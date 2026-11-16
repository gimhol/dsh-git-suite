import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { requestSync, toApiError } from '../lib/api.js'
import type { Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { cls } from '../styles.js'

export interface ForcePushTagDialogProps {
  view: GitLogView
  /** Tag name to overwrite on the remote. */
  tag: string
  remote: string
  t: Translate
  onPushed(): void
  onClose(): void
}

/** Confirmation for the dangerous case: overwriting a published tag on the remote. */
export function ForcePushTagDialog({ view, tag, remote, t, onPushed, onClose }: ForcePushTagDialogProps): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await requestSync({
        action: 'push',
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        remote,
        tagRefs: [tag],
        force: true,
      })
      onPushed()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('forcePushTagTitle')} t={t} onClose={onClose}>
      <p className={cls('dsh-gitlog-warning')} role="alert">
        {t('forcePushTagConfirm').replace('{tag}', tag).replace('{remote}', remote)}
      </p>
      {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant="danger" disabled={busy} onClick={() => { void confirm() }}>
          {busy ? t('forcePushingTag') : t('forcePushTagAction')}
        </Button>
      </DialogActions>
    </DialogShell>
  )
}
