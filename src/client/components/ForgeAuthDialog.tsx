import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { cls } from '../styles.js'

export interface ForgeAuthPrompt {
  provider: string
  host: string
  remote: string
  /** Repository owner; prefills Gitee's account-name field when it is a user. */
  owner?: string
}

export interface ForgeAuthDialogProps {
  prompt: ForgeAuthPrompt
  busy: boolean
  error: string | null
  t: Translate
  onSubmit(username: string, token: string): void
  onClose(): void
}

/**
 * Asked when the forge answers 401. The token is required; the account name is
 * optional and pre-filled for Gitee, whose git transport needs the real user.
 */
export function ForgeAuthDialog({ prompt, busy, error, t, onSubmit, onClose }: ForgeAuthDialogProps): React.ReactElement {
  const suggested = prompt.provider === 'gitee' && prompt.owner !== undefined && !prompt.owner.includes('/')
    ? prompt.owner
    : ''
  const [username, setUsername] = useState(suggested)
  const [token, setToken] = useState('')
  const ready = token.trim() !== '' && !busy
  const submit = (): void => {
    if (!ready) return
    onSubmit(username.trim(), token.trim())
  }

  return (
    <DialogShell title={t('pullAuthTitle')} t={t} onClose={onClose}>
      <p className={cls('dsh-gitlog-note')}>{t('pullAuthBody').replace('{host}', prompt.host)}</p>
      <div className={cls('dsh-gitlog-credential')}>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('pullAuthUser')}</span>
          <input
            type="text"
            value={username}
            onChange={event => setUsername(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              submit()
            }}
            placeholder={prompt.owner ?? ''}
            autoComplete="username"
            spellCheck={false}
          />
        </label>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('pullAuthToken')}</span>
          <input
            type="password"
            value={token}
            onChange={event => setToken(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              submit()
            }}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        </label>
        <p className={cls('dsh-gitlog-field-hint')}>{t('pullAuthUserHint')}</p>
        <p className={cls('dsh-gitlog-field-hint')}>{t('pullAuthHint')}</p>
      </div>
      {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
      <DialogActions>
        <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="primary" disabled={!ready} onClick={submit}>
          {busy ? t('pullAuthSaving') : t('pullAuthSave')}
        </Button>
      </DialogActions>
    </DialogShell>
  )
}
