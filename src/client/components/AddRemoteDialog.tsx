import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { requestAddRemote, toApiError } from '../lib/api.js'
import type { Translate } from '../types.js'
import { DialogShell } from './DialogShell.js'
import { Button, DialogActions } from './Button.js'
import { cls } from '../styles.js'

export interface AddRemoteDialogProps {
  view: GitLogView
  t: Translate
  onClose(): void
}

/** Add one remote (`git remote add`) to the open repository. */
export function AddRemoteDialog({ view, t, onClose }: AddRemoteDialogProps): React.ReactElement {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const add = async (): Promise<void> => {
    if (busy) return
    const remoteName = name.trim()
    const remoteUrl = url.trim()
    if (remoteName === '') {
      setError(t('remoteNameRequired'))
      return
    }
    if (remoteUrl === '') {
      setError(t('remoteUrlRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await requestAddRemote({
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        name: remoteName,
        url: remoteUrl,
      })
      view.refresh()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('addRemoteTitle')} t={t} onClose={onClose}>
      <div className={cls('dsh-gitlog-repo-form')}>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('remoteName')}</span>
          <input
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              void add()
            }}
            placeholder={t('remoteNamePlaceholder')}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </label>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('remoteUrl')}</span>
          <input
            type="text"
            value={url}
            onChange={event => setUrl(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              void add()
            }}
            placeholder={t('remoteUrlPlaceholder')}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
        <DialogActions className={cls('dsh-gitlog-modal-actions')}>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => { void add() }}>
            {busy ? t('addingRemote') : t('addRemoteAction')}
          </Button>
        </DialogActions>
      </div>
    </DialogShell>
  )
}
