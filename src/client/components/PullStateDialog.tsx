import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { PullsView } from '../hooks/usePulls.js'
import type { Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { cls } from '../styles.js'

export type PullStateAction = 'close' | 'reopen'

export interface PullStateDialogProps {
  view: PullsView
  number: number
  action: PullStateAction
  t: Translate
  onClose(): void
}

/** Confirms closing or reopening one pull request on its forge. */
export function PullStateDialog({ view, number, action, t, onClose }: PullStateDialogProps): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = action === 'close'

  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    const message = close
      ? await view.closePull(number)
      : await view.reopenPull(number)
    if (message === null) {
      onClose()
      return
    }
    setError(message)
    setBusy(false)
  }

  return (
    <DialogShell title={close ? t('pullCloseTitle') : t('pullReopenTitle')} t={t} onClose={onClose}>
      <p className={cls('dsh-gitlog-note')}>
        {(close ? t('pullCloseConfirm') : t('pullReopenConfirm')).replace('{number}', String(number))}
      </p>
      <p className={cls('dsh-gitlog-field-hint')}>{close ? t('pullCloseHint') : t('pullReopenHint')}</p>
      {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
      <DialogActions>
        <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
        <Button variant={close ? 'danger' : 'primary'} disabled={busy} onClick={() => { void confirm() }}>
          {busy
            ? (close ? t('pullClosing') : t('pullReopening'))
            : (close ? t('pullCloseAction') : t('pullReopenAction'))}
        </Button>
      </DialogActions>
    </DialogShell>
  )
}
