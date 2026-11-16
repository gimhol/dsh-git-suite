import type * as React from 'react'
import { h } from '../runtime.js'
import { cls } from '../styles.js'
import { tooltipProps } from './Tooltip.js'

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger'

export interface ButtonProps {
  children?: React.ReactNode
  variant?: ButtonVariant
  iconOnly?: boolean
  loading?: boolean
  disabled?: boolean
  title?: string
  ariaLabel?: string
  type?: 'button' | 'submit'
  onClick?(event: React.MouseEvent<HTMLButtonElement>): void
  icon?: React.ReactNode
  className?: string
  autoFocus?: boolean
  ariaHasPopup?: 'dialog' | 'menu' | boolean
  ariaExpanded?: boolean
  ariaPressed?: boolean
}

/** Shared button: 28px control height, variants, icon-only, and a loading state. */
export function Button({
  children,
  variant = 'default',
  iconOnly = false,
  loading = false,
  disabled = false,
  title,
  ariaLabel,
  type = 'button',
  onClick,
  icon,
  className,
  autoFocus = false,
  ariaHasPopup,
  ariaExpanded,
  ariaPressed,
}: ButtonProps): React.ReactElement {
  const classes = [cls('dsh-gitlog-btn')]
  if (variant === 'primary') classes.push(cls('primary'))
  if (variant === 'danger') classes.push(cls('danger'))
  if (variant === 'ghost') classes.push(cls('ghost'))
  if (iconOnly) classes.push(cls('dsh-gitlog-icon-btn'))
  if (className !== undefined && className !== '') classes.push(className)
  return (
    <button
      type={type}
      className={cls(classes.join(' '))}
      disabled={disabled || loading}
      aria-label={ariaLabel ?? title}
      {...(title === undefined ? {} : tooltipProps(title))}
      aria-busy={loading || undefined}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      aria-pressed={ariaPressed}
      onClick={onClick}
      autoFocus={autoFocus}
    >
      {icon}
      {iconOnly ? null : children}
    </button>
  )
}

export interface DialogActionsProps {
  children: React.ReactNode
  className?: string
}

/** Right-aligned dialog footer: cancel first, confirm last, 10px gap. */
export function DialogActions({ children, className = cls('dsh-gitlog-dialog-actions') }: DialogActionsProps): React.ReactElement {
  return <div className={cls(className)}>{children}</div>
}
