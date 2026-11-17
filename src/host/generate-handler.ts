import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AgentDefaultModelService, LlmService, LlmStreamChunk } from './dsh.js'
import { RouteError } from './errors.js'
import { gitFailure, runGit } from './git.js'
import { admitHeaders, failure, json } from './http.js'
import { annotateLfsPatch } from './lfs.js'
import { resolveRepository } from './repository.js'
import { defaultPrompt, renderPrompt } from './ai-prompts.js'
import type { RouteContext } from './types.js'

const MAX_BODY_BYTES = 64 * 1024
const MAX_DIFF_CHARS = 24_000
const MAX_MESSAGE_CHARS = 4_000

interface GenerateBody {
  path?: unknown
  /** User prompt template; the built-in text applies when absent. */
  prompt?: unknown
}

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name]
  if (value === undefined) return null
  return Array.isArray(value) ? value.join(', ') : value
}

async function readJson(req: IncomingMessage): Promise<GenerateBody> {
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
    return parsed as GenerateBody
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

function cleanMessage(raw: string): string {
  let text = raw.trim()
  const fenced = /^```[a-z]*\s*\n([\s\S]*?)\n```$/i.exec(text)
  if (fenced !== null) text = fenced[1]?.trim() ?? ''
  text = text.replace(/^commit message:\s*/i, '').trim()
  return text.slice(0, MAX_MESSAGE_CHARS).trim()
}

function buildPrompt(
  files: string[],
  source: 'staged' | 'unstaged',
  diff: string,
  recent: string,
  template: string,
): string {
  const truncated = diff.length > MAX_DIFF_CHARS
  return renderPrompt(template, {
    recent: recent.trim() === '' ? '(none)' : recent.trim(),
    source,
    files: files.length === 0 ? '(none)' : files.join('\n'),
    diff: `${diff.trim() === '' ? '(no textual diff)' : diff.slice(0, MAX_DIFF_CHARS)}${truncated ? '\n[diff truncated]' : ''}`,
  })
}

/** POST /git-suite/generate-message: summarize the staged (fallback unstaged) diff with the default model. */
export function createGenerateMessageHandler(
  context: RouteContext,
  llm: LlmService,
  defaultModel: AgentDefaultModelService,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (!admitHeaders(name => header(req, name))) {
      await send(res, json({
        ok: false,
        error: { code: 'forbidden', message: 'This request is not allowed to generate a message.' },
      }, 403))
      return
    }
    if (req.method !== 'POST') {
      await send(res, json({
        ok: false,
        error: { code: 'method-not-allowed', message: 'Generating a message requires POST.' },
      }, 405))
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 90_000)
    res.once('close', () => controller.abort())
    try {
      const body = await readJson(req)
      const rawPath = typeof body.path === 'string' ? body.path : ''
      const repo = await resolveRepository(context, rawPath, controller.signal)

      let staged = ''
      let unstaged = ''
      let status = ''
      let recent = ''
      try {
        ;[staged, unstaged, status, recent] = await Promise.all([
          runGit(repo.root, ['diff', '--cached', '--no-color', '--no-ext-diff', '--unified=3'], controller.signal),
          runGit(repo.root, ['diff', '--no-color', '--no-ext-diff', '--unified=3'], controller.signal),
          runGit(repo.root, ['status', '--porcelain=v1'], controller.signal),
          runGit(repo.root, ['log', '-5', '--format=%s'], controller.signal).catch(() => ''),
        ])
      } catch (error) {
        throw gitFailure(error)
      }

      const source: 'staged' | 'unstaged' = staged.trim() === '' ? 'unstaged' : 'staged'
      // LFS pointer rows would otherwise be summarized as if they were the change.
      const diff = annotateLfsPatch(source === 'staged' ? staged : unstaged)
      const files = status
        .split(/\r?\n/)
        .filter(line => line.trim() !== '')
        .map(line => line.slice(3).trim())
        .filter(path => path !== '')
        .slice(0, 80)
      if (status.trim() === '') {
        throw new RouteError(400, 'no-changes', 'There are no changes to summarize.')
      }

      let selection: { provider: string; model: string; reasoningEffort?: string }
      try {
        selection = defaultModel.currentSelection()
      } catch {
        throw new RouteError(500, 'no-model', 'No default model is configured.')
      }
      if (selection.provider === '' || selection.model === '') {
        throw new RouteError(500, 'no-model', 'No default model is configured.')
      }

      const template = typeof body.prompt === 'string' && body.prompt.trim() !== ''
        ? body.prompt
        : defaultPrompt('commitMessage')
      const prompt = buildPrompt(files, source, diff, recent, template)
      let output = ''
      let finish: LlmStreamChunk['reason']
      try {
        for await (const chunk of llm.stream({
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
          system: 'You are a Git commit message generator for a developer tool. Output only the commit message.',
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          maxTokens: 600,
          temperature: 0.2,
          signal: controller.signal,
        })) {
          if (chunk.type === 'text-delta' && typeof chunk.text === 'string') output += chunk.text
          else if (chunk.type === 'finish') finish = chunk.reason
        }
      } catch (error) {
        throw new RouteError(502, 'llm-failed', error instanceof Error ? error.message : 'The model request failed.')
      }
      if (finish?.kind === 'error' || finish?.kind === 'aborted') {
        throw new RouteError(502, 'llm-failed', finish.failure?.message ?? 'The model request failed.')
      }
      const message = cleanMessage(output)
      if (message === '') {
        throw new RouteError(502, 'empty-generation', 'The model returned an empty commit message.')
      }
      await send(res, json({ ok: true, message, source }))
    } catch (error) {
      await send(res, failure(error))
    } finally {
      clearTimeout(timeout)
    }
  }
}
