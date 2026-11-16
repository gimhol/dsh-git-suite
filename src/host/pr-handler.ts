import type { IncomingMessage, ServerResponse } from 'node:http'
import { RouteError } from './errors.js'
import { detectForge, type ForgeTarget } from './forge/detect.js'
import { closePull, getPull, mergePull, reopenPull } from './forge/index.js'
import { resolveRemote } from './forge/remote.js'
import { resolveForgeToken } from './forge/token.js'
import { gitFailure, runGit, type GitExecError } from './git.js'
import { admitHeaders, failure, json } from './http.js'
import { resolveRepository } from './repository.js'
import type { PullDetail, RouteContext } from './types.js'

interface PullBody {
  path?: unknown
  remote?: unknown
  number?: unknown
  /** `checkout` (default), `close`, `reopen`, or `merge`. */
  action?: unknown
  /** merge: the base branch to fast-forward locally after the merge. */
  base?: unknown
  mergeMethod?: unknown
  deleteSourceBranch?: unknown
}

type PullAction = 'checkout' | 'close' | 'reopen' | 'merge'

const MAX_BODY_BYTES = 16 * 1024
const FETCH_TIMEOUT_MS = 120_000

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name]
  if (value === undefined) return null
  return Array.isArray(value) ? value.join(', ') : value
}

async function readJson(req: IncomingMessage): Promise<PullBody> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new RouteError(413, 'body-too-large', 'The request body is too large.')
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object')
    return parsed as PullBody
  } catch {
    throw new RouteError(400, 'invalid-body', 'The request body must be a JSON object.')
  }
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  res.end(Buffer.from(await response.arrayBuffer()))
}

function numberFrom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new RouteError(400, 'invalid-number', 'Choose a valid pull request number.')
  }
  return value
}

/** The remote-tracking ref a pull request is fetched into. */
function trackingRef(remote: string, number: number): string {
  return `refs/remotes/${remote}/pr/${number}`
}

/** A remote URL git may fetch over the network (never a local path). */
function isNetworkRemote(value: string): boolean {
  if (/^(https?|ssh|git):\/\//i.test(value)) return true
  return /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[^\s]+$/.test(value)
}

/** A branch name safe to place inside a refspec. */
function isSafeBranch(name: string): boolean {
  if (name === '') return false
  if (name.startsWith('-') || name.includes('..') || name.includes('@{')) return false
  return !/[\u0000-\u0020~^:?*\[\\]/.test(name)
}

/** Prefer the forge's own pull-request ref; fall back to the source branch. */
async function fetchPull(
  root: string,
  remote: string,
  number: number,
  target: ForgeTarget,
  detail: PullDetail | null,
  signal: AbortSignal,
): Promise<{ localRef: string; fetchedFrom: string }> {
  const destination = trackingRef(remote, number)
  const attempts: Array<{ url: string; ref: string }> = []
  const pullRef = target.provider === 'gitlab' ? `refs/merge-requests/${number}/head` : `refs/pull/${number}/head`
  attempts.push({ url: remote, ref: pullRef })

  const sourceBranch = detail?.sourceBranch ?? ''
  if (detail !== null && isSafeBranch(sourceBranch)) {
    attempts.push({ url: remote, ref: `refs/heads/${sourceBranch}` })
  }
  if (detail !== null && isSafeBranch(sourceBranch) && detail.headRepoUrl !== null && isNetworkRemote(detail.headRepoUrl)) {
    attempts.push({ url: detail.headRepoUrl, ref: `refs/heads/${sourceBranch}` })
  }

  let lastError: unknown = null
  for (const attempt of attempts) {
    try {
      await runGit(root, ['fetch', '--no-tags', attempt.url, `+${attempt.ref}:${destination}`], signal, FETCH_TIMEOUT_MS)
      return { localRef: destination, fetchedFrom: attempt.url === remote ? remote : attempt.url }
    } catch (error) {
      lastError = error
    }
  }
  throw gitFailure(lastError).withDetails({ remote, number })
}

/** Map a refused switch onto the route's worktree-dirty vocabulary. */
function switchFailure(error: unknown, branch: string): RouteError {
  const failed = (error ?? {}) as GitExecError
  const detail = String(failed.stderr ?? '').trim().slice(0, 1200)
  if (/would be overwritten|Please commit your changes|local changes/i.test(detail)) {
    return new RouteError(409, 'worktree-dirty', 'The working tree has changes this checkout would overwrite.', {
      branch,
      detail,
    })
  }
  return gitFailure(error).withDetails({ branch })
}

/** True when a head repository URL points at the same owner/repo as the target. */
function headRepoMatches(url: string, target: ForgeTarget): boolean {
  try {
    const path = new URL(url).pathname.replace(/^\/+/, '').replace(/\.git$/i, '')
    return path.toLowerCase() === `${target.owner}/${target.repo}`.toLowerCase()
  } catch {
    return false
  }
}

/**
 * After a merge the forge holds a commit the local clone has not seen. Fetch
 * the base branch and, when it is checked out, fast-forward it so History shows
 * the merge immediately. Every failure is non-fatal: the merge already happened.
 */
async function syncBaseAfterMerge(
  root: string,
  remote: string,
  base: string,
  signal: AbortSignal,
): Promise<{ base: string; fetched: boolean; pulled: boolean }> {
  if (base === '') return { base, fetched: false, pulled: false }
  try {
    await runGit(root, ['fetch', '--no-tags', remote, `+refs/heads/${base}:refs/remotes/${remote}/${base}`], signal)
  } catch {
    return { base, fetched: false, pulled: false }
  }
  let current = ''
  try {
    current = (await runGit(root, ['branch', '--show-current'], signal)).trim()
  } catch {
    current = ''
  }
  if (current !== base) return { base, fetched: true, pulled: false }
  try {
    await runGit(root, ['merge', '--ff-only', `refs/remotes/${remote}/${base}`], signal)
    return { base, fetched: true, pulled: true }
  } catch {
    return { base, fetched: true, pulled: false }
  }
}

/**
 * POST /git-suite/pr: `action: 'checkout'` fetches one pull request into a local
 * `pr/<number>` branch and switches to it; `POST /git-suite/pr-close` and
 * `POST /git-suite/pr-reopen` change its state on the forge.
 */
export function createPullHandler(
  context: RouteContext,
  options?: { defaultAction?: PullAction },
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const fallback = options?.defaultAction ?? 'checkout'
  return async (req, res) => {
    if (!admitHeaders(name => header(req, name))) {
      await send(res, json({
        ok: false,
        error: { code: 'forbidden', message: 'This request is not allowed to change a pull request.' },
      }, 403))
      return
    }
    if (req.method !== 'POST') {
      await send(res, json({
        ok: false,
        error: { code: 'method-not-allowed', message: 'Changing a pull request requires POST.' },
      }, 405))
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 300_000)
    res.once('close', () => controller.abort())
    const signal = controller.signal
    try {
      const body = await readJson(req)
      const requested = body.action === undefined ? fallback : body.action
      const action = requested === 'checkout' || requested === 'close' || requested === 'reopen' || requested === 'merge'
        ? requested
        : null
      if (action === null) throw new RouteError(400, 'invalid-action', 'Choose the checkout, close, reopen, or merge action.')
      const number = numberFrom(body.number)
      const repo = await resolveRepository(context, typeof body.path === 'string' ? body.path : '', signal)
      const remote = await resolveRemote(repo.root, typeof body.remote === 'string' ? body.remote : '', signal)
      const target = detectForge(remote.url)
      if (target === null) {
        throw new RouteError(400, 'forge-unsupported', 'This remote is not hosted on a supported forge.', { remote: remote.name })
      }

      if (action === 'merge') {
        const method = body.mergeMethod === 'squash' || body.mergeMethod === 'rebase' ? body.mergeMethod : 'merge'
        if (target.provider !== 'github' && method === 'rebase') {
          throw new RouteError(400, 'unsupported-merge-method', 'Rebase merging is only available on GitHub.')
        }
        const token = await resolveForgeToken(repo.root, target, signal)
        if (token === null) {
          throw new RouteError(401, 'forge-auth-required', 'The forge requires an access token.', {
            remote: remote.name,
            provider: target.provider,
            host: target.host,
          })
        }
        const deleteSourceBranch = body.deleteSourceBranch === true
        let sourceBranch = ''
        let canDeleteBranch = deleteSourceBranch
        if (target.provider === 'github' && deleteSourceBranch) {
          try {
            const detail = await getPull(target, number, token, signal)
            sourceBranch = detail.sourceBranch
            // Only delete a branch in this repository, never a same-named branch
            // in the base repository of a fork pull request.
            canDeleteBranch = detail.headRepoUrl !== null && headRepoMatches(detail.headRepoUrl, target)
          } catch {
            sourceBranch = ''
            canDeleteBranch = false
          }
        }
        try {
          const result = await mergePull(
            target,
            number,
            token,
            { method, deleteSourceBranch: canDeleteBranch },
            sourceBranch,
            signal,
          )
          // Keep the local clone in step so History shows the merge right away.
          const sync = await syncBaseAfterMerge(
            repo.root,
            remote.name,
            typeof body.base === 'string' ? body.base.trim() : '',
            signal,
          )
          await send(res, json({ ok: true, ...result, ...sync }))
        } catch (error) {
          if (error instanceof RouteError) throw error.withDetails({ remote: remote.name })
          throw error
        }
        return
      }

      if (action !== 'checkout') {
        const token = await resolveForgeToken(repo.root, target, signal)
        if (token === null) {
          throw new RouteError(401, 'forge-auth-required', 'The forge requires an access token.', {
            remote: remote.name,
            provider: target.provider,
            host: target.host,
          })
        }
        try {
          if (action === 'close') await closePull(target, number, token, signal)
          else await reopenPull(target, number, token, signal)
        } catch (error) {
          if (error instanceof RouteError) throw error.withDetails({ remote: remote.name })
          throw error
        }
        await send(res, json({ ok: true, action, number }))
        return
      }

      // Preflight before any network or branch work: a dirty tree must be
      // committed or stashed explicitly instead of relying on git switch.
      let statusOutput = ''
      try {
        statusOutput = await runGit(repo.root, ['status', '--porcelain=v1', '--untracked-files=normal'], signal)
      } catch (error) {
        throw gitFailure(error)
      }
      if (statusOutput.trim() !== '') {
        const entries = statusOutput.split(/\r?\n/).filter(line => line.trim() !== '')
        const files = entries.slice(0, 20).map(line => line.slice(3).trim()).filter(path => path !== '')
        throw new RouteError(
          409,
          'worktree-dirty',
          'The working tree has uncommitted changes. Commit or stash them before checking out a pull request.',
          { files, count: entries.length },
        )
      }

      // Metadata drives the source-branch fallback; a failure here is not fatal
      // when the forge's pull-request ref can still be fetched.
      let detail: PullDetail | null = null
      try {
        const token = await resolveForgeToken(repo.root, target, signal)
        detail = await getPull(target, number, token, signal)
      } catch {
        detail = null
      }

      const fetched = await fetchPull(repo.root, remote.name, number, target, detail, signal)
      const branch = `pr/${number}`

      let existing = false
      try {
        await runGit(repo.root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], signal)
        existing = true
      } catch {
        existing = false
      }

      try {
        if (existing) {
          await runGit(repo.root, ['switch', branch], signal)
        } else {
          await runGit(repo.root, ['switch', '-c', branch, fetched.localRef], signal)
        }
      } catch (error) {
        throw switchFailure(error, branch)
      }

      const hash = (await runGit(repo.root, ['rev-parse', 'HEAD'], signal)).trim()
      await send(res, json({ ok: true, branch, hash, existing }))
    } catch (error) {
      await send(res, failure(error))
    } finally {
      clearTimeout(timeout)
    }
  }
}
