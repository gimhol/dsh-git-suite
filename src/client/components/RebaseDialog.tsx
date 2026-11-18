import type * as React from 'react'
import { h, useEffect, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { isAbortError, requestBranchAction, requestJson, toApiError } from '../lib/api.js'
import type { Commit, ResolvePayload, Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { CommitRefField } from './CommitRefField.js'
import { DialogShell } from './DialogShell.js'
import { toast } from './Toast.js'
import { cls } from '../styles.js'

export interface RebaseDialogProps {
  view: GitLogView
  t: Translate
  /** Prefilled target, e.g. a commit hash from the commit menu. */
  initialTarget?: string
  onDone(): void
  onClose(): void
}

function headCommit(resolved: ResolvePayload): Commit {
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

/** Rebase the current branch onto any commit, tag, or branch. */
export function RebaseDialog({ view, t, initialTarget = '', onDone, onClose }: RebaseDialogProps): React.ReactElement {
  const path = view.repo?.repoRoot ?? view.pathInput.trim()
  const branch = view.repo?.branch ?? ''
  const [head, setHead] = useState<Commit | null>(null)
  const [target, setTarget] = useState(initialTarget)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    requestJson<ResolvePayload>({ mode: 'resolve', path, ref: 'HEAD' }, controller.signal)
      .then(payload => {
        if (controller.signal.aborted) return
        setHead(headCommit(payload))
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted || isAbortError(failure)) return
        setError(toApiError(failure).message)
      })
    return () => controller.abort()
  }, [path])

  const run = async (): Promise<void> => {
    if (busy || head === null) return
    const desired = target.trim()
    if (desired === '') {
      setError(t('rebaseTargetRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await requestBranchAction({ action: 'rebase-onto', path, target: desired })
      toast(t('rebaseDone'))
      onDone()
      onClose()
    } catch (failure) {
      const parsed = toApiError(failure)
      // A conflict leaves the rebase running; the panel banner takes it from here.
      setError(parsed.message)
      setBusy(false)
      if (parsed.code === 'operation-conflict') onDone()
    }
  }

  if (head === null) {
    return (
      <DialogShell title={t('rebaseOntoTitle')} t={t} onClose={onClose}>
        {error === null
          ? <p className={cls('dsh-gitlog-note')}>{t('loadingCommit')}</p>
          : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
        <DialogActions>
          <Button onClick={onClose}>{t('close')}</Button>
        </DialogActions>
      </DialogShell>
    )
  }

  return (
    <DialogShell title={t('rebaseOntoTitle')} t={t} onClose={onClose}>
      <div className={cls('dsh-gitlog-repo-form')}>
        <p className={cls('dsh-gitlog-dialog-target')}>
          <code>{branch === '' ? 'HEAD' : branch}</code>
          <span>{head.subject}</span>
        </p>
        <CommitRefField
          t={t}
          path={path}
          label={t('rebaseOntoTarget')}
          value={target}
          fallback={head}
          onChange={setTarget}
          onSubmit={() => { void run() }}
        />
        <p className={cls('dsh-gitlog-warning')} role="alert">
          {t('rebaseOntoWarning').replace('{branch}', branch === '' ? 'HEAD' : branch)}
        </p>
        {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
        <DialogActions className={cls('dsh-gitlog-modal-actions')}>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={busy || target.trim() === ''} onClick={() => { void run() }}>
            {busy ? t('rebasing') : t('rebaseOntoAction')}
          </Button>
        </DialogActions>
      </div>
    </DialogShell>
  )
}

