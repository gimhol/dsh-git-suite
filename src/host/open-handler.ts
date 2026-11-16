import type { IncomingMessage, ServerResponse } from 'node:http'
import { RouteError } from './errors.js'
import { admitHeaders, failure, json } from './http.js'
import { resolveRepository } from './repository.js'
import type { RouteContext } from './types.js'
import { editorName, launchEditor } from './editors.js'
import { spawnDetached, type LaunchOutcome } from './launch.js'
import { findCodeExecutable, findMacApp } from './vscode.js'

interface OpenBody {
  path?: unknown
  target?: unknown
  /** Editor id for 	arget: 'editor'. */
  editor?: unknown
}

const MAX_BODY_BYTES = 16 * 1024

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name]
  if (value === undefined) return null
  return Array.isArray(value) ? value.join(', ') : value
}

async function readJson(req: IncomingMessage): Promise<OpenBody> {
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
    return parsed as OpenBody
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

/**
 * Open a terminal, the file manager, or VS Code at `root`. The result says
 * whether anything actually started, so the panel can explain a dead button.
 */
async function openTarget(target: 'terminal' | 'explorer' | 'vscode', root: string): Promise<LaunchOutcome> {
  if (target === 'vscode') {
    let command = 'code'
    let args = ['--new-window', root]
    // Only the `code.cmd` shim needs its console window hidden; a GUI executable
    // started hidden would come up without a window at all.
    let windowsHide = false
    if (process.platform === 'win32') {
      const executable = findCodeExecutable()
      if (executable === undefined) {
        // The `code` shim is a `.cmd` file, so `start` has to run it through cmd.
        command = process.env.ComSpec ?? 'cmd.exe'
        args = ['/c', 'start', '', 'code', '--new-window', root]
        windowsHide = true
      } else {
        command = executable
      }
    } else if (process.platform === 'darwin') {
      // `-a` by name only finds the standard bundle; use the path when found.
      const app = findMacApp()
      command = 'open'
      args = app === undefined ? ['-a', 'Visual Studio Code', root] : ['-a', app, root]
    }
    return spawnDetached(command, args, { cwd: root, windowsHide })
  }

  let command: string
  let args: string[]
  if (process.platform === 'win32') {
    if (target === 'terminal') {
      command = 'cmd.exe'
      args = ['/c', 'start', '', 'cmd.exe']
    } else {
      command = 'explorer.exe'
      args = [root]
    }
  } else if (process.platform === 'darwin') {
    command = 'open'
    args = target === 'terminal' ? ['-a', 'Terminal', root] : [root]
  } else {
    command = target === 'terminal' ? 'x-terminal-emulator' : 'xdg-open'
    args = target === 'terminal' ? [] : [root]
  }
  // `explorer.exe` exits non-zero even when the folder opened, so its code is
  // not a verdict; a terminal launcher that never starts is still a failure.
  return spawnDetached(command, args, { cwd: root, windowsHide: false, verifyExit: target !== 'explorer' })
}

/** Describe a launch failure as `exit 1` or `spawn ENOENT` for the panel. */
function launchDetail(outcome: LaunchOutcome): string {
  if (outcome.exitCode !== undefined) return `exit ${String(outcome.exitCode)}`
  return `spawn ${outcome.spawnCode ?? 'unknown'}`
}

/** POST /git-suite/open: open a terminal, the file manager, or an editor at the repository root. */
export function createOpenHandler(context: RouteContext): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (!admitHeaders(name => header(req, name))) {
      await send(res, json({
        ok: false,
        error: { code: 'forbidden', message: 'This request is not allowed to open a folder.' },
      }, 403))
      return
    }
    if (req.method !== 'POST') {
      await send(res, json({
        ok: false,
        error: { code: 'method-not-allowed', message: 'Opening a folder requires POST.' },
      }, 405))
      return
    }

    try {
      const body = await readJson(req)
      const editor = typeof body.editor === 'string' ? body.editor.trim() : ''
      const target = body.target === 'terminal'
        ? 'terminal' as const
        : body.target === 'explorer'
          ? 'explorer' as const
          : body.target === 'vscode'
            ? 'vscode' as const
            : body.target === 'editor' ? 'editor' as const : null
      if (target === null) throw new RouteError(400, 'invalid-target', 'Choose a terminal, the file manager, or an editor.')
      const repo = await resolveRepository(context, typeof body.path === 'string' ? body.path : '')
      if (target === 'editor') {
        if (editor === '') throw new RouteError(400, 'editor-required', 'Choose an editor.')
        const result = await launchEditor(editor, repo.root)
        if (!result.ok) {
          if (result.reason === 'not-installed') {
            throw new RouteError(400, 'unknown-editor', 'That editor is not installed on this host.', { editor })
          }
          const detail = launchDetail(result)
          throw new RouteError(400, 'launch-failed', `Could not start ${editorName(editor)} (${detail}).`, {
            editor,
            target,
            detail,
            ...(result.spawnCode === undefined ? {} : { spawnCode: result.spawnCode }),
            ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
          })
        }
        await send(res, json({ ok: true, target, editor, path: repo.root }))
        return
      }
      const outcome = await openTarget(target, repo.root)
      if (!outcome.ok) {
        const detail = launchDetail(outcome)
        throw new RouteError(400, 'launch-failed', `Could not open ${target} (${detail}).`, {
          target,
          detail,
          ...(outcome.spawnCode === undefined ? {} : { spawnCode: outcome.spawnCode }),
          ...(outcome.exitCode === undefined ? {} : { exitCode: outcome.exitCode }),
        })
      }
      await send(res, json({ ok: true, target, path: repo.root }))
    } catch (error) {
      await send(res, failure(error))
    }
  }
}




