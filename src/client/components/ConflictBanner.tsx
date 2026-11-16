import type * as React from 'react'
import { h } from '../runtime.js'
import type { OperationPayload, Translate } from '../types.js'
import { Button } from './Button.js'
import { cls } from '../styles.js'

export interface ConflictBannerProps {
  operation: OperationPayload
  busy: boolean
  t: Translate
  onContinue(): void
  onSkip(): void
  onAbort(): void
}

/**
 * Compact strip while a merge/rebase/cherry-pick/revert is stopped: the
 * conflicted files themselves are listed in the unstaged section.
 */
export function ConflictBanner({
  operation,
  busy,
  t,
  onContinue,
  onSkip,
  onAbort,
}: ConflictBannerProps): React.ReactElement | null {
  if (operation.operation === null) return null
  const name = operation.operation
  const remaining = operation.conflicts.length
  return (
    <div className={cls('dsh-gitlog-conflict')} role="alert">
      <strong>{t('conflictOperation').replace('{operation}', name)}</strong>
      <span className={cls('dsh-gitlog-conflict-count')}>
        {remaining === 0
          ? t('conflictAllResolved')
          : t('conflictFilesCount').replace('{count}', String(remaining))}
      </span>
      <span className={cls('dsh-gitlog-conflict-actions')}>
        <Button disabled={busy} onClick={onContinue}>{t('conflictContinue')}</Button>
        {name === 'merge' ? null : <Button disabled={busy} onClick={onSkip}>{t('conflictSkip')}</Button>}
        <Button variant="danger" disabled={busy} onClick={onAbort}>{t('conflictAbortAction')}</Button>
      </span>
    </div>
  )
}
