import type { IncomingMessage, ServerResponse } from 'node:http'
import { RouteError } from './errors.js'
import { gitFailure, runGit } from './git.js'
import { detectOperation } from './routes/operation.js'
import { admitHeaders, failure, json } from './http.js'
import { resolveRepository } from './repository.js'
import type { RouteContext } from './types.js'

interface BranchActionBody {
  action?: unknown
  path?: unknown
  branch?: unknown
  remote?: unknown
  newName?: unknown
  upstream?: unknown
  target?: unknown
  force?: unknown
}

const MAX_BODY_BYTES = 16 * 1024

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name]
  if (value === undefined) return null
  return Array.isArray(value) ? value.join(', ') : value
}

async function readJson(req: IncomingMessage): Promise<BranchActionBody> {
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
    return parsed as BranchActionBody
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

/** Whether `refs/heads/<name>` exists. */
async function localBranchExists(root: string, name: string, signal: AbortSignal): Promise<boolean> {
  try {
    await runGit(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], signal)
    return true
  } catch {
    return false
  }
}

/** @returns the local branch's upstream such as `origin/main`, or null when it tracks nothing. */
async function localBranchUpstream(root: string, name: string, signal: AbortSignal): Promise<string | null> {
  try {
    const upstream = (await runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${name}@{upstream}`], signal)).trim()
    return upstream === '' ? null : upstream
  } catch {
    return null
  }
}

/**
 * First free `<base>-2`, `<base>-3`, … so the caller can offer a name the user
 * only has to accept.
 */
async function suggestBranchName(root: string, base: string, signal: AbortSignal): Promise<string> {
  for (let index = 2; index <= 50; index += 1) {
    const candidate = `${base}-${index}`
    if (!(await localBranchExists(root, candidate, signal))) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

async function checkBranch(root: string, branch: string, signal: AbortSignal): Promise<void> {
  try {
    await runGit(root, ['check-ref-format', '--branch', branch], signal)
  } catch {
    throw new RouteError(400, 'invalid-branch', 'That branch name is not valid.', { branch })
  }
}

/** POST /git-suite/branch-action: merge, rebase, rename, or delete one local branch. */
export function createBranchActionHandler(context: RouteContext): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
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
        error: { code: 'method-not-allowed', message: 'Branch actions require POST.' },
      }, 405))
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    res.once('close', () => controller.abort())
    try {
      const body = await readJson(req)
      const action = text(body.action)
      const branch = text(body.branch)
      const remote = text(body.remote)
      if (!['merge', 'rebase', 'rebase-onto', 'rename', 'delete', 'track', 'delete-remote', 'upstream'].includes(action)) {
        throw new RouteError(400, 'invalid-action', 'Unknown branch action.')
      }
      const repo = await resolveRepository(context, text(body.path), controller.signal)

      // Rebasing onto an arbitrary ref acts on the current branch, so the
      // clicked branch is irrelevant and any commit-ish is accepted.
      if (action === 'rebase-onto') {
        const target = text(body.target)
        if (target === '' || target.startsWith('-')) {
          throw new RouteError(400, 'invalid-target', 'Choose a commit, tag, or branch to rebase onto.', { target })
        }
        try {
          await runGit(repo.root, ['rev-parse', '--verify', `${target}^{commit}`], controller.signal)
        } catch {
          throw new RouteError(404, 'unknown-target', 'That ref does not resolve to a commit.', { target })
        }
        const current = (await runGit(repo.root, ['rev-parse', '--abbrev-ref', 'HEAD'], controller.signal)).trim()
        if (current === 'HEAD') {
          throw new RouteError(409, 'detached-head', 'Check out a branch before rebasing.')
        }
        try {
          await runGit(repo.root, ['rebase', target], controller.signal)
        } catch (error) {
          const operation = await detectOperation(repo.root, controller.signal)
          if (operation !== null) {
            throw new RouteError(409, 'operation-conflict', 'The rebase stopped with conflicts.', {
              operation,
              detail: error instanceof Error ? error.message : String(error),
            })
          }
          throw gitFailure(error).withDetails({ target })
        }
        const head = (await runGit(repo.root, ['rev-parse', 'HEAD'], controller.signal)).trim()
        await send(res, json({ ok: true, action, branch: current, target, head }))
        return
      }

      if (branch === '') throw new RouteError(400, 'branch-required', 'Choose a branch.')
      await checkBranch(repo.root, branch, controller.signal)

      let newName: string | undefined
      if (action === 'rename') {
        newName = text(body.newName)
        if (newName === '') throw new RouteError(400, 'name-required', 'Enter a new branch name.')
        await checkBranch(repo.root, newName, controller.signal)
        try {
          await runGit(repo.root, ['branch', '-m', branch, newName], controller.signal)
        } catch (error) {
          throw gitFailure(error).withDetails({ branch })
        }
      } else if (action === 'track') {
        // `branch` is a remote-tracking ref such as `origin/main`; its tail is the
        // local name a user expects, and the one git would create itself.
        const tail = branch.split('/').slice(1).join('/')
        if (tail === '') throw new RouteError(400, 'name-required', 'Enter a local branch name.')
        const requested = text(body.newName)
        const local = requested === '' ? tail : requested
        await checkBranch(repo.root, local, controller.signal)

        if (await localBranchExists(repo.root, local, controller.signal)) {
          const upstream = await localBranchUpstream(repo.root, local, controller.signal)
          // The default name already is this remote branch's local branch: switching
          // to it is the checkout the user asked for.
          if (requested === '' && upstream === branch) {
            try {
              await runGit(repo.root, ['switch', local], controller.signal)
            } catch (error) {
              throw gitFailure(error).withDetails({ branch: local })
            }
            newName = local
          } else {
            // The name is taken by an unrelated branch: let the user choose another
            // one instead of failing with a bare git message.
            throw new RouteError(409, 'local-branch-exists', 'A local branch with that name already exists.', {
              local,
              remote: branch,
              upstream: upstream ?? '',
              ...(requested === '' ? { suggested: await suggestBranchName(repo.root, tail, controller.signal) } : {}),
            })
          }
        } else {
          try {
            await runGit(repo.root, ['switch', '--track', '-c', local, branch], controller.signal)
          } catch (error) {
            const detail = String((error as { stderr?: string | Buffer }).stderr ?? '')
            if (/already exists/i.test(detail)) {
              throw new RouteError(409, 'branch-exists', 'A local branch with that name already exists.', { branch: local })
            }
            if (/local changes|would be overwritten|not possible to check out/i.test(detail)) {
              throw new RouteError(409, 'worktree-dirty', 'The working tree has changes that would be overwritten; commit or stash them first.', { detail })
            }
            throw gitFailure(error).withDetails({ branch })
          }
          newName = local
        }
      } else if (action === 'upstream') {
        // Repoint one local branch at another remote-tracking branch (or at none).
        const upstream = text(body.upstream)
        if (!(await localBranchExists(repo.root, branch, controller.signal))) {
          throw new RouteError(404, 'branch-not-found', 'That local branch does not exist.', { branch })
        }
        if (upstream === '') {
          try {
            await runGit(repo.root, ['branch', '--unset-upstream', branch], controller.signal)
          } catch (error) {
            const detail = String((error as { stderr?: string | Buffer }).stderr ?? '')
            if (/no upstream/i.test(detail)) {
              throw new RouteError(409, 'no-upstream', 'That branch has no upstream to remove.', { branch })
            }
            throw gitFailure(error).withDetails({ branch })
          }
        } else {
          if (upstream.startsWith('-') || upstream.includes('\0') || /[\r\n]/.test(upstream)) {
            throw new RouteError(400, 'invalid-upstream', 'That upstream is not valid.', { upstream })
          }
          try {
            await runGit(repo.root, ['rev-parse', '--verify', `refs/remotes/${upstream}`], controller.signal)
          } catch {
            throw new RouteError(404, 'upstream-not-found', 'That remote branch does not exist.', { upstream })
          }
          try {
            await runGit(repo.root, ['branch', `--set-upstream-to=${upstream}`, branch], controller.signal)
          } catch (error) {
            throw gitFailure(error).withDetails({ branch, upstream })
          }
        }
        await send(res, json({ ok: true, action, branch, upstream }))
        return
      } else if (action === 'delete-remote') {
        if (remote === '') throw new RouteError(400, 'remote-required', 'Choose a remote.')
        if (remote.startsWith('-') || remote.includes('\0') || /[\r\n\s]/.test(remote)) {
          throw new RouteError(400, 'invalid-remote', 'That remote name is not valid.', { remote })
        }
        const remotes = (await runGit(repo.root, ['remote'], controller.signal))
          .split(/\r?\n/)
          .map(item => item.trim())
          .filter(item => item !== '')
        if (!remotes.includes(remote)) {
          throw new RouteError(404, 'remote-not-found', 'That remote is not configured in this repository.', { remote })
        }
        try {
          await runGit(repo.root, ['push', remote, '--delete', branch], controller.signal)
        } catch (error) {
          throw gitFailure(error).withDetails({ branch, remote })
        }
      } else if (action === 'merge') {
        try {
          await runGit(repo.root, ['merge', '--no-edit', branch], controller.signal)
        } catch (error) {
          throw gitFailure(error).withDetails({ branch })
        }
      } else if (action === 'rebase') {
        try {
          await runGit(repo.root, ['rebase', branch], controller.signal)
        } catch (error) {
          throw gitFailure(error).withDetails({ branch })
        }
      } else {
        try {
          await runGit(repo.root, ['branch', body.force === true ? '-D' : '-d', branch], controller.signal)
        } catch (error) {
          throw gitFailure(error).withDetails({ branch })
        }
      }

      await send(res, json({ ok: true, action, branch, remote, ...(newName === undefined ? {} : { newName }) }))
    } catch (error) {
      await send(res, failure(error))
    } finally {
      clearTimeout(timeout)
    }
  }
}

