import type * as React from 'react'
import { h } from '../runtime.js'
import type { PullChecks, Translate } from '../types.js'
import { cls } from '../styles.js'

export interface PullChecksBadgeProps {
  checks: PullChecks | null | undefined
  t: Translate
}

/** A small CI rollup badge; links to the forge's checks page when available. */
export function PullChecksBadge({ checks, t }: PullChecksBadgeProps): React.ReactElement | null {
  if (checks == null) return null
  const label = checks.state === 'success'
    ? t('pullChecksSuccess')
    : checks.state === 'failure'
      ? t('pullChecksFailure')
      : checks.state === 'pending'
        ? t('pullChecksPending')
        : checks.state === 'neutral'
          ? t('pullChecksNeutral')
          : t('pullChecksUnknown')
  const content = (
    <span className={cls(`dsh-gitlog-pull-checks is-${checks.state}`)}>
      {checks.total > 1 ? `${label} (${checks.total})` : label}
    </span>
  )
  if (checks.url === null || !/^https?:\/\//i.test(checks.url)) return content
  return (
    <a
      className={cls('dsh-gitlog-pull-checks-link')}
      href={checks.url}
      target="_blank"
      rel="noreferrer noopener"
      title={checks.url}
    >
      {content}
    </a>
  )
}
