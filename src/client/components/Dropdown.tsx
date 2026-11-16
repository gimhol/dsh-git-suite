import type * as React from 'react'
import { h, useEffect, useRef, useState } from '../runtime.js'
import { tooltipProps } from './Tooltip.js'
import { cls } from '../styles.js'

export interface DropdownOption {
  value: string
  label: string
  title?: string
  /** Optional group heading, rendered before the first option of that group. */
  group?: string
}

export interface DropdownProps {
  value: string
  options: DropdownOption[]
  onChange(value: string): void
  disabled?: boolean
  ariaLabel: string
  className?: string
  autoFocus?: boolean
  placeholder?: string
  /** Turn the trigger into a searchable input (antd-style) instead of the label button. */
  searchable?: boolean
  searchPlaceholder?: string
  noMatchesLabel?: string
}

interface OptionGroup {
  name?: string
  options: DropdownOption[]
}

function groupOptions(options: DropdownOption[]): OptionGroup[] {
  const groups: OptionGroup[] = []
  for (const option of options) {
    const last = groups[groups.length - 1]
    if (last !== undefined && last.name === option.group) last.options.push(option)
    else groups.push({ name: option.group, options: [option] })
  }
  return groups
}

function Chevron(): React.ReactElement {
  return (
    <svg
      className={cls('dsh-gitlog-dropdown-chevron')}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable={false}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

/** A custom listbox: the native select is replaced so the popup follows the DSH theme. */
export function Dropdown({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  className,
  autoFocus = false,
  placeholder = '',
  searchable = false,
  searchPlaceholder = '',
  noMatchesLabel = '',
}: DropdownProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const selected = options.find(option => option.value === value)
  const selectedLabel = selected?.label ?? placeholder
  const needle = query.trim().toLowerCase()
  const filtered = needle === ''
    ? options
    : options.filter(option => option.label.toLowerCase().includes(needle))
  const groups = groupOptions(filtered)

  useEffect(() => {
    if (!autoFocus) return
    if (searchable) searchRef.current?.focus()
    else buttonRef.current?.focus()
  }, [autoFocus, searchable])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (open && searchable) searchRef.current?.focus()
  }, [open, searchable])

  const openMenu = (): void => {
    const anchor = searchable ? triggerRef.current : buttonRef.current
    const rect = anchor?.getBoundingClientRect()
    if (rect !== undefined) {
      const width = Math.max(rect.width, 200)
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: rect.bottom + 4,
        width: rect.width,
      })
    }
    setQuery('')
    const index = options.findIndex(option => option.value === value)
    setActive(index < 0 ? 0 : index)
    setOpen(true)
  }

  const select = (option: DropdownOption): void => {
    onChange(option.value)
    setOpen(false)
  }

  const move = (delta: number): void => {
    if (filtered.length === 0) return
    setActive(index => (index + delta + filtered.length) % filtered.length)
  }

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openMenu()
      }
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      move(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      move(-1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActive(filtered.length - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = filtered[active]
      if (option !== undefined) select(option)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    }
  }

  const onSearchChange = (value: string): void => {
    if (!open) openMenu()
    setQuery(value)
    setActive(0)
  }

  return (
    <div
      ref={rootRef}
      className={cls(`dsh-gitlog-dropdown${className === undefined ? '' : ` ${className}`}`)}
    >
      {searchable
        ? (
            <div ref={triggerRef} className={cls('dsh-gitlog-dropdown-control')}>
              <input
                ref={searchRef}
                className={cls('dsh-gitlog-dropdown-input')}
                type="text"
                value={open ? query : selectedLabel}
                onChange={event => onSearchChange(event.target.value)}
                onFocus={() => {
                  if (!open) openMenu()
                }}
                onKeyDown={onTriggerKeyDown}
                placeholder={open ? searchPlaceholder : placeholder}
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                disabled={disabled}
                autoComplete="off"
                spellCheck={false}
              />
              <Chevron />
            </div>
          )
        : (
            <button
              ref={buttonRef}
              type="button"
              className={cls('dsh-gitlog-dropdown-btn')}
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-label={ariaLabel}
              disabled={disabled}
              {...tooltipProps(selected?.title ?? selected?.label ?? placeholder ?? '')}
              onClick={() => {
                if (open) setOpen(false)
                else openMenu()
              }}
              onKeyDown={onTriggerKeyDown}
            >
              <span className={cls('dsh-gitlog-dropdown-label')}>{selectedLabel}</span>
              <Chevron />
            </button>
          )}
      {open
        ? (
            <div
              className={cls('dsh-gitlog-dropdown-menu')}
              role="listbox"
              aria-label={ariaLabel}
              style={position === null
                ? undefined
                : { left: position.left, top: position.top, minWidth: position.width }}
            >
              {filtered.length === 0
                ? <p className={cls('dsh-gitlog-dropdown-empty')}>{noMatchesLabel}</p>
                : groups.map(group => (
                    <div key={group.name ?? '__default'} className={cls('dsh-gitlog-dropdown-group')}>
                      {group.name === undefined
                        ? null
                        : <div className={cls('dsh-gitlog-dropdown-group-label')}>{group.name}</div>}
                      {group.options.map(option => {
                        const index = filtered.indexOf(option)
                        return (
                          <button
                            key={option.value === '' ? '__manual' : option.value}
                            type="button"
                            role="option"
                            aria-selected={option.value === value}
                            className={cls(`dsh-gitlog-dropdown-item${index === active ? ' is-active' : ''}${option.value === value ? ' is-selected' : ''}`)}
                            {...(option.title === undefined ? {} : tooltipProps(option.title))}
                            onMouseEnter={() => setActive(index)}
                            onClick={() => select(option)}
                          >
                            {option.label}
                          </button>
                        )
                      })}
                    </div>
                  ))}
            </div>
          )
        : null}
    </div>
  )
}



