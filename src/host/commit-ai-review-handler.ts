/**
 * Pre-commit AI review: stream a Markdown review of the staged diff.
 *
 * Nothing is committed or posted anywhere; the model only reads the patch that
 * `git diff --cached` reports, so the review matches exactly what would be
 * committed next.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AgentDefaultModelService, LlmService, LlmStreamChunk } from './dsh.js'
import { RouteError } from './errors.js'
import { createHash } from 'node:crypto'
import { readStagedReview, writeStagedReview } from './staged-review-cache.js'
import { runGit } from './git.js'
import { admitHeaders, json } from './http.js'
import { resolveRepository } from './repository.js'
import type { RouteContext } from './types.js'

const MAX_BODY_BYTES = 16 * 1024
const MAX_DIFF_CHARS = 120_000
const MAX_REVIEW_CHARS = 20_000

interface ReviewBody {
  path?: unknown
  /** Bypass the cached review and call the model again. */
  fresh?: unknown
  language?: unknown
  /** Stream NDJSON progress events instead of one JSON response. */
  stream?: unknown
}

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name]
  if (value === undefined) return null
  return Array.isArray(value) ? value.join(', ') : value
}

async function readJson(req: IncomingMessage): Promise<ReviewBody> {
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
    return parsed as ReviewBody
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

function errorEvent(error: unknown): { type: 'error'; error: { code: string; message: string } } {
  const routeError = error instanceof RouteError ? error : null
  return {
    type: 'error',
    error: {
      code: routeError?.code ?? 'internal',
      message: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
    },
  }
}

/** @returns the review prompt for one staged diff. */
function buildPrompt(diff: string, truncated: boolean, language: string): string {
  return [
    'Review the staged changes that are about to be committed.',
    '',
    'Staged diff:',
    diff === '' ? '(none)' : diff,
    truncated ? '\n[diff truncated]' : '',
    '',
    'Write a code review in Markdown. Focus only on these staged changes:',
    '- Correctness bugs, edge cases, and regressions.',
    '- Security, data-loss, and performance risks.',
    '- Missing or inadequate tests.',
    '- Concrete suggestions with file paths and, when possible, hunk context.',
    'Use sections: Summary, Issues (with severity high/medium/low), Tests, Suggestions.',
    'If something is uncertain or not visible in the diff, say so instead of guessing.',
    'Do not praise, and do not invent code that is not in the diff.',
    `Respond in ${language}.`,
  ].join('\n')
}

/**
 * POST /git-suite/commit-ai-review: ask the deployment's default model for a
 * read-only Markdown review of the staged diff.
 */
export function createCommitAiReviewHandler(
  context: RouteContext,
  llm: LlmService,
  defaultModel: AgentDefaultModelService,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (!admitHeaders(name => header(req, name))) {
      await send(res, json({
        ok: false,
        error: { code: 'forbidden', message: 'This request is not allowed to review staged changes.' },
      }, 403))
      return
    }
    if (req.method !== 'POST') {
      await send(res, json({
        ok: false,
        error: { code: 'method-not-allowed', message: 'Reviewing staged changes requires POST.' },
      }, 405))
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 300_000)
    res.once('close', () => controller.abort())
    const signal = controller.signal
    try {
      const body = await readJson(req)
      const repo = await resolveRepository(context, typeof body.path === 'string' ? body.path : '', signal)
      const patch = await runGit(
        repo.root,
        ['diff', '--cached', '--no-color', '--no-ext-diff', '--find-renames', '--unified=3'],
        signal,
      )
      if (patch.trim() === '') {
        throw new RouteError(400, 'no-staged', 'There are no staged changes to review.')
      }
      // The hash makes the cache exact: any staging change produces a new key,
      // so a cached review can never describe a different staged diff.
      const hash = createHash('sha256').update(patch).digest('hex')
      const truncated = patch.length > MAX_DIFF_CHARS
      const diff = truncated ? patch.slice(0, MAX_DIFF_CHARS) : patch

      const streaming = body.stream === true
      let streamStarted = false
      const emit = (event: unknown): void => {
        if (!streaming || res.writableEnded) return
        if (!streamStarted) {
          res.writeHead(200, {
            'content-type': 'application/x-ndjson; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'x-accel-buffering': 'no',
          })
          streamStarted = true
        }
        res.write(`${JSON.stringify(event)}\n`)
      }

      if (body.fresh !== true) {
        const cached = await readStagedReview(repo.root, hash)
        if (cached !== null) {
          if (streaming) {
            emit({ type: 'start', attempt: 1, model: cached.model, hash })
            emit({ type: 'text', text: cached.text })
            emit({ type: 'done', review: cached.text, model: cached.model, hash, truncated: cached.truncated })
            res.end()
            return
          }
          await send(res, json({
            ok: true,
            review: cached.text,
            model: cached.model,
            truncated: cached.truncated,
            hash,
          }))
          return
        }
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

      // Prefer the model's lightest reasoning effort: a long review plus heavy
      // reasoning can spend the whole output budget before any visible text.
      let effort = selection.reasoningEffort
      try {
        if (llm.resolveModelInfo !== undefined) {
          const info = await llm.resolveModelInfo(selection.provider, selection.model, signal)
          const efforts = info.reasoning?.efforts ?? []
          if (efforts.length > 0 && typeof efforts[0]?.id === 'string') effort = efforts[0].id
        }
      } catch {
        // Capability lookup is optional; keep the configured effort.
      }

      const language = typeof body.language === 'string' && body.language.toLowerCase().startsWith('zh')
        ? 'Simplified Chinese'
        : 'English'
      const prompt = buildPrompt(diff, truncated, language)
      const retryPrompt = `${prompt}\n\nIMPORTANT: A previous attempt exhausted the output budget while reasoning. Output the final review directly now; do not include analysis or thinking.`

      emit({ type: 'start', attempt: 1, model: selection.model, hash })

      const runAttempt = async (
        maxTokens: number,
        includeReasoning: boolean,
        promptText: string,
      ): Promise<{ text: string; finish: LlmStreamChunk['reason']; reasoningChars: number }> => {
        let delta = ''
        let blockText = ''
        let reasoning = ''
        let finish: LlmStreamChunk['reason']
        try {
          for await (const chunk of llm.stream({
            provider: selection.provider,
            model: selection.model,
            ...(includeReasoning && effort !== undefined ? { reasoningEffort: effort } : {}),
            system: 'You are a senior software engineer reviewing a change before it is committed. Be specific, skeptical, and concise. Output Markdown only.',
            messages: [{ role: 'user', content: [{ type: 'text', text: promptText }] }],
            maxTokens,
            temperature: 0.2,
            signal,
          })) {
            if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
              delta += chunk.text
              emit({ type: 'text', text: chunk.text })
            } else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
              reasoning += chunk.text
              emit({ type: 'reasoning', text: chunk.text })
            } else if (
              chunk.type === 'block-end'
              && chunk.block?.type === 'text'
              && typeof chunk.block.text === 'string'
            ) {
              blockText += chunk.block.text
            } else if (chunk.type === 'finish') {
              finish = chunk.reason
            }
          }
        } catch (error) {
          throw new RouteError(502, 'llm-failed', error instanceof Error ? error.message : 'The model request failed.')
        }
        if (finish?.kind === 'error' || finish?.kind === 'aborted') {
          throw new RouteError(502, 'llm-failed', finish.failure?.message ?? 'The model request failed.')
        }
        if (delta === '' && blockText !== '') emit({ type: 'text', text: blockText })
        return { text: delta === '' ? blockText : delta, finish, reasoningChars: reasoning.length }
      }

      let attempt = await runAttempt(8_000, true, prompt)
      if (attempt.text.trim() === '' && !signal.aborted) {
        emit({ type: 'retry', attempt: 2 })
        attempt = await runAttempt(16_000, false, retryPrompt)
      }
      const review = attempt.text.trim().slice(0, MAX_REVIEW_CHARS)
      if (review === '') {
        if (attempt.finish?.kind === 'max-tokens' || attempt.reasoningChars > 0) {
          throw new RouteError(
            502,
            'review-truncated',
            'The model used its output budget before writing the review. Try again or use a model with less reasoning.',
          )
        }
        throw new RouteError(502, 'empty-review', 'The model returned an empty review.')
      }
      // Remember this review for the exact staged patch it describes.
      await writeStagedReview(repo.root, hash, review, selection.model, truncated)
      if (streaming) {
        emit({ type: 'done', review, model: selection.model, hash, truncated })
        res.end()
        return
      }
      await send(res, json({ ok: true, review, model: selection.model, hash, truncated }))
    } catch (error) {
      if (res.headersSent) {
        if (!res.writableEnded) {
          res.write(`${JSON.stringify(errorEvent(error))}\n`)
          res.end()
        }
        return
      }
      await send(res, json({ ok: false, error: errorEvent(error).error }, error instanceof RouteError ? error.status : 500))
    } finally {
      clearTimeout(timeout)
    }
  }
}
