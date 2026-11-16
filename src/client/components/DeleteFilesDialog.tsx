/**
 * Confirmation for deleting several untracked files at once.
 *
 * The host validates every path again (the file must still be untracked and on
 * disk), so this dialog only collects the selection and reports the outcome.
 */
import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { requestAction, toApiError } from '../lib/api.js'
import type { Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { cls } from '../styles.js'

/** Paths listed before the dialog collapses the rest into a counter. */
const VISIBLE_PATHS = 8

export interface DeleteFilesDialogProps {
  view: GitLogView
  /** Repository-relative paths of the untracked files to remove. */
  files: readonly string[]
  t: Translate
  onDone(): void
  onClose(): void
}

/** Confirmation for deleting several untracked files in one request. */
export function DeleteFilesDialog({ view, files, t, onDone, onClose }: DeleteFilesDialogProps): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await requestAction({
        action: 'delete',
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        paths: [...files],
      })
      onDone()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('deleteFilesTitle')} t={t} onClose={onClose}>
      <p className={cls('dsh-gitlog-warning')} role="alert">
        {t('deleteFilesConfirm').replace('{count}', String(files.length))}
      </p>
      <ul className={cls('dsh-gitlog-delete-list')}>
        {files.slice(0, VISIBLE_PATHS).map(file => <li key={file}>{file}</li>)}
        {files.length > VISIBLE_PATHS
          ? <li>{`… +${files.length - VISIBLE_PATHS}`}</li>
          : null}
      </ul>
      {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant="danger" disabled={busy} onClick={() => { void confirm() }}>
          {busy ? t('deletingFile') : t('deleteFileAction')}
        </Button>
      </DialogActions>
    </DialogShell>
  )
}
