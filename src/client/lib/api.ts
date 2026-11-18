import type {
  BranchAction,
  BranchActionPayload,
  BranchPayload,
  CheckoutPayload,
  ClonePayload,
  GenerateMessagePayload,
  OpenAppPayload,
  PickDirectoryPayload,
  PushTarget,
  RemoteAddPayload,
  RemoteRemovePayload,
  RemoteUrlPayload,
  RevealPayload,
  SyncAction,
  SyncPayload,
  TagInfoPayload,
  TagPayload,
  TagStatusPayload,
  CommitOpPayload,
  ReflogPayload,
  OperationPayload,
  AppsPayload,
  StashPayload,
  CommitMessagesPayload,
  VersionPayload,
  PullsPayload,
  PullPayload,
  PullCheckoutPayload,
  PullStatePayload,
  PullCreateRequest,
  PullCreatePayload,
  PullMergePayload,
  PullMergeRequest,
  PullGiteeDecisionPayload,
  PullDeletePayload,
  PullListState,
  PullAiReviewPayload,
  AiReviewMode,
  AiReviewStreamEvent,
  CommitReviewPayload,
  CommitReviewStreamEvent,
  PullDraftPayload,
  PullDraftRequest,
  WorkspaceDiffMedia,
} from '../types.js'

export interface ErrorDetails {
  path?: string
  detail?: string
  ref?: string
  hash?: string
  [key: string]: unknown
}

/** A route failure with the host's stable error code and diagnostics. */
export class ApiError extends Error {
  readonly code: string
  readonly details?: ErrorDetails

  constructor(message: string, code: string, details?: ErrorDetails) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.details = details
  }
}

export type RequestMode = 'projects' | 'tree' | 'branches' | 'log' | 'commit' | 'resolve' | 'tag' | 'tag-status' | 'version' | 'reflog' | 'operation' | 'apps' | 'commit-messages' | 'switch' | 'status' | 'workspace-diff' | 'staged-hash' | 'commit-media' | 'session-repo' | 'pulls' | 'pull'

export interface RequestParams {
  mode: RequestMode
  path?: string | null
  limit?: string
  offset?: string
  scope?: 'all' | 'remotes' | 'stash' | 'staged' | 'unstaged' | 'untracked'
  ref?: string
  hash?: string
  name?: string
  remote?: string
  file?: string
  sort?: 'date' | 'topo'
  remotes?: '1'
  /** session-repo: which Session's working directory to resolve. */
  session?: string
  /** pulls/pull: open pull requests only, or every state. */
  state?: PullListState
  /** pull: the pull request number. */
  number?: string
  /** pulls: the 1-based page to request. */
  page?: string
  /** pulls/pull: skip the host's 60-second response cache for a manual refresh. */
  fresh?: '1'
}

interface ErrorPayload {
  ok?: boolean
  error?: { code?: string; message?: string; details?: ErrorDetails }
}

/** Fetch one JSON payload from the plugin's route. */
export async function requestJson<T>(
  params: RequestParams,
  signal?: AbortSignal,
  method: 'GET' | 'POST' = 'GET',
): Promise<T> {
  // Read modes use the GET-only resource route; the branch switch is a POST
  // handler because DSH resource routes answer 405 for non-GET methods.
  const endpoint = params.mode === 'switch' ? '/git-suite/switch' : '/git-suite'
  const url = new URL(endpoint, window.location.origin)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  const response = await fetch(url, {
    method,
    signal,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'x-dsh-git-suite': '1' },
  })
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  const parsed = payload as ErrorPayload | null
  if (response.ok && parsed?.ok === true) return payload as T
  throw new ApiError(
    parsed?.error?.message ?? `Request failed with HTTP ${response.status}`,
    parsed?.error?.code ?? 'request-failed',
    parsed?.error?.details,
  )
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

export type WorkspaceAction = 'stage' | 'unstage' | 'stage-hunks' | 'unstage-hunks' | 'stage-lines' | 'unstage-lines' | 'commit' | 'discard' | 'delete' | 'ignore'

export interface WorkspaceActionRequest {
  action: WorkspaceAction
  path: string
  paths?: string[]
  /** `ignore` only: which pattern to append to `.gitignore`. */
  mode?: 'file' | 'name' | 'extension'
  /** `stage-hunks` / `unstage-hunks`: hunk indexes inside the file's diff. */
  hunks?: number[]
  /** `stage-lines` / `unstage-lines`: patch line indexes of the selection. */
  lines?: number[]
  all?: boolean
  message?: string
  amend?: boolean
  push?: boolean
}

/** POST a workspace mutation; resource routes are GET-only, so this uses the action handler. */
export async function requestAction<T>(body: WorkspaceActionRequest, signal?: AbortSignal): Promise<T> {
  const response = await fetch(new URL('/git-suite/action', window.location.origin), {
    method: 'POST',
    signal,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'x-dsh-git-suite': '1',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  const parsed = payload as ErrorPayload | null
  if (response.ok && parsed?.ok === true) return payload as T
  throw new ApiError(
    parsed?.error?.message ?? `Request failed with HTTP ${response.status}`,
    parsed?.error?.code ?? 'request-failed',
    parsed?.error?.details,
  )
}

export interface CloneRequest {
  url: string
  path: string
}

/** POST /git-suite/clone; the destination must not exist yet. */
export async function requestClone(body: CloneRequest, signal?: AbortSignal): Promise<ClonePayload> {
  const response = await fetch(new URL('/git-suite/clone', window.location.origin), {
    method: 'POST',
    signal,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'x-dsh-git-suite': '1',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  const parsed = payload as ErrorPayload | null
  if (response.ok && parsed?.ok === true) return payload as ClonePayload
  throw new ApiError(
    parsed?.error?.message ?? `Request failed with HTTP ${response.status}`,
    parsed?.error?.code ?? 'request-failed',
    parsed?.error?.details,
  )
}

export interface OpenAppRequest {
  path: string
  target: 'terminal' | 'explorer' | 'vscode' | 'editor'
  /** Editor id when `target` is `editor`. */
  editor?: string
}

/** GET /git-suite?mode=apps: which external editors are installed. */
export async function requestApps(signal?: AbortSignal): Promise<AppsPayload> {
  return requestJson<AppsPayload>({ mode: 'apps' }, signal)
}

/** Shape of the session-repository lookup: the repo of one Session's working directory. */
export interface SessionRepoPayload {
  ok: true
  path: string | null
  cwd: string | null
}

/** GET /git-suite?mode=session-repo: the Git repository of one Session's working directory. */
export async function requestSessionRepo(sessionId: string, signal?: AbortSignal): Promise<SessionRepoPayload> {
  return requestJson<SessionRepoPayload>({ mode: 'session-repo', session: sessionId }, signal)
}

/** Store an HTTPS credential through the repository's credential helper. */
export interface CredentialRequest {
  path: string
  remote: string
  username: string
  password: string
  /** The remote may use SSH: store the token for its forge host instead. */
  forge?: boolean
}

export interface CredentialPayload {
  ok: true
  remote: string
  helper: string
  host: string
}

export async function requestCredential(body: CredentialRequest, signal?: AbortSignal): Promise<CredentialPayload> {
  return postCommitJson<CredentialPayload>('/git-suite/credential', body, signal)
}

/** POST /git-suite/open: open a terminal or the OS file manager at the repository root. */
export async function requestOpenApp(body: OpenAppRequest, signal?: AbortSignal): Promise<OpenAppPayload> {
  return postCommitJson<OpenAppPayload>('/git-suite/open', body, signal)
}

/** GET /git-suite?mode=pulls: one page of pull requests for one remote. */
export async function requestPulls(
  params: { path: string; remote: string; state?: PullListState; page?: number; fresh?: boolean },
  signal?: AbortSignal,
): Promise<PullsPayload> {
  return requestJson<PullsPayload>({
    mode: 'pulls',
    path: params.path,
    remote: params.remote,
    state: params.state ?? 'open',
    ...(params.page === undefined ? {} : { page: String(params.page) }),
    ...(params.fresh === true ? { fresh: '1' as const } : {}),
  }, signal)
}

/** GET /git-suite?mode=pull: one pull request with its files and commits. */
export async function requestPull(
  params: { path: string; remote: string; number: number; state?: PullListState; fresh?: boolean },
  signal?: AbortSignal,
): Promise<PullPayload> {
  return requestJson<PullPayload>({
    mode: 'pull',
    path: params.path,
    remote: params.remote,
    number: String(params.number),
    ...(params.state === undefined ? {} : { state: params.state }),
    ...(params.fresh === true ? { fresh: '1' as const } : {}),
  }, signal)
}

export interface PullCheckoutRequest {
  path: string
  remote: string
  number: number
}

/** POST /git-suite/pr: fetch a pull request and switch to its local branch. */
export async function requestPullCheckout(
  body: PullCheckoutRequest,
  signal?: AbortSignal,
): Promise<PullCheckoutPayload> {
  return postCommitJson<PullCheckoutPayload>('/git-suite/pr', body, signal)
}

/** POST /git-suite/pr-close: close the request on the forge. */
export async function requestPullClose(
  body: PullCheckoutRequest,
  signal?: AbortSignal,
): Promise<PullStatePayload> {
  return postCommitJson<PullStatePayload>('/git-suite/pr-close', body, signal)
}

/** POST /git-suite/pr-reopen: reopen a closed request on the forge. */
export async function requestPullReopen(
  body: PullCheckoutRequest,
  signal?: AbortSignal,
): Promise<PullStatePayload> {
  return postCommitJson<PullStatePayload>('/git-suite/pr-reopen', body, signal)
}

export interface PullCreateCall extends PullCreateRequest {
  path: string
  remote: string
}

/** POST /git-suite/pr-create: open a new request from the current branch. */
export async function requestPullCreate(
  body: PullCreateCall,
  signal?: AbortSignal,
): Promise<PullCreatePayload> {
  return postCommitJson<PullCreatePayload>('/git-suite/pr-create', body, signal)
}

export interface PullMergeCall extends PullMergeRequest {
  path: string
  remote: string
  number: number
}

/** POST /git-suite/pr-merge: merge the request on the forge. */
export async function requestPullMerge(
  body: PullMergeCall,
  signal?: AbortSignal,
): Promise<PullMergePayload> {
  return postCommitJson<PullMergePayload>('/git-suite/pr-merge', body, signal)
}

export interface PullGiteeDecisionCall {
  path: string
  remote: string
  number: number
  action: 'review' | 'test'
}

/** POST /git-suite/pr-gitee-decision: mark Gitee review or test as passed. */
export async function requestPullGiteeDecision(
  body: PullGiteeDecisionCall,
  signal?: AbortSignal,
): Promise<PullGiteeDecisionPayload> {
  return postCommitJson<PullGiteeDecisionPayload>('/git-suite/pr-gitee-decision', body, signal)
}

export interface PullDeleteCall {
  path: string
  remote: string
  number: number
}

/** POST /git-suite/pr-delete: permanently delete a GitLab merge request. */
export async function requestPullDelete(
  body: PullDeleteCall,
  signal?: AbortSignal,
): Promise<PullDeletePayload> {
  return postCommitJson<PullDeletePayload>('/git-suite/pr-delete', body, signal)
}

export interface PullAiReviewCall {
  path: string
  remote: string
  number: number
  language?: string
  context?: AiReviewMode
  /** User prompt template; the host falls back to its built-in text. */
  prompt?: string
}

/** POST /git-suite/pr-ai-review: ask the default model for a read-only review. */
export async function requestPullAiReview(
  body: PullAiReviewCall,
  signal?: AbortSignal,
): Promise<PullAiReviewPayload> {
  return postCommitJson<PullAiReviewPayload>('/git-suite/pr-ai-review', body, signal)
}

/** Stream review progress as newline-delimited JSON events. */
export async function requestPullAiReviewStream(
  body: PullAiReviewCall,
  onEvent: (event: AiReviewStreamEvent) => void,
  signal?: AbortSignal,
): Promise<PullAiReviewPayload> {
  const response = await fetch(new URL('/git-suite/pr-ai-review', window.location.origin), {
    method: 'POST',
    signal,
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      'x-dsh-git-suite': '1',
    },
    body: JSON.stringify({ ...body, stream: true }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    type ErrorPayload = { error?: { code?: string; message?: string; details?: ErrorDetails } }
    let payload: ErrorPayload | null = null
    try {
      payload = JSON.parse(text) as ErrorPayload
    } catch {
      payload = null
    }
    const fallback = text.trim().slice(0, 500)
    throw new ApiError(
      payload?.error?.message ?? (fallback === '' ? 'AI review failed.' : fallback),
      payload?.error?.code ?? `http-${response.status}`,
      payload?.error?.details,
    )
  }
  if (response.body === null) throw new ApiError('The review stream was empty.', 'empty-review')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const MAX_STREAM_BUFFER = 1_000_000
  let buffer = ''
  let done: PullAiReviewPayload | null = null
  type WireEvent = AiReviewStreamEvent | {
    type: 'error'
    error: { code?: string; message?: string; details?: ErrorDetails }
  }

  const handleLine = (line: string): PullAiReviewPayload | null => {
    if (line.trim() === '') return null
    let event: WireEvent
    try {
      event = JSON.parse(line) as WireEvent
    } catch {
      return null
    }
    if (event.type === 'error') {
      throw new ApiError(event.error.message ?? 'AI review failed.', event.error.code ?? 'internal', event.error.details)
    }
    onEvent(event)
    if (event.type !== 'done') return null
    return {
      ok: true,
      review: event.review,
      model: event.model,
      files: event.files,
      truncated: event.truncated,
      context: event.context,
      contextFiles: event.contextFiles,
    }
  }

  try {
    while (true) {
      const { value, done: finished } = await reader.read()
      if (finished) break
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > MAX_STREAM_BUFFER) {
        throw new ApiError('The review stream produced an oversized event.', 'invalid-response')
      }
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const parsed = handleLine(buffer.slice(0, newline))
        if (parsed !== null) done = parsed
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.length > MAX_STREAM_BUFFER) {
      throw new ApiError('The review stream produced an oversized event.', 'invalid-response')
    }
    if (buffer.trim() !== '') {
      const parsed = handleLine(buffer)
      if (parsed !== null) done = parsed
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  if (done === null) throw new ApiError('The review stream ended before completion.', 'empty-review')
  return done
}

/**
 * POST /git-suite/commit-ai-review: stream a Markdown review of the staged
 * diff. The host only reads `git diff --cached`; nothing is committed.
 */
export async function requestCommitReviewStream(
  body: { path: string; language?: string; fresh?: boolean; prompt?: string },
  onEvent: (event: CommitReviewStreamEvent) => void,
  signal?: AbortSignal,
): Promise<CommitReviewPayload> {
  const response = await fetch(new URL('/git-suite/commit-ai-review', window.location.origin), {
    method: 'POST',
    signal,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      'x-dsh-git-suite': '1',
    },
    body: JSON.stringify({ ...body, stream: true }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    type ErrorPayload = { error?: { code?: string; message?: string; details?: ErrorDetails } }
    let payload: ErrorPayload | null = null
    try {
      payload = JSON.parse(text) as ErrorPayload
    } catch {
      payload = null
    }
    const fallback = text.trim().slice(0, 500)
    throw new ApiError(
      payload?.error?.message ?? (fallback === '' ? 'AI review failed.' : fallback),
      payload?.error?.code ?? `http-${response.status}`,
      payload?.error?.details,
    )
  }
  if (response.body === null) throw new ApiError('The review stream was empty.', 'empty-review')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const MAX_STREAM_BUFFER = 1_000_000
  let buffer = ''
  let done: CommitReviewPayload | null = null
  type WireEvent = CommitReviewStreamEvent | {
    type: 'error'
    error: { code?: string; message?: string; details?: ErrorDetails }
  }

  const handleLine = (line: string): CommitReviewPayload | null => {
    if (line.trim() === '') return null
    let event: WireEvent
    try {
      event = JSON.parse(line) as WireEvent
    } catch {
      return null
    }
    if (event.type === 'error') {
      throw new ApiError(event.error.message ?? 'AI review failed.', event.error.code ?? 'internal', event.error.details)
    }
    onEvent(event)
    if (event.type !== 'done') return null
    return { ok: true, review: event.review, model: event.model, hash: event.hash ?? '', truncated: event.truncated }
  }

  try {
    while (true) {
      const { value, done: finished } = await reader.read()
      if (finished) break
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > MAX_STREAM_BUFFER) {
        throw new ApiError('The review stream produced an oversized event.', 'invalid-response')
      }
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const parsed = handleLine(buffer.slice(0, newline))
        if (parsed !== null) done = parsed
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.trim() !== '') {
      const parsed = handleLine(buffer)
      if (parsed !== null) done = parsed
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  if (done === null) throw new ApiError('The review stream ended before completion.', 'empty-review')
  return done
}

export interface ForgetReviewCall {
  path: string
  remote: string
  number: number
}

/** POST /git-suite/pr-review-forget: drop the cached AI review of one request. */
export async function requestForgetPullReview(
  body: ForgetReviewCall,
  signal?: AbortSignal,
): Promise<{ ok: true }> {
  return postCommitJson<{ ok: true }>('/git-suite/pr-review-forget', body, signal)
}

export interface StagedHashPayload {
  ok: true
  hash: string
  empty: boolean
}

/** Read the hash of the current staged diff (staged-hash resource mode). */
export async function requestStagedHash(
  body: { path: string },
  signal?: AbortSignal,
): Promise<StagedHashPayload> {
  return requestJson<StagedHashPayload>({ mode: 'staged-hash', path: body.path }, signal)
}

export interface CommitMediaPayload {
  ok: true
  media: WorkspaceDiffMedia
}

/** Read both sides of an image or audio file in one commit. */
export async function requestCommitMedia(
  body: { path: string; hash: string; file: string },
  signal?: AbortSignal,
): Promise<CommitMediaPayload> {
  return requestJson<CommitMediaPayload>({
    mode: 'commit-media',
    path: body.path,
    hash: body.hash,
    file: body.file,
  }, signal)
}

export interface RevealFileRequest {
  path: string
  file: string
}

/** POST /git-suite/pr-generate: draft a pull request title and body with the default model. */
export async function requestPullDraft(body: PullDraftRequest, signal?: AbortSignal): Promise<PullDraftPayload> {
  return postCommitJson<PullDraftPayload>('/git-suite/pr-generate', body, signal)
}

/** POST /git-suite/reveal: show one working-tree file in the OS file browser. */
export async function requestRevealFile(body: RevealFileRequest, signal?: AbortSignal): Promise<RevealPayload> {
  return postCommitJson<RevealPayload>('/git-suite/reveal', body, signal)
}

export interface GenerateMessageRequest {
  path: string
  /** User prompt template; the host falls back to its built-in text. */
  prompt?: string
}

/** POST /git-suite/generate-message; the host summarizes the staged (or unstaged) diff with the default model. */
export async function requestGenerateMessage(
  body: GenerateMessageRequest,
  signal?: AbortSignal,
): Promise<GenerateMessagePayload> {
  const response = await fetch(new URL('/git-suite/generate-message', window.location.origin), {
    method: 'POST',
    signal,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'x-dsh-git-suite': '1',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  const parsed = payload as ErrorPayload | null
  if (response.ok && parsed?.ok === true) return payload as GenerateMessagePayload
  throw new ApiError(
    parsed?.error?.message ?? `Request failed with HTTP ${response.status}`,
    parsed?.error?.code ?? 'request-failed',
    parsed?.error?.details,
  )
}

/** POST /git-suite/pick-directory; the host opens its native directory chooser. */
export async function requestPickDirectory(
  mode: 'repo' | 'directory' = 'repo',
  signal?: AbortSignal,
): Promise<PickDirectoryPayload> {
  const response = await fetch(new URL('/git-suite/pick-directory', window.location.origin), {
    method: 'POST',
    signal,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'x-dsh-git-suite': '1',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ mode }),
  })
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  const parsed = payload as ErrorPayload | null
  if (response.ok && parsed?.ok === true) return payload as PickDirectoryPayload
  throw new ApiError(
    parsed?.error?.message ?? `Request failed with HTTP ${response.status}`,
    parsed?.error?.code ?? 'request-failed',
    parsed?.error?.details,
  )
}

async function postCommitJson<T>(endpoint: string, body: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(new URL(endpoint, window.location.origin), {
    method: 'POST',
    signal,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'x-dsh-git-suite': '1',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  const parsed = payload as ErrorPayload | null
  if (response.ok && parsed?.ok === true) return payload as T
  throw new ApiError(
    parsed?.error?.message ?? `Request failed with HTTP ${response.status}`,
    parsed?.error?.code ?? 'request-failed',
    parsed?.error?.details,
  )
}

export interface TagRequest {
  path: string
  /** `create` (default) or `delete`. */
  action?: 'create' | 'delete'
  /** Commit to tag; ignored when `base` is used instead. */
  hash?: string
  /** Ref to tag (`HEAD`, a branch, a tag, or a commit). */
  base?: string
  name: string
  /** Previous name when the tag is renamed. */
  previousName?: string
  message?: string
  force?: boolean
}

/** POST /git-suite/tag: create or force-move a tag at one commit. */
export async function requestTag(body: TagRequest, signal?: AbortSignal): Promise<TagPayload> {
  return postCommitJson<TagPayload>('/git-suite/tag', body, signal)
}

/** GET /git-suite?mode=tag: one tag's commit, subject, and annotation message. */
export async function requestTagInfo(
  params: { path: string; name: string },
  signal?: AbortSignal,
): Promise<TagInfoPayload> {
  return requestJson<TagInfoPayload>({ mode: 'tag', path: params.path, name: params.name }, signal)
}

/** GET /git-suite?mode=tag-status: how local tags compare with one remote's tags. */
export async function requestTagStatus(
  params: { path: string; remote: string },
  signal?: AbortSignal,
): Promise<TagStatusPayload> {
  return requestJson<TagStatusPayload>({ mode: 'tag-status', path: params.path, remote: params.remote }, signal)
}

/** GET /git-suite?mode=version: installed version versus the latest npm release. */
export async function requestVersionCheck(signal?: AbortSignal): Promise<VersionPayload> {
  return requestJson<VersionPayload>({ mode: 'version' }, signal)
}

/** GET /git-suite?mode=operation: an in-progress merge/rebase/pick plus its conflicts. */
export async function requestOperation(
  params: { path: string },
  signal?: AbortSignal,
): Promise<OperationPayload> {
  return requestJson<OperationPayload>({ mode: 'operation', path: params.path }, signal)
}

/** GET /git-suite?mode=commit-messages: recent messages for the commit box history. */
export async function requestCommitMessages(
  params: { path: string },
  signal?: AbortSignal,
): Promise<CommitMessagesPayload> {
  return requestJson<CommitMessagesPayload>({ mode: 'commit-messages', path: params.path }, signal)
}

/** GET /git-suite?mode=reflog: recent HEAD movements for recovery. */
export async function requestReflog(
  params: { path: string; limit?: number },
  signal?: AbortSignal,
): Promise<ReflogPayload> {
  return requestJson<ReflogPayload>({
    mode: 'reflog',
    path: params.path,
    ...(params.limit === undefined ? {} : { limit: String(params.limit) }),
  }, signal)
}

export interface CommitOpRequest {
  path: string
  action: 'cherry-pick' | 'revert' | 'reset' | 'abort' | 'continue' | 'skip' | 'resolve'
  hash?: string
  mode?: 'soft' | 'mixed' | 'hard'
  /** `resolve` only: repository-relative file to mark resolved. */
  file?: string
  side?: 'ours' | 'theirs'
}

/** POST /git-suite/commit-op: cherry-pick, revert, reset, or abort. */
export async function requestCommitOp(body: CommitOpRequest, signal?: AbortSignal): Promise<CommitOpPayload> {
  return postCommitJson<CommitOpPayload>('/git-suite/commit-op', body, signal)
}

export interface StashRequest {
  path: string
  action: 'save' | 'apply' | 'pop' | 'drop'
  ref?: string
  message?: string
  includeUntracked?: boolean
}

/** POST /git-suite/stash: push, apply, pop, or drop one stash entry. */
export async function requestStash(body: StashRequest, signal?: AbortSignal): Promise<StashPayload> {
  return postCommitJson<StashPayload>('/git-suite/stash', body, signal)
}

export interface BranchRequest {
  path: string
  name: string
  /** Commit the branch starts at; ignored when `base` is used instead. */
  hash?: string
  /** Ref the branch starts at (`HEAD`, a branch, a tag, or a commit). */
  base?: string
}

/** POST /git-suite/branch: create a local branch at a commit or ref. */
export async function requestBranch(body: BranchRequest, signal?: AbortSignal): Promise<BranchPayload> {
  return postCommitJson<BranchPayload>('/git-suite/branch', body, signal)
}

export interface CheckoutRequest {
  path: string
  hash?: string
  branch?: string
  /** Any revision to detach HEAD at, e.g. a tag ref; ignored when `hash` is set. */
  ref?: string
}

/** POST /git-suite/checkout: switch to a local branch or detach HEAD at a commit. */
export async function requestCheckout(body: CheckoutRequest, signal?: AbortSignal): Promise<CheckoutPayload> {
  return postCommitJson<CheckoutPayload>('/git-suite/checkout', body, signal)
}

export interface SyncRequest {
  action: SyncAction
  /** Tag name for `fetch-tag`: overwrite the local tag from the remote. */
  tag?: string
  path: string
  remote?: string
  branch?: string
  refs?: PushTarget[]
  /** Tag names pushed individually. */
  tagRefs?: string[]
  tags?: boolean
  force?: boolean
  fetchAll?: boolean
  prune?: boolean
  forceTags?: boolean
}

/** POST /git-suite/sync: fetch all remotes, or pull/push an explicit remote branch. */
export async function requestSync(body: SyncRequest, signal?: AbortSignal): Promise<SyncPayload> {
  return postCommitJson<SyncPayload>('/git-suite/sync', body, signal)
}

export interface RemoveRemoteRequest {
  path: string
  name: string
}

export interface AddRemoteRequest {
  path: string
  name: string
  url: string
}

export interface SetRemoteUrlRequest {
  path: string
  /** Current remote name. */
  name: string
  url: string
  /** New name when the remote is renamed as well. */
  newName?: string
}

/** POST /git-suite/remote: remove one configured remote. */
export async function requestRemoveRemote(body: RemoveRemoteRequest, signal?: AbortSignal): Promise<RemoteRemovePayload> {
  return postCommitJson<RemoteRemovePayload>('/git-suite/remote', { action: 'remove', ...body }, signal)
}

/** POST /git-suite/remote: add one configured remote. */
export async function requestAddRemote(body: AddRemoteRequest, signal?: AbortSignal): Promise<RemoteAddPayload> {
  return postCommitJson<RemoteAddPayload>('/git-suite/remote', { action: 'add', ...body }, signal)
}

/** POST /git-suite/remote: rename and/or replace the URL of one configured remote. */
export async function requestSetRemoteUrl(body: SetRemoteUrlRequest, signal?: AbortSignal): Promise<RemoteUrlPayload> {
  return postCommitJson<RemoteUrlPayload>('/git-suite/remote', { action: 'set-url', ...body }, signal)
}

export interface BranchActionRequest {
  action: BranchAction
  path: string
  /** Ignored by ebase-onto, which always acts on the current branch. */
  branch?: string
  remote?: string
  newName?: string
  /** `upstream` only: the remote-tracking ref to follow, or empty to stop tracking. */
  upstream?: string
  /** ebase-onto only: any commit, tag, or branch to rebase onto. */
  target?: string
  /** Delete only: force deletion even when the branch is not fully merged. */
  force?: boolean
}

/** POST /git-suite/branch-action: merge, rebase, rename, or delete a local branch. */
export async function requestBranchAction(body: BranchActionRequest, signal?: AbortSignal): Promise<BranchActionPayload> {
  return postCommitJson<BranchActionPayload>('/git-suite/branch-action', body, signal)
}

export function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(error instanceof Error ? error.message : String(error), 'internal')
}









