import type * as React from 'react'
import { h, useEffect, useRef } from '../runtime.js'
import type { Selection, Translate } from '../types.js'
import { cls } from '../styles.js'

export type RemoteBranchSelection = Extract<Selection, { kind: 'branch' }>

export interface RemoteBranchMenuState {
  branch: RemoteBranchSelection
  x: number
  y: number
}

export interface RemoteBranchMenuProps {
  context: RemoteBranchMenuState | null
  t: Translate
  onCheckout(branch: RemoteBranchSelection): void
  onMerge(branch: RemoteBranchSelection): void
  onRebase(branch: RemoteBranchSelection): void
  onPull(branch: RemoteBranchSelection): void
  onDelete(branch: RemoteBranchSelection): void
  onClose(): void
}

/** Right-click menu for one remote-tracking branch. */
export function RemoteBranchMenu({
  context,
  t,
  onCheckout,
  onMerge,
  onRebase,
  onPull,
  onDelete,
  onClose,
}: RemoteBranchMenuProps): React.ReactElement | null {
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
  const label = (key: 'remoteBranchCheckout' | 'remoteBranchMerge' | 'remoteBranchRebase' | 'remoteBranchPull' | 'remoteBranchDelete'): string =>
    t(key).replace('{branch}', context.branch.name)
  const left = Math.min(context.x, window.innerWidth - 260)
  const top = Math.min(context.y, window.innerHeight - 200)

  const choose = (action: (branch: RemoteBranchSelection) => void): void => {
    action(context.branch)
    onClose()
  }

  return (
    <div
      ref={menuRef}
      className={cls('dsh-gitlog-commit-menu')}
      style={{ left, top }}
      role="menu"
      aria-label={t('remoteBranchMenu')}
    >
      <button type="button" role="menuitem" onClick={() => choose(onCheckout)}>{label('remoteBranchCheckout')}</button>
      <button type="button" role="menuitem" onClick={() => choose(onMerge)}>{label('remoteBranchMerge')}</button>
      <button type="button" role="menuitem" onClick={() => choose(onRebase)}>{label('remoteBranchRebase')}</button>
      <button type="button" role="menuitem" onClick={() => choose(onPull)}>{label('remoteBranchPull')}</button>
      <button type="button" role="menuitem" className="danger" onClick={() => choose(onDelete)}>{label('remoteBranchDelete')}</button>
    </div>
  )
}
