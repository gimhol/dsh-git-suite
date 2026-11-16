import type { IncomingMessage, ServerResponse } from 'node:http'
import { RouteError } from './errors.js'
import { gitFailure, runGit } from './git.js'
import { admitHeaders, failure, json } from './http.js'
import { resolveRepository } from './repository.js'
import type { RouteContext } from './types.js'

interface SyncBody {
  action?: unknown
  path?: unknown
  remote?: unknown
  branch?: unknown
  refs?: unknown
  tagRefs?: unknown
  tag?: unknown
  tags?: unknown
  force?: unknown
  fetchAll?: unknown
  prune?: unknown
  forceTags?: unknown
}

const MAX_BODY_BYTES = 64 * 1024

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name]
  if (value === undefined) return null
  return Array.isArray(value) ? value.join(', ') : value
}

async function readJson(req: IncomingMessage): Promise<SyncBody> {
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
    return parsed as SyncBody
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

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Strip any userinfo a remote URL may embed before it reaches the UI. */
function safeUrl(url: string): string {
  return url.replace(/\/\/[^@/]+@/, '//')
}

/** Whether `ancestor` is reachable from `descendant`. */
async function isAncestor(root: string, ancestor: string, descendant: string, signal: AbortSignal): Promise<boolean> {
  try {
    await runGit(root, ['merge-base', '--is-ancestor', ancestor, descendant], signal)
    return true
  } catch {
    return false
  }
}

/**
 * Whether another worktree has this branch checked out. Moving its ref from here
 * would leave that worktree pointing at a tree its index no longer matches.
 */
async function checkedOutElsewhere(root: string, branch: string, signal: AbortSignal): Promise<boolean> {
  try {
    const output = await runGit(root, ['worktree', 'list', '--porcelain'], signal)
    return output.split(/\r?\n/).some(line => line === `branch refs/heads/${branch}`)
  } catch {
    return false
  }
}

/**
 * A push/pull that failed on authentication gets the remote, its URL scheme,
 * and the configured credential helper, so the client can offer to store a
 * token instead of only printing git's stderr.
 */
async function annotateAuthFailure(
  repoRoot: string,
  error: unknown,
  remote: string,
  signal: AbortSignal,
): Promise<RouteError> {
  const failure = gitFailure(error)
  if (failure.code !== 'auth-required') return failure
  let url = ''
  try {
    url = (await runGit(repoRoot, ['remote', 'get-url', remote], signal)).trim()
  } catch {
    url = ''
  }
  const scheme = /^https?:/i.test(url) ? 'https' : /^ssh:|^[^/]+@[^:]+:/.test(url) ? 'ssh' : 'other'
  let helper: string | null = null
  try {
    const value = (await runGit(repoRoot, ['config', '--get-all', 'credential.helper'], signal)).trim()
    helper = value === '' ? null : value.split(/\r?\n/).join(', ')
  } catch {
    helper = null
  }
  return failure.withDetails({ remote, scheme, helper, ...(url === '' ? {} : { url: safeUrl(url) }) })
}

/** POST /git-suite/sync: fetch all remotes, or pull/push one remote branch. */
export function createSyncHandler(context: RouteContext): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (!admitHeaders(name => header(req, name))) {
      await send(res, json({
        ok: false,
        error: { code: 'forbidden', message: 'This request is not allowed to modify the repository.' },
      }, 403))
      return
    }
    if (req.method !== 'POST') {
      await send(res, json({
        ok: false,
        error: { code: 'method-not-allowed', message: 'Sync actions require POST.' },
      }, 405))
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    res.once('close', () => controller.abort())
    try {
      const body = await readJson(req)
      const action = text(body.action)
      const repo = await resolveRepository(context, text(body.path), controller.signal)

      if (action === 'fetch') {
        const remote = text(body.remote)
        const args = ['fetch']
        if (remote !== '') {
          const remotes = (await runGit(repo.root, ['remote'], controller.signal))
            .split(/\r?\n/)
            .map(item => item.trim())
            .filter(item => item !== '')
          if (!remotes.includes(remote)) {
            throw new RouteError(400, 'unknown-remote', 'That remote is not configured in this repository.', { remote })
          }
          args.push(remote)
        } else if (body.fetchAll === true) {
          args.push('--all')
        }
        args.push(
          ...(body.prune === true ? ['--prune'] : []),
          ...(body.tags === true ? ['--tags'] : []),
          ...(body.forceTags === true ? ['--force'] : []),
        )
        try {
          await runGit(repo.root, args, controller.signal)
        } catch (error) {
          throw await annotateAuthFailure(repo.root, error, remote, controller.signal)
        }
        await send(res, json({ ok: true, action, ...(remote === '' ? {} : { remote }) }))
        return
      }

      if (action !== 'pull' && action !== 'push' && action !== 'fetch-tag') {
        throw new RouteError(400, 'invalid-action', 'Unknown sync action.')
      }
      const remote = text(body.remote)
      if (remote === '') {
        throw new RouteError(400, 'remote-required', 'Choose a remote.')
      }
      const remotes = (await runGit(repo.root, ['remote'], controller.signal))
        .split(/\r?\n/)
        .map(item => item.trim())
        .filter(item => item !== '')
      if (!remotes.includes(remote)) {
        throw new RouteError(400, 'unknown-remote', 'That remote is not configured in this repository.', { remote })
      }

      if (action === 'fetch-tag') {
        const name = text(body.tag)
        try {
          await runGit(repo.root, ['check-ref-format', `refs/tags/${name}`], controller.signal)
        } catch {
          throw new RouteError(400, 'invalid-tag', 'That tag name is not valid.', { tag: name })
        }
        try {
          await runGit(repo.root, ['fetch', '--force', remote, `refs/tags/${name}:refs/tags/${name}`], controller.signal)
        } catch (error) {
          throw await annotateAuthFailure(repo.root, error, remote, controller.signal).then(failure => failure.withDetails({ tag: name }))
        }
        await send(res, json({ ok: true, action, remote, tag: name }))
        return
      }

      if (action === 'pull') {
        const branch = text(body.branch)
        if (branch === '') {
          throw new RouteError(400, 'branch-required', 'Choose a branch.')
        }
        try {
          await runGit(repo.root, ['check-ref-format', '--branch', branch], controller.signal)
        } catch {
          throw new RouteError(400, 'invalid-branch', 'That branch name is not valid.', { branch })
        }
        const current = (await runGit(repo.root, ['branch', '--show-current'], controller.signal)).trim()
        if (current === branch) {
          try {
            await runGit(repo.root, ['pull', remote, branch], controller.signal)
          } catch (error) {
            throw await annotateAuthFailure(repo.root, error, remote, controller.signal)
          }
        } else {
          // `git pull` always merges into the checked-out branch, so pulling a
          // branch the user did not check out has to fast-forward its ref instead.
          const localRef = `refs/heads/${branch}`
          let localTip: string
          try {
            localTip = (await runGit(repo.root, ['rev-parse', '--verify', '--quiet', `${localRef}^{commit}`], controller.signal)).trim()
          } catch {
            throw new RouteError(404, 'branch-not-found', 'That local branch does not exist.', { branch })
          }
          if (await checkedOutElsewhere(repo.root, branch, controller.signal)) {
            throw new RouteError(409, 'branch-checked-out', 'That branch is checked out in another worktree.', { branch })
          }
          try {
            await runGit(repo.root, ['fetch', remote, branch], controller.signal)
          } catch (error) {
            throw await annotateAuthFailure(repo.root, error, remote, controller.signal)
          }
          const remoteTip = (await runGit(repo.root, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], controller.signal)).trim()
          if (remoteTip !== localTip) {
            if (await isAncestor(repo.root, localTip, remoteTip, controller.signal)) {
              // A plain fast-forward: the branch moves, the worktree is untouched.
              await runGit(repo.root, ['update-ref', localRef, remoteTip], controller.signal)
            } else if (!(await isAncestor(repo.root, remoteTip, localTip, controller.signal))) {
              throw new RouteError(409, 'diverged', 'That branch has diverged from its remote; check it out to merge.', { branch })
            }
          }
        }
        await send(res, json({ ok: true, action, remote, branch }))
        return
      }

      const rawRefs = Array.isArray(body.refs) ? body.refs : []
      const refs: { local: string; remote: string; track: boolean }[] = []
      for (const item of rawRefs) {
        if (typeof item !== 'object' || item === null) continue
        const record = item as Record<string, unknown>
        const local = text(record.local)
        const target = text(record.remote)
        if (local === '' || target === '') continue
        refs.push({ local, remote: target, track: record.track === true })
      }
      const tags = body.tags === true
      const force = body.force === true
      const rawTagRefs = Array.isArray(body.tagRefs) ? body.tagRefs : []
      const tagRefs = rawTagRefs
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(item => item !== '')
        .slice(0, 50)
      if (refs.length === 0 && !tags && tagRefs.length === 0) {
        throw new RouteError(400, 'no-refs', 'Select at least one branch or tag to push.')
      }
      for (const ref of refs) {
        try {
          await runGit(repo.root, ['check-ref-format', '--branch', ref.local], controller.signal)
          await runGit(repo.root, ['check-ref-format', '--branch', ref.remote], controller.signal)
        } catch {
          throw new RouteError(400, 'invalid-branch', 'A branch name is not valid.', { branch: ref.local })
        }
      }
      for (const name of tagRefs) {
        try {
          await runGit(repo.root, ['check-ref-format', `refs/tags/${name}`], controller.signal)
        } catch {
          throw new RouteError(400, 'invalid-tag', 'That tag name is not valid.', { tag: name })
        }
      }
      try {
        for (const name of tagRefs) {
          await runGit(repo.root, [
            'push',
            ...(force ? ['--force'] : []),
            remote,
            `refs/tags/${name}:refs/tags/${name}`,
          ], controller.signal)
        }
        for (const ref of refs) {
          await runGit(repo.root, [
            'push',
            ...(force ? ['--force'] : []),
            ...(ref.track ? ['--set-upstream'] : []),
            remote,
            `${ref.local}:${ref.remote}`,
          ], controller.signal)
        }
        if (tags) {
          await runGit(repo.root, ['push', ...(force ? ['--force'] : []), remote, '--tags'], controller.signal)
        }
      } catch (error) {
        throw await annotateAuthFailure(repo.root, error, remote, controller.signal)
      }
      await send(res, json({ ok: true, action, remote }))
    } catch (error) {
      await send(res, failure(error))
    } finally {
      clearTimeout(timeout)
    }
  }
}

