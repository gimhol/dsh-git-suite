import type * as React from 'react'
import { h, useEffect, useRef, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import type { WorkspaceView } from '../hooks/useWorkspace.js'
import { requestAction, requestCommitMessages, requestCommitOp, requestRevealFile, toApiError } from '../lib/api.js'
import { useDiffMode } from '../lib/use-diff-mode.js'
import { useSplitSize } from '../lib/use-split-size.js'
import { fileManagerName } from '../lib/platform.js'
import { readRepoUiState, writeRepoUiState } from '../lib/ui-state.js'
import { ConflictIcon, ExpandIcon, MinusIcon, PlusIcon, RefreshIcon, ReviewIcon, SparkleIcon, SplitDiffIcon, UnifiedDiffIcon } from './GitLogIcon.js'
import { Button } from './Button.js'
import { Splitter } from './Splitter.js'
import { Spinner, useMinimumSpin } from './States.js'
import { toast } from './Toast.js'
import { hideTooltip, showTooltip, tooltipProps } from './Tooltip.js'
import { DiffView } from './DiffView.js'
import { MediaDiff } from './MediaDiff.js'
import { LfsDiff } from './LfsDiff.js'
import { FileActionDialog } from './FileActionDialog.js'
import { CommitReviewDialog } from './CommitReviewDialog.js'
import { DiffDialog } from './DiffDialog.js'
import { DeleteFilesDialog } from './DeleteFilesDialog.js'
import { IgnoreFileDialog } from './IgnoreFileDialog.js'
import { StashCreateDialog } from './StashCreateDialog.js'
import type { ConflictFile, OperationPayload, Translate, WorkspaceFile, WorkspaceScope } from '../types.js'
import { cls } from '../styles.js'

function scopeOf(file: WorkspaceFile): WorkspaceScope {
  if (file.staged) return 'staged'
  return file.untracked ? 'untracked' : 'unstaged'
}

/** Colour class for a status letter: M yellow, U green, D red, R/C blue, A green. */
function statusTone(status: string): string {
  switch (status) {
    case 'M':
    case 'T':
      return 'is-modified'
    case 'U':
    case '?':
      return 'is-untracked'
    case 'A':
      return 'is-added'
    case 'D':
      return 'is-deleted'
    case 'R':
    case 'C':
      return 'is-renamed'
    default:
      return ''
  }
}

/** A failed partial-stage attempt; an LFS pointer file explains why it must be whole. */
function partialStageMessage(error: unknown, t: Translate): string {
  const failure = toApiError(error)
  return failure.code === 'lfs-file' ? t('lfsStageWhole') : failure.message
}

/** Working-tree panel: staged/unstaged files, per-file diff, and the commit form. */
export function WorkspacePane({ view, ws, t, narrow = false, operation, onOperationChanged, sessionId }: {
  view: GitLogView
  ws: WorkspaceView
  t: Translate
  /** Stacked layout: the files column sits above the diff instead of beside it. */
  narrow?: boolean
  /** Conflicts of an in-progress merge/rebase, when one is stopped. */
  operation?: OperationPayload | null
  onOperationChanged?(): void
  /** Chat session whose composer can receive an AI review; absent when no session is bound. */
  sessionId?: string
}): React.ReactElement {
  const path = view.repo?.repoRoot ?? view.pathInput.trim()
  const repoKey = view.repo?.repoRoot ?? ''
  const [checked, setChecked] = useState<{ staged: string[]; unstaged: string[] }>({ staged: [], unstaged: [] })
  const [fileMenu, setFileMenu] = useState<{ file: WorkspaceFile; x: number; y: number } | null>(null)
  const [lineMenu, setLineMenu] = useState<{ lines: number[]; x: number; y: number } | null>(null)
  const [lineBusy, setLineBusy] = useState(false)
  const lineMenuRef = useRef<HTMLDivElement | null>(null)
  const [fileAction, setFileAction] = useState<{ kind: 'discard' | 'delete'; file: string } | null>(null)
  /** Untracked paths queued for the bulk delete confirmation. */
  const [deleteFiles, setDeleteFiles] = useState<string[] | null>(null)
  const [ignoreFile, setIgnoreFile] = useState<string | null>(null)
  /** The AI review dialog reviews the staged diff. */
  const [reviewOpen, setReviewOpen] = useState(false)
  /** The patch shown in its own modal window. */
  const [diffDialogOpen, setDiffDialogOpen] = useState(false)
  const [stashOpen, setStashOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const status = ws.status
  const staged = status?.staged ?? []
  const unstaged = status?.unstaged ?? []
  /** Checked untracked files; only these can be deleted in bulk. */
  const checkedUntracked = unstaged
    .filter(file => file.untracked === true && checked.unstaged.includes(file.path))
    .map(file => file.path)
  /** Where a Shift range starts; the last row toggled by click or checkbox. */
  const lastCheck = useRef<{ group: 'staged' | 'unstaged'; path: string } | null>(null)

  /**
   * Toggle one row; with Shift, extend the selection from the last row in the
   * same group, so a run of files can be checked without clicking each one.
   */
  const toggleCheck = (group: 'staged' | 'unstaged', file: string, extend = false): void => {
    const files = group === 'staged' ? staged : unstaged
    const anchor = lastCheck.current
    if (extend && anchor !== null && anchor.group === group) {
      const from = files.findIndex(item => item.path === anchor.path)
      const to = files.findIndex(item => item.path === file)
      if (from >= 0 && to >= 0) {
        const [start, end] = from <= to ? [from, to] : [to, from]
        const range = files.slice(start, end + 1).map(item => item.path)
        setChecked(current => {
          const list = current[group]
          // A range that is already fully checked is cleared instead.
          const filled = range.every(item => list.includes(item))
          return {
            ...current,
            [group]: filled
              ? list.filter(item => !range.includes(item))
              : Array.from(new Set([...list, ...range])),
          }
        })
        lastCheck.current = { group, path: file }
        return
      }
    }
    lastCheck.current = { group, path: file }
    setChecked(current => {
      const list = current[group]
      const next = list.includes(file) ? list.filter(item => item !== file) : [...list, file]
      return { ...current, [group]: next }
    })
  }

  useEffect(() => {
    if (fileMenu === null) return undefined
    const onPointerDown = (event: MouseEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) setFileMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFileMenu(null)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [fileMenu])

  /** Show one working-tree file in the OS file browser; a missing file becomes a toast. */
  const revealFile = async (file: WorkspaceFile): Promise<void> => {
    try {
      await requestRevealFile({ path, file: file.path })
    } catch (error) {
      const failure = toApiError(error)
      toast(
        failure.code === 'file-missing'
          ? t('fileMissing').replace('{file}', file.path)
          : failure.message,
        'error',
      )
    }
  }

  const [hunkBusy, setHunkBusy] = useState(false)
  const statusSpinning = useMinimumSpin(ws.statusState === 'loading')
  const diffMode = useDiffMode()

  useEffect(() => {
    if (lineMenu === null) return undefined
    const onPointerDown = (event: MouseEvent): void => {
      if (lineMenuRef.current !== null && !lineMenuRef.current.contains(event.target as Node)) setLineMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setLineMenu(null)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [lineMenu])

  /** Stage or unstage the selected diff lines, then reload the diff. */
  const stageLines = async (lines: number[]): Promise<void> => {
    const current = ws.selected
    if (current === null || lineBusy) return
    const action = current.scope === 'staged' ? 'unstage-lines' : 'stage-lines'
    if (lines.length === 0) return
    setLineBusy(true)
    setLineMenu(null)
    try {
      await requestAction({ action, path, paths: [current.path], lines })
      ws.selectFile(current.path, current.scope)
      ws.refresh()
      toast(action === 'unstage-lines' ? t('linesUnstaged') : t('linesStaged'))
    } catch (error) {
      toast(partialStageMessage(error, t), 'error')
    } finally {
      setLineBusy(false)
    }
  }

  /** Stage or unstage one hunk of the selected file, then reload its diff. */
  const stageHunk = async (hunk: number): Promise<void> => {
    const current = ws.selected
    if (current === null || hunkBusy) return
    const action = current.scope === 'staged' ? 'unstage-hunks' : 'stage-hunks'
    setHunkBusy(true)
    try {
      await requestAction({ action, path, paths: [current.path], hunks: [hunk] })
      ws.selectFile(current.path, current.scope)
      ws.refresh()
      toast(action === 'unstage-hunks' ? t('hunkUnstaged') : t('hunkStaged'))
    } catch (error) {
      toast(partialStageMessage(error, t), 'error')
    } finally {
      setHunkBusy(false)
    }
  }

  /** Double-click flips one file between staged and unstaged. */
  const toggleStage = (file: WorkspaceFile, scope: WorkspaceScope): void => {
    if (scope === 'staged') ws.unstage([file.path])
    else ws.stage([file.path])
  }

  /** Which sides still exist for a conflicted file (from the operation payload). */
  const conflictSideOf = (file: string): ConflictFile | undefined => operation?.conflicts.find(entry => entry.path === file)

  /** Resolve one conflicted file by keeping the ours or theirs side. */
  const resolveConflict = async (file: WorkspaceFile, side: 'ours' | 'theirs'): Promise<void> => {
    try {
      await requestCommitOp({ path, action: 'resolve', file: file.path, side })
      toast(t('conflictResolvedFile').replace('{file}', file.path))
      ws.refresh()
      view.refresh()
      onOperationChanged?.()
    } catch (error) {
      toast(toApiError(error).message, 'error')
    }
  }

  // Commit-message history: ArrowUp at the start and ArrowDown at the end walk it.
  const messageRef = useRef<HTMLTextAreaElement | null>(null)
  const historyRef = useRef<string[] | null>(null)
  const historyIndex = useRef(-1)
  /** Text that was in the field before the first history insert. */
  const historyDraft = useRef('')
  const caretToEnd = useRef(false)

  useEffect(() => {
    historyRef.current = null
    historyIndex.current = -1
    historyDraft.current = ''
  }, [path])

  useEffect(() => {
    if (!caretToEnd.current) return
    caretToEnd.current = false
    const element = messageRef.current
    if (element !== null) element.setSelectionRange(element.value.length, element.value.length)
  }, [ws.message])

  // An empty field always starts a fresh message rather than a history walk.
  useEffect(() => {
    if (ws.message !== '') return
    historyIndex.current = -1
    historyDraft.current = ''
  }, [ws.message])

  const loadHistory = async (): Promise<string[]> => {
    if (historyRef.current !== null) return historyRef.current
    try {
      const payload = await requestCommitMessages({ path })
      historyRef.current = payload.messages
    } catch {
      historyRef.current = []
    }
    return historyRef.current
  }

  /**
   * Advance the history walk: `ArrowUp` at the start or `ArrowDown` at the end
   * of an inserted message both move to the next older message. After the oldest
   * entry the walk returns to the text that was typed before it started.
   */
  const stepHistory = async (): Promise<void> => {
    const messages = await loadHistory()
    if (messages.length === 0) return
    if (historyIndex.current < 0) historyDraft.current = ws.message
    const next = historyIndex.current + 1
    caretToEnd.current = true
    if (next >= messages.length) {
      const draft = historyDraft.current
      historyDraft.current = ''
      historyIndex.current = -1
      ws.setMessage(draft)
      return
    }
    historyIndex.current = next
    ws.setMessage(messages[next] ?? '')
  }
  /** Absolute path of a working-tree file, using the repository's separator. */
  const absolutePath = (relative: string): string => {
    const root = path.replace(/[\\/]+$/, '')
    const separator = root.includes('\\') ? '\\' : '/'
    return `${root}${separator}${relative.replace(/^[\\/]+/, '')}`
  }

  /** Tooltip for the whole row: the absolute path and the status in words. */
  const rowHint = (file: WorkspaceFile): string => {
    const from = file.origPath === undefined ? '' : ` (from ${file.origPath})`
    return `${absolutePath(file.path)} - ${statusLabel(file)}${from}`
  }

  const statusLabel = (file: WorkspaceFile): string => {
    if (file.unmerged === true) return t('statusConflicted')
    switch (file.status) {
      case 'M':
        return t('statusModified')
      case 'T':
        return t('statusTypeChange')
      case 'U':
      case '?':
        return t('statusUntracked')
      case 'A':
        return t('statusAdded')
      case 'D':
        return t('statusDeleted')
      case 'R':
        return t('statusRenamed')
      case 'C':
        return t('statusCopied')
      default:
        return file.status
    }
  }

  const fileRow = (file: WorkspaceFile): React.ReactElement => {
    const scope = scopeOf(file)
    const conflicted = file.unmerged === true
    const conflictSides = conflicted && operation !== null && operation !== undefined
      ? operation.conflicts.find(conflict => conflict.path === file.path)
      : undefined
    const selected = ws.selected?.path === file.path && ws.selected.scope === scope
    const group = scope === 'staged' ? 'staged' : 'unstaged'
    const isChecked = checked[group].includes(file.path)
    return (
      <div
        key={`${scope}:${file.path}`}
        className={cls(`dsh-gitlog-workspace-file${selected ? ' is-selected' : ''}`)}
        {...tooltipProps(() => rowHint(file))}
        onClick={event => {
          // Shift-click extends the checkbox range instead of opening the diff.
          if (event.shiftKey) {
            toggleCheck(group, file.path, true)
            return
          }
          ws.selectFile(file.path, scope)
        }}
        onDoubleClick={() => toggleStage(file, scope)}
        onContextMenu={event => {
          event.preventDefault()
          setFileMenu({ file, x: event.clientX, y: event.clientY })
        }}
      >
        <input
          type="checkbox"
          checked={isChecked}
          onClick={event => event.stopPropagation()}
          onDoubleClick={event => event.stopPropagation()}
          onChange={event => toggleCheck(group, file.path, (event.nativeEvent as MouseEvent).shiftKey === true)}
          aria-label={file.path}
        />
        <span className={cls(`dsh-gitlog-workspace-status ${statusTone(file.status)}${conflicted ? ' is-conflict' : ''}`)}>
          {file.status}
        </span>
        {conflicted
          ? (
              <span
                className={cls('dsh-gitlog-workspace-conflict')}
                {...tooltipProps(t('statusConflicted'))}
              >
                <ConflictIcon size={12} />
              </span>
            )
          : null}
        <span className={cls('dsh-gitlog-workspace-path')}>
          {file.path}
        </span>
        {file.lfs === true
          ? <span className={cls('dsh-gitlog-lfs')}>{t('lfsBadge')}</span>
          : file.binary
            ? <span className={cls('dsh-gitlog-binary')}>{t('binary')}</span>
            : (
                <span className={cls('dsh-gitlog-workspace-stats')}>
                  {file.additions === null ? null : <span className={cls('dsh-gitlog-add')}>{`+${file.additions}`}</span>}
                  {file.deletions === null ? null : <span className={cls('dsh-gitlog-del')}>{`-${file.deletions}`}</span>}
                </span>
              )}
        <button
          type="button"
          className={cls('dsh-gitlog-workspace-file-action')}
                    aria-label={conflicted ? t('markResolved') : scope === 'staged' ? t('unstageFile') : t('stageFile')}
          onClick={event => {
            event.stopPropagation()
            toggleStage(file, scope)
          }}
          onDoubleClick={event => event.stopPropagation()}
          onMouseEnter={event => showTooltip(
            conflicted ? t('markResolved') : scope === 'staged' ? t('unstageFile') : t('stageFile'),
            event.currentTarget.getBoundingClientRect(),
          )}
          onMouseLeave={hideTooltip}
        >
          {scope === 'staged' ? <MinusIcon size={14} /> : <PlusIcon size={14} />}
        </button>
      </div>
    )
  }

  const bodyRef = useRef<HTMLDivElement | null>(null)
  const formRef = useRef<HTMLDivElement | null>(null)
  const filesRef = useRef<HTMLDivElement | null>(null)
  const stagedRef = useRef<HTMLElement | null>(null)
  const filesSize = useSplitSize({
    initial: () => readRepoUiState(repoKey).commitFilesWidth ?? 380,
    min: 260,
    max: () => {
      const width = bodyRef.current?.getBoundingClientRect().width ?? 0
      return width <= 0 ? 520 : Math.max(260, Math.min(width - 320, width * 0.7))
    },
    axis: 'x',
    persist: value => writeRepoUiState({ commitFilesWidth: value }, repoKey),
  })
  // The form is anchored at the bottom, so dragging up grows it.
  const commitSize = useSplitSize({
    initial: () => readRepoUiState(repoKey).commitFormHeight ?? 220,
    min: 150,
    max: () => {
      const height = filesRef.current?.getBoundingClientRect().height ?? 0
      return height <= 0 ? 420 : Math.max(160, height - 240)
    },
    axis: 'y',
    invert: true,
    persist: value => writeRepoUiState({ commitFormHeight: value }, repoKey),
  })
  // Stacked layout: the file column and the diff are separated by a splitter too.
  const narrowFilesSize = useSplitSize({
    initial: () => readRepoUiState(repoKey).commitFilesHeight ?? 300,
    min: 160,
    measure: () => filesRef.current?.getBoundingClientRect().height ?? 0,
    max: () => {
      const height = bodyRef.current?.getBoundingClientRect().height ?? 0
      // Leave room for the diff (min 240px) and the form (min 150px).
      return height <= 0 ? 520 : Math.max(200, height - 420)
    },
    axis: 'y',
    persist: value => writeRepoUiState({ commitFilesHeight: value }, repoKey),
  })

  // Stacked layout: the form sits at the bottom, so the divider above it is a
  // splitter that hands height to the form (and takes it back from the diff).
  const narrowCommitSize = useSplitSize({
    initial: () => readRepoUiState(repoKey).commitNarrowHeight ?? 260,
    min: 150,
    measure: () => formRef.current?.getBoundingClientRect().height ?? 0,
    max: () => {
      const height = bodyRef.current?.getBoundingClientRect().height ?? 0
      return height <= 0 ? 520 : Math.max(160, height - 220)
    },
    axis: 'y',
    invert: true,
    persist: value => writeRepoUiState({ commitNarrowHeight: value }, repoKey),
  })
  const stagedSize = useSplitSize({
    initial: () => readRepoUiState(repoKey).commitStagedHeight ?? 180,
    min: 90,
    measure: () => stagedRef.current?.getBoundingClientRect().height ?? 0,
    max: () => {
      const height = filesRef.current?.getBoundingClientRect().height ?? 0
      return height <= 0 ? 420 : Math.max(120, height - commitSize.size - 150)
    },
    axis: 'y',
    persist: value => writeRepoUiState({ commitStagedHeight: value }, repoKey),
  })

  const section = (group: 'staged' | 'unstaged', files: WorkspaceFile[], style?: React.CSSProperties, nodeRef?: React.Ref<HTMLElement>): React.ReactElement => {
    const isStaged = group === 'staged'
    const hasChecked = checked[group].length > 0
    const selectedAction = (): void => {
      if (isStaged) {
        ws.unstage(checked.staged)
        setChecked(current => ({ ...current, staged: [] }))
      } else {
        ws.stage(checked.unstaged)
        setChecked(current => ({ ...current, unstaged: [] }))
      }
    }
    const allAction = (): void => {
      if (isStaged) {
        ws.unstageAll()
        setChecked(current => ({ ...current, staged: [] }))
      } else {
        ws.stageAll()
        setChecked(current => ({ ...current, unstaged: [] }))
      }
    }
    return (
      <section className={cls('dsh-gitlog-workspace-section')} style={style} ref={nodeRef}>
        <div className={cls('dsh-gitlog-workspace-section-head')}>
          <h3>{`${isStaged ? t('stagedFiles') : t('unstagedFiles')} (${files.length})`}</h3>
          <span className={cls('dsh-gitlog-workspace-section-actions')}>
            <Button
              disabled={!hasChecked || ws.actionState === 'loading'}
              onClick={selectedAction}
            >
              {isStaged ? t('unstageSelected') : t('stageSelected')}
            </Button>
            <Button
              disabled={files.length === 0 || ws.actionState === 'loading'}
              onClick={allAction}
            >
              {isStaged ? t('unstageAll') : t('stageAll')}
            </Button>
            {isStaged
              ? null
              : (
                  <Button
                    disabled={ws.status === null || ws.actionState === 'loading'}
                    title={t('stashHint')}
                    onClick={() => setStashOpen(true)}
                  >
                    {t('stashCreate')}
                  </Button>
                )}
          </span>
        </div>
        <div
          className={cls('dsh-gitlog-workspace-list')}
          tabIndex={0}
          role="group"
          aria-label={isStaged ? t('stagedFiles') : t('unstagedFiles')}
          onKeyDown={event => {
            // Ctrl/Cmd+A checks every file instead of selecting page text.
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
              event.preventDefault()
              setChecked(current => ({ ...current, [group]: files.map(file => file.path) }))
            }
          }}
        >
          {files.length === 0
            ? <p className={cls('dsh-gitlog-workspace-empty')}>{isStaged ? t('noStaged') : t('noUnstaged')}</p>
            : files.map(file => fileRow(file))}
        </div>
      </section>
    )
  }

  const authorLabel = status?.author.name
    ? `${status.author.name} <${status.author.email}>`
    : t('notConfigured')

  const commitForm = (
    <div
      ref={formRef}
      className={cls('dsh-gitlog-workspace-commit')}
      style={narrow
        ? (narrowCommitSize.touched ? { flex: '0 0 auto', height: `${narrowCommitSize.size}px` } : undefined)
        : { flex: '0 1 auto', height: `${commitSize.size}px` }}
    >
      <div className={cls('dsh-gitlog-workspace-message-head')}>
        <span>{t('commitMessage')}</span>
        <span className={cls('dsh-gitlog-workspace-author')} {...tooltipProps(authorLabel)}>{authorLabel}</span>
      </div>
      <textarea
        ref={messageRef}
        className={cls('dsh-gitlog-workspace-message')}
        value={ws.message}
        placeholder={t('commitMessage')}
        onChange={event => {
          // Any edit makes this a new message: the history walk restarts.
          historyIndex.current = -1
          historyDraft.current = ''
          ws.setMessage(event.target.value)
        }}
        onKeyDown={event => {
          if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return
          const element = event.currentTarget
          if (element.selectionStart !== element.selectionEnd) return
          if (event.key === 'ArrowUp' && element.selectionStart === 0) {
            // At the very start: walk into the repository's messages.
            event.preventDefault()
            void stepHistory()
            return
          }
          // At the end of an inserted, unedited message: keep walking backwards.
          if (event.key === 'ArrowDown' && historyIndex.current >= 0 && element.selectionEnd === element.value.length) {
            event.preventDefault()
            void stepHistory()
          }
        }}
        rows={3}
        spellCheck={false}
      />
      {ws.generateError !== null ? <p className={cls('dsh-gitlog-note')} role="alert">{ws.generateError.message}</p> : null}
      <div className={cls('dsh-gitlog-workspace-options')}>
        <label className={cls('dsh-gitlog-check')}>
          <input
            type="checkbox"
            checked={ws.amend}
            onChange={event => ws.setAmend(event.target.checked)}
          />
          {t('amendLastCommit')}
        </label>
        <label className={cls('dsh-gitlog-check')}>
          <input
            type="checkbox"
            checked={ws.push}
            disabled={status?.upstream === null || status === null}
            onChange={event => ws.setPush(event.target.checked)}
          />
          {status?.upstream === null || status === null
            ? t('noUpstream')
            : `${t('pushAfterCommit')} ${status.upstream}`}
        </label>
      </div>
      {ws.note !== null ? <p className={cls('dsh-gitlog-note')} role="status">{ws.note}</p> : null}
      {ws.actionError !== null ? <p className={cls('dsh-gitlog-note')} role="alert">{ws.actionError.message}</p> : null}
      <div className={cls('dsh-gitlog-workspace-commit-actions')}>
        <Button
          iconOnly
          variant="ghost"
          title={t('commitReview')}
          onClick={() => setReviewOpen(true)}
          disabled={staged.length === 0 || ws.actionState === 'loading'}
          icon={<ReviewIcon />}
        />
        <Button
          iconOnly
          className={cls('dsh-gitlog-generate-btn')}
          title={ws.generateState === 'loading' ? t('generatingMessage') : t('generateMessage')}
          onClick={ws.generate}
          disabled={ws.generateState === 'loading'
            || ws.actionState === 'loading'
            || path === ''
            || (staged.length === 0 && unstaged.length === 0)}
          icon={<SparkleIcon />}
        />
        <Button
          variant="primary"
          disabled={ws.actionState === 'loading' || ws.message.trim() === '' || (staged.length === 0 && !ws.amend)}
          onClick={ws.commit}
        >
          {ws.actionState === 'loading' ? t('committing') : t('commit')}
        </Button>
      </div>
    </div>
  )

  const scopeLabel = ws.selected?.scope === 'staged'
    ? t('staged')
    : ws.selected?.scope === 'untracked'
      ? t('untracked')
      : t('unstaged')

  // The selection carries only path and scope; the list entry says whether LFS
  // stores that path, which decides how a binary diff is explained.
  const selectedEntry = ws.selected === null || status === null
    ? undefined
    : (ws.selected.scope === 'staged' ? status.staged : status.unstaged)
        .find(file => file.path === ws.selected?.path)

  const diffPane = (
    <div className={cls('dsh-gitlog-workspace-diff')}>
      <div className={cls('dsh-gitlog-workspace-diff-head')}>
        <h3>{t('patch')}</h3>
        {ws.selected !== null
          ? <code className={cls('dsh-gitlog-patch-file')} {...tooltipProps(ws.selected.path)}>{`${scopeLabel} · ${ws.selected.path}`}</code>
          : null}
        <span className={cls('dsh-gitlog-diff-actions')}>
          {ws.diff === null || ws.diff.patch === '' || ws.diff.binary
            ? null
            : (
                <button
                  type="button"
                  className={cls('dsh-gitlog-diff-mode')}
                  aria-label={t('diffDialogOpen')}
                  {...tooltipProps(t('diffDialogOpen'))}
                  onClick={() => setDiffDialogOpen(true)}
                >
                  <ExpandIcon />
                </button>
              )}
          <button
            type="button"
            className={cls('dsh-gitlog-diff-mode')}
            aria-label={diffMode.mode === 'split' ? t('diffUnified') : t('diffSplit')}
            {...tooltipProps(diffMode.mode === 'split' ? t('diffUnified') : t('diffSplit'))}
            onClick={diffMode.toggle}
          >
            {diffMode.mode === 'split' ? <UnifiedDiffIcon /> : <SplitDiffIcon />}
          </button>
        </span>
      </div>
      {ws.selected === null
        ? <p className={cls('dsh-gitlog-workspace-empty')}>{t('selectFileToViewDiff')}</p>
        : ws.diffState === 'loading'
          ? <p className={cls('dsh-gitlog-workspace-empty')}>{t('loadingDiff')}</p>
          : ws.diffState === 'error'
            ? <p className={cls('dsh-gitlog-note')} role="alert">{ws.diffError?.message ?? t('unknownError')}</p>
            : ws.diff !== null
              ? ws.diff.media !== undefined
                ? (
                    <div className={cls('dsh-gitlog-workspace-diff-body')}>
                      <MediaDiff media={ws.diff.media} path={ws.selected?.path ?? ''} t={t} />
                    </div>
                  )
                : ws.diff.lfs !== undefined
                ? (
                    <div className={cls('dsh-gitlog-workspace-diff-body')}>
                      <LfsDiff lfs={ws.diff.lfs} path={ws.selected?.path} t={t} />
                    </div>
                  )
                : ws.diff.binary
                ? (
                    <p className={cls('dsh-gitlog-workspace-empty')}>
                      {selectedEntry?.lfs === true ? t('lfsBinary') : t('binary')}
                    </p>
                  )
                : (
                    <div className={cls('dsh-gitlog-workspace-diff-body')}>
                      <DiffView
                        patch={ws.diff.patch}
                        t={t}
                        path={ws.selected?.path}
                        empty={t('fileNoPatch')}
                        hunkAction={ws.selected === null
                          ? undefined
                          : {
                              label: ws.selected.scope === 'staged' ? t('unstageHunk') : t('stageHunk'),
                              busy: hunkBusy,
                              onAction: hunk => { void stageHunk(hunk) },
                            }}
                        mode={diffMode.mode}
                        onLineContextMenu={(selection, event) => setLineMenu({
                          lines: selection.lines,
                          x: event.clientX,
                          y: event.clientY,
                        })}
                      />
                      {ws.diff.truncated ? <p className={cls('dsh-gitlog-note')}>{t('patchTruncated')}</p> : null}
                    </div>
                  )
              : null}
    </div>
  )

  return (
    <div className={cls('dsh-gitlog-workspace')}>
      <div className={cls('dsh-gitlog-workspace-head')}>
        <div className={cls('dsh-gitlog-workspace-title')}>
          {status !== null
            ? (
                <span className={cls('dsh-gitlog-workspace-branch')} {...(status.upstream === null ? {} : tooltipProps(status.upstream))}>
                  {status.branch}
                  {status.upstream === null
                    ? ''
                    : ` · ${status.upstream} ↑${status.ahead} ↓${status.behind}`}
                </span>
              )
            : null}
        </div>
        <span className={cls('dsh-gitlog-workspace-spacer')} />
        <Spinner size={16} active={statusSpinning} />
        <Button
          iconOnly
          variant="ghost"
          title={t('refresh')}
          onClick={ws.refresh}
          disabled={ws.statusState === 'loading' || path === ''}
          icon={<RefreshIcon />}
        />
      </div>
      {path === ''
        ? <p className={cls('dsh-gitlog-workspace-empty')}>{t('workspaceNoRepo')}</p>
        : ws.statusState === 'error'
          ? (
              <div className={cls('dsh-gitlog-workspace-empty')}>
                <p>{ws.statusError?.message ?? t('unknownError')}</p>
                <Button onClick={ws.refresh}>{t('tryAgain')}</Button>
              </div>
            )
          : (
              <div
                ref={bodyRef}
                className={cls('dsh-gitlog-workspace-body')}
                style={narrow ? undefined : { gridTemplateColumns: `${filesSize.size}px 6px minmax(0, 1fr)` }}
              >
                <div
                  ref={filesRef}
                  className={cls('dsh-gitlog-workspace-files')}
                  style={narrow && narrowFilesSize.touched
                    ? { flex: '0 0 auto', height: `${narrowFilesSize.size}px` }
                    : undefined}
                >
                  {section(
                    'staged',
                    staged,
                    stagedSize.touched ? { flex: '0 0 auto', height: `${stagedSize.size}px` } : undefined,
                    stagedRef,
                  )}
                  <Splitter
                    orientation="horizontal"
                    label={t('resizeStaged')}
                    onStart={stagedSize.start}
                    onDrag={stagedSize.drag}
                    onReset={stagedSize.reset}
                  />
                  {section('unstaged', unstaged)}
                  {narrow
                    ? null
                    : (
                        <Splitter
                          orientation="horizontal"
                          label={t('resizeCommitForm')}
                          onStart={commitSize.start}
                          onDrag={commitSize.drag}
                          onReset={commitSize.reset}
                        />
                      )}
                  {narrow ? null : commitForm}
                </div>
                {narrow
                  ? (
                      <Splitter
                        orientation="horizontal"
                        label={t('resizeCommitFiles')}
                        onStart={narrowFilesSize.start}
                        onDrag={narrowFilesSize.drag}
                        onReset={narrowFilesSize.reset}
                      />
                    )
                  : (
                      <Splitter
                        orientation="vertical"
                        label={t('resizeCommitFiles')}
                        onStart={filesSize.start}
                        onDrag={filesSize.drag}
                        onReset={filesSize.reset}
                      />
                    )}
                {diffPane}
                {/* The stacked layout separates the form with the same hairline as a splitter. */}
                {narrow
                  ? (
                      <Splitter
                        orientation="horizontal"
                        label={t('resizeCommitForm')}
                        onStart={narrowCommitSize.start}
                        onDrag={narrowCommitSize.drag}
                        onReset={narrowCommitSize.reset}
                      />
                    )
                  : null}
                {narrow ? commitForm : null}
              </div>
            )}
      {fileMenu === null
        ? null
        : (
            <div
              ref={menuRef}
              className={cls('dsh-gitlog-commit-menu dsh-gitlog-file-menu')}
              style={{
                left: Math.min(fileMenu.x, window.innerWidth - 220),
                top: Math.min(fileMenu.y, window.innerHeight - 100),
              }}
              role="menu"
              aria-label={t('fileMenu')}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void revealFile(fileMenu.file)
                  setFileMenu(null)
                }}
              >
                {t('revealIn').replace('{name}', fileManagerName(t))}
              </button>
              {fileMenu.file.unmerged !== true ? null : (
                <button
                  type="button"
                  role="menuitem"
                  disabled={conflictSideOf(fileMenu.file.path)?.ours === false}
                  onClick={() => {
                    const file = fileMenu.file
                    setFileMenu(null)
                    void resolveConflict(file, 'ours')
                  }}
                >
                  {t('conflictTakeOurs')}
                </button>
              )}
              {fileMenu.file.unmerged !== true ? null : (
                <button
                  type="button"
                  role="menuitem"
                  disabled={conflictSideOf(fileMenu.file.path)?.theirs === false}
                  onClick={() => {
                    const file = fileMenu.file
                    setFileMenu(null)
                    void resolveConflict(file, 'theirs')
                  }}
                >
                  {t('conflictTakeTheirs')}
                </button>
              )}
              {fileMenu.file.staged || fileMenu.file.unmerged === true
                ? null
                : (
                    <button
                      type="button"
                      role="menuitem"
                      className="danger"
                      onClick={() => {
                        setFileAction({
                          kind: fileMenu.file.untracked ? 'delete' : 'discard',
                          file: fileMenu.file.path,
                        })
                        setFileMenu(null)
                      }}
                    >
                      {fileMenu.file.untracked ? t('deleteFileMenu') : t('discardMenu')}
                    </button>
                  )}
              {checkedUntracked.length === 0
                ? null
                : (
                    <button
                      type="button"
                      role="menuitem"
                      className="danger"
                      onClick={() => {
                        setDeleteFiles(checkedUntracked)
                        setFileMenu(null)
                      }}
                    >
                      {t('deleteSelectedCount').replace('{count}', String(checkedUntracked.length))}
                    </button>
                  )}
              {fileMenu.file.staged || !fileMenu.file.untracked
                ? null
                : (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIgnoreFile(fileMenu.file.path)
                        setFileMenu(null)
                      }}
                    >
                      {t('ignoreMenu')}
                    </button>
                  )}
            </div>
          )}
      {lineMenu === null
        ? null
        : (
            <div
              ref={lineMenuRef}
              className={cls('dsh-gitlog-commit-menu dsh-gitlog-file-menu')}
              style={{
                left: Math.min(lineMenu.x, window.innerWidth - 220),
                top: Math.min(lineMenu.y, window.innerHeight - 100),
              }}
              role="menu"
              aria-label={t('diffMenu')}
            >
              <button
                type="button"
                role="menuitem"
                disabled={lineBusy}
                onClick={() => { void stageLines(lineMenu.lines) }}
              >
                {lineMenu.lines.length > 1
                  ? (ws.selected?.scope === 'staged' ? t('unstageLines') : t('stageLines')).replace('{count}', String(lineMenu.lines.length))
                  : (ws.selected?.scope === 'staged' ? t('unstageLine') : t('stageLine'))}
              </button>
            </div>
          )}
      {fileAction === null
        ? null
        : (
            <FileActionDialog
              view={view}
              file={fileAction.file}
              action={fileAction.kind}
              t={t}
              onDone={() => ws.refresh()}
              onClose={() => setFileAction(null)}
            />
          )}
      {reviewOpen
        ? (
            <CommitReviewDialog
              view={view}
              t={t}
              sessionId={sessionId}
              onClose={() => setReviewOpen(false)}
            />
          )
        : null}
      {diffDialogOpen && ws.diff !== null && ws.diff.patch !== ''
        ? (
            <DiffDialog
              path={ws.selected?.path ?? ''}
              patch={ws.diff.patch}
              t={t}
              mode={diffMode.mode}
              onToggleMode={diffMode.toggle}
              onClose={() => setDiffDialogOpen(false)}
            />
          )
        : null}
      {deleteFiles === null
        ? null
        : (
            <DeleteFilesDialog
              view={view}
              files={deleteFiles}
              t={t}
              onDone={() => {
                const removed = new Set(deleteFiles)
                setChecked(current => ({
                  ...current,
                  unstaged: current.unstaged.filter(path => !removed.has(path)),
                }))
                ws.refresh()
              }}
              onClose={() => setDeleteFiles(null)}
            />
          )}
      {ignoreFile === null
        ? null
        : (
            <IgnoreFileDialog
              view={view}
              file={ignoreFile}
              t={t}
              onDone={() => ws.refresh()}
              onClose={() => setIgnoreFile(null)}
            />
          )}
      {stashOpen
        ? <StashCreateDialog view={view} ws={ws} t={t} onClose={() => setStashOpen(false)} />
        : null}
    </div>
  )
}




































