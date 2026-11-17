import type * as React from 'react'
import { h } from '../runtime.js'
import { formatDateTime } from '../lib/format.js'
import type { GraphGeometry, GraphRow } from '../lib/graph.js'
import type { Commit, CommitColumns, Translate } from '../types.js'
import { CommitGraph } from './CommitGraph.js'
import { Refs } from './Refs.js'
import { tooltipProps } from './Tooltip.js'
import { cls } from '../styles.js'

/** One log line: the graph lane height has to match the row height (`.dsh-gitlog-commit`) so lines connect. */
export const COMMIT_ROW_HEIGHT = 26

export interface CommitRowProps {
  commit: Commit
  selected: boolean
  onSelect(commit: Commit): void
  onContextMenu?(commit: Commit, event: React.MouseEvent): void
  /** Right-click on a ref chip; returns whether it opened its own menu. */
  onRefContextMenu?(ref: string, event: React.MouseEvent): boolean
  t: Translate
  row: GraphRow
  geometry: GraphGeometry
  /** Columns the header menu currently shows. */
  columns: CommitColumns
  /** Tooltip text for one ref chip; null leaves it silent. */
  refTooltipOf?(ref: string): string | null
}

export function CommitRow({ commit, selected, onSelect, onContextMenu, onRefContextMenu, t, row, geometry, columns, refTooltipOf }: CommitRowProps): React.ReactElement {
  const isMerge = commit.parents.length > 1
  return (
    <button
      type="button"
      className={cls(`dsh-gitlog-commit${selected ? ' is-selected' : ''}`)}
      aria-pressed={selected}
      onClick={() => onSelect(commit)}
      onContextMenu={event => onContextMenu?.(commit, event)}
    >
      {columns.graph
        ? (
            <span className={cls('dsh-gitlog-graph')} aria-hidden={true}>
              <CommitGraph row={row} geometry={geometry} height={COMMIT_ROW_HEIGHT} />
            </span>
          )
        : null}
      <span className={cls('dsh-gitlog-desc')}>
        <Refs refs={commit.refs} onRefContextMenu={onRefContextMenu} tooltipOf={refTooltipOf} />
        <span className={cls('dsh-gitlog-subject')} {...tooltipProps(commit.subject || t('noSubject'))}>{commit.subject || t('noSubject')}</span>
        {isMerge ? <span className={cls('dsh-gitlog-merge')}>{t('merge')}</span> : null}
      </span>
      {columns.date ? <span className={cls('dsh-gitlog-commit-date')}>{formatDateTime(commit.date, t('localeId'))}</span> : null}
      {columns.author
        ? <span className={cls('dsh-gitlog-commit-author')} {...tooltipProps(`${commit.author} <${commit.email}>`)}>{commit.author}</span>
        : null}
      {columns.hash ? <code className={cls('dsh-gitlog-commit-hash')} {...tooltipProps(commit.hash)}>{commit.shortHash}</code> : null}
    </button>
  )
}

