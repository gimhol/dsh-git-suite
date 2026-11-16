import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { requestTag, toApiError } from '../lib/api.js'
import type { Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { cls } from '../styles.js'

export interface DeleteTagDialogProps {
  view: GitLogView
  tag: string
  t: Translate
  onClose(): void
}

/** Confirmation for deleting one local tag. */
export function DeleteTagDialog({ view, tag, t, onClose }: DeleteTagDialogProps): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await requestTag({
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        action: 'delete',
        name: tag,
      })
      view.refresh()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('tagDeleteTitle')} t={t} onClose={onClose}>
      <p className={cls('dsh-gitlog-note')}>{t('tagDeleteConfirm').replace('{tag}', tag)}</p>
      {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant="danger" disabled={busy} onClick={() => { void confirm() }}>
          {busy ? t('tagDeleting') : t('tagDeleteAction')}
        </Button>
      </DialogActions>
    </DialogShell>
  )
}
