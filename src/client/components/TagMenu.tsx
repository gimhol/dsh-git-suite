import type * as React from 'react'
import { h, useEffect, useRef } from '../runtime.js'
import type { Selection, Translate } from '../types.js'
import { cls } from '../styles.js'

export type TagSelection = Extract<Selection, { kind: 'tag' }>

export interface TagMenuState {
  tag: TagSelection
  x: number
  y: number
  /** How the tag compares with the remote, when that is already known. */
  status?: 'same' | 'different' | 'local-only'
}

export interface TagMenuProps {
  context: TagMenuState | null
  t: Translate
  onCheckout(tag: TagSelection): void
  onEdit(tag: TagSelection): void
  onPush(tag: TagSelection, force: boolean): void
  onFetchTag(tag: TagSelection): void
  onDelete(tag: TagSelection): void
  onClose(): void
}

/** Right-click menu for one tag: check out, edit, push, delete. */
export function TagMenu({ context, t, onCheckout, onEdit, onPush, onFetchTag, onDelete, onClose }: TagMenuProps): React.ReactElement | null {
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
  const left = Math.min(context.x, window.innerWidth - 260)
  const top = Math.min(context.y, window.innerHeight - 190)

  return (
    <div
      ref={menuRef}
      className={cls('dsh-gitlog-commit-menu')}
      style={{ left, top }}
      role="menu"
      aria-label={t('tagMenu')}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onCheckout(context.tag)
          onClose()
        }}
      >
        {t('tagCheckoutMenu').replace('{tag}', context.tag.name)}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onEdit(context.tag)
          onClose()
        }}
      >
        {t('tagEditMenu').replace('{tag}', context.tag.name)}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onPush(context.tag, false)
          onClose()
        }}
      >
        {t('tagPushMenu').replace('{tag}', context.tag.name)}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onPush(context.tag, true)
          onClose()
        }}
      >
        {t('tagForcePushMenu').replace('{tag}', context.tag.name)}
      </button>
      {context.status === 'different'
        ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onFetchTag(context.tag)
                onClose()
              }}
            >
              {t('tagFetchMenu').replace('{tag}', context.tag.name)}
            </button>
          )
        : null}
      <button
        type="button"
        role="menuitem"
        className="danger"
        onClick={() => {
          onDelete(context.tag)
          onClose()
        }}
      >
        {t('tagDeleteMenu').replace('{tag}', context.tag.name)}
      </button>
    </div>
  )
}
