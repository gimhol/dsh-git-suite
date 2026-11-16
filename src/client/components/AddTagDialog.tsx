import type * as React from 'react'
import { h, useEffect, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { isAbortError, requestJson, requestTag, toApiError } from '../lib/api.js'
import type { Commit, ResolvePayload, Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { CommitRefField } from './CommitRefField.js'
import { DialogShell } from './DialogShell.js'
import { cls } from '../styles.js'

export interface AddTagDialogProps {
  view: GitLogView
  t: Translate
  onClose(): void
}

function commitFrom(resolved: ResolvePayload): Commit {
  return {
    hash: resolved.hash,
    shortHash: resolved.shortHash,
    author: resolved.author,
    email: '',
    date: resolved.date,
    parents: [],
    refs: [],
    subject: resolved.subject,
  }
}

/** Create a new tag on any commit; the start point defaults to HEAD. */
export function AddTagDialog({ view, t, onClose }: AddTagDialogProps): React.ReactElement {
  const path = view.repo?.repoRoot ?? view.pathInput.trim()
  const [head, setHead] = useState<Commit | null>(null)
  const [name, setName] = useState('')
  const [base, setBase] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    requestJson<ResolvePayload>({ mode: 'resolve', path, ref: 'HEAD' }, controller.signal)
      .then(payload => {
        if (controller.signal.aborted) return
        setHead(commitFrom(payload))
        setBase(payload.shortHash)
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted || isAbortError(failure)) return
        setError(toApiError(failure).message)
      })
    return () => controller.abort()
  }, [path])

  const save = async (): Promise<void> => {
    if (busy || head === null) return
    const tag = name.trim()
    if (tag === '') {
      setError(t('tagNameRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const typed = base.trim()
      await requestTag({
        path,
        name: tag,
        ...(typed === '' ? { hash: head.hash } : { base: typed }),
        ...(message.trim() === '' ? {} : { message: message.trim() }),
      })
      view.refresh()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
      setBusy(false)
    }
  }

  if (head === null) {
    return (
      <DialogShell title={t('tagDialogTitle')} t={t} onClose={onClose}>
        {error === null
          ? <p className={cls('dsh-gitlog-note')}>{t('loadingCommit')}</p>
          : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
        <DialogActions className={cls('dsh-gitlog-settings-actions')}>
          <Button onClick={onClose}>{t('close')}</Button>
        </DialogActions>
      </DialogShell>
    )
  }

  return (
    <DialogShell title={t('tagDialogTitle')} t={t} onClose={onClose}>
      <div className={cls('dsh-gitlog-repo-form')}>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('tagName')}</span>
          <input
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              void save()
            }}
            placeholder={t('tagNamePlaceholder')}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </label>
        <CommitRefField
          t={t}
          path={path}
          label={t('commit')}
          value={base}
          fallback={head}
          onChange={setBase}
          onSubmit={() => { void save() }}
        />
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('tagMessage')}</span>
          <textarea
            className={cls('dsh-gitlog-workspace-message')}
            value={message}
            onChange={event => setMessage(event.target.value)}
            placeholder={t('tagMessagePlaceholder')}
            rows={3}
            spellCheck={false}
          />
        </label>
        {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
        <DialogActions className={cls('dsh-gitlog-settings-actions')}>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => { void save() }}>
            {busy ? t('tagSaving') : t('tagSave')}
          </Button>
        </DialogActions>
      </div>
    </DialogShell>
  )
}
