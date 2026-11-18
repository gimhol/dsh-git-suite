import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { requestAction, toApiError } from '../lib/api.js'
import type { Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { cls } from '../styles.js'

export interface IgnoreFileDialogProps {
  view: GitLogView
  /** Repository-relative path, with `/` separators. */
  file: string
  t: Translate
  onDone(): void
  onClose(): void
}

type IgnoreMode = 'file' | 'name' | 'extension'

/** Append one pattern to `.gitignore`: this file, every same-name file, or its extension. */
export function IgnoreFileDialog({ view, file, t, onDone, onClose }: IgnoreFileDialogProps): React.ReactElement {
  const name = file.split('/').pop() ?? file
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot + 1) : ''
  const [mode, setMode] = useState<IgnoreMode>('file')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patternOf = (option: IgnoreMode): string => {
    if (option === 'file') return file
    if (option === 'name') return name
    return extension === '' ? '' : `*.${extension}`
  }

  const save = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await requestAction({
        action: 'ignore',
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        paths: [file],
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
    <DialogShell title={t('ignoreTitle')} t={t} onClose={onClose}>
      <div className={cls('dsh-gitlog-repo-form')}>
        <label className={cls('dsh-gitlog-check')}>
          <input
            type="radio"
            name="gitlog-ignore-mode"
            checked={mode === 'file'}
            onChange={() => setMode('file')}
          />
          {t('ignoreOnlyFile')}
        </label>
        <label className={cls('dsh-gitlog-check')}>
          <input
            type="radio"
            name="gitlog-ignore-mode"
            checked={mode === 'name'}
            onChange={() => setMode('name')}
          />
          {t('ignoreSameName')}
        </label>
        <label className={cls('dsh-gitlog-check')}>
          <input
            type="radio"
            name="gitlog-ignore-mode"
            checked={mode === 'extension'}
            disabled={extension === ''}
            onChange={() => setMode('extension')}
          />
          {extension === '' ? t('ignoreNoExtension') : t('ignoreExtension').replace('{ext}', extension)}
        </label>
        <p className={cls('dsh-gitlog-modal-hint')}>{`${t('ignorePattern')} ${patternOf(mode)}`}</p>
        {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
        <DialogActions className={cls('dsh-gitlog-modal-actions')}>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => { void save() }}>
            {busy ? t('ignoring') : t('ignoreAction')}
          </Button>
        </DialogActions>
      </div>
    </DialogShell>
  )
}
