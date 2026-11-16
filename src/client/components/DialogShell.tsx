import type * as React from 'react'
import { h, useEffect, useRef } from '../runtime.js'
import type { Translate } from '../types.js'
import { cls } from '../styles.js'

export interface DialogShellProps {
  title: string
  t: Translate
  /** Wider frame for dialogs that list branches or long URLs. */
  wide?: boolean
  onClose(): void
  children: React.ReactNode
}

/** Shared modal frame used by the repository and commit-action dialogs. */
export function DialogShell({ title, t, wide = false, onClose, children }: DialogShellProps): React.ReactElement {
  // A click only dismisses the modal when the press started on the backdrop
  // itself; selecting text inside and releasing outside must not close it.
  const pressedBackdrop = useRef(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className={cls('dsh-gitlog-settings-backdrop')}
      onMouseDown={event => {
        pressedBackdrop.current = event.target === event.currentTarget
      }}
      onClick={event => {
        const dismiss = pressedBackdrop.current && event.target === event.currentTarget
        pressedBackdrop.current = false
        if (dismiss) onClose()
      }}
    >
      <div
        className={cls(`dsh-gitlog-settings dsh-gitlog-repo-dialog${wide ? ' dsh-gitlog-dialog-wide' : ''}`)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={cls('dsh-gitlog-settings-head')}>
          <h2>{title}</h2>
          <button
            type="button"
            className={cls('dsh-gitlog-settings-close')}
            onClick={onClose}
            aria-label={t('close')}
          >
            ×
          </button>
        </div>
        <div className={cls('dsh-gitlog-settings-body')}>{children}</div>
      </div>
    </div>
  )
}
