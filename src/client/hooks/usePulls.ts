import type { ForgeAuthPrompt } from '../components/ForgeAuthDialog.js'
import { toast } from '../components/Toast.js'
import { useCallback, useEffect, useRef, useState } from '../runtime.js'
import { isAbortError, requestCredential, requestPull, requestPullAiReviewStream, requestPullCheckout, requestPullClose, requestPullCreate, requestPullDelete, requestPullGiteeDecision, requestPullMerge, requestPullReopen, requestPulls, toApiError, type ApiError } from '../lib/api.js'
import { defaultForgeRemote, forgeOf, supportedRemotes } from '../lib/forge.js'
import type { AiReviewMode, DetailStatus, LoadStatus, PullCreateBranch, PullCreateRequest, PullDetail, PullListState, PullMergeRequest, PullSummary, RemoteGroup, Translate } from '../types.js'

/** Stop accumulating after this many rows so the panel stays responsive. */
const MAX_PULLS = 300
/** Quietly refresh the first page and the selected detail while the view is open. */
const PR_REFRESH_MS = 60_000
const AI_REVIEW_MODE_KEY = 'dsh.git-suite.ai-review-mode.v1'

export type PullActionResult =
  | { ok: true; warning?: string }
  | { ok: false; auth: true }
  | { ok: false; auth: false; message: string }

function readAiReviewMode(): AiReviewMode {
  try {
    const value = window.localStorage.getItem(AI_REVIEW_MODE_KEY)
    if (value === 'diff' || value === 'api' || value === 'worktree') return value
  } catch {
    // Storage may be unavailable.
  }
  return 'worktree'
}

export interface PullsView {
  /** Supported remotes only; empty when this repository has no forge. */
  remotes: RemoteGroup[]
  remote: string
  state: PullListState
  status: LoadStatus
  pulls: PullSummary[]
  error: ApiError | null
  hasMore: boolean
  /** A later page is being fetched. */
  loadingMore: boolean
  selected: number | null
  detail: PullDetail | null
  detailStatus: DetailStatus
  detailError: ApiError | null
  authPrompt: ForgeAuthPrompt | null
  authBusy: boolean
  authError: string | null
  checkingOut: number | null
  /** Non-null while a close request is in flight. */
  closing: number | null
  /** Non-null while a reopen request is in flight. */
  reopening: number | null
  selectRemote(name: string): void
  setState(state: PullListState): void
  refresh(): void
  /** Fetch the next page and append it (no-op when there is nothing left). */
  loadMore(): void
  selectPull(number: number, fresh?: boolean): Promise<boolean>
  submitToken(username: string, token: string): Promise<void>
  dismissAuth(): void
  checkout(number: number): Promise<void>
  /** Close on the forge; resolves with an error message, or null on success. */
  closePull(number: number): Promise<string | null>
  /** Reopen a closed request; resolves with an error message, or null on success. */
  reopenPull(number: number): Promise<string | null>
  /** Non-null while a merge request is in flight. */
  merging: number | null
  /** Merge the selected request; resolves with an error message, or null. */
  mergePull(input: PullMergeRequest): Promise<string | null>
  /** Non-null while a Gitee review/test approval is in flight. */
  giteeDecision: 'review' | 'test' | null
  /** Mark Gitee review or test as passed; resolves with the action result. */
  decideGitee(action: 'review' | 'test', numberOverride?: number): Promise<PullActionResult>
  /** Non-null while a delete request is in flight. */
  deleting: number | null
  /** Permanently delete a GitLab merge request; resolves with the action result. */
  deletePull(number: number): Promise<PullActionResult>
  /** Read-only AI review of the selected request. */
  aiReview: string
  aiReviewReasoning: string
  aiReviewAttempt: number
  aiReviewStatus: 'idle' | 'loading' | 'ready' | 'error'
  aiReviewError: string | null
  aiReviewContext: 'worktree' | 'api' | 'diff' | null
  aiReviewContextFiles: number
  aiReviewMode: AiReviewMode
  setAiReviewMode(mode: AiReviewMode): void
  runAiReview(mode?: AiReviewMode): void
  clearAiReview(): void
  /** The checked-out branch a new request would come from. */
  headBranch: string
  /** Remote that owns the source branch (for a cross-repository request). */
  headRemote: string
  /** Repository root, for host features that read local git data. */
  repoRoot: string
  /** Local branches with their upstream refs, for the create dialog. */
  localBranches: readonly PullCreateBranch[]
  /** The remote's default branch, used to prefill the create form. */
  defaultBase: string
  /** Open a request from the current branch; resolves with an error message, or null. */
  createPull(input: PullCreateRequest): Promise<string | null>
}

export interface UsePullsOptions {
  /** Only load while the PR view is the visible one. */
  active: boolean
  repoRoot: string
  remotes: readonly RemoteGroup[]
  /** Current branch upstream (`origin/main`), used to pick the default remote. */
  upstream: string
  /** Checked-out branch, shown as the source of a new request. */
  branch: string
  /** Local branches with their upstream refs, for the create dialog's From picker. */
  branches?: readonly PullCreateBranch[]
  t: Translate
  /** Called after a pull request was checked out, so the panel reloads. */
  onCheckedOut(): void
}

/**
 * Owns the PR view: supported remotes, the paged list, the selected request's
 * detail, credential prompting, and local checkout. Requests stay lazy: while
 * the history or commit view is visible nothing here talks to the network.
 */
export function usePulls({ active, repoRoot, remotes, upstream, branch, branches = [], t, onCheckedOut }: UsePullsOptions): PullsView {
  const supported = supportedRemotes(remotes)
  const [remote, setRemote] = useState('')
  const [state, setState] = useState<PullListState>('open')
  const [pulls, setPulls] = useState<PullSummary[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState<ApiError | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextPage, setNextPage] = useState(2)
  const [defaultBase, setDefaultBase] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [detail, setDetail] = useState<PullDetail | null>(null)
  const [detailStatus, setDetailStatus] = useState<DetailStatus>('idle')
  const [detailError, setDetailError] = useState<ApiError | null>(null)
  const [authPrompt, setAuthPrompt] = useState<ForgeAuthPrompt | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [checkingOut, setCheckingOut] = useState<number | null>(null)
  const [closing, setClosing] = useState<number | null>(null)
  const [reopening, setReopening] = useState<number | null>(null)
  const [merging, setMerging] = useState<number | null>(null)
  const [giteeDecision, setGiteeDecision] = useState<'review' | 'test' | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  /** Synchronous guards: React state may still be stale on a fast second click. */
  const giteeDecisionRef = useRef<'review' | 'test' | null>(null)
  const deletingRef = useRef<number | null>(null)
  const selectedRef = useRef<number | null>(null)

  useEffect(() => {
    selectedRef.current = selected
  }, [selected])
  const [aiReview, setAiReview] = useState('')
  const [aiReviewReasoning, setAiReviewReasoning] = useState('')
  const [aiReviewAttempt, setAiReviewAttempt] = useState(1)
  const [aiReviewStatus, setAiReviewStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [aiReviewError, setAiReviewError] = useState<string | null>(null)
  const [aiReviewContext, setAiReviewContext] = useState<'worktree' | 'api' | 'diff' | null>(null)
  const [aiReviewContextFiles, setAiReviewContextFiles] = useState(0)
  const [aiReviewMode, setAiReviewModeState] = useState<AiReviewMode>(readAiReviewMode)
  /** State change requested before the forge asked for a token; retried after saving. */
  const pendingState = useRef<{ action: 'close' | 'reopen'; number: number } | null>(null)
  /** New request that failed on auth; retried after saving the token. */
  const pendingCreate = useRef<PullCreateRequest | null>(null)
  /** Merge that failed on auth; retried after saving the token. */
  const pendingMerge = useRef<{ number: number; input: PullMergeRequest } | null>(null)
  /** Gitee approval that failed on auth; retried after saving the token. */
  const pendingGiteeDecision = useRef<{ number: number; action: 'review' | 'test' } | null>(null)
  /** Delete that failed on auth; retried after saving the token. */
  const pendingDelete = useRef<number | null>(null)
  /** AI review that failed on auth; retried after saving the token. */
  const pendingAiReview = useRef<{ number: number; mode: AiReviewMode } | null>(null)
  const aiAbort = useRef<AbortController | null>(null)
  const aiRunningRef = useRef(false)
  const creatingRef = useRef(false)
  const [reload, setReload] = useState(0)
  const listAbort = useRef<AbortController | null>(null)
  const moreAbort = useRef<AbortController | null>(null)
  const detailAbort = useRef<AbortController | null>(null)
  /** The next list load skips the host's response cache (manual refresh). */
  const freshRef = useRef(false)

  // Pick a supported remote once the refs tree has loaded.
  useEffect(() => {
    if (!active) return
    if (supported.length === 0) {
      if (remote !== '') setRemote('')
      return
    }
    if (supported.some(item => item.name === remote)) return
    setRemote(defaultForgeRemote(remotes, upstream))
  }, [active, remotes, upstream, remote, supported.length])

  // A different repository, remote, or filter starts from a clean slate.
  useEffect(() => {
    listAbort.current?.abort()
    moreAbort.current?.abort()
    detailAbort.current?.abort()
    setPulls([])
    setHasMore(false)
    setLoadingMore(false)
    setNextPage(2)
    setDefaultBase('')
    setSelected(null)
    setDetail(null)
    setDetailStatus('idle')
    setDetailError(null)
    setError(null)
    setStatus('loading')
    setAuthPrompt(null)
    setAuthError(null)
    pendingState.current = null
    pendingCreate.current = null
    pendingMerge.current = null
    pendingGiteeDecision.current = null
    pendingDelete.current = null
    pendingAiReview.current = null
    aiAbort.current?.abort()
    aiAbort.current = null
    aiRunningRef.current = false
    setAiReview('')
    setAiReviewReasoning('')
    setAiReviewAttempt(1)
    setAiReviewStatus('idle')
    setAiReviewError(null)
    setAiReviewContext(null)
    setAiReviewContextFiles(0)
  }, [repoRoot, remote, state])

  // Leaving the view cancels anything still in flight.
  useEffect(() => {
    if (active) return
    listAbort.current?.abort()
    detailAbort.current?.abort()
  }, [active])

  const promptAuth = useCallback((apiError: ApiError, remoteName: string): void => {
    const details = apiError.details ?? {}
    const forge = forgeOf(remotes, remoteName)
    setAuthError(null)
    setAuthPrompt({
      provider: typeof details.provider === 'string' ? details.provider : forge?.provider ?? '',
      host: typeof details.host === 'string' ? details.host : forge?.host ?? '',
      remote: typeof details.remote === 'string' ? details.remote : remoteName,
      owner: forge?.owner ?? '',
    })
  }, [remotes])

  const selectPull = useCallback(async (number: number, fresh = false): Promise<boolean> => {
    setSelected(number)
    setDetail(null)
    setDetailStatus('loading')
    setDetailError(null)
    detailAbort.current?.abort()
    const controller = new AbortController()
    detailAbort.current = controller
    try {
      const payload = await requestPull({ path: repoRoot, remote, number, state, fresh }, controller.signal)
      if (controller.signal.aborted) return false
      setDetail(payload.pull)
      setDetailStatus('ready')
      return true
    } catch (loadError) {
      if (controller.signal.aborted || isAbortError(loadError)) return false
      const apiError = toApiError(loadError)
      setDetailError(apiError)
      setDetailStatus('error')
      if (apiError.code === 'forge-auth-required') promptAuth(apiError, remote)
      return false
    }
  }, [promptAuth, remote, repoRoot, state])

  // A different request starts with no stale AI review.
  useEffect(() => {
    aiAbort.current?.abort()
    aiAbort.current = null
    aiRunningRef.current = false
    setAiReview('')
    setAiReviewReasoning('')
    setAiReviewAttempt(1)
    setAiReviewStatus('idle')
    setAiReviewError(null)
    setAiReviewContext(null)
    setAiReviewContextFiles(0)
  }, [selected])

  /** Refresh the selected detail without clearing it or flashing a spinner. */
  const refreshQuietDetail = useCallback(async (number: number): Promise<boolean> => {
    try {
      const payload = await requestPull({ path: repoRoot, remote, number, state, fresh: true })
      setDetail(current => current?.number === number ? payload.pull : current)
      return true
    } catch {
      // Best-effort: keep the current detail on a failed background refresh.
      return false
    }
  }, [remote, repoRoot, state])

  // Load one page whenever the view becomes visible or its inputs change.
  useEffect(() => {
    if (!active || repoRoot === '' || remote === '') return undefined
    if (!supported.some(item => item.name === remote)) return undefined
    const fresh = freshRef.current
    freshRef.current = false
    listAbort.current?.abort()
    const controller = new AbortController()
    listAbort.current = controller
    setStatus('loading')
    setError(null)
    requestPulls({ path: repoRoot, remote, state, fresh }, controller.signal)
      .then(payload => {
        if (controller.signal.aborted) return
        setPulls(Array.isArray(payload.pulls) ? payload.pulls : [])
        setHasMore(payload.hasMore === true)
        setDefaultBase(typeof payload.defaultBase === 'string' ? payload.defaultBase : '')
        setNextPage(2)
        setLoadingMore(false)
        setStatus('ready')
      })
      .catch(loadError => {
        if (controller.signal.aborted || isAbortError(loadError)) return
        const apiError = toApiError(loadError)
        setError(apiError)
        setStatus('error')
        if (apiError.code === 'forge-auth-required') promptAuth(apiError, remote)
      })
    return () => controller.abort()
  }, [active, promptAuth, reload, remote, repoRoot, state, supported.length])

  // Open the newest pull request after the list arrives.
  useEffect(() => {
    if (status !== 'ready' || pulls.length === 0) return
    if (selected !== null && pulls.some(pull => pull.number === selected)) return
    const first = pulls[0]
    if (first !== undefined) void selectPull(first.number)
  }, [pulls, selected, selectPull, status])

  useEffect(() => () => {
    listAbort.current?.abort()
    moreAbort.current?.abort()
    detailAbort.current?.abort()
    aiAbort.current?.abort()
  }, [])

  // Quietly keep the first page and the selected detail fresh without losing
  // loaded pages: new rows are merged in, closed ones disappear from "open".
  useEffect(() => {
    if (!active || repoRoot === '' || remote === '') return undefined
    let disposed = false

    const refreshQuiet = async (): Promise<void> => {
      if (document.visibilityState !== 'visible') return
      try {
        const payload = await requestPulls({ path: repoRoot, remote, state, page: 1, fresh: true })
        if (disposed) return
        const incoming = Array.isArray(payload.pulls) ? payload.pulls : []
        setPulls(current => {
          const seen = new Set(incoming.map(pull => pull.number))
          const merged = [...incoming, ...current.filter(pull => !seen.has(pull.number))]
          const filtered = state === 'open'
            ? merged.filter(pull => pull.state === 'open')
            : state === 'merged'
              ? merged.filter(pull => pull.state === 'merged')
              : state === 'closed'
                ? merged.filter(pull => pull.state !== 'open')
                : merged
          return filtered.slice(0, MAX_PULLS)
        })
        if (selected !== null) void refreshQuietDetail(selected)
      } catch {
        // Polling is best-effort; the normal list error path handles manual loads.
      }
    }

    const timer = window.setInterval(() => { void refreshQuiet() }, PR_REFRESH_MS)
    const onFocus = (): void => { void refreshQuiet() }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void refreshQuiet()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [active, refreshQuietDetail, remote, repoRoot, selected, state])

  const selectRemote = useCallback((name: string): void => {
    setRemote(name)
  }, [])

  const refresh = useCallback((): void => {
    freshRef.current = true
    setReload(value => value + 1)
    if (selected !== null) void selectPull(selected, true)
  }, [selected, selectPull])

  const loadMore = useCallback((): void => {
    if (!active || status !== 'ready' || !hasMore || loadingMore || repoRoot === '' || remote === '') return
    moreAbort.current?.abort()
    const controller = new AbortController()
    moreAbort.current = controller
    setLoadingMore(true)
    requestPulls({ path: repoRoot, remote, state, page: nextPage, fresh: true }, controller.signal)
      .then(payload => {
        if (controller.signal.aborted) return
        const seen = new Set(pulls.map(pull => pull.number))
        const incoming = payload.pulls.filter(pull => !seen.has(pull.number))
        const merged = [...pulls, ...incoming].slice(0, MAX_PULLS)
        setPulls(merged)
        setHasMore(payload.hasMore === true && merged.length < MAX_PULLS)
        setNextPage(value => value + 1)
      })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error)) toast(toApiError(error).message, 'error')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingMore(false)
      })
  }, [active, hasMore, loadingMore, nextPage, pulls, remote, repoRoot, state])

  const changePullState = useCallback(async (number: number, action: 'close' | 'reopen'): Promise<string | null> => {
    if (closing !== null || reopening !== null || repoRoot === '' || remote === '') return null
    const setBusy = action === 'close' ? setClosing : setReopening
    setBusy(number)
    try {
      await (action === 'close' ? requestPullClose : requestPullReopen)({ path: repoRoot, remote, number })
      toast(action === 'close'
        ? t('pullClosed').replace('{number}', String(number))
        : t('pullReopened').replace('{number}', String(number)))
      freshRef.current = true
      setReload(value => value + 1)
      if ((action === 'close' ? state !== 'open' : state !== 'closed')) {
        void selectPull(number, true)
      } else {
        setPulls(current => current.filter(item => item.number !== number))
        setSelected(null)
        setDetail(null)
        setDetailStatus('idle')
      }
      return null
    } catch (error) {
      const apiError = toApiError(error)
      if (apiError.code === 'forge-auth-required') {
        pendingState.current = { action, number }
        promptAuth(apiError, remote)
        return null
      }
      return apiError.message
    } finally {
      setBusy(null)
    }
  }, [closing, promptAuth, remote, reopening, repoRoot, selectPull, state, t])

  const closePull = useCallback((number: number): Promise<string | null> => changePullState(number, 'close'), [changePullState])
  const reopenPull = useCallback((number: number): Promise<string | null> => changePullState(number, 'reopen'), [changePullState])

  const createPull = useCallback(async (input: PullCreateRequest): Promise<string | null> => {
    if (creatingRef.current || repoRoot === '' || remote === '') return null
    creatingRef.current = true
    try {
      const payload = await requestPullCreate({
        path: repoRoot,
        remote: input.remote ?? remote,
        title: input.title,
        body: input.body,
        base: input.base,
        head: input.head,
        draft: input.draft,
      })
      toast(t('pullCreated').replace('{number}', String(payload.number)))
      freshRef.current = true
      if (state === 'closed' || state === 'merged') {
        // A new request is open; switch to the open filter and let the reload select it.
        setState('open')
        setReload(value => value + 1)
        return null
      }
      // Show it at the top immediately; the fresh page reload keeps the list true.
      setPulls(current => [payload.pull, ...current.filter(item => item.number !== payload.number)])
      setSelected(payload.number)
      void selectPull(payload.number, true)
      setReload(value => value + 1)
      return null
    } catch (error) {
      const apiError = toApiError(error)
      if (apiError.code === 'forge-auth-required') {
        pendingCreate.current = input
        promptAuth(apiError, remote)
        return null
      }
      if (apiError.code === 'branch-not-pushed') {
        const name = typeof apiError.details?.branch === 'string' ? apiError.details.branch : branch
        return t('pullBranchNotPushed').replace('{branch}', name)
      }
      if (apiError.code === 'detached-head') return t('pullDetached')
      return apiError.message
    } finally {
      creatingRef.current = false
    }
  }, [branch, promptAuth, remote, repoRoot, selectPull, state, t])

  const mergePull = useCallback(async (input: PullMergeRequest, numberOverride?: number): Promise<string | null> => {
    const number = numberOverride ?? selected
    if (merging !== null || number === null || repoRoot === '' || remote === '') return null
    setMerging(number)
    try {
      const payload = await requestPullMerge({
        path: repoRoot,
        remote,
        number,
        method: input.method,
        deleteSourceBranch: input.deleteSourceBranch,
        base: input.base,
      })
      if (!payload.merged) return payload.message !== '' ? payload.message : t('pullMergeFailed')
      toast(t('pullMerged').replace('{number}', String(number)))
      // The host fetched the base branch (and fast-forwarded it when checked
      // out); reload the log so History shows the merge immediately.
      onCheckedOut()
      freshRef.current = true
      setReload(value => value + 1)
      if (state === 'open') {
        setPulls(current => current.filter(item => item.number !== number))
        setSelected(null)
        setDetail(null)
        setDetailStatus('idle')
      } else {
        void selectPull(number, true)
      }
      return null
    } catch (error) {
      const apiError = toApiError(error)
      if (apiError.code === 'forge-auth-required') {
        pendingMerge.current = { number, input }
        promptAuth(apiError, remote)
        return null
      }
      if (
        apiError.code === 'forge-request-failed'
        && apiError.details?.status === 405
        && forgeOf(remotes, remote)?.provider === 'gitee'
      ) {
        return t('pullMergeGiteeReviewRequired')
      }
      return apiError.message
    } finally {
      setMerging(null)
    }
  }, [merging, onCheckedOut, promptAuth, remote, remotes, repoRoot, selectPull, selected, state, t])

  const decideGitee = useCallback(async (action: 'review' | 'test', numberOverride?: number): Promise<PullActionResult> => {
    const number = numberOverride ?? selected
    if (number === null || repoRoot === '' || remote === '') {
      return { ok: false, auth: false, message: t('pullNoSelection') }
    }
    if (giteeDecision !== null || giteeDecisionRef.current !== null || deletingRef.current !== null) {
      return { ok: false, auth: false, message: t('pullGiteeBusy') }
    }
    giteeDecisionRef.current = action
    setGiteeDecision(action)
    try {
      await requestPullGiteeDecision({ path: repoRoot, remote, number, action })
      toast(action === 'review' ? t('pullGiteeReviewPassed') : t('pullGiteeTestPassed'))
      if (selectedRef.current === number) {
        const refreshed = await refreshQuietDetail(number)
        if (!refreshed) {
          const warning = t('pullDetailRefreshFailed')
          toast(warning)
          return { ok: true, warning }
        }
      }
      return { ok: true }
    } catch (error) {
      const apiError = toApiError(error)
      if (apiError.code === 'forge-auth-required') {
        pendingGiteeDecision.current = { number, action }
        promptAuth(apiError, remote)
        return { ok: false, auth: true }
      }
      pendingGiteeDecision.current = null
      return { ok: false, auth: false, message: apiError.message }
    } finally {
      giteeDecisionRef.current = null
      setGiteeDecision(null)
    }
  }, [giteeDecision, promptAuth, refreshQuietDetail, remote, repoRoot, t])

  const deletePull = useCallback(async (number: number): Promise<PullActionResult> => {
    if (repoRoot === '' || remote === '') {
      return { ok: false, auth: false, message: t('pullNoSelection') }
    }
    if (deleting !== null || deletingRef.current !== null || giteeDecisionRef.current !== null) {
      return { ok: false, auth: false, message: t('pullDeleteBusy') }
    }
    deletingRef.current = number
    setDeleting(number)
    try {
      await requestPullDelete({ path: repoRoot, remote, number })
      toast(t('pullDeleted').replaceAll('{number}', String(number)))
      pendingDelete.current = null
      detailAbort.current?.abort()
      detailAbort.current = null
      setPulls(current => current.filter(item => item.number !== number))
      selectedRef.current = null
      setSelected(null)
      setDetail(null)
      setDetailStatus('idle')
      setDetailError(null)
      freshRef.current = true
      setReload(value => value + 1)
      return { ok: true }
    } catch (error) {
      const apiError = toApiError(error)
      if (apiError.code === 'forge-auth-required') {
        pendingDelete.current = number
        promptAuth(apiError, remote)
        return { ok: false, auth: true }
      }
      pendingDelete.current = null
      return { ok: false, auth: false, message: apiError.message }
    } finally {
      deletingRef.current = null
      setDeleting(null)
    }
  }, [deleting, promptAuth, remote, repoRoot, t])

  const runAiReview = useCallback((numberOverride?: number, modeOverride?: AiReviewMode): void => {
    const number = numberOverride ?? selected
    const mode = modeOverride ?? aiReviewMode
    if (number === null || repoRoot === '' || remote === '' || aiRunningRef.current) return
    aiRunningRef.current = true
    aiAbort.current?.abort()
    const controller = new AbortController()
    aiAbort.current = controller
    setAiReview('')
    setAiReviewReasoning('')
    setAiReviewAttempt(1)
    setAiReviewError(null)
    setAiReviewStatus('loading')
    setAiReviewContext(null)
    setAiReviewContextFiles(0)
    requestPullAiReviewStream({
      path: repoRoot,
      remote,
      number,
      language: t('localeId'),
      context: mode,
    }, event => {
      if (event.type === 'start') {
        setAiReviewAttempt(event.attempt)
        setAiReviewContext(event.context)
        setAiReviewContextFiles(event.contextFiles)
      } else if (event.type === 'reasoning') {
        setAiReviewReasoning(current => current + event.text)
      } else if (event.type === 'text') {
        setAiReview(current => current + event.text)
      } else if (event.type === 'retry') {
        setAiReview('')
        setAiReviewReasoning('')
        setAiReviewAttempt(event.attempt)
        setAiReviewContext(null)
        setAiReviewContextFiles(0)
      }
    }, controller.signal)
      .then(payload => {
        if (controller.signal.aborted) return
        setAiReview(payload.review)
        setAiReviewContext(payload.context)
        setAiReviewContextFiles(payload.contextFiles)
        setAiReviewStatus('ready')
      })
      .catch(error => {
        if (controller.signal.aborted || isAbortError(error)) return
        const apiError = toApiError(error)
        if (apiError.code === 'forge-auth-required') {
          pendingAiReview.current = { number, mode }
          setAiReviewStatus('idle')
          promptAuth(apiError, remote)
          return
        }
        if (apiError.code === 'review-truncated') {
          setAiReviewError(t('pullAiReviewTruncated'))
        } else if (apiError.code === 'empty-review') {
          setAiReviewError(t('pullAiReviewEmpty'))
        } else {
          setAiReviewError(apiError.message)
        }
        setAiReviewStatus('error')
      })
      .finally(() => {
        if (aiAbort.current === controller) {
          aiAbort.current = null
          aiRunningRef.current = false
        }
      })
  }, [aiReviewMode, promptAuth, remote, repoRoot, selected, t])

  const chooseAiReviewMode = useCallback((mode: AiReviewMode): void => {
    setAiReviewModeState(mode)
    try {
      window.localStorage.setItem(AI_REVIEW_MODE_KEY, mode)
    } catch {
      // The current choice still applies in memory.
    }
  }, [])

  const clearAiReview = useCallback((): void => {
    aiAbort.current?.abort()
    aiAbort.current = null
    aiRunningRef.current = false
    setAiReview('')
    setAiReviewReasoning('')
    setAiReviewAttempt(1)
    setAiReviewError(null)
    setAiReviewStatus('idle')
    setAiReviewContext(null)
    setAiReviewContextFiles(0)
  }, [])

  const submitToken = useCallback(async (username: string, token: string): Promise<void> => {
    const prompt = authPrompt
    if (prompt === null || authBusy) return
    setAuthBusy(true)
    setAuthError(null)
    try {
      await requestCredential({
        path: repoRoot,
        remote: prompt.remote,
        username,
        password: token,
        forge: true,
      })
      setAuthPrompt(null)
      freshRef.current = true
      setReload(value => value + 1)
      const pendingNew = pendingCreate.current
      pendingCreate.current = null
      if (pendingNew !== null) {
        await createPull(pendingNew)
        return
      }
      const pendingMergeRequest = pendingMerge.current
      pendingMerge.current = null
      if (pendingMergeRequest !== null) {
        await mergePull(pendingMergeRequest.input, pendingMergeRequest.number)
        return
      }
      const pendingApproval = pendingGiteeDecision.current
      pendingGiteeDecision.current = null
      if (pendingApproval !== null) {
        await decideGitee(pendingApproval.action, pendingApproval.number)
        return
      }
      const pendingRemoval = pendingDelete.current
      pendingDelete.current = null
      if (pendingRemoval !== null) {
        await deletePull(pendingRemoval)
        return
      }
      const pendingReview = pendingAiReview.current
      pendingAiReview.current = null
      if (pendingReview !== null) {
        runAiReview(pendingReview.number, pendingReview.mode)
        return
      }
      const pending = pendingState.current
      pendingState.current = null
      if (pending !== null) {
        await changePullState(pending.number, pending.action)
        return
      }
      if (selected !== null) void selectPull(selected, true)
    } catch (authFailure) {
      setAuthError(toApiError(authFailure).message)
    } finally {
      setAuthBusy(false)
    }
  }, [authBusy, authPrompt, changePullState, createPull, decideGitee, deletePull, mergePull, repoRoot, runAiReview, selected, selectPull])

  const dismissAuth = useCallback((): void => {
    setAuthPrompt(null)
    setAuthError(null)
    pendingState.current = null
    pendingCreate.current = null
    pendingMerge.current = null
    pendingGiteeDecision.current = null
    pendingDelete.current = null
  }, [])

  const checkout = useCallback(async (number: number): Promise<void> => {
    if (checkingOut !== null || repoRoot === '' || remote === '') return
    setCheckingOut(number)
    try {
      const payload = await requestPullCheckout({ path: repoRoot, remote, number })
      toast(payload.existing
        ? t('pullCheckoutExisting').replace('{branch}', payload.branch)
        : t('pullCheckoutDone').replace('{number}', String(number)).replace('{branch}', payload.branch))
      onCheckedOut()
    } catch (checkoutError) {
      const apiError = toApiError(checkoutError)
      if (apiError.code === 'worktree-dirty') {
        const details = apiError.details
        const count = typeof details?.count === 'number'
          ? details.count
          : Array.isArray(details?.files) ? details.files.length : null
        toast(
          count === null
            ? t('pullCheckoutDirtyNoCount')
            : t('pullCheckoutDirty').replace('{count}', String(count)),
          'error',
        )
      } else {
        toast(apiError.message, 'error')
      }
    } finally {
      setCheckingOut(null)
    }
  }, [checkingOut, onCheckedOut, remote, repoRoot, t])

  return {
    remotes: supported,
    remote,
    state,
    status,
    pulls,
    error,
    hasMore,
    loadingMore,
    selected,
    detail,
    detailStatus,
    detailError,
    authPrompt,
    authBusy,
    authError,
    checkingOut,
    closing,
    reopening,
    merging,
    selectRemote,
    setState,
    refresh,
    loadMore,
    selectPull,
    submitToken,
    dismissAuth,
    checkout,
    closePull,
    reopenPull,
    mergePull,
    giteeDecision,
    decideGitee,
    deleting,
    deletePull,
    aiReview,
    aiReviewReasoning,
    aiReviewAttempt,
    aiReviewStatus,
    aiReviewError,
    aiReviewContext,
    aiReviewContextFiles,
    aiReviewMode,
    setAiReviewMode: chooseAiReviewMode,
    runAiReview: (mode?: AiReviewMode) => { runAiReview(undefined, mode) },
    clearAiReview,
    headBranch: branch,
    headRemote: upstream.includes('/') ? upstream.slice(0, upstream.indexOf('/')) : remote,
    repoRoot,
    localBranches: branches,
    defaultBase,
    createPull,
  }
}
