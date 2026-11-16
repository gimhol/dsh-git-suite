import type * as React from 'react'
import { h } from '../runtime.js'
import { Button } from './Button.js'
import { cls } from '../styles.js'

export interface SwitchOption<Value extends string> {
  value: Value
  label: string
  /** Optional tooltip; a visible label usually makes it unnecessary. */
  title?: string
}

export interface SwitchProps<Value extends string> {
  value: Value
  options: readonly SwitchOption<Value>[]
  onChange(value: Value): void
  ariaLabel?: string
  className?: string
}

/**
 * Segmented text switch: a bordered track with ghost buttons, and the pressed
 * segment carrying the only fill.
 */
export function Switch<Value extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: SwitchProps<Value>): React.ReactElement {
  return (
    <div
      className={cls(`dsh-gitlog-switch${className === undefined ? '' : ` ${className}`}`)}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map(option => (
        <Button
          key={option.value}
          variant="ghost"
          ariaPressed={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}
