import type * as React from 'react'
import { h, useEffect, useRef } from '../runtime.js'
import type { Branch, Translate } from '../types.js'
import { cls } from '../styles.js'

export interface BranchMenuState {
  branch: Branch
  x: number
  y: number
}

export interface BranchMenuProps {
  context: BranchMenuState | null
  t: Translate
  onCheckout(branch: Branch): void
  onMerge(branch: Branch): void
  onRebase(branch: Branch): void
  /** Rebase the current branch onto an arbitrary ref. */
  onRebaseOnto(): void
  onFetch(branch: Branch): void
  onPull(branch: Branch): void
  onPush(branch: Branch): void
  /** Repoint the branch at another remote branch (or at none). */
  onUpstream(branch: Branch): void
  onRename(branch: Branch): void
  onDelete(branch: Branch): void
  onClose(): void
}

/** Right-click menu for one local branch. */
export function BranchMenu({ context, t, onCheckout, onMerge, onRebase, onRebaseOnto, onFetch, onPull, onPush, onUpstream, onRename, onDelete, onClose }: BranchMenuProps): React.ReactElement | null {
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
  const branch = context.branch
  const upstream = branch.upstream ?? ''
  const label = (key: 'branchCheckout' | 'branchMerge' | 'branchRebase' | 'branchRebaseOnto' | 'branchFetch' | 'branchPull' | 'branchPush' | 'branchUpstream' | 'branchRename' | 'branchDelete'): string =>
    t(key).replace('{branch}', branch.name).replace('{upstream}', upstream === '' ? branch.name : upstream)
  const left = Math.min(context.x, window.innerWidth - 250)
  const top = Math.min(context.y, window.innerHeight - 300)
  const choose = (action: (branch: Branch) => void): void => {
    action(branch)
    onClose()
  }

  return (
    <div
      ref={menuRef}
      className={cls('dsh-gitlog-commit-menu dsh-gitlog-branch-menu')}
      style={{ left, top }}
      role="menu"
      aria-label={t('branchMenu')}
    >
      <button type="button" role="menuitem" disabled={branch.current} onClick={() => choose(onCheckout)}>{label('branchCheckout')}</button>
      <button type="button" role="menuitem" disabled={branch.current} onClick={() => choose(onMerge)}>{label('branchMerge')}</button>
      <button type="button" role="menuitem" disabled={branch.current} onClick={() => choose(onRebase)}>{label('branchRebase')}</button>
      {branch.current
        ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onRebaseOnto()
                onClose()
              }}
            >
              {label('branchRebaseOnto')}
            </button>
          )
        : null}
      <div className={cls('dsh-gitlog-menu-separator')} role="separator" />
      <button type="button" role="menuitem" disabled={upstream === ''} onClick={() => choose(onFetch)}>{label('branchFetch')}</button>
      <button type="button" role="menuitem" disabled={upstream === ''} onClick={() => choose(onPull)}>{label('branchPull')}</button>
      <button type="button" role="menuitem" disabled={upstream === ''} onClick={() => choose(onPush)}>{label('branchPush')}</button>
      <button type="button" role="menuitem" onClick={() => choose(onUpstream)}>{label('branchUpstream')}</button>
      <div className={cls('dsh-gitlog-menu-separator')} role="separator" />
      <button type="button" role="menuitem" onClick={() => choose(onRename)}>{label('branchRename')}</button>
      <button type="button" role="menuitem" className="danger" disabled={branch.current} onClick={() => choose(onDelete)}>{label('branchDelete')}</button>
    </div>
  )
}

