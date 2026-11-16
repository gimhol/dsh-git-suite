import type * as React from 'react'
import { h, useEffect, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { isAbortError, requestTag, requestTagInfo, toApiError } from '../lib/api.js'
import type { Commit, TagInfoPayload, Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { CommitRefField } from './CommitRefField.js'
import { DialogShell } from './DialogShell.js'
import { cls } from '../styles.js'

export interface EditTagDialogProps {
  view: GitLogView
  /** Current tag name (without `refs/tags/`). */
  tag: string
  t: Translate
  onClose(): void
}

function fallbackCommit(info: TagInfoPayload): Commit {
  return {
    hash: info.hash,
    shortHash: info.shortHash,
    author: '',
    email: '',
    date: '',
    parents: [],
    refs: [],
    subject: info.subject,
  }
}

/** Edit one tag: rename it, move it to another commit, or rewrite its message. */
export function EditTagDialog({ view, tag, t, onClose }: EditTagDialogProps): React.ReactElement {
  const path = view.repo?.repoRoot ?? view.pathInput.trim()
  const [info, setInfo] = useState<TagInfoPayload | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState(tag)
  const [base, setBase] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    requestTagInfo({ path, name: tag }, controller.signal)
      .then(payload => {
        if (controller.signal.aborted) return
        setInfo(payload)
        setBase(payload.shortHash === '' ? payload.hash : payload.shortHash)
        setMessage(payload.message)
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted || isAbortError(failure)) return
        setLoadError(toApiError(failure).message)
      })
    return () => controller.abort()
  }, [path, tag])

  const save = async (): Promise<void> => {
    if (busy || info === null) return
    const nextName = name.trim()
    if (nextName === '') {
      setError(t('tagNameRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const typed = base.trim()
      await requestTag({
        path,
        name: nextName,
        ...(typed === '' || typed === info.shortHash || typed === info.hash
          ? { hash: info.hash }
          : { base: typed }),
        ...(message.trim() === '' ? {} : { message: message.trim() }),
        force: true,
        ...(nextName === info.name ? {} : { previousName: info.name }),
      })
      view.refresh()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
      setBusy(false)
    }
  }

  if (loadError !== null) {
    return (
      <DialogShell title={t('tagEditTitle')} t={t} onClose={onClose}>
        <p className={cls('dsh-gitlog-note')} role="alert">{loadError}</p>
        <DialogActions className={cls('dsh-gitlog-settings-actions')}>
          <Button onClick={onClose}>{t('close')}</Button>
        </DialogActions>
      </DialogShell>
    )
  }

  if (info === null) {
    return (
      <DialogShell title={t('tagEditTitle')} t={t} onClose={onClose}>
        <p className={cls('dsh-gitlog-note')}>{t('loadingCommit')}</p>
      </DialogShell>
    )
  }

  return (
    <DialogShell title={t('tagEditTitle')} t={t} onClose={onClose}>
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
          />
        </label>
        <CommitRefField
          t={t}
          path={path}
          label={t('commit')}
          value={base}
          fallback={fallbackCommit(info)}
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
