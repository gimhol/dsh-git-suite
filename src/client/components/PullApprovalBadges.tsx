import type * as React from 'react'
import { h } from '../runtime.js'
import type { PullApproval, Translate } from '../types.js'
import { cls } from '../styles.js'

export interface PullApprovalBadgesProps {
  approval: PullApproval
  t: Translate
}

function label(state: PullApproval['review'], t: Translate): string {
  if (state === 'passed') return t('pullApprovalPassed')
  if (state === 'partial') return t('pullApprovalPartial')
  if (state === 'pending') return t('pullApprovalPending')
  return t('pullApprovalNone')
}

function tone(state: PullApproval['review']): string {
  if (state === 'passed') return 'passed'
  if (state === 'none') return 'none'
  return 'pending'
}

/** Gitee's separate review and test gates, shown in the detail header. */
export function PullApprovalBadges({ approval, t }: PullApprovalBadgesProps): React.ReactElement {
  return (
    <span className={cls('dsh-gitlog-pull-approval')}>
      <span
        className={cls(`dsh-gitlog-pull-approval-item is-${tone(approval.review)}`)}
        title={`${String(approval.reviewers)} ${t('pullApprovalReview')}`}
      >
        {`${t('pullApprovalReview')}: ${label(approval.review, t)}`}
      </span>
      <span
        className={cls(`dsh-gitlog-pull-approval-item is-${tone(approval.test)}`)}
        title={`${String(approval.testers)} ${t('pullApprovalTest')}`}
      >
        {`${t('pullApprovalTest')}: ${label(approval.test, t)}`}
      </span>
    </span>
  )
}
