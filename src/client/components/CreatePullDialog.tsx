import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { PullsView } from '../hooks/usePulls.js'
import type { Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { Dropdown } from './Dropdown.js'
import { cls } from '../styles.js'

export interface CreatePullDialogProps {
  view: PullsView
  t: Translate
  onClose(): void
}

/** Opens a new pull request from the checked-out branch into a remote base. */
export function CreatePullDialog({ view, t, onClose }: CreatePullDialogProps): React.ReactElement {
  const group = view.remotes.find(item => item.name === view.remote)
  const prefix = `${view.remote}/`
  const branches = [...new Set((group?.branches ?? []).map(branch => (
    branch.name.startsWith(prefix) ? branch.name.slice(prefix.length) : branch.name
  )))].filter(name => name !== view.headBranch).sort()
  if (view.defaultBase !== '' && !branches.includes(view.defaultBase)) branches.unshift(view.defaultBase)

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [base, setBase] = useState(
    view.defaultBase !== '' && branches.includes(view.defaultBase) ? view.defaultBase : branches[0] ?? '',
  )
  const [draft, setDraft] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (busy) return
    const value = title.trim()
    if (value === '') {
      setError(t('pullTitleRequired'))
      return
    }
    if (base === '') {
      setError(t('pullBaseRequired'))
      return
    }
    setBusy(true)
    setError(null)
    const message = await view.createPull({ title: value, body, base, draft })
    if (message === null) {
      onClose()
      return
    }
    setError(message)
    setBusy(false)
  }

  return (
    <DialogShell title={t('pullCreateTitle')} t={t} onClose={onClose}>
      <div className={cls('dsh-gitlog-pull-create')}>
        <div className={cls('dsh-gitlog-pull-create-branches')}>
          <span className={cls('dsh-gitlog-field')}>
            <span>{t('pullCreateHead')}</span>
            <code className={cls('dsh-gitlog-pull-create-head')}>{view.headBranch === '' ? '—' : view.headBranch}</code>
          </span>
          <Dropdown
            className={cls('dsh-gitlog-field grow')}
            value={base}
            options={branches.map(name => ({ value: name, label: name, title: name }))}
            onChange={setBase}
            ariaLabel={t('pullCreateBase')}
            placeholder={t('pullCreateBase')}
            searchable
            searchPlaceholder={t('search')}
            noMatchesLabel={t('noMatches')}
          />
        </div>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('pullCreateTitleLabel')}</span>
          <input
            type="text"
            value={title}
            onChange={event => setTitle(event.target.value)}
            placeholder={t('pullCreateTitlePlaceholder')}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </label>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('pullCreateBody')}</span>
          <textarea
            className={cls('dsh-gitlog-pull-create-body')}
            value={body}
            onChange={event => setBody(event.target.value)}
            placeholder={t('pullCreateBodyPlaceholder')}
            spellCheck={false}
          />
        </label>
        <label className={cls('dsh-gitlog-check')}>
          <input type="checkbox" checked={draft} onChange={event => setDraft(event.target.checked)} />
          {t('pullCreateDraft')}
        </label>
        <p className={cls('dsh-gitlog-field-hint')}>{t('pullCreateHint')}</p>
        {view.headRemote !== '' && view.headRemote !== view.remote
          ? (
              <p className={cls('dsh-gitlog-field-hint')}>
                {t('pullCreateCrossRepo').replace('{head}', view.headRemote).replace('{base}', view.remote)}
              </p>
            )
          : null}
      </div>
      {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
      <DialogActions>
        <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="primary" disabled={busy || base === ''} onClick={() => { void submit() }}>
          {busy ? t('pullCreating') : t('pullCreateAction')}
        </Button>
      </DialogActions>
    </DialogShell>
  )
}
