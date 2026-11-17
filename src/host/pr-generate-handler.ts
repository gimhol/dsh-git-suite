/**
 * AI draft for a new pull request: a title and Markdown body derived from the
 * commits and diff between the chosen base and the current branch.
 *
 * Everything is read locally with git; nothing is pushed or posted.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AgentDefaultModelService, LlmService, LlmStreamChunk } from './dsh.js'
import { RouteError } from './errors.js'
import { gitFailure, runGit } from './git.js'
import { admitHeaders, failure, json } from './http.js'
import { resolveRepository } from './repository.js'
import { defaultPrompt, renderPrompt } from './ai-prompts.js'
import type { RouteContext } from './types.js'

const MAX_BODY_BYTES = 16 * 1024
const MAX_DIFF_CHARS = 24_000
const MAX_LOG_CHARS = 6_000
const MAX_TITLE_CHARS = 200

interface DraftBody {
  path?: unknown
  remote?: unknown
  base?: unknown
  head?: unknown
  language?: unknown
  /** User prompt template; the built-in text applies when absent. */
  prompt?: unknown
}

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name]
  if (value === undefined) return null
  return Array.isArray(value) ? value.join(', ') : value
}

async function readJson(req: IncomingMessage): Promise<DraftBody> {
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
    return parsed as DraftBody
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

/** @returns the first ref that resolves, or null when none do. */
async function resolveRef(root: string, refs: readonly string[], signal: AbortSignal): Promise<string | null> {
  for (const ref of refs) {
    try {
      await runGit(root, ['rev-parse', '--verify', '--quiet', ref], signal)
      return ref
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

/** Split a model reply into the first non-empty line (title) and the rest (body). */
function parseDraft(raw: string): { title: string; body: string } {
  let text = raw.trim()
  const fenced = /^```[a-z]*\s*\n([\s\S]*?)\n```$/i.exec(text)
  if (fenced !== null) text = fenced[1]?.trim() ?? ''
  const lines = text.split(/\r?\n/)
  const first = lines.findIndex(line => line.trim() !== '')
  if (first < 0) return { title: '', body: '' }
  const title = (lines[first] ?? '').trim().replace(/^#+\s*/, '').slice(0, MAX_TITLE_CHARS)
  const body = lines.slice(first + 1).join('\n').replace(/^\s*\n/, '').trim()
  return { title, body }
}

function buildPrompt(head: string, base: string, commits: string, diff: string, truncated: boolean, language: string, template: string): string {
  return renderPrompt(template, {
    head,
    base,
    commits: commits.trim() === '' ? '(none)' : commits.trim(),
    diff: `${diff.trim() === '' ? '(no textual diff)' : diff.slice(0, MAX_DIFF_CHARS)}${truncated ? '\n[diff truncated]' : ''}`,
    language,
  })
}

/** POST /git-suite/pr-generate: draft a pull request title and body with the default model. */
export function createPullDraftHandler(
  context: RouteContext,
  llm: LlmService,
  defaultModel: AgentDefaultModelService,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (!admitHeaders(name => header(req, name))) {
      await send(res, json({
        ok: false,
        error: { code: 'forbidden', message: 'This request is not allowed to draft a pull request.' },
      }, 403))
      return
    }
    if (req.method !== 'POST') {
      await send(res, json({
        ok: false,
        error: { code: 'method-not-allowed', message: 'Drafting a pull request requires POST.' },
      }, 405))
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    res.once('close', () => controller.abort())
    const signal = controller.signal
    try {
      const body = await readJson(req)
      const repo = await resolveRepository(context, typeof body.path === 'string' ? body.path : '', signal)
      const remote = typeof body.remote === 'string' ? body.remote.trim() : ''
      const base = typeof body.base === 'string' ? body.base.trim() : ''
      const head = typeof body.head === 'string' ? body.head.trim() : ''
      if (base === '' || head === '') {
        throw new RouteError(400, 'invalid-branches', 'A base and a head branch are required.')
      }

      const baseRef = await resolveRef(
        repo.root,
        remote === '' ? [base] : [`refs/remotes/${remote}/${base}`, `${remote}/${base}`, base],
        signal,
      )
      const headRef = await resolveRef(repo.root, [head, 'HEAD'], signal)
      if (baseRef === null || headRef === null) {
        throw new RouteError(400, 'unknown-ref', 'The base or head branch could not be resolved locally.', { base, head })
      }

      let commits = ''
      let diff = ''
      try {
        ;[commits, diff] = await Promise.all([
          runGit(repo.root, ['log', '--no-merges', '--format=%h %s', `${baseRef}..${headRef}`], signal),
          runGit(repo.root, ['diff', '--no-color', '--no-ext-diff', '--unified=3', `${baseRef}...${headRef}`], signal),
        ])
      } catch (error) {
        throw gitFailure(error)
      }
      if (commits.trim() === '' && diff.trim() === '') {
        throw new RouteError(400, 'no-changes', 'There are no commits between the base and the head branch.')
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

      const language = typeof body.language === 'string' && body.language.toLowerCase().startsWith('zh')
        ? 'Simplified Chinese'
        : 'English'
      const truncated = diff.length > MAX_DIFF_CHARS
      const template = typeof body.prompt === 'string' && body.prompt.trim() !== ''
        ? body.prompt
        : defaultPrompt('prDraft')
      const prompt = buildPrompt(
        head,
        base,
        commits.slice(0, MAX_LOG_CHARS),
        diff,
        truncated,
        language,
        template,
      )

      let output = ''
      let finish: LlmStreamChunk['reason']
      try {
        for await (const chunk of llm.stream({
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
          system: 'You are a pull request writer for a developer tool. Output only the title and Markdown body.',
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          maxTokens: 1_600,
          temperature: 0.3,
          signal,
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
      const draft = parseDraft(output)
      if (draft.title === '') {
        throw new RouteError(502, 'empty-generation', 'The model returned an empty pull request draft.')
      }
      await send(res, json({ ok: true, title: draft.title, body: draft.body }))
    } catch (error) {
      await send(res, failure(error))
    } finally {
      clearTimeout(timeout)
    }
  }
}
