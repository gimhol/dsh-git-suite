import type * as React from 'react'
import { h, useEffect, useRef, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { graphGeometry } from '../lib/graph.js'
import { refTooltip } from '../lib/ref-tooltip.js'
import type { Commit, CommitColumn, CommitColumns, Translate } from '../types.js'
import { CommitColumnsMenu } from './CommitColumnsMenu.js'
import { tooltipProps } from './Tooltip.js'
import { CommitRow, COMMIT_ROW_HEIGHT } from './CommitRow.js'
import { Dropdown, type DropdownOption } from './Dropdown.js'
import { LoadingLine, useMinimumSpin } from './States.js'
import { RefreshIcon } from './GitLogIcon.js'
import { VirtualList } from './VirtualList.js'
import { cls } from '../styles.js'

interface ColumnWidths {
  graph: number
  date: number
  author: number
  hash: number
}

const DEFAULT_COLUMN_WIDTHS: ColumnWidths = { graph: 48, date: 152, author: 110, hash: 64 }
const COLUMN_LIMITS: Record<keyof ColumnWidths, readonly [number, number]> = {
  graph: [32, Number.POSITIVE_INFINITY],
  date: [128, Number.POSITIVE_INFINITY],
  author: [64, Number.POSITIVE_INFINITY],
  hash: [48, Number.POSITIVE_INFINITY],
}
const COLUMN_KEYS = ['graph', 'date', 'author', 'hash'] as const
const COLUMN_STORAGE_KEY = 'dsh.git-suite.commit-columns.v1'
const COLUMN_VISIBILITY_KEY = 'dsh.git-suite.commit-visible.v1'
const DEFAULT_VISIBILITY: CommitColumns = { graph: true, date: true, author: true, hash: true }
const COLUMN_PADDING = 26
const MIN_DESCRIPTION_WIDTH = 120
/** Below this rendered width the log drops the author and commit columns. */
const NARROW_WIDTH = 760
/** Date column width when the panel is too narrow to keep the user's width. */
const COMPACT_DATE_WIDTH = 132

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function readColumnWidths(): ColumnWidths {
  try {
    const raw = window.localStorage.getItem(COLUMN_STORAGE_KEY)
    if (raw === null) return { ...DEFAULT_COLUMN_WIDTHS }
    const parsed = JSON.parse(raw) as Partial<Record<keyof ColumnWidths, unknown>>
    const widths = { ...DEFAULT_COLUMN_WIDTHS }
    for (const key of COLUMN_KEYS) {
      const value = parsed[key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        const [min, max] = COLUMN_LIMITS[key]
        widths[key] = clamp(value, min, max)
      }
    }
    return widths
  } catch {
    return { ...DEFAULT_COLUMN_WIDTHS }
  }
}

function readColumnVisibility(): CommitColumns {
  try {
    const raw = window.localStorage.getItem(COLUMN_VISIBILITY_KEY)
    if (raw === null) return { ...DEFAULT_VISIBILITY }
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>
    const visibility = { ...DEFAULT_VISIBILITY }
    for (const key of COLUMN_KEYS) {
      if (typeof parsed[key] === 'boolean') visibility[key] = parsed[key]
    }
    return visibility
  } catch {
    return { ...DEFAULT_VISIBILITY }
  }
}

interface ColumnResizerProps {
  label: string
  style: React.CSSProperties
  onStart(): void
  onDrag(deltaX: number): void
}

/** A vertical drag handle placed in a header gap; it only reports pointer deltas. */
function ColumnResizer({ label, style, onStart, onDrag }: ColumnResizerProps): React.ReactElement {
  const [dragging, setDragging] = useState(false)
  const origin = useRef<number | null>(null)

  const stop = (element: Element, pointerId: number): void => {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
    document.documentElement.style.cursor = ''
    document.body.style.userSelect = ''
    origin.current = null
    setDragging(false)
  }

  return (
    <span
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      {...tooltipProps(label)}
      className={cls(`dsh-gitlog-col-resizer${dragging ? ' is-dragging' : ''}`)}
      style={style}
      onPointerDown={event => {
        if (event.button !== 0) return
        event.preventDefault()
        origin.current = event.clientX
        setDragging(true)
        event.currentTarget.setPointerCapture(event.pointerId)
        document.documentElement.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
        onStart()
      }}
      onPointerMove={event => {
        if (origin.current === null) return
        onDrag(event.clientX - origin.current)
      }}
      onPointerUp={event => {
        if (origin.current === null) return
        stop(event.currentTarget, event.pointerId)
      }}
      onPointerCancel={event => {
        if (origin.current === null) return
        stop(event.currentTarget, event.pointerId)
      }}
      onKeyDown={event => {
        const step = event.shiftKey ? 32 : 8
        let delta = 0
        if (event.key === 'ArrowLeft') delta = -step
        else if (event.key === 'ArrowRight') delta = step
        if (delta === 0) return
        event.preventDefault()
        onStart()
        onDrag(delta)
      }}
    />
  )
}

/** The paged, virtualized commit list with a sticky table header and resizable columns. */
export function CommitList({ view, t, onContextMenu, onRefContextMenu }: {
  view: GitLogView
  t: Translate
  onContextMenu?(commit: Commit, event: React.MouseEvent): void
  onRefContextMenu?(ref: string, event: React.MouseEvent): boolean
}): React.ReactElement {
  const { commits, selected, graph, status } = view
  const showLoadingLine = useMinimumSpin(status === 'loading')
  const [widths, setWidths] = useState<ColumnWidths>(readColumnWidths)
  const [chosen, setChosen] = useState<CommitColumns>(readColumnVisibility)
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 900px)').matches)
  const [columnsMenu, setColumnsMenu] = useState<{ x: number; y: number } | null>(null)
  const startWidths = useRef<ColumnWidths>(widths)

  useEffect(() => {
    try {
      window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(widths))
    } catch {
      // Storage can be disabled; resizing still works for this session.
    }
  }, [widths])

  useEffect(() => {
    try {
      window.localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(chosen))
    } catch {
      // Storage can be disabled; the choice still applies for this session.
    }
  }, [chosen])

  const geometry = graphGeometry(graph.maxLanes)

  const beginResize = (): void => {
    startWidths.current = widths
  }

  const resizeColumn = (key: 'date' | 'author' | 'hash', deltaX: number): void => {
    setWidths(current => {
      const start = startWidths.current
      const [min] = COLUMN_LIMITS[key]
      // No max width: wide columns are allowed to make the table scroll
      // horizontally, while the description keeps its 120px minimum.
      const next = Math.max(min, start[key] - deltaX)
      if (next === current[key]) return current
      return { ...current, [key]: next }
    })
  }

  const resizeGraph = (deltaX: number): void => {
    setWidths(current => {
      const start = startWidths.current
      const [min] = COLUMN_LIMITS.graph
      const next = Math.max(min, start.graph + deltaX)
      if (next === current.graph) return current
      return { ...current, graph: next }
    })
  }

  // Narrow panels drop the author and commit columns no matter what was saved.
  const columns: CommitColumns = {
    graph: chosen.graph,
    date: chosen.date,
    author: chosen.author && !narrow,
    hash: chosen.hash && !narrow,
  }
  const dateWidth = narrow ? `${COMPACT_DATE_WIDTH}px` : 'var(--gitlog-date-w, 152px)'
  const template: string[] = []
  if (columns.graph) template.push('var(--gitlog-graph-w, auto)')
  template.push('minmax(120px, 1fr)')
  if (columns.date) template.push(dateWidth)
  if (columns.author) template.push('var(--gitlog-author-w, 110px)')
  if (columns.hash) template.push('var(--gitlog-hash-w, 64px)')

  const fixedWidth = (columns.graph ? widths.graph : 0)
    + (columns.date ? (narrow ? COMPACT_DATE_WIDTH : widths.date) : 0)
    + (columns.author ? widths.author : 0)
    + (columns.hash ? widths.hash : 0)
  const gapWidth = Math.max(0, template.length - 1) * 8

  const style = {
    '--gitlog-graph-w': `${widths.graph}px`,
    '--gitlog-date-w': `${widths.date}px`,
    '--gitlog-author-w': `${widths.author}px`,
    '--gitlog-hash-w': `${widths.hash}px`,
    '--gitlog-columns': template.join(' '),
    '--gitlog-table-min': `calc(${fixedWidth}px + ${COLUMN_PADDING + gapWidth + MIN_DESCRIPTION_WIDTH}px)`,
  } as React.CSSProperties

  // Each resizer sits in the 8px grid gap at the boundary it moves, measured
  // from the right edge over the columns that are currently visible.
  const graphResizerLeft = 'calc(10px + var(--gitlog-graph-w))'
  const hashResizerRight = `calc(16px + ${widths.hash}px)`
  const authorResizerRight = `calc(16px + ${widths.author + (columns.hash ? widths.hash + 8 : 0)}px)`
  const dateResizerRight = `calc(16px + ${(narrow ? COMPACT_DATE_WIDTH : widths.date)
    + (columns.author ? widths.author + 8 : 0)
    + (columns.hash ? widths.hash + 8 : 0)}px)`

  const toggleColumn = (column: CommitColumn): void => {
    setChosen(current => ({ ...current, [column]: !columns[column] }))
  }

  const localBranches = view.tree?.branches ?? []
  const remoteGroups = view.tree?.remotes ?? []
  const branchOptions: DropdownOption[] = [
    { value: 'all', label: t('allBranches') },
    { value: 'head', label: t('currentBranch') },
    ...localBranches.map(branch => ({
      value: `branch:${branch.ref}`,
      label: branch.name,
      title: branch.name,
    })),
    ...(view.showRemotes
      ? remoteGroups.flatMap(group => group.branches.map(branch => ({
          value: `branch:${branch.ref}`,
          label: branch.name,
          title: branch.name,
          group: group.name,
        })))
      : []),
  ]
  const branchValue = view.selection.kind === 'all'
    ? 'all'
    : view.selection.kind === 'head'
      ? 'head'
      : view.selection.kind === 'branch'
        ? `branch:${view.selection.ref}`
        : ''
  const chooseBranch = (value: string): void => {
    if (value === 'all') {
      view.selectRef({ kind: 'all' })
      return
    }
    if (value === 'head') {
      view.selectRef({ kind: 'head' })
      return
    }
    const ref = value.startsWith('branch:') ? value.slice('branch:'.length) : ''
    const local = localBranches.find(branch => branch.ref === ref)
    const remote = remoteGroups.flatMap(group => group.branches).find(branch => branch.ref === ref)
    const branch = local ?? remote
    if (branch === undefined) return
    view.selectRef({ kind: 'branch', ref: branch.ref, name: branch.name, remote: branch.kind === 'remote' })
  }
  const sortOptions: DropdownOption[] = [
    { value: 'date', label: t('sortDate') },
    { value: 'topo', label: t('sortTopo') },
  ]

  return (
    <section className={cls('dsh-gitlog-list')} aria-label={t('commits')} style={style}>
      <div className={cls('dsh-gitlog-list-header')}>
        <div className={cls('dsh-gitlog-history-toolbar')}>
          <Dropdown
            className={cls('dsh-gitlog-history-branch')}
            value={branchValue}
            options={branchOptions}
            onChange={chooseBranch}
            ariaLabel={t('branchFilter')}
            placeholder={view.branchLabel}
          />
          <Dropdown
            className={cls('dsh-gitlog-history-sort')}
            value={view.sort}
            options={sortOptions}
            onChange={value => view.setSort(value === 'topo' ? 'topo' : 'date')}
            ariaLabel={t('sortOrder')}
          />
          <label className={cls('dsh-gitlog-check dsh-gitlog-history-remotes')}>
            <input
              type="checkbox"
              checked={view.showRemotes}
              onChange={event => view.setShowRemotes(event.target.checked)}
            />
            {t('showRemoteBranches')}
          </label>
          <span className={cls('dsh-gitlog-history-spacer')} />
          <button
            type="button"
            className={cls('dsh-gitlog-history-refresh')}
            aria-label={t('refresh')}
            {...tooltipProps(t('refresh'))}
            disabled={status === 'loading'}
            onClick={view.refresh}
          >
            <RefreshIcon size={16} />
          </button>
        </div>
        <div
          className={cls('dsh-gitlog-commit-header')}
          onContextMenu={event => {
            event.preventDefault()
            setColumnsMenu({ x: event.clientX, y: event.clientY })
          }}
        >
          {columns.graph ? <span className={cls('dsh-gitlog-col dsh-gitlog-col-graph')}>{t('columnGraph')}</span> : null}
          <span className={cls('dsh-gitlog-col dsh-gitlog-col-description')}>{t('columnDescription')}</span>
          {columns.date ? <span className={cls('dsh-gitlog-col dsh-gitlog-col-date')}>{t('columnDate')}</span> : null}
          {columns.author ? <span className={cls('dsh-gitlog-col dsh-gitlog-col-author')}>{t('columnAuthor')}</span> : null}
          {columns.hash ? <span className={cls('dsh-gitlog-col dsh-gitlog-col-hash')}>{t('columnCommit')}</span> : null}
          {columns.graph
            ? (
                <ColumnResizer
                  label={`${t('resizeColumn')} · ${t('columnGraph')}`}
                  style={{ left: graphResizerLeft }}
                  onStart={beginResize}
                  onDrag={resizeGraph}
                />
              )
            : null}
          {columns.date
            ? (
                <ColumnResizer
                  label={`${t('resizeColumn')} · ${t('columnDate')}`}
                  style={{ right: dateResizerRight }}
                  onStart={beginResize}
                  onDrag={deltaX => resizeColumn('date', deltaX)}
                />
              )
            : null}
          {columns.author
            ? (
                <ColumnResizer
                  label={`${t('resizeColumn')} · ${t('columnAuthor')}`}
                  style={{ right: authorResizerRight }}
                  onStart={beginResize}
                  onDrag={deltaX => resizeColumn('author', deltaX)}
                />
              )
            : null}
          {columns.hash
            ? (
                <ColumnResizer
                  label={`${t('resizeColumn')} · ${t('columnCommit')}`}
                  style={{ right: hashResizerRight }}
                  onStart={beginResize}
                  onDrag={deltaX => resizeColumn('hash', deltaX)}
                />
              )
            : null}
        </div>
      </div>
      <VirtualList
        className={cls('dsh-gitlog-list-scroll')}
        items={commits}
        rowHeight={COMMIT_ROW_HEIGHT}
        resetKey={commits[0]?.hash ?? ''}
        onReachEnd={view.loadMore}
        onViewportChange={width => setNarrow(width < NARROW_WIDTH)}
        footer={showLoadingLine ? <LoadingLine label={t('loadingCommits')} active={status === 'loading'} /> : null}
        renderRow={(commit, index) => {
          const row = graph.rows[index]
          if (row === undefined) return null
          return (
            <CommitRow
              key={commit.hash}
              commit={commit}
              selected={selected === commit.hash}
              onSelect={view.selectCommit}
              onContextMenu={onContextMenu}
              onRefContextMenu={onRefContextMenu}
              t={t}
              row={row}
              geometry={geometry}
              columns={columns}
              refTooltipOf={ref => refTooltip(ref, view.tree, commit.shortHash, t)}
            />
          )
        }}
      />
      <CommitColumnsMenu
        context={columnsMenu}
        columns={columns}
        narrow={narrow}
        t={t}
        onToggle={toggleColumn}
        onClose={() => setColumnsMenu(null)}
      />
    </section>
  )
}










