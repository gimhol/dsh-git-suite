import { useCallback, useEffect, useMemo, useRef, useState } from '../runtime.js'
import { isAbortError, requestJson, toApiError, type ApiError } from '../lib/api.js'
import { layoutGraph, type GraphLayout } from '../lib/graph.js'
import { buildProjectGroups, findCurrentProject, type ProjectGroups } from '../lib/projects.js'
import { addRecentProject, readRecentProjects, writeRecentProjects } from '../lib/recent-projects.js'
import { requestSessionRepo } from '../lib/api.js'
import { selectionAfterHeadChange, selectionFromStored, selectionKey, selectionLabel, selectionParams, storedSelection } from '../lib/selection.js'
import { type RepoUiState, readRepoUiState, writeRepoUiState } from '../lib/ui-state.js'
import type {
  Commit,
  CommitDetail,
  CommitPayload,
  DetailStatus,
  LoadStatus,
  LogPayload,
  Project,
  ProjectsPayload,
  RefsPayload,
  Repo,
  Selection,
  SwitchPayload,
  Translate,
} from '../types.js'

const DEFAULT_LIMIT = 50
const HEAD: Selection = { kind: 'head' }

interface LoadLogOptions {
  path?: string
  limit: number
  offset?: number
  selection?: Selection
  append?: boolean
  sort?: 'date' | 'topo'
  showRemotes?: boolean
}

/** Everything the panel and its subcomponents render, plus the actions they trigger. */
export interface GitLogView {
  repo: Repo | null
  projectsStatus: LoadStatus
  projectGroups: ProjectGroups
  currentProject: Project | null
  selectedProjectPath: string
  pathInput: string
  limit: number
  status: LoadStatus
  commits: Commit[]
  error: ApiError | null
  hasMore: boolean
  selected: string | null
  detail: CommitDetail | null
  detailStatus: DetailStatus
  detailError: ApiError | null
  switching: boolean
  switchError: string | null
  tree: RefsPayload | null
  treeStatus: LoadStatus
  treeError: ApiError | null
  selection: Selection
  branchLabel: string
  scanNote: string | null
  graph: GraphLayout
  sort: 'date' | 'topo'
  showRemotes: boolean
  changePathText(value: string): void
  setLimit(value: number): void
  setSort(value: 'date' | 'topo'): void
  setShowRemotes(value: boolean): void
  /** Apply the stored preferences of a repository the panel just opened. */
  applyRepoPreferences(stored: RepoUiState): void
  selectProjectPath(path: string): void
  submitPath(): void
  openPath(path: string): void
  refresh(): void
  loadMore(): void
  rescanProjects(): void
  selectRef(selection: Selection): void
  switchBranch(selection: Selection): void
  selectCommit(commit: Commit): void
}

/**
 * Owns the viewer's state: project scan and recents, the refs tree, paged
 * commit log, the current selection, and the selected commit's detail.
 */
export function useGitLogView(t: Translate, options?: { sessionId?: string }): GitLogView {
  const sessionId = options?.sessionId
  const [pathInput, setPathInput] = useState('')
  const [repo, setRepo] = useState<Repo | null>(null)
  const [commits, setCommits] = useState<Commit[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState<ApiError | null>(null)
  const [tree, setTree] = useState<RefsPayload | null>(null)
  const [treeStatus, setTreeStatus] = useState<LoadStatus>('loading')
  const [treeError, setTreeError] = useState<ApiError | null>(null)
  const [selection, setSelection] = useState<Selection>(HEAD)
  const [limit, setLimitState] = useState(() => readRepoUiState().limit ?? DEFAULT_LIMIT)
  const [sort, setSortState] = useState<'date' | 'topo'>(() => readRepoUiState().sort ?? 'date')
  const [showRemotes, setShowRemotesState] = useState(() => readRepoUiState().showRemotes ?? false)
  const [hasMore, setHasMore] = useState(false)
  const [nextOffset, setNextOffset] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<CommitDetail | null>(null)
  const [detailStatus, setDetailStatus] = useState<DetailStatus>('idle')
  const [detailError, setDetailError] = useState<ApiError | null>(null)
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsStatus, setProjectsStatus] = useState<LoadStatus>('loading')
  const [projectsTruncated, setProjectsTruncated] = useState(false)
  const [recentProjects, setRecentProjects] = useState<string[]>([])
  const [selectedProjectPath, setSelectedProjectPath] = useState('')

  const logAbort = useRef<AbortController | null>(null)
  const detailAbort = useRef<AbortController | null>(null)
  const projectAbort = useRef<AbortController | null>(null)
  const treeAbort = useRef<AbortController | null>(null)
  const recentLoaded = useRef(false)
  /** Set after a fresh log load so the first commit can be opened automatically. */
  const autoSelectCommit = useRef(false)
  const sortRef = useRef(sort)
  const showRemotesRef = useRef(showRemotes)
  sortRef.current = sort
  showRemotesRef.current = showRemotes
  const limitRef = useRef(limit)
  limitRef.current = limit

  const scanWorkspaceProjects = useCallback(async (signal: AbortSignal): Promise<Project[]> => {
    const payload = await requestJson<ProjectsPayload>({ mode: 'projects' }, signal)
    if (signal.aborted) return []
    const list = Array.isArray(payload.projects)
      ? payload.projects.filter(project => project && typeof project.path === 'string' && project.path !== '')
      : []
    setProjects(list)
    setProjectsTruncated(payload.truncated === true)
    setProjectsStatus('ready')
    return list
  }, [])

  const rememberProject = useCallback((path: string) => {
    setRecentProjects(current => addRecentProject(current, path))
  }, [])

  const loadTree = useCallback(async (path: string | undefined): Promise<void> => {
    treeAbort.current?.abort()
    const controller = new AbortController()
    treeAbort.current = controller
    setTreeStatus('loading')
    setTreeError(null)
    try {
      const payload = await requestJson<RefsPayload>({ mode: 'tree', path }, controller.signal)
      if (controller.signal.aborted) return
      setTree(payload)
      setTreeStatus('ready')
    } catch (loadError) {
      if (controller.signal.aborted || isAbortError(loadError)) return
      setTreeError(toApiError(loadError))
      setTreeStatus('error')
    }
  }, [])

  const loadLog = useCallback(async (options: LoadLogOptions): Promise<void> => {
    const append = options.append === true
    const offset = options.offset ?? 0
    const activeSelection = options.selection ?? HEAD
    const sortValue = options.sort ?? sortRef.current
    const showRemotesValue = options.showRemotes ?? showRemotesRef.current
    logAbort.current?.abort()
    detailAbort.current?.abort()
    const controller = new AbortController()
    logAbort.current = controller
    setStatus('loading')
    setError(null)
    setSwitchError(null)
    try {
      const payload = await requestJson<LogPayload>({
        mode: 'log',
        path: options.path,
        limit: String(options.limit),
        offset: String(offset),
        ...selectionParams(activeSelection),
        sort: sortValue,
        ...(activeSelection.kind === 'all' && showRemotesValue ? { remotes: '1' as const } : {}),
      }, controller.signal)
      if (controller.signal.aborted) return
      const incoming = Array.isArray(payload.commits) ? payload.commits : []
      setCommits(current => append ? [...current, ...incoming] : incoming)
      setHasMore(payload.hasMore === true)
      setNextOffset(typeof payload.nextOffset === 'number' ? payload.nextOffset : offset + incoming.length)
      if (!append) {
        setRepo({
          repoRoot: payload.repoRoot,
          repoName: payload.repoName,
          branch: payload.branch,
          defaultPath: payload.defaultPath,
          superproject: payload.superproject ?? null,
        })
        setPathInput(payload.repoRoot)
        setSelectedProjectPath(payload.repoRoot)
        setSelection(activeSelection)
        rememberProject(payload.repoRoot)
        setSelected(null)
        setDetail(null)
        setDetailStatus('idle')
        setDetailError(null)
      }
      autoSelectCommit.current = !append && incoming.length > 0
      setStatus('ready')
    } catch (loadError) {
      if (controller.signal.aborted || isAbortError(loadError)) return
      const apiError = toApiError(loadError)
      setError(apiError)
      if (apiError.details?.path && !append) setPathInput(apiError.details.path)
      setStatus('error')
    }
  }, [rememberProject])

  useEffect(() => {
    const controller = new AbortController()
    projectAbort.current = controller
    let active = true

    const start = async (): Promise<void> => {
      let scanned: Project[] = []
      try {
        scanned = await scanWorkspaceProjects(controller.signal)
      } catch {
        if (!controller.signal.aborted && active) setProjectsStatus('error')
      }
      if (!active) return
      // The sidebar panel opens on the repository of the Session it belongs to.
      let sessionRepo: string | null = null
      if (sessionId !== undefined && sessionId !== '') {
        try {
          const payload = await requestSessionRepo(sessionId, controller.signal)
          sessionRepo = payload.path
        } catch {
          sessionRepo = null
        }
        if (!active) return
      }
      const remembered = readRecentProjects()
      setRecentProjects(sessionRepo === null ? remembered : addRecentProject(remembered, sessionRepo))
      recentLoaded.current = true
      const initialPath = sessionRepo ?? remembered[0] ?? scanned[0]?.path ?? ''
      setSelectedProjectPath(initialPath)
      setSelection(HEAD)
      void loadLog({ path: initialPath, limit: limitRef.current, offset: 0, selection: HEAD })
      void loadTree(initialPath)
    }

    void start()
    return () => {
      active = false
      controller.abort()
      logAbort.current?.abort()
      detailAbort.current?.abort()
      treeAbort.current?.abort()
    }
  }, [loadLog, loadTree, scanWorkspaceProjects, sessionId])

  useEffect(() => {
    if (!recentLoaded.current) return
    writeRecentProjects(recentProjects)
  }, [recentProjects])

  const rescanProjects = useCallback(async (): Promise<void> => {
    projectAbort.current?.abort()
    const controller = new AbortController()
    projectAbort.current = controller
    setProjectsStatus('loading')
    try {
      await scanWorkspaceProjects(controller.signal)
    } catch {
      if (!controller.signal.aborted) setProjectsStatus('error')
    }
  }, [scanWorkspaceProjects])

  const setLimit = useCallback((value: number) => {
    setLimitState(value)
    writeRepoUiState({ limit: value })
  }, [])

  const setSort = useCallback((value: 'date' | 'topo'): void => {
    if (value === sort) return
    setSortState(value)
    writeRepoUiState({ sort: value }, repo?.repoRoot ?? undefined)
    void loadLog({ path: repo?.repoRoot ?? pathInput.trim(), limit, offset: 0, selection, sort: value })
  }, [sort, loadLog, repo, pathInput, limit, selection])

  const setShowRemotes = useCallback((value: boolean): void => {
    if (value === showRemotes) return
    setShowRemotesState(value)
    writeRepoUiState({ showRemotes: value }, repo?.repoRoot ?? undefined)
    if (selection.kind === 'all') {
      void loadLog({ path: repo?.repoRoot ?? pathInput.trim(), limit, offset: 0, selection, showRemotes: value })
    }
  }, [showRemotes, loadLog, repo, pathInput, limit, selection])

  const applyRepoPreferences = useCallback((stored: RepoUiState): void => {
    const nextLimit = stored.limit ?? DEFAULT_LIMIT
    const nextSort = stored.sort ?? 'date'
    const nextShowRemotes = stored.showRemotes ?? false
    // Restore the branch dropdown's last choice along with the other preferences.
    const nextSelection = selectionFromStored(stored.logSelection)
    setLimitState(nextLimit)
    setSortState(nextSort)
    setShowRemotesState(nextShowRemotes)
    setSelection(nextSelection)
    const target = repo?.repoRoot ?? pathInput.trim()
    if (target === '') return
    if (
      nextLimit === limit
      && nextSort === sort
      && nextShowRemotes === showRemotes
      && selectionKey(nextSelection) === selectionKey(selection)
    ) return
    void loadLog({
      path: target,
      limit: nextLimit,
      offset: 0,
      selection: nextSelection,
      sort: nextSort,
      showRemotes: nextShowRemotes,
    })
  }, [repo, pathInput, limit, sort, showRemotes, selection, loadLog])

  // A restored branch that no longer exists (deleted since last time) falls
  // back to HEAD instead of leaving the list on a dead scope.
  useEffect(() => {
    if (selection.kind !== 'branch' || tree === null) return
    if (tree.branches.some(branch => branch.ref === selection.ref)) return
    setSelection(HEAD)
    void loadLog({ path: repo?.repoRoot ?? pathInput.trim(), limit, offset: 0, selection: HEAD })
  }, [tree, selection, repo, pathInput, limit, loadLog])

  const changePathText = useCallback((value: string) => {    setPathInput(value)
    setSelectedProjectPath('')
  }, [])

  const selectProjectPath = (path: string): void => {
    if (path === '') {
      setSelectedProjectPath('')
      return
    }
    setSelectedProjectPath(path)
    setPathInput(path)
    setSelection(HEAD)
    setTree(null)
    setTreeStatus('loading')
    setCommits([])
    setSelected(null)
    setDetail(null)
    setDetailStatus('idle')
    void loadLog({ path, limit, offset: 0, selection: HEAD })
    void loadTree(path)
  }

  const openPath = useCallback((rawPath: string): void => {
    const path = rawPath.trim()
    if (path === '') return
    setPathInput(path)
    setSelectedProjectPath('')
    setSelection(HEAD)
    setTree(null)
    setTreeStatus('loading')
    setCommits([])
    setSelected(null)
    setDetail(null)
    setDetailStatus('idle')
    void loadLog({ path, limit, offset: 0, selection: HEAD })
    void loadTree(path)
  }, [loadLog, loadTree, limit])

  const submitPath = (): void => {
    openPath(pathInput)
  }

  const selectRef = (next: Selection): void => {
    setSelection(next)
    // The branch dropdown is a per-repository preference; remember it.
    const stored = storedSelection(next)
    if (stored !== undefined) writeRepoUiState({ logSelection: stored }, repo?.repoRoot ?? undefined)
    void loadLog({
      path: repo?.repoRoot ?? pathInput.trim(),
      limit,
      offset: 0,
      selection: next,
    })
  }

  const selectCommit = async (commit: Commit): Promise<void> => {
    setSelected(commit.hash)
    setDetailStatus('loading')
    setDetail(null)
    setDetailError(null)
    detailAbort.current?.abort()
    const controller = new AbortController()
    detailAbort.current = controller
    try {
      const payload = await requestJson<CommitPayload>({
        mode: 'commit',
        path: repo?.repoRoot ?? pathInput,
        hash: commit.hash,
      }, controller.signal)
      if (controller.signal.aborted) return
      setDetail(payload.commit)
      setDetailStatus('ready')
    } catch (loadError) {
      if (controller.signal.aborted || isAbortError(loadError)) return
      setDetailError(toApiError(loadError))
      setDetailStatus('error')
    }
  }

  // Open the newest commit after every fresh log load (initial load, ref change,
  // refresh, project switch). Closing the detail afterwards does not re-open it.
  useEffect(() => {
    if (!autoSelectCommit.current) return
    if (status !== 'ready') return
    const first = commits[0]
    if (first === undefined) return
    autoSelectCommit.current = false
    void selectCommit(first)
  }, [commits, selectCommit, status])

  const refresh = (): void => {
    const path = pathInput.trim()
    void loadLog({ path, limit, offset: 0, selection })
    void loadTree(path)
  }

  const loadMore = (): void => {
    if (!hasMore || status === 'loading') return
    void loadLog({
      path: repo?.repoRoot ?? pathInput.trim(),
      limit,
      offset: nextOffset,
      append: true,
      selection,
    })
  }

  /** Double-clicking a local branch switches the working tree, then reloads HEAD and the refs. */
  const switchBranch = useCallback(async (next: Selection): Promise<void> => {
    if (next.kind !== 'branch' || next.remote || switching) return
    setSwitching(true)
    setSwitchError(null)
    try {
      const payload = await requestJson<SwitchPayload>({
        mode: 'switch',
        path: repo?.repoRoot ?? pathInput.trim(),
        ref: next.ref,
      }, undefined, 'POST')
      rememberProject(payload.repoRoot)
      // Keep the user's "all branches" scope; only scopes tied to HEAD change.
      const shown = selectionAfterHeadChange(selection)
      setSelection(shown)
      setSelected(null)
      setDetail(null)
      setDetailStatus('idle')
      setDetailError(null)
      await Promise.all([
        loadLog({ path: payload.repoRoot, limit, offset: 0, selection: shown }),
        loadTree(payload.repoRoot),
      ])
    } catch (error) {
      if (!isAbortError(error)) setSwitchError(toApiError(error).message)
    } finally {
      setSwitching(false)
    }
  }, [limit, loadLog, loadTree, pathInput, rememberProject, repo, selection, switching])

  const graph = useMemo(() => layoutGraph(commits), [commits])
  const projectGroups = useMemo(() => buildProjectGroups(projects, recentProjects), [projects, recentProjects])
  const currentProject = findCurrentProject(projectGroups, selectedProjectPath)
  const branchLabel = selectionLabel(selection, repo, t)

  const scanNote = projectsStatus === 'error'
    ? t('scanFailed')
    : projectsStatus === 'ready' && projects.length === 0
      ? t('noWorkspaceProjects')
      : projectsTruncated
        ? t('scanTruncated')
        : null

  return {
    repo,
    projectsStatus,
    projectGroups,
    currentProject,
    selectedProjectPath,
    pathInput,
    limit,
    status,
    commits,
    error,
    hasMore,
    selected,
    detail,
    detailStatus,
    detailError,
    switching,
    switchError,
    tree,
    treeStatus,
    treeError,
    selection,
    branchLabel,
    scanNote,
    graph,
    sort,
    showRemotes,
    changePathText,
    setLimit,
    setSort,
    setShowRemotes,
    applyRepoPreferences,
    selectProjectPath,
    submitPath,
    openPath,
    refresh,
    loadMore,
    rescanProjects: () => { void rescanProjects() },
    selectRef,
    switchBranch: (selection: Selection) => { void switchBranch(selection) },
    selectCommit,
  }
}




