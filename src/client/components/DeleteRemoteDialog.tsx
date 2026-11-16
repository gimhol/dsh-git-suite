import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { requestRemoveRemote, toApiError } from '../lib/api.js'
import type { Translate } from '../types.js'
import { DialogShell } from './DialogShell.js'
import { Button, DialogActions } from './Button.js'
import { cls } from '../styles.js'

export interface DeleteRemoteDialogProps {
  view: GitLogView
  remote: string
  t: Translate
  onClose(): void
}

/** Confirmation for removing one configured remote. */
export function DeleteRemoteDialog({ view, remote, t, onClose }: DeleteRemoteDialogProps): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await requestRemoveRemote({
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        name: remote,
      })
      view.refresh()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('remoteRemoveTitle')} t={t} onClose={onClose}>
      <p className={cls('dsh-gitlog-note')}>{t('remoteRemoveConfirm').replace('{remote}', remote)}</p>
      {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant="danger" disabled={busy} onClick={() => { void confirm() }}>
          {busy ? t('removingRemote') : t('removeRemote')}
        </Button>
      </DialogActions>
    </DialogShell>
  )
}
