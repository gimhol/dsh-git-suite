import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { AuthPrompt } from '../hooks/useWorkspace.js'
import type { Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { cls } from '../styles.js'

export interface CredentialDialogProps {
  prompt: AuthPrompt
  busy: boolean
  error: string | null
  t: Translate
  onSubmit(username: string, password: string): void
  onClose(): void
}

/**
 * Offered when a push/pull failed on authentication: the credential goes to the
 * repository's credential helper (OS keychain), then the action is retried.
 */
export function CredentialDialog({ prompt, busy, error, t, onSubmit, onClose }: CredentialDialogProps): React.ReactElement {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const ssh = prompt.scheme === 'ssh'
  const noHelper = prompt.helper === null
  const ready = username.trim() !== '' && password !== '' && !busy && !ssh && !noHelper
  const submit = (): void => {
    if (!ready) return
    onSubmit(username.trim(), password)
  }

  return (
    <DialogShell title={t('credentialTitle')} t={t} onClose={onClose}>
      <p className={cls('dsh-gitlog-note')}>{t('credentialBody').replace('{remote}', prompt.remote)}</p>
      {ssh
        ? <p className={cls('dsh-gitlog-note')} role="alert">{t('credentialSsh')}</p>
        : (
            <div className={cls('dsh-gitlog-credential')}>
              <label className={cls('dsh-gitlog-field')}>
                <span>{t('credentialUser')}</span>
                <input
                  type="text"
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  autoComplete="username"
                  spellCheck={false}
                  autoFocus
                />
              </label>
              <label className={cls('dsh-gitlog-field')}>
                <span>{t('credentialSecret')}</span>
                <input
                  type="password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  onKeyDown={event => {
                    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                    event.preventDefault()
                    submit()
                  }}
                  autoComplete="current-password"
                />
              </label>
              <p className={cls('dsh-gitlog-field-hint')}>{t('credentialStoreHint')}</p>
              {noHelper ? <p className={cls('dsh-gitlog-note')} role="alert">{t('credentialNoHelper')}</p> : null}
            </div>
          )}
      {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
      <DialogActions>
        <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
        {ssh || noHelper
          ? null
          : (
              <Button variant="primary" disabled={!ready} onClick={submit}>
                {busy ? t('credentialBusy') : t('credentialSave')}
              </Button>
            )}
      </DialogActions>
    </DialogShell>
  )
}
