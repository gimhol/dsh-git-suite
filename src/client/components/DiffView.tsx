import type * as React from 'react'
import { h, useEffect, useMemo, useRef, useState } from '../runtime.js'
import { isContentLine, pairDiffLines, parseDiff, patchLinesForRows } from '../lib/diff.js'
import { highlightLines, languageForPath, type HighlightToken } from '../lib/highlight.js'
import type { DiffLine } from '../lib/diff.js'
import type { Translate } from '../types.js'
import { cls } from '../styles.js'

export type DiffMode = 'unified' | 'split'

export interface DiffHunkAction {
  label: string
  busy?: boolean
  /** Called with the hunk index inside this patch. */
  onAction(hunk: number): void
}

export interface DiffSelection {
  /** First selected patch line index. */
  start: number
  /** Last selected patch line index, inclusive. */
  end: number
  /** Every selected content line, so a side-by-side row maps to exactly its lines. */
  lines: number[]
}

export interface DiffViewProps {
  /** Unified diff text (`git diff`, `git show`, or one file's section). */
  patch: string
  t: Translate
  /** Message shown when the patch has no lines. */
  empty?: string
  /** Lines rendered before the "show more" button appears. */
  pageSize?: number
  /** Unified rows or a side-by-side split. */
  mode?: DiffMode
  /** Optional per-hunk action, e.g. "stage this hunk". */
  hunkAction?: DiffHunkAction
  /** Reports the selected patch line range, if the caller wants to act on it. */
  onSelectLines?(selection: DiffSelection | null): void
  /** Right-click inside the selection (or on one row) with the patch lines to act on. */
  onLineContextMenu?(selection: DiffSelection, event: React.MouseEvent): void
  /** Repository-relative path, used to pick a syntax-highlighting grammar. */
  path?: string
  className?: string
}

const DEFAULT_PAGE = 800
const EDGE = 24

/** One diff line: the marker column stays plain, the content may be tokenized. */
function DiffCode({ line, tokens }: { line: DiffLine; tokens: HighlightToken[] | null }): React.ReactElement {
  const content = line.kind === 'add' || line.kind === 'del' || line.kind === 'context'
  if (!content) {
    return <span className={cls('dsh-gitlog-diff-code')}>{line.raw === '' ? ' ' : line.raw}</span>
  }
  return (
    <span className={cls('dsh-gitlog-diff-code')}>
      <span className={cls('dsh-gitlog-diff-marker')}>{line.raw.slice(0, 1)}</span>
      {tokens === null
        ? line.content
        : tokens.map((token, index) => token.type === null
          ? token.text
          : <span key={index} className={cls(`dsh-gitlog-tok-${token.type}`)}>{token.text}</span>)}
    </span>
  )
}

/**
 * Unified or side-by-side diff renderer: coloured additions and deletions, a
 * sticky old/new gutter (unified mode), incremental rendering for huge patches,
 * and a draggable line selection that works in both layouts.
 */
export function DiffView({
  patch,
  t,
  empty,
  pageSize = DEFAULT_PAGE,
  mode = 'unified',
  hunkAction,
  onSelectLines,
  onLineContextMenu,
  path,
  className,
}: DiffViewProps): React.ReactElement {
  const parsed = useMemo(() => parseDiff(patch), [patch])
  const splitRows = useMemo(() => (mode === 'split' ? pairDiffLines(parsed.lines) : null), [mode, parsed.lines])
  const language = useMemo(() => languageForPath(path), [path])
  // Tokenize each side once (full text, so multi-line constructs work) and keep
  // a row -> line-index map for rendering.
  const highlight = useMemo(() => {
    if (language === null) return null
    const oldLines: string[] = []
    const newLines: string[] = []
    const oldAt = new Map<number, number>()
    const newAt = new Map<number, number>()
    for (const line of parsed.lines) {
      if (line.kind === 'del' || line.kind === 'context') {
        oldAt.set(line.index, oldLines.length)
        oldLines.push(line.content)
      }
      if (line.kind === 'add' || line.kind === 'context') {
        newAt.set(line.index, newLines.length)
        newLines.push(line.content)
      }
    }
    const oldTokens = highlightLines(oldLines, language)
    const newTokens = highlightLines(newLines, language)
    if (oldTokens === null && newTokens === null) return null
    return { oldTokens, newTokens, oldAt, newAt }
  }, [language, parsed.lines])

  const tokensOf = (line: DiffLine, side: 'old' | 'new'): HighlightToken[] | null => {
    if (highlight === null) return null
    const index = (side === 'old' ? highlight.oldAt : highlight.newAt).get(line.index)
    if (index === undefined) return null
    const tokens = side === 'old' ? highlight.oldTokens : highlight.newTokens
    return tokens?.[index] ?? null
  }
  const [limit, setLimit] = useState(pageSize)
  const [anchor, setAnchor] = useState<number | null>(null)
  const [head, setHead] = useState<number | null>(null)
  const [selecting, setSelecting] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setLimit(pageSize)
    setAnchor(null)
    setHead(null)
  }, [patch, mode, pageSize])

  // Drag across the gutter picks up the row under the pointer.
  useEffect(() => {
    if (!selecting) return undefined
    const rowUnder = (clientX: number, clientY: number): number | null => {
      const element = document.elementFromPoint(clientX, clientY)
      const row = element?.closest<HTMLElement>('[data-diff-row]')
      if (row === null || row === undefined) return null
      const value = Number.parseInt(row.dataset.diffRow ?? '', 10)
      return Number.isFinite(value) ? value : null
    }
    const onMove = (event: PointerEvent): void => {
      const next = rowUnder(event.clientX, event.clientY)
      if (next !== null) setHead(next)
      // Scroll while dragging past the top or bottom edge.
      const container = containerRef.current
      if (container === null) return
      const rect = container.getBoundingClientRect()
      if (event.clientY < rect.top + EDGE) container.scrollTop -= 14
      else if (event.clientY > rect.bottom - EDGE) container.scrollTop += 14
    }
    const onUp = (): void => setSelecting(false)
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
    }
  }, [selecting])

  const unified = splitRows === null
  /** Row range (unified rows or split rows); the two layouts number rows differently. */
  const range = anchor !== null && head !== null
    ? { start: Math.min(anchor, head), end: Math.max(anchor, head) }
    : null

  const lineIndexesOf = (start: number, end: number): DiffSelection | null =>
    patchLinesForRows(splitRows, parsed.lines, start, end)

  const lineRange = range === null ? null : lineIndexesOf(range.start, range.end)

  useEffect(() => {
    onSelectLines?.(lineRange)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the range matters
  }, [lineRange?.start, lineRange?.end])

  if (parsed.lines.length === 0) {
    return <p className={cls('dsh-gitlog-note')}>{empty ?? t('fileNoPatch')}</p>
  }

  const totalRows = splitRows === null ? parsed.lines.length : splitRows.length
  const remaining = totalRows - Math.min(limit, totalRows)

  const copySelection = (): void => {
    if (lineRange === null) return
    const text = lineRange.lines
      .map(index => parsed.lines[index]?.raw ?? '')
      .join('\n')
    void navigator.clipboard?.writeText(text).catch(() => {})
  }

  const hunkButton = (hunk: number): React.ReactElement | null => hunkAction === undefined
    ? null
    : (
        <button
          type="button"
          className={cls('dsh-gitlog-diff-hunk-action')}
          disabled={hunkAction.busy === true}
          onClick={() => hunkAction.onAction(hunk)}
        >
          {hunkAction.label}
        </button>
      )

  const startSelect = (row: number) => (event: React.PointerEvent): void => {
    if (event.button !== 0) return
    event.preventDefault()
    containerRef.current?.focus()
    setAnchor(row)
    setHead(row)
    setSelecting(true)
  }

  const openMenu = (row: number) => (event: React.MouseEvent): void => {
    if (onLineContextMenu === undefined) return
    event.preventDefault()
    const inside = range !== null && row >= range.start && row <= range.end
    if (!inside) {
      setAnchor(row)
      setHead(row)
    }
    const rows = inside && range !== null ? range : { start: row, end: row }
    const lines = lineIndexesOf(rows.start, rows.end)
    if (lines !== null) onLineContextMenu(lines, event)
  }

  const unifiedLine = (line: DiffLine, row: number): React.ReactElement => {
    const selected = range !== null && row >= range.start && row <= range.end
    const selectable = isContentLine(line)
    return (
      <div
        key={row}
        data-diff-row={row}
        className={cls(`dsh-gitlog-diff-line is-${line.kind}${selected ? ' is-selected' : ''}`)}
        onContextMenu={selectable ? openMenu(row) : undefined}
      >
        <span
          className={cls('dsh-gitlog-diff-gutter')}
          onPointerDown={selectable ? startSelect(row) : undefined}
        >
          <span className={cls('dsh-gitlog-diff-num')}>{line.oldLine ?? ''}</span>
          <span className={cls('dsh-gitlog-diff-num')}>{line.newLine ?? ''}</span>
        </span>
        <DiffCode line={line} tokens={line.kind === 'del' ? tokensOf(line, 'old') : tokensOf(line, 'new')} />
        {line.kind === 'hunk' ? hunkButton(line.hunk) : null}
      </div>
    )
  }

  const splitCell = (line: DiffLine | null, side: 'left' | 'right'): React.ReactElement => (
    <div className={cls(`dsh-gitlog-diff-cell${line === null ? ' is-empty' : ` is-${line.kind}`}`)}>
      <span className={cls('dsh-gitlog-diff-num')}>
        {line === null ? '' : side === 'left' ? line.oldLine ?? '' : line.newLine ?? ''}
      </span>
      {line === null ? <span className={cls('dsh-gitlog-diff-code')} /> : <DiffCode line={line} tokens={tokensOf(line, side === 'left' ? 'old' : 'new')} />}
    </div>
  )

  return (
    <div
      ref={containerRef}
      className={cls(`dsh-gitlog-diff${unified ? '' : ' is-split'}${className === undefined ? '' : ` ${className}`}`)}
      role="region"
      aria-label={t('patch')}
      tabIndex={0}
      onPointerDown={event => {
        // Only a left click outside the gutter (or a split row) drops the
        // selection: right-click must keep it, so the menu can act on it.
        if (event.button !== 0) return
        const target = event.target as HTMLElement | null
        if (target !== null && target.closest(`.${cls('dsh-gitlog-diff-gutter')}`) !== null) return
        if (target !== null && target.closest(`.${cls('dsh-gitlog-diff-split-row')}`) !== null) return
        setAnchor(null)
        setHead(null)
      }}
      onKeyDown={event => {
        if (lineRange === null) return
        if (event.key !== 'c' || !(event.ctrlKey || event.metaKey)) return
        event.preventDefault()
        copySelection()
      }}
      onContextMenu={event => {
        // Rows handle their own menu; anywhere else with a selection keeps it.
        if (onLineContextMenu === undefined || lineRange === null) return
        const target = event.target as HTMLElement | null
        if (target !== null && target.closest('[data-diff-row]') !== null) return
        event.preventDefault()
        onLineContextMenu(lineRange, event)
      }}
    >
      {splitRows === null
        ? parsed.lines.slice(0, limit).map(unifiedLine)
        : splitRows.slice(0, limit).map((row, index) => {
            const selected = range !== null && index >= range.start && index <= range.end
            if (row.full !== null) {
              return (
                <div
                  key={index}
                  data-diff-row={index}
                  className={cls(`dsh-gitlog-diff-line is-${row.full.kind}`)}
                >
                  <DiffCode line={row.full} tokens={null} />
                  {row.full.kind === 'hunk' ? hunkButton(row.full.hunk) : null}
                </div>
              )
            }
            return (
              <div
                key={index}
                data-diff-row={index}
                className={cls(`dsh-gitlog-diff-split-row${selected ? ' is-selected' : ''}`)}
                onPointerDown={startSelect(index)}
                onContextMenu={openMenu(index)}
              >
                {splitCell(row.left, 'left')}
                {splitCell(row.right, 'right')}
              </div>
            )
          })}
      {remaining > 0
        ? (
            <button
              type="button"
              className={cls('dsh-gitlog-diff-more')}
              onClick={() => setLimit(value => value + pageSize)}
            >
              {t('diffMore').replace('{count}', String(remaining))}
            </button>
          )
        : null}
    </div>
  )
}








