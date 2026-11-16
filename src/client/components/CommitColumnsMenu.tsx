import type * as React from 'react'
import { h, useEffect, useRef } from '../runtime.js'
import type { CommitColumn, CommitColumns, Translate } from '../types.js'
import { cls } from '../styles.js'

export interface CommitColumnsMenuState {
  x: number
  y: number
}

export interface CommitColumnsMenuProps {
  context: CommitColumnsMenuState | null
  /** What the list actually shows right now. */
  columns: CommitColumns
  /** A narrow panel forces the author and commit columns off. */
  narrow: boolean
  t: Translate
  onToggle(column: CommitColumn): void
  onClose(): void
}

const ORDER: readonly CommitColumn[] = ['graph', 'date', 'author', 'hash']

/** Right-click menu on the log header: which columns the list shows. */
export function CommitColumnsMenu({ context, columns, narrow, t, onToggle, onClose }: CommitColumnsMenuProps): React.ReactElement | null {
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (context === null) return undefined
    const onPointerDown = (event: MouseEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [context, onClose])

  if (context === null) return null
  const label = (column: CommitColumn): string => {
    if (column === 'graph') return t('columnGraph')
    if (column === 'date') return t('columnDate')
    if (column === 'author') return t('columnAuthor')
    return t('columnCommit')
  }
  const left = Math.min(context.x, window.innerWidth - 200)
  const top = Math.min(context.y, window.innerHeight - 160)

  return (
    <div
      ref={menuRef}
      className={cls('dsh-gitlog-commit-menu dsh-gitlog-columns-menu')}
      style={{ left, top }}
      role="menu"
      aria-label={t('columnsMenu')}
    >
      {ORDER.map(column => (
        <button
          key={column}
          type="button"
          role="menuitemcheckbox"
          aria-checked={columns[column]}
          disabled={narrow && (column === 'author' || column === 'hash')}
          onClick={() => onToggle(column)}
        >
          <span className={cls('dsh-gitlog-menu-check')} aria-hidden="true">{columns[column] ? '✓' : ''}</span>
          {label(column)}
        </button>
      ))}
    </div>
  )
}
