/**
 * A full-size modal for one review text (AI pull request reviews and similar),
 * so long Markdown can be read while it streams and after it settles.
 */
import type * as React from 'react'
import { h } from '../runtime.js'
import type { Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { LoadingLine } from './States.js'
import { Markdown } from './Markdown.js'
import { cls } from '../styles.js'

export interface ReviewDialogProps {
  title: string
  /** Markdown review body; a partial prefix while {@link loading} is true. */
  text: string
  t: Translate
  /** The review is still streaming. */
  loading?: boolean
  /** Copy/insert stay disabled until the review settles. */
  canCopy?: boolean
  canInsert?: boolean
  /** Tooltip explaining why insert is unavailable (e.g. no session). */
  insertTitle?: string
  onCopy?(): void
  onInsert?(): void
  onClose(): void
}

/** Review Markdown rendered in a large frame with its own scroll area. */
export function ReviewDialog({
  title,
  text,
  t,
  loading = false,
  canCopy = false,
  canInsert = false,
  insertTitle,
  onCopy,
  onInsert,
  onClose,
}: ReviewDialogProps): React.ReactElement {
  return (
    <DialogShell title={title} t={t} frameClassName={cls('dsh-gitlog-review-dialog')} onClose={onClose}>
      {loading ? <LoadingLine label={t('pullAiReviewing')} /> : null}
      <div className={cls('dsh-gitlog-review-dialog-body')}>
        <Markdown text={text} />
      </div>
      <DialogActions>
        <Button disabled={!canCopy || onCopy === undefined} onClick={onCopy}>
          {t('commitReviewCopy')}
        </Button>
        <Button disabled={!canInsert || onInsert === undefined} title={insertTitle} onClick={onInsert}>
          {t('commitReviewInsert')}
        </Button>
        <Button variant="primary" onClick={onClose}>{t('close')}</Button>
      </DialogActions>
    </DialogShell>
  )
}
