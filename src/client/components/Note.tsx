/**
 * One status or error line with its own close button.
 *
 * Results of push/pull/fetch, a commit, or a rejected branch action used to stay
 * on screen until the next action of the same kind, so a reader had no way to
 * clear the line. Every such message is dismissible now, and the success ones
 * also fade out on their own.
 */
import type * as React from 'react'
import { h } from '../runtime.js'
import { cls } from '../styles.js'

export interface NoteProps {
  /** Message to show; an empty message renders nothing. */
  text: string
  /** Accessible label and tooltip for the close button. */
  closeLabel: string
  /** Errors use the alert role and the error colour. */
  tone?: 'info' | 'error'
  onDismiss: () => void
}

export function Note({ text, closeLabel, tone = 'info', onDismiss }: NoteProps): React.ReactElement | null {
  if (text.trim() === '') return null
  return (
    <p
      className={cls(`dsh-gitlog-note is-dismissible${tone === 'error' ? ' is-error' : ''}`)}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span className={cls('dsh-gitlog-note-text')}>{text}</span>
      <button
        type="button"
        className={cls('dsh-gitlog-note-close')}
        aria-label={closeLabel}
        title={closeLabel}
        onClick={onDismiss}
      >
        ×
      </button>
    </p>
  )
}
