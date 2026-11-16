import type * as React from 'react'
import { h, useEffect, useState } from '../runtime.js'
import { cls } from '../styles.js'

export type ToastKind = 'info' | 'error'

interface ToastState {
  text: string
  kind: ToastKind
}

type Listener = (state: ToastState | null) => void

const DURATION_MS = 3600

const listeners = new Set<Listener>()
let timer: number | null = null

/**
 * Show one transient message in the panel. A newer message replaces the current
 * one, and the toast clears itself after a few seconds.
 */
export function toast(text: string, kind: ToastKind = 'info'): void {
  if (text.trim() === '') return
  if (timer !== null) window.clearTimeout(timer)
  const state: ToastState = { text, kind }
  for (const listener of listeners) listener(state)
  timer = window.setTimeout(() => {
    timer = null
    for (const listener of listeners) listener(null)
  }, DURATION_MS)
}

/**
 * Mount once per panel. It renders whatever `toast()` last asked for, so any
 * component can report a transient failure without owning its own overlay.
 */
export function ToastHost(): React.ReactElement | null {
  const [state, setState] = useState<ToastState | null>(null)

  useEffect(() => {
    listeners.add(setState)
    return () => {
      listeners.delete(setState)
      if (listeners.size === 0 && timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
    }
  }, [])

  if (state === null) return null
  return (
    <div
      className={cls(`dsh-gitlog-toast${state.kind === 'error' ? ' is-error' : ''}`)}
      role="status"
    >
      {state.text}
    </div>
  )
}
