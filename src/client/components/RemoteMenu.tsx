import type * as React from 'react'
import { h, useEffect, useRef } from '../runtime.js'
import type { Translate } from '../types.js'
import { cls } from '../styles.js'

export interface RemoteMenuState {
  remote: string
  x: number
  y: number
}

export interface RemoteMenuProps {
  context: RemoteMenuState | null
  t: Translate
  onFetch(remote: string): void
  onPull(remote: string): void
  onPush(remote: string): void
  onEdit(remote: string): void
  onDelete(remote: string): void
  onClose(): void
}

/** Right-click menu for one remote: fetch, pull, push, edit URL, remove. */
export function RemoteMenu({ context, t, onFetch, onPull, onPush, onEdit, onDelete, onClose }: RemoteMenuProps): React.ReactElement | null {
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
  const label = (key: 'remoteFetchMenu' | 'remotePullMenu' | 'remotePushMenu' | 'remoteEditMenu' | 'remoteRemoveMenu'): string =>
    t(key).replace('{remote}', context.remote)
  const left = Math.min(context.x, window.innerWidth - 200)
  const top = Math.min(context.y, window.innerHeight - 190)

  const choose = (action: (remote: string) => void): void => {
    action(context.remote)
    onClose()
  }

  return (
    <div
      ref={menuRef}
      className={cls('dsh-gitlog-commit-menu dsh-gitlog-remote-menu')}
      style={{ left, top }}
      role="menu"
      aria-label={t('remoteMenu')}
    >
      <button type="button" role="menuitem" onClick={() => choose(onFetch)}>{label('remoteFetchMenu')}</button>
      <button type="button" role="menuitem" onClick={() => choose(onPull)}>{label('remotePullMenu')}</button>
      <button type="button" role="menuitem" onClick={() => choose(onPush)}>{label('remotePushMenu')}</button>
      <button type="button" role="menuitem" onClick={() => choose(onEdit)}>{label('remoteEditMenu')}</button>
      <button type="button" role="menuitem" className="danger" onClick={() => choose(onDelete)}>{label('remoteRemoveMenu')}</button>
    </div>
  )
}
