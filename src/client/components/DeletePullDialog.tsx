import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { PullsView } from '../hooks/usePulls.js'
import type { Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { cls } from '../styles.js'

export interface DeletePullDialogProps {
  view: PullsView
  number: number
  t: Translate
  onClose(): void
}

/** Permanently deletes a GitLab merge request after an explicit warning. */
export function DeletePullDialog({ view, number, t, onClose }: DeletePullDialogProps): React.ReactElement {
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = view.deleting === number

  const submit = async (): Promise<void> => {
    if (busy || !confirmed) return
    setError(null)
    const result = await view.deletePull(number)
    if (result.ok) {
      onClose()
      return
    }
    if (result.auth) return
    setError(result.message)
  }

  return (
    <DialogShell title={t('pullDeleteTitle')} t={t} onClose={onClose}>
      <p className={cls('dsh-gitlog-note')}>{`#${number}`}</p>
      <p className={cls('dsh-gitlog-danger-text')}>{t('pullDeleteWarning')}</p>
      <p className={cls('dsh-gitlog-field-hint')}>{t('pullDeleteHint')}</p>
      <label className={cls('dsh-gitlog-check')}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={event => setConfirmed(event.target.checked)}
        />
        {t('pullDeleteConfirm')}
      </label>
      {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
      <DialogActions>
        <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
        <Button
          variant="danger"
          disabled={busy || !confirmed}
          onClick={() => { void submit() }}
        >
          {busy ? t('pullDeleting') : t('pullDeleteAction')}
        </Button>
      </DialogActions>
    </DialogShell>
  )
}
