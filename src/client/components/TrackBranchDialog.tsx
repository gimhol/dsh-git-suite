/**
 * Asks for a local name when a remote branch cannot take its default one.
 *
 * `git switch --track -c <name>` refuses to run when `<name>` already exists, and
 * the existing branch may be unrelated to the remote one the user clicked. The
 * host answers such a checkout with `local-branch-exists` plus a free suggestion,
 * so this dialog explains the clash and lets the user confirm or edit that name.
 */
import type * as React from 'react'
import { cls } from '../styles.js'
import { h, useState } from '../runtime.js'
import { requestBranchAction, toApiError } from '../lib/api.js'
import type { Translate } from '../types.js'
import { DialogShell } from './DialogShell.js'
import { Button, DialogActions } from './Button.js'

/** What the host reported about the clashing checkout. */
export interface TrackBranchPrompt {
  /** Repository root the checkout runs in. */
  path: string
  /** Remote-tracking ref being checked out, such as `origin/main`. */
  remoteRef: string
  /** Local branch that already owns the default name. */
  local: string
  /** Upstream of that local branch, empty when it tracks nothing. */
  upstream: string
  /** Free local name the host suggests. */
  suggested: string
}

export interface TrackBranchDialogProps {
  prompt: TrackBranchPrompt
  t: Translate
  onDone(): void
  onClose(): void
}

/** Name the new local branch, then check the remote branch out under it. */
export function TrackBranchDialog({ prompt, t, onDone, onClose }: TrackBranchDialogProps): React.ReactElement {
  const [name, setName] = useState(prompt.suggested)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async (): Promise<void> => {
    if (busy) return
    const local = name.trim()
    if (local === '') {
      setError(t('trackNameRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await requestBranchAction({ action: 'track', path: prompt.path, branch: prompt.remoteRef, newName: local })
      onDone()
    } catch (failure) {
      const api = toApiError(failure)
      setError(
        api.code === 'local-branch-exists' || api.code === 'branch-exists'
          ? t('trackNameTaken')
          : api.code === 'invalid-branch' ? t('trackInvalid') : api.message,
      )
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('trackDialogTitle')} t={t} onClose={onClose}>
      <div className={cls('dsh-gitlog-repo-form')}>
        <p className={cls('dsh-gitlog-note')}>
          {t('trackDialogBody').replace('{local}', prompt.local).replace('{remote}', prompt.remoteRef)}
        </p>
        <p className={cls('dsh-gitlog-settings-hint')}>
          {prompt.upstream === ''
            ? t('trackNoUpstream').replace('{local}', prompt.local)
            : t('trackUpstream').replace('{local}', prompt.local).replace('{upstream}', prompt.upstream)}
        </p>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('trackName')}</span>
          <input
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              void confirm()
            }}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </label>
        {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
        <DialogActions className={cls('dsh-gitlog-settings-actions')}>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => { void confirm() }}>
            {busy ? t('trackCheckingOut') : t('trackCheckout')}
          </Button>
        </DialogActions>
      </div>
    </DialogShell>
  )
}
