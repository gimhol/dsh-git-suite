import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { PullsView } from '../hooks/usePulls.js'
import type { PullDetail, Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { Dropdown } from './Dropdown.js'
import { PullChecksBadge } from './PullChecksBadge.js'
import { PullApprovalBadges } from './PullApprovalBadges.js'
import { PullReviewBadge } from './PullReviewBadge.js'
import { cls } from '../styles.js'

export interface MergePullDialogProps {
  view: PullsView
  pull: PullDetail
  t: Translate
  onClose(): void
}

/** Merges the selected request with a method and optional branch deletion. */
export function MergePullDialog({ view, pull, t, onClose }: MergePullDialogProps): React.ReactElement {
  const provider = view.remotes.find(item => item.name === view.remote)?.forge?.provider ?? ''
  const forge = view.remotes.find(item => item.name === view.remote)?.forge ?? null
  const repo = forge === null ? '' : `${forge.owner}/${forge.repo}`
  const webUrl = /^https?:\/\//i.test(pull.webUrl) ? pull.webUrl : ''
  const methods: Array<'merge' | 'squash' | 'rebase'> = provider === 'github'
    ? ['merge', 'squash', 'rebase']
    : ['merge', 'squash']
  const [method, setMethod] = useState<'merge' | 'squash' | 'rebase'>('merge')
  const [deleteSourceBranch, setDeleteSourceBranch] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [approvalError, setApprovalError] = useState<string | null>(null)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const current = view.detail?.number === pull.number ? view.detail : pull
  const blocked = current.mergeable === false
  const failing = current.checks?.state === 'failure'
  const approvalBusy = busy || view.merging !== null || view.giteeDecision !== null
  const mergeBusy = approvalBusy || blocked || refreshFailed

  const approve = async (action: 'review' | 'test'): Promise<void> => {
    if (approvalBusy) return
    setApprovalError(null)
    setRefreshFailed(false)
    const result = await view.decideGitee(action, current.number)
    if (result.ok) {
      if (result.warning !== undefined) {
        setApprovalError(result.warning)
        setRefreshFailed(true)
      }
      return
    }
    if (!result.auth) setApprovalError(result.message)
  }

  const submit = async (): Promise<void> => {
    if (mergeBusy) return
    setBusy(true)
    setError(null)
    const message = await view.mergePull({ method, deleteSourceBranch })
    if (message === null) {
      onClose()
      return
    }
    setError(message)
    setBusy(false)
  }

  return (
    <DialogShell title={t('pullMergeTitle')} t={t} onClose={onClose}>
      <div className={cls('dsh-gitlog-pull-merge')}>
        <p className={cls('dsh-gitlog-note')}>{`${repo === '' ? '' : `${repo} · `}#${pull.number} · ${pull.title}`}</p>
        <div className={cls('dsh-gitlog-pull-merge-meta')}>
          <PullChecksBadge checks={current.checks} t={t} />
          <PullReviewBadge review={current.review ?? null} t={t} />
          {current.approval === undefined || current.approval === null
            ? null
            : <PullApprovalBadges approval={current.approval} t={t} />}
          {blocked ? <span className={cls('dsh-gitlog-pull-merge-warning')}>{t('pullMergeBlocked')}</span> : null}
          {failing ? <span className={cls('dsh-gitlog-pull-merge-warning')}>{t('pullMergeChecksFailing')}</span> : null}
        </div>
        {provider === 'gitee'
          ? (
              <div className={cls('dsh-gitlog-merge-approvals')}>
                <p className={cls('dsh-gitlog-field-hint')}>{t('pullGiteeApprovalsHint')}</p>
                <div className={cls('dsh-gitlog-merge-approval-actions')}>
                  <Button
                    loading={view.giteeDecision === 'review'}
                    disabled={approvalBusy}
                    onClick={() => { void approve('review') }}
                  >
                    {t('pullGiteeReview')}
                  </Button>
                  <Button
                    loading={view.giteeDecision === 'test'}
                    disabled={approvalBusy}
                    onClick={() => { void approve('test') }}
                  >
                    {t('pullGiteeTest')}
                  </Button>
                </div>
                {approvalError === null
                  ? null
                  : <p className={cls('dsh-gitlog-note')} role="alert">{approvalError}</p>}
                {view.giteeDecision === null
                  ? null
                  : <p className={cls('dsh-gitlog-field-hint')}>{t('pullGiteeApprovalRunning')}</p>}
              </div>
            )
          : null}
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('pullMergeMethod')}</span>
          <Dropdown
            value={method}
            options={methods.map(value => ({
              value,
              label: value === 'merge'
                ? t('pullMergeMethodMerge')
                : value === 'squash'
                  ? t('pullMergeMethodSquash')
                  : t('pullMergeMethodRebase'),
            }))}
            onChange={value => setMethod(value as 'merge' | 'squash' | 'rebase')}
            ariaLabel={t('pullMergeMethod')}
          />
        </label>
        <label className={cls('dsh-gitlog-check')}>
          <input
            type="checkbox"
            checked={deleteSourceBranch}
            onChange={event => setDeleteSourceBranch(event.target.checked)}
          />
          {t('pullMergeDeleteBranch')}
        </label>
        <p className={cls('dsh-gitlog-field-hint')}>{t('pullMergeHint')}</p>
        {webUrl === ''
          ? null
          : (
              <p className={cls('dsh-gitlog-field-hint')}>
                <a href={webUrl} target="_blank" rel="noreferrer noopener">{t('pullOpenBrowser')}</a>
              </p>
            )}
      </div>
      {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
      <DialogActions>
        <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
        <Button
          variant="primary"
          disabled={mergeBusy}
          onClick={() => { void submit() }}
        >
          {busy ? t('pullMerging') : t('pullMergeAction')}
        </Button>
      </DialogActions>
    </DialogShell>
  )
}
