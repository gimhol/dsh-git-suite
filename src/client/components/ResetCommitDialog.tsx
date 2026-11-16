import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { requestCommitOp, toApiError } from '../lib/api.js'
import type { Commit, Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { cls } from '../styles.js'

export interface ResetCommitDialogProps {
  view: GitLogView
  commit: Commit
  t: Translate
  onDone(): void
  onClose(): void
}

type ResetMode = 'soft' | 'mixed' | 'hard'

/** Move the current branch to a commit, with the three reset modes spelled out. */
export function ResetCommitDialog({ view, commit, t, onDone, onClose }: ResetCommitDialogProps): React.ReactElement {
  const [mode, setMode] = useState<ResetMode>('mixed')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hard = mode === 'hard'

  const apply = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await requestCommitOp({
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        action: 'reset',
        hash: commit.hash,
        mode,
      })
      onDone()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('resetTitle')} t={t} onClose={onClose}>
      <p className={cls('dsh-gitlog-dialog-target')}>
        <code>{commit.shortHash}</code>
        <span>{commit.subject}</span>
      </p>
      <fieldset className={cls('dsh-gitlog-checkout-options')}>
        <legend>{t('resetMode')}</legend>
        <label>
          <input type="radio" name="reset-mode" checked={mode === 'soft'} onChange={() => setMode('soft')} />
          {t('resetSoft')}
        </label>
        <label>
          <input type="radio" name="reset-mode" checked={mode === 'mixed'} onChange={() => setMode('mixed')} />
          {t('resetMixed')}
        </label>
        <label>
          <input type="radio" name="reset-mode" checked={mode === 'hard'} onChange={() => setMode('hard')} />
          {t('resetHard')}
        </label>
      </fieldset>
      {hard ? <p className={cls('dsh-gitlog-warning')} role="alert">{t('resetHardWarning')}</p> : null}
      {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button variant={hard ? 'danger' : 'primary'} disabled={busy} onClick={() => { void apply() }}>
          {busy ? t('resetting') : t('resetAction')}
        </Button>
      </DialogActions>
    </DialogShell>
  )
}
