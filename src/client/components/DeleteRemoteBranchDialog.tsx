import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { requestBranchAction, toApiError } from '../lib/api.js'
import type { Translate } from '../types.js'
import { DialogShell } from './DialogShell.js'
import { Button, DialogActions } from './Button.js'
import { cls } from '../styles.js'

export interface DeleteRemoteBranchDialogProps {
  view: GitLogView
  remote: string
  branch: string
  t: Translate
  onClose(): void
}

/** Confirmation for deleting one branch on a remote (`git push <remote> --delete`). */
export function DeleteRemoteBranchDialog({ view, remote, branch, t, onClose }: DeleteRemoteBranchDialogProps): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await requestBranchAction({
        action: 'delete-remote',
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        branch,
        remote,
      })
      view.refresh()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('remoteBranchDeleteTitle')} t={t} onClose={onClose}>
      <p className={cls('dsh-gitlog-note')}>
        {t('remoteBranchDeleteConfirm').replace('{branch}', branch).replace('{remote}', remote)}
      </p>
      {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant="danger" disabled={busy} onClick={() => { void confirm() }}>
          {busy ? t('remoteBranchDeleting') : t('branchDeleteAction')}
        </Button>
      </DialogActions>
    </DialogShell>
  )
}
