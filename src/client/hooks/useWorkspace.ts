import { useCallback, useEffect, useRef, useState } from '../runtime.js'
import {
  isAbortError,
  requestAction,
  requestGenerateMessage,
  requestJson,
  requestSync,
  toApiError,
  type ApiError,
  type WorkspaceActionRequest,
} from '../lib/api.js'
import { resolvePrompt } from '../lib/ai-prompts.js'
import { readRepoUiState, writeRepoUiState } from '../lib/ui-state.js'
import { requestCredential } from '../lib/api.js'
import type {
  FetchOptions,
  LoadStatus,
  PushOptions,
  SyncAction,
  Translate,
  WorkspaceActionPayload,
  WorkspaceDiff,
  WorkspaceDiffPayload,
  WorkspaceScope,
  WorkspaceStatus,
  WorkspaceStatusPayload,
} from '../types.js'

export interface AuthPrompt {
  remote: string
  action: SyncAction
  scheme: 'https' | 'ssh' | 'other'
  helper: string | null
}

export interface WorkspaceSelection {
  path: string
  scope: WorkspaceScope
}

export type WorkspaceLoadState = 'idle' | LoadStatus

export interface WorkspaceView {
  status: WorkspaceStatus | null
  statusState: WorkspaceLoadState
  statusError: ApiError | null
  selected: WorkspaceSelection | null
  diff: WorkspaceDiff | null
  diffState: WorkspaceLoadState
  diffError: ApiError | null
  message: string
  amend: boolean
  push: boolean
  actionState: 'idle' | 'loading'
  actionError: ApiError | null
  note: string | null
  generateState: 'idle' | 'loading'
  generateError: ApiError | null
  syncState: 'idle' | 'loading'
  syncAction: SyncAction | null
  syncError: ApiError | null
  syncNote: string | null
  generate(): void
  refresh(): void
  sync(action: SyncAction, target?: { remote: string; branch: string }, fetchOptions?: FetchOptions): void
  pushBranches(options: PushOptions): void
  /** Set when a push/pull failed on authentication; the dialog retries after storing. */
  authPrompt: AuthPrompt | null
  authBusy: boolean
  authError: string | null
  submitCredential(username: string, password: string): Promise<void>
  dismissCredential(): void
  selectFile(path: string, scope: WorkspaceScope): void
  setMessage(value: string): void
  setAmend(value: boolean): void
  setPush(value: boolean): void
  stage(paths: readonly string[]): void
  stageAll(): void
  unstage(paths: readonly string[]): void
  unstageAll(): void
  commit(): void
}

/** Working-tree status, per-file diff, and stage/unstage/commit operations for one repository. */
/** Unsent commit message for one repository, kept across panel switches. */
function readDraft(key: string): string {
  if (key === '') return ''
  return readRepoUiState(key).draft ?? ''
}

function writeDraft(key: string, value: string): void {
  if (key === '') return
  writeRepoUiState({ draft: value }, key)
}

export function useWorkspace(path: string, revision: string, t: Translate, onCommitted?: () => void): WorkspaceView {
  const [status, setStatus] = useState<WorkspaceStatus | null>(null)
  const [statusState, setStatusState] = useState<WorkspaceLoadState>('idle')
  const [statusError, setStatusError] = useState<ApiError | null>(null)
  /** Bumped by {@link WorkspaceView.refresh} so the open diff reloads too. */
  const [treeRevision, setTreeRevision] = useState(0)
  const [selected, setSelected] = useState<WorkspaceSelection | null>(null)
  const [diff, setDiff] = useState<WorkspaceDiff | null>(null)
  const [diffState, setDiffState] = useState<WorkspaceLoadState>('idle')
  const [diffError, setDiffError] = useState<ApiError | null>(null)
  const draftKey = path.trim()
  const [message, setMessage] = useState(() => readDraft(draftKey))
  const [amend, setAmend] = useState(false)
  const [push, setPush] = useState(false)
  const [actionState, setActionState] = useState<'idle' | 'loading'>('idle')
  const [actionError, setActionError] = useState<ApiError | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [generateState, setGenerateState] = useState<'idle' | 'loading'>('idle')
  const [generateError, setGenerateError] = useState<ApiError | null>(null)
  const [syncState, setSyncState] = useState<'idle' | 'loading'>('idle')
  const [syncAction, setSyncAction] = useState<SyncAction | null>(null)
  const [syncError, setSyncError] = useState<ApiError | null>(null)
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const [authPrompt, setAuthPrompt] = useState<AuthPrompt | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const lastSync = useRef<{ action: SyncAction; target?: { remote: string; branch: string }; fetchOptions?: FetchOptions } | null>(null)
  const actionAbort = useRef<AbortController | null>(null)
  const generateAbort = useRef<AbortController | null>(null)
  const syncAbort = useRef<AbortController | null>(null)
  const committedRef = useRef(onCommitted)
  committedRef.current = onCommitted

  // Drafts are per repository, so switching back restores what was typed.
  useEffect(() => {
    setMessage(readDraft(draftKey))
  }, [draftKey])

  // Write the draft back lazily; the field is edited on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => writeDraft(draftKey, message), 250)
    return () => window.clearTimeout(timer)
  }, [draftKey, message])

  const loadStatus = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (path.trim() === '') {
      setStatus(null)
      setStatusState('idle')
      setStatusError(null)
      return
    }
    setStatusState('loading')
    setStatusError(null)
    try {
      const payload = await requestJson<WorkspaceStatusPayload>({ mode: 'status', path }, signal)
      setStatus(payload.workspace)
      setStatusState('ready')
    } catch (error) {
      if (isAbortError(error)) return
      setStatusError(toApiError(error))
      setStatusState('error')
    }
  }, [path])

  // Reload when the repository path or checked-out branch changes.
  useEffect(() => {
    setSelected(null)
    setDiff(null)
    const controller = new AbortController()
    void loadStatus(controller.signal)
    return () => controller.abort()
  }, [loadStatus, revision])

  useEffect(() => {
    if (selected === null) {
      setDiff(null)
      setDiffState('idle')
      setDiffError(null)
      return undefined
    }
    const controller = new AbortController()
    setDiffState('loading')
    setDiffError(null)
    requestJson<WorkspaceDiffPayload>({
      mode: 'workspace-diff',
      path,
      file: selected.path,
      scope: selected.scope,
    }, controller.signal)
      .then(payload => {
        setDiff(payload.diff)
        setDiffState('ready')
      })
      .catch(error => {
        if (isAbortError(error)) return
        setDiffError(toApiError(error))
        setDiffState('error')
      })
    return () => controller.abort()
  }, [path, selected, treeRevision])

  const refresh = useCallback((): void => {
    void loadStatus()
    setTreeRevision(value => value + 1)
  }, [loadStatus])

  const generate = useCallback((): void => {
    if (path.trim() === '') return
    generateAbort.current?.abort()
    const controller = new AbortController()
    generateAbort.current = controller
    setGenerateState('loading')
    setGenerateError(null)
    requestGenerateMessage({ path, prompt: resolvePrompt('commitMessage', path).template }, controller.signal)
      .then(payload => {
        if (controller.signal.aborted) return
        setMessage(payload.message)
        setGenerateState('idle')
      })
      .catch(error => {
        if (isAbortError(error)) return
        setGenerateError(toApiError(error))
        setGenerateState('idle')
      })
      .finally(() => {
        if (generateAbort.current === controller) generateAbort.current = null
      })
  }, [path])

  const selectFile = useCallback((file: string, scope: WorkspaceScope): void => {
    setSelected(current => current !== null && current.path === file && current.scope === scope
      ? current
      : { path: file, scope })
  }, [])

  const runAction = useCallback(async (body: Omit<WorkspaceActionRequest, 'path'>): Promise<void> => {
    if (path.trim() === '') return
    actionAbort.current?.abort()
    const controller = new AbortController()
    actionAbort.current = controller
    setActionState('loading')
    setActionError(null)
    setNote(null)
    try {
      const payload = await requestAction<WorkspaceActionPayload>({ ...body, path }, controller.signal)
      if (payload.action === 'commit') {
        setMessage('')
        writeDraft(draftKey, '')
        setAmend(false)
        setPush(false)
        setNote(payload.commit ? `${t('commitSucceeded')} ${payload.commit.shortHash}` : t('commitSucceeded'))
        committedRef.current?.()
      }
      setSelected(null)
      await loadStatus(controller.signal)
    } catch (error) {
      if (!isAbortError(error)) setActionError(toApiError(error))
    } finally {
      if (actionAbort.current === controller) {
        actionAbort.current = null
        setActionState('idle')
      }
    }
  }, [path, loadStatus, t])

  useEffect(() => () => {
    actionAbort.current?.abort()
    generateAbort.current?.abort()
    syncAbort.current?.abort()
  }, [])

  const sync = useCallback((action: SyncAction, target?: { remote: string; branch: string }, fetchOptions?: FetchOptions): void => {
    if (path.trim() === '') return
    syncAbort.current?.abort()
    const controller = new AbortController()
    syncAbort.current = controller
    setSyncState('loading')
    setSyncAction(action)
    setSyncError(null)
    setSyncNote(null)
    requestSync({ action, path, ...(target ?? {}), ...(fetchOptions ?? {}) }, controller.signal)
      .then(payload => {
        if (controller.signal.aborted) return
        const label = action === 'fetch'
          ? t('fetchSucceeded')
          : action === 'pull'
            ? t('pullSucceeded')
            : t('pushSucceeded')
        setSyncNote(target === undefined ? label : `${label} ${target.remote}/${target.branch}`)
        setSelected(null)
        committedRef.current?.()
        return loadStatus(controller.signal)
      })
      .catch(error => {
        if (isAbortError(error)) return
        const apiError = toApiError(error)
        setSyncError(apiError)
        if (apiError.code !== 'auth-required') return
        const details = apiError.details ?? {}
        setAuthError(null)
        setAuthPrompt({
          remote: typeof details.remote === 'string' && details.remote !== '' ? details.remote : target?.remote ?? 'origin',
          action,
          scheme: details.scheme === 'ssh' ? 'ssh' : details.scheme === 'https' ? 'https' : 'other',
          helper: typeof details.helper === 'string' ? details.helper : null,
        })
      })
      .finally(() => {
        if (syncAbort.current === controller) {
          syncAbort.current = null
          setSyncAction(null)
          setSyncState('idle')
        }
      })
  }, [path, loadStatus, t])

  /** Store the credential through the host and retry the failed sync once. */
  const submitCredential = useCallback(async (username: string, password: string): Promise<void> => {
    const prompt = authPrompt
    const pending = lastSync.current
    if (prompt === null || pending === null || authBusy) return
    setAuthBusy(true)
    setAuthError(null)
    try {
      await requestCredential({ path, remote: prompt.remote, username, password })
      setAuthPrompt(null)
      sync(pending.action, pending.target, pending.fetchOptions)
    } catch (error) {
      setAuthError(toApiError(error).message)
    } finally {
      setAuthBusy(false)
    }
  }, [authPrompt, authBusy, path, sync])

  const dismissCredential = useCallback((): void => {
    setAuthPrompt(null)
    setAuthError(null)
  }, [])

  const pushBranches = useCallback((options: PushOptions): void => {
    if (path.trim() === '') return
    syncAbort.current?.abort()
    const controller = new AbortController()
    syncAbort.current = controller
    setSyncState('loading')
    setSyncAction('push')
    setSyncError(null)
    setSyncNote(null)
    requestSync({
      action: 'push',
      path,
      remote: options.remote,
      refs: options.refs,
      tags: options.tags,
      force: options.force,
    }, controller.signal)
      .then(() => {
        if (controller.signal.aborted) return
        setSyncNote(`${t('pushSucceeded')} ${options.remote}`)
        setSelected(null)
        committedRef.current?.()
        return loadStatus(controller.signal)
      })
      .catch(error => {
        if (isAbortError(error)) return
        const apiError = toApiError(error)
        setSyncError(apiError)
        if (apiError.code !== 'auth-required') return
        const details = apiError.details ?? {}
        setAuthError(null)
        setAuthPrompt({
          remote: typeof details.remote === 'string' && details.remote !== '' ? details.remote : options.remote,
          action: 'push',
          scheme: details.scheme === 'ssh' ? 'ssh' : details.scheme === 'https' ? 'https' : 'other',
          helper: typeof details.helper === 'string' ? details.helper : null,
        })
      })
      .finally(() => {
        if (syncAbort.current === controller) {
          syncAbort.current = null
          setSyncAction(null)
          setSyncState('idle')
        }
      })
  }, [path, loadStatus, t])

  const stage = useCallback((paths: readonly string[]): void => {
    void runAction({ action: 'stage', paths: [...paths] })
  }, [runAction])

  const stageAll = useCallback((): void => {
    void runAction({ action: 'stage', all: true })
  }, [runAction])

  const unstage = useCallback((paths: readonly string[]): void => {
    void runAction({ action: 'unstage', paths: [...paths] })
  }, [runAction])

  const unstageAll = useCallback((): void => {
    void runAction({ action: 'unstage', all: true })
  }, [runAction])

  const commit = useCallback((): void => {
    void runAction({ action: 'commit', message, amend, push })
  }, [runAction, message, amend, push])

  return {
    status,
    statusState,
    statusError,
    selected,
    diff,
    diffState,
    diffError,
    message,
    amend,
    push,
    actionState,
    actionError,
    note,
    generateState,
    generateError,
    syncState,
    syncAction,
    syncError,
    syncNote,
    generate,
    refresh,
    sync,
    pushBranches,
    authPrompt,
    authBusy,
    authError,
    submitCredential,
    dismissCredential,
    selectFile,
    setMessage,
    setAmend,
    setPush,
    stage,
    stageAll,
    unstage,
    unstageAll,
    commit,
  }
}






