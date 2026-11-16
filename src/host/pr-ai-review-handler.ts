import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AgentDefaultModelService, LlmService, LlmStreamChunk } from './dsh.js'
import { RouteError } from './errors.js'
import { detectForge } from './forge/detect.js'
import { getPull } from './forge/index.js'
import { resolveRemote } from './forge/remote.js'
import { resolveForgeToken } from './forge/token.js'
import { admitHeaders, failure, json } from './http.js'
import { resolveRepository } from './repository.js'
import type { PullDetail, PullFile, RouteContext } from './types.js'
import { readReviewContext, type ReviewContext, type ReviewContextMode } from './pr-review-context.js'
import { writeReviewCache } from './pr-review-cache.js'

const MAX_BODY_BYTES = 64 * 1024
const MAX_PATCH_CHARS = 120_000
const MAX_FILE_CONTEXT_CHARS = 80_000
const MAX_DESCRIPTION_CHARS = 4_000
const MAX_REVIEW_CHARS = 20_000

/** Split the model's input window between patches and full-file context. */
function reviewBudgets(contextWindow: number | undefined): { diff: number; files: number } {
  if (contextWindow === undefined || contextWindow <= 0) {
    return { diff: MAX_PATCH_CHARS, files: MAX_FILE_CONTEXT_CHARS }
  }
  // Reserve the 16k retry budget and prompt overhead; 3 chars/token is a
  // conservative estimate for mixed prose and code.
  const usableTokens = Math.max(8_000, contextWindow - 16_000 - 2_000)
  const usableChars = usableTokens * 3
  return {
    diff: Math.min(MAX_PATCH_CHARS, Math.max(16_000, Math.floor(usableChars * 0.62))),
    files: Math.min(MAX_FILE_CONTEXT_CHARS, Math.max(8_000, Math.floor(usableChars * 0.38))),
  }
}

interface ReviewBody {
  path?: unknown
  remote?: unknown
  number?: unknown
  language?: unknown
  /** Full-file context source chosen by the user. */
  context?: unknown
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

/** Source files first, so a large documentation tail cannot hide code patches. */
function reviewPriority(file: PullFile): number {
  const path = file.path.toLowerCase()
  if (/(^|\/)(package-lock|pnpm-lock|yarn\.lock|composer\.lock)/.test(path)) return 4
  if (/(^|\/)docs\//.test(path) || /\.(md|mdx|txt|rst)$/.test(path)) return 3
  if (/\.(json|ya?ml|toml|ini|lock)$/.test(path)) return 2
  if (/\.(tsx?|jsx?|mjs|cjs|vue|svelte|py|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|sh|lua|dart|scala|ex|exs|hs|erl|clj|jl|ml|sql)$/.test(path)) return 0
  return 1
}

function diffExcerpt(pull: PullDetail, maxChars: number): { text: string; truncated: boolean } {
  let remaining = maxChars
  let truncated = false
  const parts: string[] = []
  const files = [...pull.files].sort((a, b) => reviewPriority(a) - reviewPriority(b))
  for (const file of files.slice(0, 80)) {
    const header = `### ${file.path} (${file.status}, +${file.additions ?? '?'} -${file.deletions ?? '?'})`
    if (remaining <= header.length + 2) {
      truncated = true
      break
    }
    const patch = file.patch.trim()
    const room = Math.max(0, remaining - header.length - 2)
    const body = patch.slice(0, room)
    parts.push(`${header}\n${body === '' ? '(no textual patch from the forge; this does not necessarily mean the file is binary)' : body}`)
    remaining -= header.length + body.length + 2
    if (body.length < patch.length) {
      truncated = true
      break
    }
  }
  return { text: parts.join('\n\n'), truncated }
}

function buildPrompt(
  pull: PullDetail,
  language: string,
  context: ReviewContext,
  diffBudget: number,
): { prompt: string; truncated: boolean } {
  const diff = diffExcerpt(pull, diffBudget)
  const description = pull.body.trim().slice(0, MAX_DESCRIPTION_CHARS)
  const commits = pull.commits.slice(0, 30).map(commit => `- ${commit.shortHash} ${commit.subject}`).join('\n')
  const fullFiles = context.files.length === 0
    ? '(complete file contents unavailable; review the diff only)'
    : context.files.map(file => `### ${file.path}\n${file.content}`).join('\n\n')
  return {
    truncated: diff.truncated || context.truncated,
    prompt: [
      `Review pull request #${pull.number}: ${pull.title}`,
      `Source: ${pull.sourceBranch} → ${pull.targetBranch}`,
      `Author: ${pull.author === '' ? 'unknown' : pull.author}`,
      '',
      'Description:',
      description === '' ? '(none)' : description,
      '',
      `Commits (${pull.commits.length}):`,
      commits === '' ? '(none)' : commits,
      '',
      `Changed files (${pull.files.length}${pull.filesTruncated ? '+' : ''}):`,
      diff.text === '' ? '(no textual diff)' : diff.text,
      diff.truncated ? '\n[diff truncated]' : '',
      '',
      'Some patches may be unavailable from the forge; when complete file contents are supplied below, trust them over missing patches.',
      '',
      'Full contents of changed files at the PR head (read from a temporary read-only checkout; nothing was executed):',
      fullFiles,
      context.truncated ? '\n[file contents truncated]' : '',
      '',
      'Write a code review in Markdown. Focus only on the changes above:',
      '- Correctness bugs, edge cases, and regressions.',
      '- Security, data-loss, and performance risks.',
      '- Missing or inadequate tests.',
      '- Concrete suggestions with file paths and, when possible, hunk context.',
      'Use sections: Summary, Issues (with severity high/medium/low), Tests, Suggestions.',
      'If something is uncertain or not visible in the excerpt, say so instead of guessing.',
      'Do not praise, do not repeat the description, and do not invent code that is not in the diff.',
      `Respond in ${language}.`,
    ].join('\n'),
  }
}

function errorEvent(error: unknown): { type: 'error'; error: { code: string; message: string; details?: unknown } } {
  const routeError = error instanceof RouteError ? error : null
  return {
    type: 'error',
    error: {
      code: routeError?.code ?? 'internal',
      message: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
      ...(routeError?.details === undefined ? {} : { details: routeError.details }),
    },
  }
}

/**
 * POST /git-suite/pr-ai-review: fetch one pull request and ask the deployment's
 * default model for a read-only Markdown review. Nothing is posted to the forge.
 */
export function createPullAiReviewHandler(
  context: RouteContext,
  llm: LlmService,
  defaultModel: AgentDefaultModelService,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (!admitHeaders(name => header(req, name))) {
      await send(res, json({
        ok: false,
        error: { code: 'forbidden', message: 'This request is not allowed to review a pull request.' },
      }, 403))
      return
    }
    if (req.method !== 'POST') {
      await send(res, json({
        ok: false,
        error: { code: 'method-not-allowed', message: 'Reviewing a pull request requires POST.' },
      }, 405))
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 300_000)
    res.once('close', () => controller.abort())
    const signal = controller.signal
    try {
      const body = await readJson(req)
      const rawNumber = typeof body.number === 'number' ? body.number : Number.NaN
      if (!Number.isInteger(rawNumber) || rawNumber <= 0 || rawNumber > 2_147_483_647) {
        throw new RouteError(400, 'invalid-number', 'That pull request number is not valid.')
      }
      const repo = await resolveRepository(context, typeof body.path === 'string' ? body.path : '', signal)
      const remote = await resolveRemote(repo.root, typeof body.remote === 'string' ? body.remote : '', signal)
      const target = detectForge(remote.url)
      if (target === null) {
        throw new RouteError(400, 'forge-unsupported', 'This remote is not hosted on a supported forge.', { remote: remote.name })
      }

      const token = await resolveForgeToken(repo.root, target, signal)
      let pull: PullDetail
      try {
        pull = await getPull(target, rawNumber, token, signal, true)
      } catch (error) {
        if (error instanceof RouteError) throw error.withDetails({ remote: remote.name })
        throw error
      }
      if (pull.files.length === 0) {
        throw new RouteError(400, 'no-diff', 'This pull request has no changed files to review.')
      }
      const contextMode: ReviewContextMode = body.context === 'diff' || body.context === 'api' || body.context === 'worktree'
        ? body.context
        : 'auto'

      let selection: { provider: string; model: string; reasoningEffort?: string }
      try {
        selection = defaultModel.currentSelection()
      } catch {
        throw new RouteError(500, 'no-model', 'No default model is configured.')
      }
      if (selection.provider === '' || selection.model === '') {
        throw new RouteError(500, 'no-model', 'No default model is configured.')
      }

      // A large review plus high reasoning can consume the whole output budget
      // before any visible text. Use the model's least reasoning effort and size
      // the patch/file budgets from its context window when available.
      let reviewReasoningEffort = selection.reasoningEffort
      let contextWindow: number | undefined
      try {
        if (llm.resolveModelInfo !== undefined) {
          const info = await llm.resolveModelInfo(selection.provider, selection.model, signal)
          const efforts = info.reasoning?.efforts ?? []
          if (efforts.length > 0 && typeof efforts[0]?.id === 'string') {
            reviewReasoningEffort = efforts[0].id
          }
          if (typeof info.context?.contextWindow === 'number') {
            contextWindow = info.context.contextWindow
          }
        }
      } catch {
        // Capability lookup is optional; keep the configured effort.
      }
      const budgets = reviewBudgets(contextWindow)
      const reviewContext = await readReviewContext(
        repo.root,
        remote.name,
        target,
        pull,
        rawNumber,
        token,
        signal,
        contextMode,
        { maxTotalChars: budgets.files },
      )

      const language = typeof body.language === 'string' && body.language.toLowerCase().startsWith('zh')
        ? 'Simplified Chinese'
        : 'English'
      const { prompt, truncated } = buildPrompt(pull, language, reviewContext, budgets.diff)
      const retryPrompt = `${prompt}\n\nIMPORTANT: A previous attempt exhausted the output budget while reasoning. Output the final review directly now; do not include analysis or thinking.`
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
      emit({
        type: 'start',
        attempt: 1,
        model: selection.model,
        files: pull.files.length,
        context: reviewContext.mode,
        contextFiles: reviewContext.files.length,
      })

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
            ...(includeReasoning && reviewReasoningEffort !== undefined
              ? { reasoningEffort: reviewReasoningEffort }
              : {}),
            system: 'You are a senior software engineer reviewing a pull request. Be specific, skeptical, and concise. Output Markdown only.',
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
        if (delta === '' && blockText !== '') {
          emit({ type: 'text', text: blockText })
        }
        return { text: delta === '' ? blockText : delta, finish, reasoningChars: reasoning.length }
      }

      // Reasoning models can consume the whole output budget before emitting
      // visible text. Start with room for both, then retry once without the
      // reasoning effort if the first attempt produced no review.
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
            'The model used its output budget before writing the review. Try diff-only mode, a smaller context, or a model with less reasoning.',
          )
        }
        throw new RouteError(502, 'empty-review', 'The model returned an empty review.')
      }
      // Keep the finished review so reopening this PR shows it immediately.
      await writeReviewCache(repo.root, remote.name, rawNumber, pull.updatedAt, review)
      if (streaming) {
        emit({
          type: 'done',
          review,
          model: selection.model,
          files: pull.files.length,
          truncated,
          context: reviewContext.mode,
          contextFiles: reviewContext.files.length,
        })
        res.end()
        return
      }
      await send(res, json({
        ok: true,
        review,
        model: selection.model,
        files: pull.files.length,
        truncated,
        context: reviewContext.mode,
        contextFiles: reviewContext.files.length,
      }))
    } catch (error) {
      if (res.headersSent) {
        if (!res.writableEnded) {
          res.write(`${JSON.stringify(errorEvent(error))}\n`)
          res.end()
        }
        return
      }
      await send(res, failure(error))
    } finally {
      clearTimeout(timeout)
    }
  }
}
