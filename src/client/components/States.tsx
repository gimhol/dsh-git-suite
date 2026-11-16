import type * as React from 'react'
import { h, useEffect, useRef, useState } from '../runtime.js'
import type { Translate } from '../types.js'
import { cls } from '../styles.js'

/** One spinner revolution; the CSS animation uses the same duration. */
export const SPIN_MS = 900

/**
 * Keep a spinner on screen for whole revolutions (three by default) once it
 * appears, so a fast operation never makes it flash on and off — and it always
 * disappears at the end of a turn, not in the middle of one.
 */
export function useMinimumSpin(active: boolean, turns = 3): boolean {
  const minimum = SPIN_MS * turns
  const [visible, setVisible] = useState(active)
  const since = useRef(active ? Date.now() : 0)

  useEffect(() => {
    if (active) {
      if (!visible) {
        since.current = Date.now()
        setVisible(true)
      }
      return undefined
    }
    if (!visible) return undefined
    const remaining = minimum - (Date.now() - since.current)
    if (remaining <= 0) {
      setVisible(false)
      return undefined
    }
    const timer = window.setTimeout(() => setVisible(false), remaining)
    return () => window.clearTimeout(timer)
  }, [active, visible, minimum])

  return visible
}

/** Fade-out duration; the component stays mounted until the animation ends. */
const FADE_MS = 160

/**
 * Smooth SVG spinner: a low-opacity track plus a rotating three-quarter arc.
 * Pass `active={false}` to fade it out instead of removing it instantly.
 */
export function Spinner({ size = 16, active = true }: { size?: number; active?: boolean }): React.ReactElement | null {
  const [mounted, setMounted] = useState(active)

  useEffect(() => {
    if (active) {
      setMounted(true)
      return undefined
    }
    if (!mounted) return undefined
    const timer = window.setTimeout(() => setMounted(false), FADE_MS)
    return () => window.clearTimeout(timer)
  }, [active, mounted])

  if (!mounted) return null
  return (
    <svg
      className={cls(`dsh-gitlog-spinner${active ? '' : ' is-hiding'}`)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden={true}
      focusable={false}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity={0.22} strokeWidth={2} />
      <path
        d="M12 3A9 9 0 1 1 4.21 16.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  )
}

export function LoadingState({ label }: { label: string }): React.ReactElement {
  return (
    <div className={cls('dsh-gitlog-state')}>
      <Spinner size={18} />
      <p>{label}</p>
    </div>
  )
}

export function LoadingLine({ label, active = true }: { label: string; active?: boolean }): React.ReactElement {
  return (
    <div className={cls('dsh-gitlog-loading-line')}>
      <Spinner size={18} active={active} />
      {active ? <span>{label}</span> : null}
    </div>
  )
}

export function EmptyState({ t, onRefresh }: { t: Translate; onRefresh(): void }): React.ReactElement {
  return (
    <div className={cls('dsh-gitlog-state')}>
      <h2>{t('noCommits')}</h2>
      <p>{t('noCommitsHint')}</p>
      <button type="button" className={cls('dsh-gitlog-btn')} onClick={onRefresh}>{t('refresh')}</button>
    </div>
  )
}



