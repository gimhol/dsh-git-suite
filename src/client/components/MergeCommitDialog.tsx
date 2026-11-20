import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { requestBranchAction, toApiError } from '../lib/api.js'
import type { Commit, Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { toast } from './Toast.js'
import { cls } from '../styles.js'

export interface MergeCommitDialogProps {
  view: GitLogView
  commit: Commit
  t: Translate
  /** Refresh the log, the working tree, and the in-progress operation. */
  onDone(): void
  onClose(): void
}

type MergeMode = 'default' | 'no-ff' | 'ff-only' | 'squash'

/**
 * Merge one commit into the checked-out branch. The merge stays local: the
 * dialog exposes the switches Git users reach for (--no-ff, --ff-only,
 * --squash, --no-commit, --allow-unrelated-histories) and never forces.
 */
export function MergeCommitDialog({ view, commit, t, onDone, onClose }: MergeCommitDialogProps): React.ReactElement {
  const path = view.repo?.repoRoot ?? view.pathInput.trim()
  const branch = view.repo?.branch ?? ''
  const detached = branch === '' || branch === 'detached'
  const branchLabel = detached ? t('detached') : branch
  const [mode, setMode] = useState<MergeMode>('default')
  const [noCommit, setNoCommit] = useState(false)
  const [allowUnrelated, setAllowUnrelated] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Modes in which Git can create a merge commit (message and --no-commit). */
  const mergeCommitMode = mode === 'default' || mode === 'no-ff'
  const target = commit.shortHash

  const chooseMode = (next: MergeMode): void => {
    setMode(next)
    // --ff-only cannot stop before a commit, and --squash stops implicitly.
    if (next === 'ff-only' || next === 'squash') setNoCommit(false)
  }

  const merge = async (): Promise<void> => {
    if (busy || detached) return
    setBusy(true)
    setError(null)
    try {
      await requestBranchAction({
        action: 'merge',
        path,
        target: commit.hash,
        ...(mode === 'no-ff' ? { noFf: true } : {}),
        ...(mode === 'ff-only' ? { ffOnly: true } : {}),
        ...(mode === 'squash' ? { squash: true } : {}),
        ...(mergeCommitMode && noCommit ? { noCommit: true } : {}),
        ...(allowUnrelated ? { allowUnrelated: true } : {}),
        ...(mergeCommitMode && message.trim() !== '' ? { message: message.trim() } : {}),
      })
      if (mode === 'squash') toast(t('mergeSquashDone').replace('{target}', target))
      else if (noCommit) toast(t('mergeStopped').replace('{target}', target))
      else toast(t('mergeDone').replace('{target}', target))
      onDone()
      onClose()
    } catch (failure) {
      const parsed = toApiError(failure)
      // A conflict leaves the merge stopped in the repository; close the
      // dialog so the panel's conflict bar (or the conflicted file list for a
      // squash) can take over.
      if (parsed.code === 'operation-conflict' || parsed.code === 'merge-conflict') {
        onDone()
        onClose()
        toast(
          parsed.code === 'merge-conflict' ? t('mergeSquashConflict') : t('mergeConflictStopped'),
          'error',
        )
        return
      }
      setError(parsed.message)
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('mergeDialogTitle')} t={t} onClose={onClose}>
      <div className={cls('dsh-gitlog-repo-form')}>
        <p className={cls('dsh-gitlog-dialog-target')}>
          <code>{commit.shortHash}</code>
          <span>{commit.subject}</span>
        </p>
        <p className={cls('dsh-gitlog-merge-into')}>
          <span>{t('mergeIntoBranch')}</span>
          <code>{branchLabel}</code>
        </p>
        {detached ? <p className={cls('dsh-gitlog-warning')} role="alert">{t('mergeDetachedWarning')}</p> : null}
        <fieldset className={cls('dsh-gitlog-checkout-options dsh-gitlog-merge-modes')}>
          <legend>{t('mergeMode')}</legend>
          <label className={cls('dsh-gitlog-merge-mode')}>
            <input
              type="radio"
              name="merge-mode"
              checked={mode === 'default'}
              onChange={() => chooseMode('default')}
            />
            <span>{t('mergeModeDefault')}</span>
            <code>--ff</code>
          </label>
          <label className={cls('dsh-gitlog-merge-mode')}>
            <input
              type="radio"
              name="merge-mode"
              checked={mode === 'no-ff'}
              onChange={() => chooseMode('no-ff')}
            />
            <span>{t('mergeModeNoFf')}</span>
            <code>--no-ff</code>
          </label>
          <label className={cls('dsh-gitlog-merge-mode')}>
            <input
              type="radio"
              name="merge-mode"
              checked={mode === 'ff-only'}
              onChange={() => chooseMode('ff-only')}
            />
            <span>{t('mergeModeFfOnly')}</span>
            <code>--ff-only</code>
          </label>
          <label className={cls('dsh-gitlog-merge-mode')}>
            <input
              type="radio"
              name="merge-mode"
              checked={mode === 'squash'}
              onChange={() => chooseMode('squash')}
            />
            <span>{t('mergeModeSquash')}</span>
            <code>--squash</code>
          </label>
        </fieldset>
        {mergeCommitMode
          ? (
              <div className={cls('dsh-gitlog-merge-message')}>
                <label className={cls('dsh-gitlog-field')}>
                  <span>{t('mergeMessage')}</span>
                  <input
                    type="text"
                    value={message}
                    onChange={event => setMessage(event.target.value)}
                    onKeyDown={event => {
                      if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                      event.preventDefault()
                      void merge()
                    }}
                    placeholder={t('mergeMessagePlaceholder')}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </label>
                <p className={cls('dsh-gitlog-merge-hint')}>{t('mergeMessageHint')}</p>
              </div>
            )
          : null}
        <div className={cls('dsh-gitlog-merge-options')}>
          {mergeCommitMode
            ? (
                <label className={cls('dsh-gitlog-check')}>
                  <input
                    type="checkbox"
                    checked={noCommit}
                    onChange={event => setNoCommit(event.target.checked)}
                  />
                  {t('mergeNoCommit')}
                </label>
              )
            : null}
          <label className={cls('dsh-gitlog-check')}>
            <input
              type="checkbox"
              checked={allowUnrelated}
              onChange={event => setAllowUnrelated(event.target.checked)}
            />
            {t('mergeAllowUnrelated')}
          </label>
        </div>
        {mode === 'squash' ? <p className={cls('dsh-gitlog-merge-hint')}>{t('mergeSquashHint')}</p> : null}
        {mergeCommitMode && noCommit ? <p className={cls('dsh-gitlog-merge-hint')}>{t('mergeNoCommitHint')}</p> : null}
        {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
        <DialogActions className={cls('dsh-gitlog-modal-actions')}>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={busy || detached} onClick={() => { void merge() }}>
            {busy ? t('merging') : t('mergeAction')}
          </Button>
        </DialogActions>
      </div>
    </DialogShell>
  )
}
