import type * as React from 'react'
import { h, useEffect, useRef, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { requestBranch, requestCheckout, requestCommitOp, requestTag, toApiError } from '../lib/api.js'
import { selectionAfterHeadChange } from '../lib/selection.js'
import type { Branch, Commit, Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { CommitRefField } from './CommitRefField.js'
import { DialogShell } from './DialogShell.js'
import { MergeCommitDialog } from './MergeCommitDialog.js'
import { OperationConflictDialog } from './OperationConflictDialog.js'
import { ReflogDialog } from './ReflogDialog.js'
import { ResetCommitDialog } from './ResetCommitDialog.js'
import { toast } from './Toast.js'
import { cls } from '../styles.js'

export interface CommitContext {
  commit: Commit
  x: number
  y: number
}

interface CommitDialogProps {
  view: GitLogView
  commit: Commit
  t: Translate
  onClose(): void
}

function sameHash(left: string, right: string): boolean {
  if (left === '' || right === '') return false
  return left.startsWith(right) || right.startsWith(left)
}

function localBranchesAt(view: GitLogView, commit: Commit): Branch[] {
  return (view.tree?.branches ?? []).filter(branch => branch.kind === 'local' && sameHash(branch.hash, commit.hash))
}

function repoPath(view: GitLogView): string {
  return view.repo?.repoRoot ?? view.pathInput.trim()
}

function CommitTarget({ commit }: { commit: Commit }): React.ReactElement {
  return (
    <p className={cls('dsh-gitlog-dialog-target')}>
      <code>{commit.shortHash}</code>
      <span>{commit.subject}</span>
    </p>
  )
}

function TagDialog({ view, commit, t, onClose }: CommitDialogProps): React.ReactElement {
  const existing = commit.refs.filter(ref => ref.startsWith('tag: ')).map(ref => ref.slice(5))
  const path = repoPath(view)
  const [name, setName] = useState(existing[0] ?? '')
  const [base, setBase] = useState(commit.shortHash)
  const [message, setMessage] = useState('')
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const saveTag = async (): Promise<void> => {
    if (busy) return
    const tag = name.trim()
    if (tag === '') {
      setError(t('tagNameRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await requestTag({
        path,
        // The clicked commit is the default; any typed ref wins.
        ...(base.trim() === '' ? { hash: commit.hash } : { base: base.trim() }),
        name: tag,
        ...(message.trim() === '' ? {} : { message: message.trim() }),
        force,
      })
      view.refresh()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('tagDialogTitle')} t={t} onClose={onClose}>
      <div className={cls('dsh-gitlog-repo-form')}>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('tagName')}</span>
          <input
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              void saveTag()
            }}
            placeholder={t('tagNamePlaceholder')}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </label>
        <CommitRefField
          t={t}
          path={path}
          label={t('commit')}
          value={base}
          fallback={commit}
          onChange={setBase}
          onSubmit={() => { void saveTag() }}
        />
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('tagMessage')}</span>
          <textarea
            className={cls('dsh-gitlog-workspace-message')}
            value={message}
            onChange={event => setMessage(event.target.value)}
            placeholder={t('tagMessagePlaceholder')}
            rows={3}
            spellCheck={false}
          />
        </label>
        <label className={cls('dsh-gitlog-check')}>
          <input
            type="checkbox"
            checked={force}
            onChange={event => setForce(event.target.checked)}
          />
          {t('tagForce')}
        </label>
        {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
        <DialogActions className={cls('dsh-gitlog-modal-actions')}>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => { void saveTag() }}>
            {busy ? t('tagSaving') : t('tagSave')}
          </Button>
        </DialogActions>
      </div>
    </DialogShell>
  )
}

function BranchDialog({ view, commit, t, onClose }: CommitDialogProps): React.ReactElement {
  const path = repoPath(view)
  const [name, setName] = useState('')
  const [base, setBase] = useState(commit.shortHash)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createBranch = async (): Promise<void> => {
    if (busy) return
    const branch = name.trim()
    if (branch === '') {
      setError(t('branchNameRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      // The typed start point wins; the clicked commit is only the default.
      await requestBranch({
        path,
        name: branch,
        base: base.trim() === '' ? commit.hash : base.trim(),
      })
      view.refresh()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('branchDialogTitle')} t={t} onClose={onClose}>
      <div className={cls('dsh-gitlog-repo-form')}>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('branchName')}</span>
          <input
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              void createBranch()
            }}
            placeholder={t('branchNamePlaceholder')}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </label>
        <CommitRefField
          t={t}
          path={path}
          label={t('branchBase')}
          value={base}
          fallback={commit}
          onChange={setBase}
          onSubmit={() => { void createBranch() }}
        />
        {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
        <DialogActions className={cls('dsh-gitlog-modal-actions')}>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => { void createBranch() }}>
            {busy ? t('branchSaving') : t('branchCreate')}
          </Button>
        </DialogActions>
      </div>
    </DialogShell>
  )
}

function CheckoutDialog({ view, commit, t, onClose }: CommitDialogProps): React.ReactElement {
  const branches = localBranchesAt(view, commit)
  const [target, setTarget] = useState(branches[0]?.name ?? 'detached')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const detached = target === 'detached'

  const confirmCheckout = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await requestCheckout({
        path: repoPath(view),
        ...(detached ? { hash: commit.hash } : { branch: target }),
      })
      // Keep an "all branches" scope; otherwise follow the new HEAD.
      view.selectRef(selectionAfterHeadChange(view.selection))
      view.refresh()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('checkoutDialogTitle')} t={t} onClose={onClose}>
      <div className={cls('dsh-gitlog-repo-form')}>
        <CommitTarget commit={commit} />
        <fieldset className={cls('dsh-gitlog-checkout-options')}>
          <legend>{t('checkoutTarget')}</legend>
          <label>
            <input
              type="radio"
              name="checkout-target"
              checked={detached}
              onChange={() => setTarget('detached')}
            />
            {t('checkoutDetached')}
          </label>
          {branches.map(branch => (
            <label key={branch.name}>
              <input
                type="radio"
                name="checkout-target"
                checked={target === branch.name}
                onChange={() => setTarget(branch.name)}
              />
              {t('checkoutBranch')} <code>{branch.name}</code>
            </label>
          ))}
        </fieldset>
        <p className={cls('dsh-gitlog-warning')} role="alert">
          {detached
            ? t('checkoutWarningDetached')
            : t('checkoutWarningBranch').replace('{name}', target)}
        </p>
        {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
        <DialogActions className={cls('dsh-gitlog-modal-actions')}>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => { void confirmCheckout() }}>
            {busy ? t('checkingOut') : t('checkoutConfirm')}
          </Button>
        </DialogActions>
      </div>
    </DialogShell>
  )
}

/** Right-click menu for a commit: tag, branch, checkout, merge, pick/revert/reset, reflog. */
export function CommitActions({ view, context, t, onClose, onChanged, onRebaseOnto }: {
  view: GitLogView
  context: CommitContext | null
  t: Translate
  onClose(): void
  /** Rebase the current branch onto this commit (opens the shared dialog). */
  onRebaseOnto?(target: string): void
  /** Also refresh the working tree, which reset and pick/revert can touch. */
  onChanged?(): void
}): React.ReactElement | null {
  const [dialog, setDialog] = useState<'tag' | 'branch' | 'checkout' | 'merge' | 'reset' | 'reflog' | null>(null)
  const [busy, setBusy] = useState<'cherry-pick' | 'revert' | null>(null)
  const [conflict, setConflict] = useState<{ operation: string; message: string } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const close = (): void => {
    setDialog(null)
    setConflict(null)
    onClose()
  }

  const done = (): void => {
    view.refresh()
    onChanged?.()
  }

  useEffect(() => {
    if (context === null || dialog !== null) return undefined
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
  }, [context, dialog, onClose])

  if (context === null) return null
  const { commit } = context

  const run = async (action: 'cherry-pick' | 'revert'): Promise<void> => {
    if (busy !== null) return
    setBusy(action)
    try {
      await requestCommitOp({ path: repoPath(view), action, hash: commit.hash })
      done()
      toast(action === 'cherry-pick' ? t('cherryPickDone') : t('revertDone'))
      onClose()
    } catch (error) {
      const failure = toApiError(error)
      const operation = failure.details?.operation
      if (failure.code === 'operation-conflict') {
        setConflict({
          operation: typeof operation === 'string' ? operation : action,
          message: failure.message,
        })
      } else {
        toast(failure.message, 'error')
      }
    } finally {
      setBusy(null)
    }
  }

  if (conflict !== null) {
    return (
      <OperationConflictDialog
        view={view}
        operation={conflict.operation}
        message={conflict.message}
        t={t}
        onDone={done}
        onClose={close}
      />
    )
  }

  if (dialog === 'tag') return <TagDialog view={view} commit={commit} t={t} onClose={close} />
  if (dialog === 'branch') return <BranchDialog view={view} commit={commit} t={t} onClose={close} />
  if (dialog === 'checkout') return <CheckoutDialog view={view} commit={commit} t={t} onClose={close} />
  if (dialog === 'merge') return <MergeCommitDialog view={view} commit={commit} t={t} onDone={done} onClose={close} />
  if (dialog === 'reset') {
    return <ResetCommitDialog view={view} commit={commit} t={t} onDone={done} onClose={close} />
  }
  if (dialog === 'reflog') return <ReflogDialog view={view} t={t} onDone={done} onClose={close} />

  const left = Math.min(context.x, window.innerWidth - 200)
  const top = Math.min(context.y, window.innerHeight - 270)
  return (
    <div
      ref={menuRef}
      className={cls('dsh-gitlog-commit-menu')}
      style={{ left, top }}
      role="menu"
      aria-label={t('commitMenu')}
    >
      <button type="button" role="menuitem" onClick={() => setDialog('tag')}>{t('commitTag')}</button>
      <button type="button" role="menuitem" onClick={() => setDialog('branch')}>{t('commitBranch')}</button>
      <button type="button" role="menuitem" onClick={() => setDialog('checkout')}>{t('commitCheckout')}</button>
      <button type="button" role="menuitem" onClick={() => setDialog('merge')}>{t('commitMerge')}</button>
      <button type="button" role="menuitem" onClick={() => { void run('cherry-pick') }}>{t('commitCherryPick')}</button>
      <button type="button" role="menuitem" onClick={() => { void run('revert') }}>{t('commitRevert')}</button>
      <button type="button" role="menuitem" onClick={() => setDialog('reset')}>{t('commitReset')}</button>
      {onRebaseOnto === undefined
        ? null
        : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const target = commit.hash
                onClose()
                onRebaseOnto(target)
              }}
            >
              {t('commitRebaseOnto')}
            </button>
          )}
      <button type="button" role="menuitem" onClick={() => setDialog('reflog')}>{t('commitReflog')}</button>
    </div>
  )
}

