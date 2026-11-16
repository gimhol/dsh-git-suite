import type * as React from 'react'
import { h } from '../runtime.js'
import type { ApiError } from '../lib/api.js'
import type { Translate } from '../types.js'
import { cls } from '../styles.js'

export interface ErrorStateProps {
  error: ApiError | null
  t: Translate
  onRetry(): void
}

/** A full-panel failure with the error code and, when the host sent one, the offending path. */
export function ErrorState({ error, t, onRetry }: ErrorStateProps): React.ReactElement {
  const code = error?.code
  const title = code === 'not-a-repo'
    ? t('notRepoTitle')
    : code === 'empty-repo'
      ? t('emptyRepoTitle')
      : code === 'invalid-path'
        ? t('invalidPathTitle')
        : code === 'git-missing'
          ? t('gitMissingTitle')
          : t('errorTitle')
  const hint = code === 'not-a-repo'
    ? t('notRepoHint')
    : code === 'empty-repo'
      ? t('emptyRepoHint')
      : code === 'invalid-path'
        ? t('invalidPathHint')
        : code === 'git-missing'
          ? t('gitMissingHint')
          : null
  return (
    <div className={cls('dsh-gitlog-state')}>
      <h2>{title}</h2>
      {hint !== null ? <p>{hint}</p> : null}
      <p className={cls('dsh-gitlog-error-code')}>{`${code ?? 'unknown'}${error?.message ? ` · ${error.message}` : ''}`}</p>
      {error?.details?.path ? <p className={cls('dsh-gitlog-error-code')}>{error.details.path}</p> : null}
      <button type="button" className={cls('dsh-gitlog-btn')} onClick={onRetry}>{t('tryAgain')}</button>
    </div>
  )
}
