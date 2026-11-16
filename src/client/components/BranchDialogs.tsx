import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { requestBranchAction, toApiError } from '../lib/api.js'
import { selectionAfterHeadChange } from '../lib/selection.js'
import type { Branch, Translate } from '../types.js'
import { DialogShell } from './DialogShell.js'
import { Button, DialogActions } from './Button.js'
import { cls } from '../styles.js'

export interface BranchRenameDialogProps {
  view: GitLogView
  branch: Branch
  t: Translate
  onClose(): void
}

/** Rename one local branch. */
export function BranchRenameDialog({ view, branch, t, onClose }: BranchRenameDialogProps): React.ReactElement {
  const [name, setName] = useState(branch.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const renameBranch = async (): Promise<void> => {
    if (busy) return
    const value = name.trim()
    if (value === '') {
      setError(t('branchNameRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await requestBranchAction({
        action: 'rename',
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        branch: branch.name,
        newName: value,
      })
      view.selectRef(selectionAfterHeadChange(view.selection))
      view.refresh()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('branchRenameTitle')} t={t} onClose={onClose}>
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
              void renameBranch()
            }}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </label>
        {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
        <DialogActions>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => { void renameBranch() }}>
            {busy ? t('branchSaving') : t('branchRenameAction')}
          </Button>
        </DialogActions>
      </div>
    </DialogShell>
  )
}

export interface BranchDeleteDialogProps {
  view: GitLogView
  branch: Branch
  t: Translate
  onClose(): void
}

/** Confirm and delete one local branch. */
export function BranchDeleteDialog({ view, branch, t, onClose }: BranchDeleteDialogProps): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forcePrompt, setForcePrompt] = useState(false)
  const [forceConfirmed, setForceConfirmed] = useState(false)

  const confirm = async (force = false): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await requestBranchAction({
        action: 'delete',
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        branch: branch.name,
        ...(force ? { force: true } : {}),
      })
      view.selectRef(selectionAfterHeadChange(view.selection))
      view.refresh()
      onClose()
    } catch (failure) {
      const message = toApiError(failure).message
      if (!force && /not fully merged/i.test(message)) {
        setForcePrompt(true)
        setError(null)
      } else {
        setError(message)
      }
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('branchDeleteTitle')} t={t} onClose={onClose}>
      <p className={cls('dsh-gitlog-note')}>{t('branchDeleteConfirm').replace('{branch}', branch.name)}</p>
      {forcePrompt
        ? (
            <div className={cls('dsh-gitlog-branch-delete-warning')}>
              <p className={cls('dsh-gitlog-danger-text')}>{t('branchDeleteUnmerged')}</p>
              <label className={cls('dsh-gitlog-check')}>
                <input
                  type="checkbox"
                  checked={forceConfirmed}
                  onChange={event => setForceConfirmed(event.target.checked)}
                />
                {t('branchDeleteForceConfirm')}
              </label>
            </div>
          )
        : null}
      {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        {forcePrompt
          ? (
              <Button
                variant="danger"
                disabled={busy || !forceConfirmed}
                onClick={() => { void confirm(true) }}
              >
                {busy ? t('branchDeleting') : t('branchDeleteForceAction')}
              </Button>
            )
          : (
              <Button variant="danger" disabled={busy} onClick={() => { void confirm() }}>
                {busy ? t('branchDeleting') : t('branchDeleteAction')}
              </Button>
            )}
      </DialogActions>
    </DialogShell>
  )
}
