import type * as React from 'react'
import { h } from '../runtime.js'
import type { PullReview, Translate } from '../types.js'
import { cls } from '../styles.js'

export interface PullReviewBadgeProps {
  review: PullReview | null | undefined
  t: Translate
}

/** Read-only review summary; hidden when the forge has no review data. */
export function PullReviewBadge({ review, t }: PullReviewBadgeProps): React.ReactElement | null {
  if (review == null || review.state === 'none') return null
  const label = review.state === 'approved'
    ? t('pullReviewApproved')
    : review.state === 'changes_requested'
      ? t('pullReviewChanges')
      : t('pullReviewPending')
  const count = review.state === 'approved'
    ? review.approvals
    : review.state === 'changes_requested'
      ? review.changesRequested
      : 0
  return (
    <span className={cls(`dsh-gitlog-pull-review is-${review.state}`)}>
      {count > 0 ? `${label} (${count})` : label}
    </span>
  )
}
