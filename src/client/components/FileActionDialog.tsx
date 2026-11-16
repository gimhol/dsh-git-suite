import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { requestAction, toApiError } from '../lib/api.js'
import type { Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { cls } from '../styles.js'

export interface FileActionDialogProps {
  view: GitLogView
  file: string
  /** `discard` restores an unstaged change; `delete` removes an untracked file. */
  action: 'discard' | 'delete'
  t: Translate
  onDone(): void
  onClose(): void
}

/** Confirmation for the two destructive per-file working-tree actions. */
export function FileActionDialog({ view, file, action, t, onDone, onClose }: FileActionDialogProps): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const discard = action === 'discard'

  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await requestAction({
        action,
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        paths: [file],
      })
      onDone()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
      setBusy(false)
    }
  }

  return (
    <DialogShell title={discard ? t('discardTitle') : t('deleteFileTitle')} t={t} onClose={onClose}>
      <p className={cls('dsh-gitlog-warning')} role="alert">
        {(discard ? t('discardConfirm') : t('deleteFileConfirm')).replace('{file}', file)}
      </p>
      {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant="danger" disabled={busy} onClick={() => { void confirm() }}>
          {busy ? (discard ? t('discarding') : t('deletingFile')) : (discard ? t('discardAction') : t('deleteFileAction'))}
        </Button>
      </DialogActions>
    </DialogShell>
  )
}
