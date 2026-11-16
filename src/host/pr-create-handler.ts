import type { IncomingMessage, ServerResponse } from 'node:http'
import { RouteError } from './errors.js'
import { detectForge } from './forge/detect.js'
import { createPull } from './forge/index.js'
import { readDefaultBase, resolveRemote } from './forge/remote.js'
import { resolveForgeToken } from './forge/token.js'
import { runGit } from './git.js'
import { admitHeaders, failure, json } from './http.js'
import { resolveRepository } from './repository.js'
import type { RouteContext } from './types.js'

interface CreateBody {
  path?: unknown
  remote?: unknown
  title?: unknown
  body?: unknown
  base?: unknown
  /** Local branch to open the request from; defaults to the checked-out branch. */
  head?: unknown
  draft?: unknown
}

const MAX_BODY_BYTES = 64 * 1024
const MAX_TITLE = 256
const MAX_DESCRIPTION = 20_000

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name]
  if (value === undefined) return null
  return Array.isArray(value) ? value.join(', ') : value
}

async function readJson(req: IncomingMessage): Promise<CreateBody> {
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
    return parsed as CreateBody
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

/** The checked-out branch and the remote branch that would become the PR head. */
async function headRef(
  root: string,
  signal: AbortSignal,
  requested = '',
): Promise<{ local: string; remote: string; branch: string }> {
  const local = requested === ''
    ? (await runGit(root, ['branch', '--show-current'], signal)).trim()
    : requested
  if (local === '') {
    throw new RouteError(409, 'detached-head', 'Check out a local branch before creating a pull request.')
  }
  // A branch chosen in the dialog must still exist locally.
  try {
    await runGit(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${local}`], signal)
  } catch {
    throw new RouteError(400, 'unknown-branch', 'That local branch no longer exists.', { branch: local })
  }
  let remote = ''
  let branch = local
  try {
    remote = (await runGit(root, ['config', '--get', `branch.${local}.remote`], signal)).trim()
  } catch {
    // No upstream configured.
  }
  try {
    const merge = (await runGit(root, ['config', '--get', `branch.${local}.merge`], signal)).trim()
    if (merge.startsWith('refs/heads/')) branch = merge.slice('refs/heads/'.length)
  } catch {
    // No merge ref configured.
  }
  if (remote === '.') remote = ''
  return { local, remote, branch }
}

/**
 * Whether the branch exists on the remote. A tracking ref is enough; if push
 * just created the branch the ref may not exist yet, so ask the remote. A
 * network/credential failure is left to the forge API instead of blocking.
 */
async function remoteHasBranch(
  root: string,
  remote: string,
  branch: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    await runGit(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${branch}`], signal)
    return true
  } catch {
    // No local tracking ref: ask the remote below.
  }
  try {
    const output = await runGit(root, ['ls-remote', '--heads', remote, `refs/heads/${branch}`], signal)
    return output.trim() !== ''
  } catch {
    return true
  }
}

/**
 * POST /git-suite/pr-create: open a pull/merge request from the current branch
 * into a base branch on the selected remote. The head may live on a different
 * remote of the same forge (a fork), in which case the provider API receives a
 * qualified head ref (`owner:branch`) or the fork's GitLab project id.
 */
export function createPullCreateHandler(context: RouteContext): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (!admitHeaders(name => header(req, name))) {
      await send(res, json({
        ok: false,
        error: { code: 'forbidden', message: 'This request is not allowed to create a pull request.' },
      }, 403))
      return
    }
    if (req.method !== 'POST') {
      await send(res, json({
        ok: false,
        error: { code: 'method-not-allowed', message: 'Creating a pull request requires POST.' },
      }, 405))
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)
    res.once('close', () => controller.abort())
    const signal = controller.signal
    try {
      const body = await readJson(req)
      const title = text(body.title)
      const description = typeof body.body === 'string' ? body.body : ''
      const draft = body.draft === true
      if (title === '' || title.length > MAX_TITLE) {
        throw new RouteError(400, 'invalid-title', 'Enter a title of at most 256 characters.')
      }
      if (description.length > MAX_DESCRIPTION) {
        throw new RouteError(400, 'description-too-long', 'The description is too long.')
      }

      const repo = await resolveRepository(context, typeof body.path === 'string' ? body.path : '', signal)
      const remote = await resolveRemote(repo.root, typeof body.remote === 'string' ? body.remote : '', signal)
      const target = detectForge(remote.url)
      if (target === null) {
        throw new RouteError(400, 'forge-unsupported', 'This remote is not hosted on a supported forge.', { remote: remote.name })
      }

      const headInfo = await headRef(repo.root, signal, text(body.head))
      const headRemoteName = headInfo.remote === '' ? remote.name : headInfo.remote
      const headRemote = headRemoteName === remote.name
        ? remote
        : await resolveRemote(repo.root, headRemoteName, signal)
      const headTarget = detectForge(headRemote.url)
      if (headTarget === null) {
        throw new RouteError(400, 'forge-unsupported', 'The source remote is not hosted on a supported forge.', { remote: headRemote.name })
      }
      if (headTarget.provider !== target.provider || headTarget.host.toLowerCase() !== target.host.toLowerCase()) {
        throw new RouteError(
          400,
          'cross-forge-unsupported',
          'The source and target remotes must be on the same forge and host.',
          { source: headRemote.name, target: remote.name },
        )
      }
      const sameRepo = headTarget.owner.toLowerCase() === target.owner.toLowerCase()
        && headTarget.repo.toLowerCase() === target.repo.toLowerCase()
      const headBranch = headInfo.branch
      const requestedBase = text(body.base)
      const base = requestedBase === '' ? await readDefaultBase(repo.root, remote.name, signal) : requestedBase
      if (base === '') {
        throw new RouteError(400, 'base-required', 'Choose the branch the pull request should target.', { remote: remote.name })
      }
      if (sameRepo && base === headBranch) {
        throw new RouteError(400, 'same-branch', 'The source and target branches must differ.', { branch: headBranch })
      }
      if (!(await remoteHasBranch(repo.root, headRemote.name, headBranch, signal))) {
        throw new RouteError(409, 'branch-not-pushed', 'Push this branch before creating a pull request.', {
          remote: headRemote.name,
          branch: headBranch,
          local: true,
        })
      }
      if (!(await remoteHasBranch(repo.root, remote.name, base, signal))) {
        throw new RouteError(400, 'invalid-base', 'That base branch does not exist on the remote.', {
          remote: remote.name,
          branch: base,
          local: false,
        })
      }

      const token = await resolveForgeToken(repo.root, target, signal)
      if (token === null) {
        throw new RouteError(401, 'forge-auth-required', 'The forge requires an access token.', {
          remote: remote.name,
          provider: target.provider,
          host: target.host,
        })
      }

      try {
        const pull = await createPull(target, token, {
          title,
          body: description,
          head: sameRepo ? headBranch : `${headTarget.owner}:${headBranch}`,
          base,
          draft,
          headProjectPath: target.provider === 'gitlab' && !sameRepo ? headTarget.projectPath : null,
        }, signal)
        await send(res, json({ ok: true, pull, number: pull.number, webUrl: pull.webUrl }))
      } catch (error) {
        if (!(error instanceof RouteError)) throw error
        const detail = typeof error.details?.detail === 'string' ? error.details.detail : ''
        // Surface the forge's own reason (duplicate request, branch rules, …).
        if (detail !== '' && error.code === 'forge-request-failed') {
          throw new RouteError(error.status, error.code, `${error.message} ${detail}`, { ...error.details, remote: remote.name })
        }
        throw error.withDetails({ remote: remote.name })
      }
    } catch (error) {
      await send(res, failure(error))
    } finally {
      clearTimeout(timeout)
    }
  }
}
