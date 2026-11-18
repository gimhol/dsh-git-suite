import type * as React from 'react'
import { CommitActions, type CommitContext } from './components/CommitActions.js'
import { CommitList } from './components/CommitList.js'
import { AddRemoteDialog } from './components/AddRemoteDialog.js'
import { AddBranchDialog } from './components/AddBranchDialog.js'
import { EditRemoteDialog } from './components/EditRemoteDialog.js'
import { BranchMenu, type BranchMenuState } from './components/BranchMenu.js'
import { BranchDeleteDialog, BranchRenameDialog } from './components/BranchDialogs.js'
import { UpstreamDialog } from './components/UpstreamDialog.js'
import { DeleteRemoteDialog } from './components/DeleteRemoteDialog.js'
import { DetailPane } from './components/DetailPane.js'
import { ErrorState } from './components/ErrorState.js'
import { PanelControls } from './components/PanelControls.js'
import { PullsPane } from './components/PullsPane.js'
import { RefsTree } from './components/RefsTree.js'
import { RemoteMenu, type RemoteMenuState } from './components/RemoteMenu.js'
import { RemoteBranchMenu, type RemoteBranchMenuState, type RemoteBranchSelection } from './components/RemoteBranchMenu.js'
import { DeleteRemoteBranchDialog } from './components/DeleteRemoteBranchDialog.js'
import { TrackBranchDialog, type TrackBranchPrompt } from './components/TrackBranchDialog.js'
import { TagMenu, type TagMenuState, type TagSelection } from './components/TagMenu.js'
import { EditTagDialog } from './components/EditTagDialog.js'
import { AddTagDialog } from './components/AddTagDialog.js'
import { DeleteTagDialog } from './components/DeleteTagDialog.js'
import { ForcePushTagDialog } from './components/ForcePushTagDialog.js'
import { RebaseDialog } from './components/RebaseDialog.js'
import { CredentialDialog } from './components/CredentialDialog.js'
import { FetchTagDialog } from './components/FetchTagDialog.js'
import { StashMenu, type StashMenuState } from './components/StashMenu.js'
import { ConflictBanner } from './components/ConflictBanner.js'
import { Note } from './components/Note.js'
import { refTooltip } from './lib/ref-tooltip.js'
import { toast } from './components/Toast.js'
import { Button } from './components/Button.js'
import { GitLogIcon } from './components/GitLogIcon.js'
import { RepoActions } from './components/RepoActions.js'
import { SettingsDialog, SettingsIcon } from './components/SettingsDialog.js'
import { Splitter } from './components/Splitter.js'
import { useSplitSize } from './lib/use-split-size.js'
import { ToastHost } from './components/Toast.js'
import { TooltipHost } from './components/Tooltip.js'
import { WorkspacePane } from './components/WorkspacePane.js'
import { EmptyState, LoadingState } from './components/States.js'
import { useGitLogView } from './hooks/useGitLogView.js'
import { usePulls } from './hooks/usePulls.js'
import { useWorkspace } from './hooks/useWorkspace.js'
import { requestBranchAction, requestCheckout, requestCommitOp, requestOperation, requestSync, requestTagStatus, requestVersionCheck, toApiError } from './lib/api.js'
import { hasForge } from './lib/forge.js'
import { readRepoUiState, setActiveRepo, writeRepoUiState, type ViewMode } from './lib/ui-state.js'
import { h, useEffect, useRef, useState } from './runtime.js'
import { cls, CSS } from './styles.js'
import type { Branch, Commit, OperationPayload, Selection, TagStatusPayload, Translate, VersionPayload } from './types.js'

const VERSION_CACHE_KEY = 'git-suite-version-check'
const VERSION_CHECK_INTERVAL = 6 * 60 * 60 * 1000

/** Last npm version check, or null when storage is empty or unreadable. */
function readVersionCache(): { at: number; version: VersionPayload } | null {
  try {
    const raw = window.localStorage.getItem(VERSION_CACHE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as { at?: unknown; version?: unknown }
    if (typeof parsed.at !== 'number' || typeof parsed.version !== 'object' || parsed.version === null) return null
    return { at: parsed.at, version: parsed.version as VersionPayload }
  } catch {
    return null
  }
}

/** Remember the check so opening the panel again does not hit the registry. */
function writeVersionCache(version: VersionPayload): void {
  try {
    window.localStorage.setItem(VERSION_CACHE_KEY, JSON.stringify({ at: Date.now(), version }))
  } catch {
    // Storage may be unavailable; the next mount simply checks again.
  }
}

export interface GitLogPanelProps {
  t: Translate
  /** Narrow right-sidebar column: the commit page starts without the refs tree. */
  compact?: boolean
  /** Session whose working directory the panel should open on (right sidebar). */
  sessionId?: string
}

const MIN_TREE_WIDTH = 160
const MAX_TREE_WIDTH = 480
const MIN_TREE_HEIGHT = 140
const MAX_TREE_HEIGHT = 460
const MIN_DETAIL_RATIO = 0.2
const MAX_DETAIL_RATIO = 0.8
/** Conflicts can be created from a terminal; poll often enough to notice. */
const OPERATION_POLL_MS = 3000

/** Identity of the current operation, including the remaining conflict stages. */
function operationSignature(payload: OperationPayload | null): string {
  if (payload === null || payload.operation === null) return ''
  const files = payload.conflicts
    .map(file => `${file.path}:${file.ours ? '2' : ''}${file.theirs ? '3' : ''}`)
    .join('|')
  return `${payload.operation}|${files}`
}

/** Split `origin/feature/x` into the remote name and the branch name on that remote. */
function splitRemoteBranch(name: string): { remote: string; branch: string } {
  const slash = name.indexOf('/')
  return slash <= 0 ? { remote: '', branch: name } : { remote: name.slice(0, slash), branch: name.slice(slash + 1) }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** The 900px breakpoint is shared with the stylesheet's single-column layout. */
function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
}

/** The Git suite panel; the same component backs the main area and the right-sidebar tab. */
export function GitLogPanel({ t, compact = false, sessionId }: GitLogPanelProps): React.ReactElement {
  const view = useGitLogView(t, { sessionId })
  const { status, commits, error, detail, detailStatus, detailError } = view
  const workspacePath = view.repo?.repoRoot ?? view.pathInput.trim()
  const workspaceRevision = `${workspacePath}:${view.repo?.branch ?? ''}`
  const ws = useWorkspace(workspacePath, workspaceRevision, t, view.refresh)
  /** Latest view/workspace objects for the conflict poll, which outlives one render. */
  const liveRefresh = useRef({ view, ws })
  liveRefresh.current = { view, ws }
  /** Panel root, focused on plain clicks so Ctrl/Cmd+A stays inside the panel. */
  const rootRef = useRef<HTMLDivElement | null>(null)
  const repoRoot = view.repo?.repoRoot ?? ''
  const [narrow, setNarrow] = useState(isNarrowViewport)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** Latest npm version check; drives the settings badge and dialog summary. */
  const [version, setVersion] = useState<VersionPayload | null>(null)
  const [viewMode, setViewModeState] = useState<ViewMode>(() => readRepoUiState().viewMode ?? 'history')
  const pulls = usePulls({
    active: viewMode === 'pulls',
    repoRoot,
    remotes: view.tree?.remotes ?? [],
    upstream: ws.status?.upstream ?? '',
    branch: view.repo?.branch ?? '',
    branches: (view.tree?.branches ?? [])
      .filter(branch => branch.kind === 'local')
      .map(branch => ({ name: branch.name, upstream: branch.upstream ?? null })),
    t,
    onCheckedOut: () => {
      view.refresh()
      ws.refresh()
    },
  })
  /** Per-page tree visibility choices; each view keeps its own. */
  const [treeOverrides, setTreeOverrides] = useState<Partial<Record<ViewMode, boolean>>>({})
  const [commitMenu, setCommitMenu] = useState<CommitContext | null>(null)
  const [remoteMenu, setRemoteMenu] = useState<RemoteMenuState | null>(null)
  const [remoteDelete, setRemoteDelete] = useState<string | null>(null)
  const [remoteEdit, setRemoteEdit] = useState<string | null>(null)
  const [remoteBranchMenu, setRemoteBranchMenu] = useState<RemoteBranchMenuState | null>(null)
  const [remoteBranchDelete, setRemoteBranchDelete] = useState<{ remote: string; branch: string } | null>(null)
  const [trackPrompt, setTrackPrompt] = useState<TrackBranchPrompt | null>(null)
  const [addRemoteOpen, setAddRemoteOpen] = useState(false)
  const [addBranchOpen, setAddBranchOpen] = useState(false)
  const [branchMenu, setBranchMenu] = useState<BranchMenuState | null>(null)
  const [rebaseTarget, setRebaseTarget] = useState<string | null>(null)
  const [branchDialog, setBranchDialog] = useState<{ action: 'rename' | 'delete'; branch: Branch } | null>(null)
  const [upstreamEdit, setUpstreamEdit] = useState<Branch | null>(null)
  const [branchActionError, setBranchActionError] = useState<string | null>(null)
  const [tagMenu, setTagMenu] = useState<TagMenuState | null>(null)
  const [stashMenu, setStashMenu] = useState<StashMenuState | null>(null)
  const [operation, setOperation] = useState<OperationPayload | null>(null)
  /** Signature of the last operation state, so the poll reacts only to changes. */
  const operationRef = useRef('')
  /** Conflict set the panel already switched to the commit view for. */
  const autoSwitched = useRef('')
  const [conflictBusy, setConflictBusy] = useState(false)
  const [tagStatus, setTagStatus] = useState<TagStatusPayload | null>(null)
  const [addTagOpen, setAddTagOpen] = useState(false)
  const [tagEdit, setTagEdit] = useState<string | null>(null)
  const [tagDelete, setTagDelete] = useState<string | null>(null)
  const [tagForcePush, setTagForcePush] = useState<string | null>(null)
  const [tagFetch, setTagFetch] = useState<string | null>(null)
  const [tagActionError, setTagActionError] = useState<string | null>(null)
  /** The scan note the reader closed; a different note shows again. */
  const [scanNoteDismissed, setScanNoteDismissed] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const stackRef = useRef<HTMLDivElement | null>(null)
  const hasCommits = commits.length > 0
  // In the narrow layout the tree sits above the log, so its splitter is horizontal.
  const treeOrientation = compact || narrow ? 'horizontal' : 'vertical'

  // One hook per axis: the tree splits horizontally in the narrow layout and
  // vertically otherwise, so both sizes have to stay available.
  const treeWidthSize = useSplitSize({
    initial: () => clamp(readRepoUiState().treeWidth ?? 240, MIN_TREE_WIDTH, MAX_TREE_WIDTH),
    min: MIN_TREE_WIDTH,
    max: () => {
      const width = bodyRef.current?.getBoundingClientRect().width ?? 0
      return width <= 0 ? MAX_TREE_WIDTH : clamp(width - 320, MIN_TREE_WIDTH, MAX_TREE_WIDTH)
    },
    axis: 'x',
    persist: value => writeRepoUiState({ treeWidth: value }),
  })
  const treeHeightSize = useSplitSize({
    initial: () => clamp(readRepoUiState().treeHeight ?? 220, MIN_TREE_HEIGHT, MAX_TREE_HEIGHT),
    min: MIN_TREE_HEIGHT,
    max: () => {
      const height = bodyRef.current?.getBoundingClientRect().height ?? 0
      return height <= 0 ? MAX_TREE_HEIGHT : clamp(height - 240, MIN_TREE_HEIGHT, MAX_TREE_HEIGHT)
    },
    axis: 'y',
    persist: value => writeRepoUiState({ treeHeight: value }),
  })
  // The detail pane is the remainder under the list, so dragging up grows it.
  const detailSize = useSplitSize({
    initial: () => clamp(readRepoUiState().detailRatio ?? 0.45, MIN_DETAIL_RATIO, MAX_DETAIL_RATIO),
    min: MIN_DETAIL_RATIO,
    max: MAX_DETAIL_RATIO,
    axis: 'y',
    invert: true,
    reference: () => stackRef.current?.getBoundingClientRect().height ?? 0,
    persist: value => writeRepoUiState({ detailRatio: value }),
  })
  const treeSize = treeOrientation === 'vertical' ? treeWidthSize : treeHeightSize

  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)')
    const update = (): void => setNarrow(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  // The right panel's commit page starts without the refs tree: the lists and
  // the diff need the height. The header toggle still brings it back.
  const treeDefault = viewMode !== 'pulls' && !(compact && viewMode === 'workspace')
  // Each page owns its own show/hide choice; the pull request page never shows
  // the tree at all.
  const treeVisible = viewMode === 'pulls' ? false : treeOverrides[viewMode] ?? treeDefault

  // An explicit show/hide belongs to the current page, so switching pages keeps
  // each page's own state and a reload restores both.
  const toggleTree = (): void => {
    if (viewMode === 'pulls') return
    const next = { ...treeOverrides, [viewMode]: !treeVisible }
    setTreeOverrides(next)
    writeRepoUiState({ treeVisible: next }, repoRoot === '' ? undefined : repoRoot)
  }

  // Every repository keeps its own bucket: adopt it when the panel switches.
  useEffect(() => {
    setActiveRepo(repoRoot === '' ? null : repoRoot)
    if (repoRoot === '') return
    const stored = readRepoUiState(repoRoot)
    if (stored.viewMode !== undefined) setViewModeState(stored.viewMode)
    if (stored.treeWidth !== undefined) treeWidthSize.apply(stored.treeWidth)
    if (stored.treeHeight !== undefined) treeHeightSize.apply(stored.treeHeight)
    if (stored.detailRatio !== undefined) detailSize.apply(stored.detailRatio)
    setTreeOverrides(stored.treeVisible ?? {})
    view.applyRepoPreferences(stored)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one run per repository
  }, [repoRoot])

  const setViewMode = (mode: ViewMode): void => {
    setViewModeState(mode)
    writeRepoUiState({ viewMode: mode })
  }

  // A stored PR view is only valid while a supported forge exists; a local
  // repository or an unsupported host falls back to history.
  useEffect(() => {
    if (viewMode !== 'pulls') return
    if (view.treeStatus === 'loading') return
    if (!hasForge(view.tree?.remotes ?? [])) setViewMode('history')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setViewMode only writes state
  }, [viewMode, view.tree, view.treeStatus])

  const state = status === 'loading'
    ? <LoadingState label={t('loadingCommits')} />
    : status === 'error'
      ? <ErrorState error={error} t={t} onRetry={view.refresh} />
      : <EmptyState t={t} onRefresh={view.refresh} />

  const bodyStyle = {
    '--gitlog-tree-w': `${treeWidthSize.size}px`,
    '--gitlog-tree-h': `${treeHeightSize.size}px`,
  } as unknown as React.CSSProperties

  const detailStyle: React.CSSProperties = { flexBasis: `${detailSize.size * 100}%` }

  const openCommitMenu = (commit: Commit, event: React.MouseEvent): void => {
    event.preventDefault()
    void view.selectCommit(commit)
    setCommitMenu({ commit, x: event.clientX, y: event.clientY })
  }

  const openSubmodule = (path: string): void => {
    const root = view.repo?.repoRoot ?? view.pathInput.trim()
    if (root === '') return
    const separator = root.includes('\\') ? '\\' : '/'
    view.openPath(`${root.replace(/[\\/]+$/, '')}${separator}${path}`)
  }

  const fetchRemote = (remote: string): void => {
    ws.sync('fetch', undefined, { fetchAll: false, prune: true, tags: true, forceTags: false, remote })
  }

  const pullRemote = (remote: string): void => {
    const branch = ws.status?.branch ?? ''
    if (branch === '') return
    ws.sync('pull', { remote, branch })
  }

  const pushRemote = (remote: string): void => {
    const branch = ws.status?.branch ?? ''
    if (branch === '') return
    ws.pushBranches({
      remote,
      refs: [{ local: branch, remote: branch, track: false }],
      tags: false,
      force: false,
    })
  }

  const openBranchMenu = (selection: Selection, event: React.MouseEvent): void => {
    if (selection.kind !== 'branch' || selection.remote) return
    const branch = view.tree?.branches.find(item => item.ref === selection.ref)
    if (branch !== undefined) setBranchMenu({ branch, x: event.clientX, y: event.clientY })
  }

  const branchUpstream = (branch: Branch): { remote: string; branch: string } | null => {
    const upstream = branch.upstream ?? ''
    const slash = upstream.indexOf('/')
    return slash > 0 ? { remote: upstream.slice(0, slash), branch: upstream.slice(slash + 1) } : null
  }

  const checkoutBranch = (branch: Branch): void => {
    void view.switchBranch({ kind: 'branch', ref: branch.ref, name: branch.name, remote: false })
  }

  const mergeBranch = (branch: Branch): void => {
    void runBranchAction('merge', branch)
  }

  const rebaseBranch = (branch: Branch): void => {
    void runBranchAction('rebase', branch)
  }

  const runBranchAction = async (action: 'merge' | 'rebase', branch: Branch): Promise<void> => {
    setBranchActionError(null)
    try {
      await requestBranchAction({
        action,
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        branch: branch.name,
      })
      ws.refresh()
      view.refresh()
    } catch (error) {
      setBranchActionError(toApiError(error).message)
    }
  }

  /** Right-click on a commit's ref chip: open the same menu the refs tree uses. */
  const openRefMenu = (ref: string, event: React.MouseEvent): boolean => {
    const x = event.clientX
    const y = event.clientY
    if (ref.startsWith('tag: ')) {
      const name = ref.slice('tag: '.length)
      setTagMenu({ tag: { kind: 'tag', ref: `refs/tags/${name}`, name }, status: tagStatus?.statuses[name], x, y })
      return true
    }
    const branchName = ref.startsWith('HEAD -> ') ? ref.slice('HEAD -> '.length) : ref
    const local = (view.tree?.branches ?? []).find(branch => branch.kind === 'local' && branch.name === branchName)
    if (local !== undefined) {
      setBranchMenu({ branch: local, x, y })
      return true
    }
    for (const group of view.tree?.remotes ?? []) {
      const branch = group.branches.find(item => item.name === branchName)
      if (branch !== undefined) {
        setRemoteBranchMenu({
          branch: { kind: 'branch', ref: branch.ref, name: branch.name, remote: true },
          x,
          y,
        })
        return true
      }
    }
    return false
  }

  /** Right-clicking a tag checks it out by detaching HEAD at the tag's commit. */
  const checkoutTag = async (tag: TagSelection): Promise<void> => {
    setTagActionError(null)
    try {
      await requestCheckout({
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        ref: tag.ref,
      })
      ws.refresh()
      if (view.selection.kind === 'all') {
        view.refresh()
      } else {
        view.selectRef({ kind: 'head' })
        view.refresh()
      }
    } catch (error) {
      setTagActionError(toApiError(error).message)
    }
  }

  const upstreamRemote = (() => {
    const upstream = ws.status?.upstream ?? ''
    const slash = upstream.indexOf('/')
    return slash > 0 ? upstream.slice(0, slash) : (view.tree?.remotes[0]?.name ?? '')
  })()

  /** Compare local tags with the upstream remote (or the first configured one). */
  const runTagCompare = async (): Promise<void> => {
    const path = view.repo?.repoRoot ?? view.pathInput.trim()
    const remote = upstreamRemote
    if (path === '' || remote === '') return
    try {
      setTagStatus(await requestTagStatus({ path, remote }))
    } catch {
      // Unreachable remote or missing credentials: keep the tree clean.
      setTagStatus(null)
    }
  }

  // Compare automatically once per repository/remote/tag set, and again whenever
  // tags change; the compare button only re-runs it on demand.
  const tagsKey = view.tree === null ? '' : view.tree.tags.map(tag => `${tag.name}:${tag.hash}`).join(',')
  const lastTagCompare = useRef('')
  useEffect(() => {
    const root = view.repo?.repoRoot ?? ''
    if (root === '' || upstreamRemote === '') return undefined
    const key = `${root}\u0000${upstreamRemote}\u0000${tagsKey}`
    if (lastTagCompare.current === key) return undefined
    lastTagCompare.current = key
    const timer = window.setTimeout(() => { void runTagCompare() }, 400)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runTagCompare closes over the same values
  }, [view.repo?.repoRoot, upstreamRemote, tagsKey])

  /** Which merge/rebase/pick is stopped by conflicts, and its unmerged files. */
  const refreshOperation = async (signal?: AbortSignal): Promise<void> => {
    const target = view.repo?.repoRoot ?? view.pathInput.trim()
    if (target === '') {
      operationRef.current = ''
      setOperation(null)
      return
    }
    try {
      const payload = await requestOperation({ path: target }, signal)
      operationRef.current = operationSignature(payload)
      setOperation(payload)
    } catch {
      // Keep the last known state; a transient failure should not hide a banner.
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void refreshOperation(controller.signal)
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the repository matters here
  }, [view.repo?.repoRoot])

  // A merge/rebase/pick can be started from a terminal while this panel is
  // open. Poll the operation state (and once on focus) so its conflict banner
  // and file lists appear without a manual reload.
  useEffect(() => {
    const target = view.repo?.repoRoot ?? ''
    if (target === '') return undefined
    let disposed = false
    let busy = false
    const check = async (): Promise<void> => {
      if (busy || disposed) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      busy = true
      try {
        const next = await requestOperation({ path: target })
        if (disposed) return
        const signature = operationSignature(next)
        if (signature === operationRef.current) return
        operationRef.current = signature
        setOperation(next)
        // The commit list and working-tree files predate this state change.
        liveRefresh.current.view.refresh()
        liveRefresh.current.ws.refresh()
      } catch {
        // Retry on the next tick; a transient failure must not clear the banner.
      } finally {
        busy = false
      }
    }
    const timer = window.setInterval(() => { void check() }, OPERATION_POLL_MS)
    const onFocus = (): void => { void check() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      disposed = true
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- liveRefresh ref holds current view/ws
  }, [view.repo?.repoRoot])

  // Opening the commit view re-reads its status, so changes made in a terminal
  // (conflict stages included) show up without another manual refresh.
  useEffect(() => {
    if (viewMode !== 'workspace') return
    ws.refresh()
    void refreshOperation()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on entering the view
  }, [viewMode])

  // Returning to the window re-reads the working tree, so edits made elsewhere
  // (editors, formatters, terminals) show up without a manual refresh.
  useEffect(() => {
    let timer: number | null = null
    const onFocus = (): void => {
      if (document.visibilityState === 'hidden') return
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        const workspace = liveRefresh.current.ws
        if (workspace.statusState === 'loading') return
        workspace.refresh()
      }, 200)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      if (timer !== null) window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- liveRefresh ref holds current ws
  }, [])

  // Check npm for a newer release when the panel opens, cached for six hours.
  useEffect(() => {
    const cached = readVersionCache()
    if (cached !== null && Date.now() - cached.at < VERSION_CHECK_INTERVAL) {
      setVersion(cached.version)
      return
    }
    let cancelled = false
    void requestVersionCheck()
      .then(payload => {
        if (cancelled) return
        setVersion(payload)
        writeVersionCache(payload)
      })
      .catch(() => {
        // Offline or a registry hiccup: keep whatever the cache held.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // A conflict created anywhere (terminal included) opens the commit page,
  // where the banner and the conflict files are actionable. Only a newly seen
  // conflict set switches; going back to history afterwards is allowed.
  useEffect(() => {
    if (operation === null) {
      autoSwitched.current = ''
      return
    }
    if (operation.conflicts.length === 0) return
    const signature = operationSignature(operation)
    if (signature === autoSwitched.current) return
    autoSwitched.current = signature
    if (viewMode !== 'workspace') setViewMode('workspace')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the switch is the point
  }, [operation, viewMode])

  // A pull can end in a conflicted merge; re-read the state once syncing settles.
  useEffect(() => {
    if (ws.syncState !== 'idle') return
    void refreshOperation()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshOperation reads the current repo
  }, [ws.syncState])

  const conflictAction = async (action: 'continue' | 'skip' | 'abort'): Promise<void> => {
    if (conflictBusy) return
    setConflictBusy(true)
    try {
      await requestCommitOp({ path: view.repo?.repoRoot ?? view.pathInput.trim(), action })
      toast(action === 'continue' ? t('conflictContinued') : action === 'skip' ? t('conflictSkipped') : t('conflictAborted'))
      view.refresh()
      ws.refresh()
    } catch (error) {
      const failure = toApiError(error)
      toast(failure.code === 'operation-conflict' ? t('conflictStillBlocked') : failure.message, 'error')
    } finally {
      setConflictBusy(false)
      void refreshOperation()
    }
  }

  const resolveConflict = async (file: string, side: 'ours' | 'theirs'): Promise<void> => {
    if (conflictBusy) return
    setConflictBusy(true)
    try {
      await requestCommitOp({ path: view.repo?.repoRoot ?? view.pathInput.trim(), action: 'resolve', file, side })
      toast(t('conflictResolvedFile').replace('{file}', file))
      ws.refresh()
    } catch (error) {
      toast(toApiError(error).message, 'error')
    } finally {
      setConflictBusy(false)
      void refreshOperation()
    }
  }

  /** Push one tag to the upstream remote; `force` overwrites a moved remote tag. */
  const pushTag = async (tag: TagSelection, force: boolean): Promise<void> => {
    const path = view.repo?.repoRoot ?? view.pathInput.trim()
    if (path === '' || upstreamRemote === '') {
      setTagActionError(t('remoteMissing'))
      return
    }
    setTagActionError(null)
    try {
      await requestSync({
        action: 'push',
        path,
        remote: upstreamRemote,
        tagRefs: [tag.name],
        force,
      })
      ws.refresh()
      view.refresh()
      void runTagCompare()
    } catch (error) {
      setTagActionError(toApiError(error).message)
    }
  }

  /** Right-click actions on a remote-tracking branch such as `origin/main`. */
  /** Refresh both halves after a checkout, following the new HEAD. */
  const afterCheckout = (): void => {
    ws.refresh()
    if (view.selection.kind === 'all') {
      view.refresh()
    } else {
      view.selectRef({ kind: 'head' })
      view.refresh()
    }
  }

  /**
   * Checking out a remote branch creates (or switches to) its local namesake.
   * When that name is already an unrelated branch, the host answers
   * `local-branch-exists` with a free name and the user confirms one here.
   */
  const checkoutRemoteBranch = async (branch: RemoteBranchSelection): Promise<void> => {
    setBranchActionError(null)
    try {
      await requestBranchAction({
        action: 'track',
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        branch: branch.name,
      })
      afterCheckout()
    } catch (error) {
      const failure = toApiError(error)
      const details = failure.details
      const local = typeof details?.local === 'string' ? details.local : ''
      const suggested = typeof details?.suggested === 'string' ? details.suggested : ''
      if (failure.code === 'local-branch-exists' && local !== '' && suggested !== '') {
        setTrackPrompt({
          path: view.repo?.repoRoot ?? view.pathInput.trim(),
          remoteRef: branch.name,
          local,
          upstream: typeof details?.upstream === 'string' ? details.upstream : '',
          suggested,
        })
        return
      }
      setBranchActionError(failure.message)
    }
  }

  const mergeRemoteBranch = async (branch: RemoteBranchSelection): Promise<void> => {
    setBranchActionError(null)
    try {
      await requestBranchAction({
        action: 'merge',
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        branch: branch.name,
      })
      ws.refresh()
      view.refresh()
    } catch (error) {
      setBranchActionError(toApiError(error).message)
    }
  }

  const rebaseRemoteBranch = async (branch: RemoteBranchSelection): Promise<void> => {
    setBranchActionError(null)
    try {
      await requestBranchAction({
        action: 'rebase',
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        branch: branch.name,
      })
      ws.refresh()
      view.refresh()
    } catch (error) {
      setBranchActionError(toApiError(error).message)
    }
  }

  const pullRemoteBranch = (branch: RemoteBranchSelection): void => {
    const target = splitRemoteBranch(branch.name)
    if (target.remote === '') {
      setBranchActionError(t('remoteMissing'))
      return
    }
    ws.sync('pull', { remote: target.remote, branch: target.branch })
  }

  const deleteRemoteBranch = (branch: RemoteBranchSelection): void => {
    const target = splitRemoteBranch(branch.name)
    if (target.remote === '') {
      setBranchActionError(t('remoteMissing'))
      return
    }
    setRemoteBranchDelete({ remote: target.remote, branch: target.branch })
  }

  const fetchBranch = (branch: Branch): void => {
    const upstream = branchUpstream(branch)
    if (upstream === null) return
    ws.sync('fetch', undefined, { fetchAll: false, prune: true, tags: true, forceTags: false, remote: upstream.remote })
  }

  const pullBranch = (branch: Branch): void => {
    const upstream = branchUpstream(branch)
    if (upstream === null) return
    ws.sync('pull', upstream)
  }

  const pushBranch = (branch: Branch): void => {
    const upstream = branchUpstream(branch)
    if (upstream === null) return
    ws.pushBranches({
      remote: upstream.remote,
      refs: [{ local: branch.name, remote: upstream.branch, track: false }],
      tags: false,
      force: false,
    })
  }

  const body = (
    <div ref={bodyRef} className={cls(treeVisible ? 'dsh-gitlog-body has-tree' : 'dsh-gitlog-body')} style={bodyStyle}>
      {treeVisible
        ? (
            <RefsTree
              key={repoRoot}
              repoKey={repoRoot}
              tree={view.tree}
              status={view.treeStatus}
              error={view.treeError}
        selection={view.selection}
        switching={view.switching}
        onSelect={view.selectRef}
        onSwitch={view.switchBranch}
        onOpenSubmodule={openSubmodule}
        onAddBranch={view.repo === null ? undefined : () => setAddBranchOpen(true)}
        onAddRemote={view.repo === null ? undefined : () => setAddRemoteOpen(true)}
        onAddTag={view.repo === null ? undefined : () => setAddTagOpen(true)}
        tagStatus={tagStatus}
        onTagMenu={(tag, event) => setTagMenu({
          tag,
          status: tagStatus?.statuses[tag.name],
          x: event.clientX,
          y: event.clientY,
        })}
        onRemoteBranchMenu={(branch, event) => setRemoteBranchMenu({ branch, x: event.clientX, y: event.clientY })}
        onRefresh={view.refresh}
        refreshing={status === 'loading'}
        onStashMenu={(stash, event) => {
          const ref = 'ref' in stash && typeof stash.ref === 'string' ? stash.ref : ''
          if (ref !== '') setStashMenu({ selection: stash, ref, x: event.clientX, y: event.clientY })
        }}
        onRemoteMenu={(remote, event) => setRemoteMenu({ remote, x: event.clientX, y: event.clientY })}
        onBranchMenu={openBranchMenu}
        t={t}
            />
          )
        : null}
      {treeVisible
        ? (
      <Splitter
        orientation={treeOrientation}
        label={t('resizeTree')}
        onStart={treeSize.start}
        onDrag={treeSize.drag}
        onReset={treeSize.reset}
      />
          )
        : null}
      <div ref={stackRef} className={cls('dsh-gitlog-stack')}>
        {viewMode === 'pulls'
          ? <PullsPane key={repoRoot} view={pulls} t={t} narrow={compact || narrow} repoKey={repoRoot} sessionId={sessionId} />
          : viewMode === 'workspace'
            ? (
                <WorkspacePane
                  key={repoRoot}
                  view={view}
                  ws={ws}
                  t={t}
                  narrow={compact || narrow}
                  operation={operation}
                  onOperationChanged={() => { void refreshOperation() }}
                  sessionId={sessionId}
                />
              )
            : hasCommits
              ? <CommitList view={view} t={t} onContextMenu={openCommitMenu} onRefContextMenu={openRefMenu} />
              : <div className={cls('dsh-gitlog-state-pane')}>{state}</div>}
        {viewMode === 'history' && hasCommits
          ? (
              <Splitter
                orientation="horizontal"
                label={t('resizeDetail')}
                onStart={detailSize.start}
                onDrag={detailSize.drag}
                onReset={detailSize.reset}
              />
            )
          : null}
        {viewMode === 'history' && hasCommits
          ? (
              <aside className={cls('dsh-gitlog-detail')} style={detailStyle} aria-label={t('details')}>
                <DetailPane
                  detail={detail}
                  status={detailStatus}
                  error={detailError}
                  t={t}
                  repoRoot={view.repo?.repoRoot ?? ''}
                  refTooltipOf={ref => refTooltip(ref, view.tree, detail?.shortHash ?? '', t)}
                />
              </aside>
            )
          : null}
      </div>
    </div>
  )

  return (
    <div
      ref={rootRef}
      className={cls('dsh-gitlog')}
      tabIndex={-1}
      onPointerDown={event => {
        // Keep keyboard focus inside the panel: a click on chrome or the diff
        // would otherwise leave focus on <body> and let Ctrl/Cmd+A select the
        // whole page. Real controls keep their own focus.
        const target = event.target
        if (!(target instanceof HTMLElement)) return
        if (target.closest('input, textarea, select, button, a, [contenteditable="true"], [tabindex]') !== null) return
        rootRef.current?.focus({ preventScroll: true })
      }}
      onKeyDown={event => {
        // Ctrl/Cmd+A belongs to the panel while it has focus: never let it
        // select the whole page. Text fields keep their native select-all.
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return
        const target = event.target
        if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]') !== null) return
        event.preventDefault()
      }}
    >
      <style>{CSS}</style>
      <ToastHost />
      <TooltipHost />
      <div className={cls('dsh-gitlog-topbar')}>
        <PanelControls view={view} t={t} />
        <div className={cls('dsh-gitlog-header-actions')}>
          {viewMode === 'pulls'
            ? null
            : (
                <Button
                  iconOnly
                  title={treeVisible ? t('hideTree') : t('showTree')}
                  onClick={toggleTree}
                  ariaPressed={treeVisible}
                  icon={<GitLogIcon size={16} />}
                />
              )}
          <Button
            iconOnly
            title={version?.updateAvailable === true
              ? t('updateAvailable').replace('{version}', version.latest)
              : t('settings')}
            onClick={() => setSettingsOpen(true)}
            ariaHasPopup="dialog"
            ariaExpanded={settingsOpen}
            icon={(
              <span className={cls('dsh-gitlog-settings-icon')}>
                <SettingsIcon />
                {version?.updateAvailable === true
                  ? <span className={cls('dsh-gitlog-settings-dot')} aria-hidden={true} />
                  : null}
              </span>
            )}
          />
        </div>
      </div>
      <RepoActions
        view={view}
        ws={ws}
        mode={viewMode}
        onModeChange={setViewMode}
        t={t}
      />
      {operation === null
        ? null
        : (
            <ConflictBanner
              operation={operation}
              busy={conflictBusy}
              t={t}
              onContinue={() => { void conflictAction('continue') }}
              onSkip={() => { void conflictAction('skip') }}
              onAbort={() => { void conflictAction('abort') }}
            />
          )}
      {view.scanNote !== null && view.scanNote !== scanNoteDismissed
        ? (
            <Note
              text={view.scanNote}
              closeLabel={t('close')}
              onDismiss={() => setScanNoteDismissed(view.scanNote)}
            />
          )
        : null}
      {branchActionError !== null
        ? (
            <Note
              text={branchActionError}
              closeLabel={t('close')}
              tone="error"
              onDismiss={() => setBranchActionError(null)}
            />
          )
        : null}
      {tagActionError !== null
        ? (
            <Note
              text={tagActionError}
              closeLabel={t('close')}
              tone="error"
              onDismiss={() => setTagActionError(null)}
            />
          )
        : null}
      {view.switching ? <p className={cls('dsh-gitlog-note')} role="status">{t('switching')}</p> : null}
      {view.switchError !== null
        ? (
            <Note
              text={view.switchError}
              closeLabel={t('close')}
              tone="error"
              onDismiss={view.clearSwitchError}
            />
          )
        : null}
      {error !== null && commits.length > 0
        ? (
            <Note
              text={`${t('errorTitle')} · ${error.message}`}
              closeLabel={t('close')}
              tone="error"
              onDismiss={view.clearError}
            />
          )
        : null}
      {body}
      {settingsOpen
        ? (
            <SettingsDialog
              limit={view.limit}
              t={t}
              version={version}
              repoRoot={view.repo?.repoRoot ?? null}
              onChange={view.setLimit}
              onClose={() => setSettingsOpen(false)}
            />
          )
        : null}
      <CommitActions
        view={view}
        context={commitMenu}
        t={t}
        onClose={() => setCommitMenu(null)}
        onChanged={() => {
          ws.refresh()
          void refreshOperation()
        }}
        onRebaseOnto={target => setRebaseTarget(target)}
      />
      {ws.authPrompt === null
        ? null
        : (
            <CredentialDialog
              prompt={ws.authPrompt}
              busy={ws.authBusy}
              error={ws.authError}
              t={t}
              onSubmit={(username, password) => { void ws.submitCredential(username, password) }}
              onClose={ws.dismissCredential}
            />
          )}
      {rebaseTarget === null
        ? null
        : (
            <RebaseDialog
              view={view}
              t={t}
              initialTarget={rebaseTarget}
              onDone={() => {
                view.refresh()
                ws.refresh()
                void refreshOperation()
              }}
              onClose={() => setRebaseTarget(null)}
            />
          )}
      <StashMenu
        view={view}
        context={stashMenu}
        t={t}
        onChanged={() => {
          ws.refresh()
          view.refresh()
        }}
        onClose={() => setStashMenu(null)}
      />
      <RemoteMenu
        context={remoteMenu}
        t={t}
        onFetch={fetchRemote}
        onPull={pullRemote}
        onPush={pushRemote}
        onEdit={setRemoteEdit}
        onDelete={setRemoteDelete}
        onClose={() => setRemoteMenu(null)}
      />
      <TagMenu
        context={tagMenu}
        t={t}
        onCheckout={tag => { void checkoutTag(tag) }}
        onEdit={tag => setTagEdit(tag.name)}
        onPush={(tag, force) => {
          // Overwriting a published tag needs the explicit confirmation dialog.
          if (force) setTagForcePush(tag.name)
          else void pushTag(tag, false)
        }}
        onFetchTag={tag => setTagFetch(tag.name)}
        onDelete={tag => setTagDelete(tag.name)}
        onClose={() => setTagMenu(null)}
      />
      {tagEdit === null
        ? null
        : <EditTagDialog view={view} tag={tagEdit} t={t} onClose={() => setTagEdit(null)} />}
      {tagDelete === null
        ? null
        : <DeleteTagDialog view={view} tag={tagDelete} t={t} onClose={() => setTagDelete(null)} />}
      {tagForcePush === null || upstreamRemote === ''
        ? null
        : (
            <ForcePushTagDialog
              view={view}
              tag={tagForcePush}
              remote={upstreamRemote}
              t={t}
              onPushed={() => {
                ws.refresh()
                void runTagCompare()
              }}
              onClose={() => setTagForcePush(null)}
            />
          )}
      {tagFetch === null || upstreamRemote === ''
        ? null
        : (
            <FetchTagDialog
              view={view}
              tag={tagFetch}
              remote={upstreamRemote}
              t={t}
              onFetched={() => {
                ws.refresh()
                view.refresh()
                void runTagCompare()
              }}
              onClose={() => setTagFetch(null)}
            />
          )}
      {addTagOpen
        ? <AddTagDialog view={view} t={t} onClose={() => setAddTagOpen(false)} />
        : null}
      <RemoteBranchMenu
        context={remoteBranchMenu}
        t={t}
        onCheckout={branch => { void checkoutRemoteBranch(branch) }}
        onMerge={branch => { void mergeRemoteBranch(branch) }}
        onRebase={branch => { void rebaseRemoteBranch(branch) }}
        onPull={pullRemoteBranch}
        onDelete={deleteRemoteBranch}
        onClose={() => setRemoteBranchMenu(null)}
      />
      {remoteBranchDelete === null
        ? null
        : (
            <DeleteRemoteBranchDialog
              view={view}
              remote={remoteBranchDelete.remote}
              branch={remoteBranchDelete.branch}
              t={t}
              onClose={() => setRemoteBranchDelete(null)}
            />
          )}
      {trackPrompt === null
        ? null
        : (
            <TrackBranchDialog
              prompt={trackPrompt}
              t={t}
              onClose={() => setTrackPrompt(null)}
              onDone={() => { setTrackPrompt(null); afterCheckout() }}
            />
          )}
      {remoteDelete === null
        ? null
        : (
            <DeleteRemoteDialog
              view={view}
              remote={remoteDelete}
              t={t}
              onClose={() => setRemoteDelete(null)}
            />
          )}
      {remoteEdit === null
        ? null
        : (
            <EditRemoteDialog
              view={view}
              remote={remoteEdit}
              url={view.tree?.remotes.find(group => group.name === remoteEdit)?.url ?? ''}
              t={t}
              onClose={() => setRemoteEdit(null)}
            />
          )}
      {addRemoteOpen
        ? <AddRemoteDialog view={view} t={t} onClose={() => setAddRemoteOpen(false)} />
        : null}
      {addBranchOpen
        ? <AddBranchDialog view={view} t={t} onClose={() => setAddBranchOpen(false)} />
        : null}
      <BranchMenu
        context={branchMenu}
        t={t}
        onCheckout={checkoutBranch}
        onMerge={mergeBranch}
        onRebase={rebaseBranch}
        onRebaseOnto={() => setRebaseTarget('')}
        onFetch={fetchBranch}
        onPull={pullBranch}
        onPush={pushBranch}
        onUpstream={branch => setUpstreamEdit(branch)}
        onRename={branch => setBranchDialog({ action: 'rename', branch })}
        onDelete={branch => setBranchDialog({ action: 'delete', branch })}
        onClose={() => setBranchMenu(null)}
      />
      {upstreamEdit === null
        ? null
        : (
            <UpstreamDialog
              view={view}
              branch={upstreamEdit}
              t={t}
              onClose={() => {
                setUpstreamEdit(null)
                ws.refresh()
              }}
            />
          )}
      {branchDialog === null
        ? null
        : branchDialog.action === 'rename'
          ? (
              <BranchRenameDialog
                view={view}
                branch={branchDialog.branch}
                t={t}
                onClose={() => setBranchDialog(null)}
              />
            )
          : (
              <BranchDeleteDialog
                view={view}
                branch={branchDialog.branch}
                t={t}
                onClose={() => setBranchDialog(null)}
              />
            )}
    </div>
  )
}



















