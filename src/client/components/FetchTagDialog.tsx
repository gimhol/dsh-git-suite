import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { requestSync, toApiError } from '../lib/api.js'
import type { Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { cls } from '../styles.js'

export interface FetchTagDialogProps {
  view: GitLogView
  /** Tag name to replace locally. */
  tag: string
  remote: string
  t: Translate
  onFetched(): void
  onClose(): void
}

/** Confirmation for replacing a diverged local tag with the remote's version. */
export function FetchTagDialog({ view, tag, remote, t, onFetched, onClose }: FetchTagDialogProps): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await requestSync({
        action: 'fetch-tag',
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        remote,
        tag,
      })
      onFetched()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('fetchTagTitle')} t={t} onClose={onClose}>
      <p className={cls('dsh-gitlog-warning')} role="alert">
        {t('fetchTagConfirm').replace('{tag}', tag).replace('{remote}', remote)}
      </p>
      {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant="danger" disabled={busy} onClick={() => { void confirm() }}>
          {busy ? t('fetchingTag') : t('fetchTagAction')}
        </Button>
      </DialogActions>
    </DialogShell>
  )
}
