import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import type { WorkspaceView } from '../hooks/useWorkspace.js'
import { requestStash, toApiError } from '../lib/api.js'
import type { Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { toast } from './Toast.js'
import { cls } from '../styles.js'

export interface StashCreateDialogProps {
  view: GitLogView
  ws: WorkspaceView
  t: Translate
  onClose(): void
}

/** `git stash push` with an optional message and untracked files. */
export function StashCreateDialog({ view, ws, t, onClose }: StashCreateDialogProps): React.ReactElement {
  const [message, setMessage] = useState('')
  const [includeUntracked, setIncludeUntracked] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const payload = await requestStash({
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        action: 'save',
        message: message.trim(),
        includeUntracked,
      })
      ws.refresh()
      view.refresh()
      toast(t('stashSaved').replace('{ref}', payload.ref ?? 'stash@{0}'))
      onClose()
    } catch (failure) {
      const parsed = toApiError(failure)
      setError(parsed.code === 'nothing-to-stash' ? t('stashNothing') : parsed.message)
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('stashCreateTitle')} t={t} onClose={onClose}>
      <div className={cls('dsh-gitlog-repo-form')}>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('stashMessage')}</span>
          <input
            type="text"
            value={message}
            onChange={event => setMessage(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              void save()
            }}
            placeholder={t('stashMessagePlaceholder')}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </label>
        <label className={cls('dsh-gitlog-check')}>
          <input
            type="checkbox"
            checked={includeUntracked}
            onChange={event => setIncludeUntracked(event.target.checked)}
          />
          {t('stashIncludeUntracked')}
        </label>
        <p className={cls('dsh-gitlog-settings-hint')}>{t('stashHint')}</p>
        {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
        <DialogActions className={cls('dsh-gitlog-settings-actions')}>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => { void save() }}>
            {busy ? t('stashSaving') : t('stashSave')}
          </Button>
        </DialogActions>
      </div>
    </DialogShell>
  )
}
