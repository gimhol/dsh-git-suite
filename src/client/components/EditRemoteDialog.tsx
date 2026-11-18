import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { requestSetRemoteUrl, toApiError } from '../lib/api.js'
import type { Translate } from '../types.js'
import { DialogShell } from './DialogShell.js'
import { Button, DialogActions } from './Button.js'
import { cls } from '../styles.js'

export interface EditRemoteDialogProps {
  view: GitLogView
  remote: string
  url: string
  t: Translate
  onClose(): void
}

/** Rename a remote and/or replace its URL (`git remote rename` + `remote set-url`). */
export function EditRemoteDialog({ view, remote, url: initialUrl, t, onClose }: EditRemoteDialogProps): React.ReactElement {
  const [name, setName] = useState(remote)
  const [url, setUrl] = useState(initialUrl)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    if (busy) return
    const nextName = name.trim()
    const nextUrl = url.trim()
    if (nextName === '') {
      setError(t('remoteNameRequired'))
      return
    }
    if (nextUrl === '') {
      setError(t('remoteUrlRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await requestSetRemoteUrl({
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        name: remote,
        url: nextUrl,
        ...(nextName === remote ? {} : { newName: nextName }),
      })
      view.refresh()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('remoteEditTitle')} t={t} onClose={onClose}>
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
              void save()
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
              void save()
            }}
            placeholder={t('remoteUrlPlaceholder')}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
        <DialogActions className={cls('dsh-gitlog-modal-actions')}>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => { void save() }}>
            {busy ? t('savingRemoteUrl') : t('saveRemoteUrl')}
          </Button>
        </DialogActions>
      </div>
    </DialogShell>
  )
}
