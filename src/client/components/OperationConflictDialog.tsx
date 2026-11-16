import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { requestCommitOp, toApiError } from '../lib/api.js'
import type { Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { cls } from '../styles.js'

export interface OperationConflictDialogProps {
  view: GitLogView
  /** The git operation that stopped (`cherry-pick`, `revert`, `merge`, or `rebase`). */
  operation: string
  message: string
  t: Translate
  onDone(): void
  onClose(): void
}

/** A cherry-pick/revert stopped with conflicts: the way out is to abort it. */
export function OperationConflictDialog({
  view,
  operation,
  message,
  t,
  onDone,
  onClose,
}: OperationConflictDialogProps): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const abort = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await requestCommitOp({
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        action: 'abort',
      })
      onDone()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('conflictTitle')} t={t} onClose={onClose}>
      <p className={cls('dsh-gitlog-warning')} role="alert">
        {t('conflictBody').replace('{operation}', operation)}
      </p>
      <div className={cls('dsh-gitlog-note')} style={{ whiteSpace: 'pre-wrap' }}>{message}</div>
      {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
      <DialogActions>
        <Button onClick={onClose}>{t('close')}</Button>
        <Button variant="danger" disabled={busy} onClick={() => { void abort() }}>
          {busy ? t('aborting') : t('conflictAbort')}
        </Button>
      </DialogActions>
    </DialogShell>
  )
}
