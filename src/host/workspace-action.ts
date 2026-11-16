import { randomUUID } from 'node:crypto'
import { readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { RouteError } from './errors.js'
import { gitFailure, runGit } from './git.js'
import { admitHeaders, failure, json } from './http.js'
import { buildLinePatch, selectHunks } from './patch.js'
import { resolveRepository } from './repository.js'
import type { RouteContext, WorkspaceCommit } from './types.js'

interface ActionBody {
  action?: unknown
  path?: unknown
  paths?: unknown
  all?: unknown
  message?: unknown
  amend?: unknown
  push?: unknown
  mode?: unknown
  hunks?: unknown
  lines?: unknown
}

const MAX_BODY_BYTES = 64 * 1024

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name]
  if (value === undefined) return null
  return Array.isArray(value) ? value.join(', ') : value
}

async function readJson(req: IncomingMessage): Promise<ActionBody> {
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
    return parsed as ActionBody
  } catch {
    throw new RouteError(400, 'invalid-body', 'The request body must be a JSON object.')
  }
}

function parsePaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item !== '' && !item.includes('\0'))
    .slice(0, 1000)
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  res.end(Buffer.from(await response.arrayBuffer()))
}

/** Map a failed commit onto a clearer workspace message where possible. */
function commitFailure(error: unknown): RouteError {
  const failed = (error ?? {}) as { stderr?: string | Buffer; message?: string }
  const detail = String(failed.stderr ?? '').trim().slice(0, 1200) || String(failed.message ?? 'git commit failed')
  if (/nothing to commit|no changes added|nothing added to commit/i.test(detail)) {
    return new RouteError(409, 'nothing-to-commit', 'There are no staged changes to commit.', { detail })
  }
  if (/Please tell me who you are|unable to auto-detect email/i.test(detail)) {
    return new RouteError(409, 'author-missing', 'Git has no user.name or user.email configured.', { detail })
  }
  if (/hook|pre-commit|commit-msg/i.test(detail)) {
    return new RouteError(409, 'hook-failed', 'A Git commit hook rejected the commit.', { detail })
  }
  return gitFailure(error)
}

async function readCommitResult(root: string, signal: AbortSignal, push: boolean): Promise<WorkspaceCommit> {
  const hash = (await runGit(root, ['rev-parse', 'HEAD'], signal)).trim()
  const shortHash = (await runGit(root, ['rev-parse', '--short', 'HEAD'], signal)).trim()
  const subject = (await runGit(root, ['log', '-1', '--format=%s'], signal)).trim()
  const branch = (await runGit(root, ['branch', '--show-current'], signal)).trim()
  let upstream: string | null = null
  try {
    const value = (await runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], signal)).trim()
    upstream = value === '' ? null : value
  } catch {
    upstream = null
  }
  let pushed = false
  if (push) {
    if (upstream === null) throw new RouteError(409, 'no-upstream', 'The current branch has no upstream to push to.')
    // Push the upstream's remote branch explicitly: `git push` with the default
    // `simple` mode fails when the upstream name differs from the local branch.
    const slash = upstream.indexOf('/')
    if (slash <= 0) throw new RouteError(409, 'no-upstream', 'The current branch has no upstream to push to.')
    const remote = upstream.slice(0, slash)
    const target = upstream.slice(slash + 1)
    await runGit(root, ['push', remote, `HEAD:${target}`], signal)
    pushed = true
  }
  return { hash, shortHash, subject, branch, upstream, pushed }
}

/** POST /git-suite/action: stage, unstage, and commit working-tree changes. */
export function createWorkspaceActionHandler(context: RouteContext): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
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
        error: { code: 'method-not-allowed', message: 'Workspace actions require POST.' },
      }, 405))
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    res.once('close', () => controller.abort())
    try {
      const body = await readJson(req)
      const action = typeof body.action === 'string' ? body.action : ''
      const rawPath = typeof body.path === 'string' ? body.path : ''
      const repo = await resolveRepository(context, rawPath, controller.signal)

      if (action === 'stage' || action === 'unstage') {
        const paths = parsePaths(body.paths)
        const all = body.all === true
        if (!all && paths.length === 0) throw new RouteError(400, 'no-paths', 'Select at least one file.')
        if (action === 'stage') {
          const args = all ? ['add', '-A'] : ['add', '-A', '--', ...paths]
          await runGit(repo.root, args, controller.signal)
        } else {
          const args = all ? ['reset', '-q', 'HEAD'] : ['reset', '-q', 'HEAD', '--', ...paths]
          await runGit(repo.root, args, controller.signal)
        }
        await send(res, json({ ok: true, action }))
        return
      }

      if (action === 'stage-lines' || action === 'unstage-lines') {
        const paths = parsePaths(body.paths)
        const target = paths[0]
        if (target === undefined) throw new RouteError(400, 'no-paths', 'Select a file.')
        const absolute = resolve(repo.root, target)
        const rel = relative(repo.root, absolute)
        if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
          throw new RouteError(400, 'invalid-path', 'That file is outside the repository.', { path: target })
        }
        const rawLines = Array.isArray(body.lines) ? body.lines : []
        const lines = rawLines.filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0)
        if (lines.length === 0) throw new RouteError(400, 'no-lines', 'Select at least one line.')
        const reverse = action === 'unstage-lines'
        let diff = ''
        try {
          diff = await runGit(repo.root, ['diff', ...(reverse ? ['--cached'] : []), '--', rel], controller.signal)
        } catch (error) {
          throw gitFailure(error)
        }
        const patch = buildLinePatch(diff, lines)
        if (patch === null) {
          throw new RouteError(404, 'no-lines', 'Those lines cannot be applied on their own.', { file: rel })
        }
        const patchFile = join(tmpdir(), `dsh-git-suite-${randomUUID()}.patch`)
        try {
          await writeFile(patchFile, patch, 'utf8')
          await runGit(
            repo.root,
            ['apply', '--cached', '--recount', '--unidiff-zero', '--whitespace=nowarn', ...(reverse ? ['--reverse'] : []), patchFile],
            controller.signal,
          )
        } catch (error) {
          throw gitFailure(error)
        } finally {
          await unlink(patchFile).catch(() => {})
        }
        await send(res, json({ ok: true, action, file: rel, lines }))
        return
      }

      if (action === 'stage-hunks' || action === 'unstage-hunks') {
        const paths = parsePaths(body.paths)
        const target = paths[0]
        if (target === undefined) throw new RouteError(400, 'no-paths', 'Select a file.')
        const absolute = resolve(repo.root, target)
        const rel = relative(repo.root, absolute)
        if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
          throw new RouteError(400, 'invalid-path', 'That file is outside the repository.', { path: target })
        }
        const raw = Array.isArray(body.hunks) ? body.hunks : []
        const hunks = raw.filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0)
        if (hunks.length === 0) throw new RouteError(400, 'no-hunks', 'Select at least one hunk.')
        const reverse = action === 'unstage-hunks'
        let diff = ''
        try {
          diff = await runGit(
            repo.root,
            ['diff', ...(reverse ? ['--cached'] : []), '--', rel],
            controller.signal,
          )
        } catch (error) {
          throw gitFailure(error)
        }
        const patch = selectHunks(diff, hunks)
        if (patch === null) {
          throw new RouteError(404, 'no-hunks', 'That file has no hunk to apply.', { file: rel })
        }
        // `git apply` needs the patch on disk; runGit only passes arguments.
        const patchFile = join(tmpdir(), `dsh-git-suite-${randomUUID()}.patch`)
        try {
          await writeFile(patchFile, patch, 'utf8')
          await runGit(
            repo.root,
            ['apply', '--cached', '--whitespace=nowarn', ...(reverse ? ['--reverse'] : []), patchFile],
            controller.signal,
          )
        } catch (error) {
          throw gitFailure(error)
        } finally {
          await unlink(patchFile).catch(() => {})
        }
        await send(res, json({ ok: true, action, file: rel, hunks }))
        return
      }

      if (action === 'discard' || action === 'delete') {
        const paths = parsePaths(body.paths)
        if (paths.length === 0) throw new RouteError(400, 'no-paths', 'Select at least one file.')
        const targets = paths.map(path => {
          const absolute = resolve(repo.root, path)
          const inside = relative(repo.root, absolute)
          if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
            throw new RouteError(400, 'invalid-path', 'That file is outside the repository.', { path })
          }
          return { rel: inside, abs: absolute }
        })
        if (action === 'discard') {
          try {
            await runGit(repo.root, ['checkout', '--', ...targets.map(target => target.rel)], controller.signal)
          } catch (error) {
            throw gitFailure(error)
          }
        } else {
          for (const target of targets) {
            let tracked = true
            try {
              await runGit(repo.root, ['ls-files', '--error-unmatch', '--', target.rel], controller.signal)
            } catch {
              tracked = false
            }
            if (tracked) {
              throw new RouteError(409, 'tracked-file', 'That file is tracked; delete only applies to untracked files.', { file: target.rel })
            }
            try {
              await stat(target.abs)
            } catch {
              throw new RouteError(404, 'file-missing', 'That file does not exist on disk.', { file: target.rel })
            }
            await rm(target.abs, { force: true })
          }
        }
        await send(res, json({ ok: true, action }))
        return
      }

      if (action === 'ignore') {
        const mode = body.mode === 'name' || body.mode === 'extension' ? body.mode : 'file'
        const paths = parsePaths(body.paths)
        const target = paths[0]
        if (target === undefined) throw new RouteError(400, 'no-paths', 'Select at least one file.')
        const absolute = resolve(repo.root, target)
        const inside = relative(repo.root, absolute)
        if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
          throw new RouteError(400, 'invalid-path', 'That file is outside the repository.', { path: target })
        }
        let tracked = true
        try {
          await runGit(repo.root, ['ls-files', '--error-unmatch', '--', inside], controller.signal)
        } catch {
          tracked = false
        }
        if (tracked) {
          throw new RouteError(409, 'tracked-file', 'That file is tracked; ignoring it has no effect.', { file: inside })
        }
        const posix = inside.split(sep).join('/')
        const base = posix.split('/').pop() ?? posix
        const dot = base.lastIndexOf('.')
        const extension = dot > 0 ? base.slice(dot + 1) : ''
        const pattern = mode === 'name' ? base : mode === 'extension' ? (extension === '' ? '' : `*.${extension}`) : posix
        if (pattern === '') {
          throw new RouteError(400, 'no-extension', 'That file has no extension to ignore.', { file: inside })
        }
        const ignorePath = join(repo.root, '.gitignore')
        let existing = ''
        try {
          existing = await readFile(ignorePath, 'utf8')
        } catch {
          existing = ''
        }
        const lines = existing.split(/\r?\n/).map(line => line.trim())
        if (!lines.includes(pattern)) {
          const next = existing.trim() === '' ? `${pattern}\n` : `${existing.replace(/[\s\r\n]+$/, '')}\n${pattern}\n`
          await writeFile(ignorePath, next, 'utf8')
        }
        await send(res, json({ ok: true, action, pattern }))
        return
      }

      if (action === 'commit') {
        const message = typeof body.message === 'string' ? body.message.trim() : ''
        if (message === '') throw new RouteError(400, 'empty-message', 'Enter a commit message.')
        if (message.length > 20_000) throw new RouteError(400, 'message-too-long', 'The commit message is too long.')
        const amend = body.amend === true
        const push = body.push === true
        try {
          await runGit(repo.root, ['commit', '-m', message, ...(amend ? ['--amend'] : [])], controller.signal)
        } catch (error) {
          throw commitFailure(error)
        }
        const commit = await readCommitResult(repo.root, controller.signal, push)
        await send(res, json({ ok: true, action, commit }))
        return
      }

      throw new RouteError(400, 'invalid-action', 'Unknown workspace action.')
    } catch (error) {
      await send(res, failure(error))
    } finally {
      clearTimeout(timeout)
    }
  }
}


