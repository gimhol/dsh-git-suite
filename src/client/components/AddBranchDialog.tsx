import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { requestBranch, toApiError } from '../lib/api.js'
import type { Translate } from '../types.js'
import { DialogShell } from './DialogShell.js'
import { Button, DialogActions } from './Button.js'
import { cls } from '../styles.js'

export interface AddBranchDialogProps {
  view: GitLogView
  t: Translate
  onClose(): void
}

/** Create a local branch (`git branch`) from a ref of the open repository. */
export function AddBranchDialog({ view, t, onClose }: AddBranchDialogProps): React.ReactElement {
  const [name, setName] = useState('')
  const [base, setBase] = useState(() => {
    const current = view.tree?.current ?? ''
    return current === '' || current === 'detached' ? '' : current
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async (): Promise<void> => {
    if (busy) return
    const branch = name.trim()
    if (branch === '') {
      setError(t('branchNameRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await requestBranch({
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        name: branch,
        base: base.trim() || 'HEAD',
      })
      view.refresh()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('branchDialogTitle')} t={t} onClose={onClose}>
      <div className={cls('dsh-gitlog-repo-form')}>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('branchName')}</span>
          <input
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              void create()
            }}
            placeholder={t('branchNamePlaceholder')}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </label>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('branchBase')}</span>
          <input
            type="text"
            value={base}
            onChange={event => setBase(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              void create()
            }}
            placeholder="HEAD"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <p className={cls('dsh-gitlog-modal-hint')}>{t('branchBaseHint')}</p>
        {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
        <DialogActions className={cls('dsh-gitlog-modal-actions')}>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => { void create() }}>
            {busy ? t('branchSaving') : t('branchCreate')}
          </Button>
        </DialogActions>
      </div>
    </DialogShell>
  )
}
