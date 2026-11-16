import type * as React from 'react'
import { h, useEffect } from '../runtime.js'
import { cls } from '../styles.js'

export interface TooltipAnchorRect {
  left: number
  top: number
  bottom: number
  width?: number
  right?: number
}

/** An anchor is either a live element (measured at paint time) or a fixed rect. */
export type TooltipAnchor = HTMLElement | TooltipAnchorRect

/** Normalized box used by the placement math. */
interface AnchorBox {
  left: number
  top: number
  bottom: number
  width: number
  right: number
}

interface Placement {
  text: string
  left: number
  top: number
  above: boolean
}

/** Close to the native delay, short enough to feel immediate. */
const DELAY_MS = 260
/** Matches the fade-out keyframe so the bubble is removed after it ends. */
const FADE_OUT_MS = 110
const MAX_WIDTH = 360
const EDGE = 8
/** Space between the control and the bubble, so the bubble never covers it. */
const GAP = 8

let timer: number | null = null
let removal: number | null = null
let current: Placement | null = null
let element: HTMLDivElement | null = null
let hosts = 0

function clearTimer(): void {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
}

function cancelRemoval(): void {
  if (removal !== null) {
    window.clearTimeout(removal)
    removal = null
  }
}

/**
 * The bubble lives in `document.body`: the panel can sit inside transformed or
 * scaled shells, where a child would be measured against the shell instead of
 * the viewport.
 */
function ensureElement(): HTMLDivElement {
  if (element !== null) return element
  // Drop leftovers from an earlier plugin instance (hot reload, remount).
  for (const stale of Array.from(document.querySelectorAll(`.${cls('dsh-gitlog-tooltip')}`))) stale.remove()
  const node = document.createElement('div')
  node.className = cls('dsh-gitlog-tooltip')
  node.setAttribute('role', 'tooltip')
  node.style.display = 'none'
  document.body.appendChild(node)
  element = node
  return node
}

function anchorRect(anchor: TooltipAnchor): AnchorBox {
  if (!(anchor instanceof HTMLElement)) {
    const width = anchor.width ?? 0
    return { left: anchor.left, top: anchor.top, bottom: anchor.bottom, width, right: anchor.left + width }
  }
  const rect = anchor.getBoundingClientRect()
  return { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width, right: rect.right }
}

/**
 * Position the bubble, then measure where it actually landed and correct the
 * offset. The measurement loop makes the placement independent of the
 * coordinate space: CSS zoom, transforms, or nested scrolling all resolve to
 * one translation that the second pass removes.
 */
function applyPlacement(text: string, anchor: TooltipAnchor): void {
  const node = ensureElement()
  const target = anchorRect(anchor)
  const root = document.documentElement.getBoundingClientRect()
  const above = target.bottom + 64 > root.bottom

  node.textContent = text
  node.classList.remove(cls('is-hiding'))
  node.style.display = ''
  node.style.visibility = 'hidden'
  node.style.maxWidth = `${MAX_WIDTH}px`
  // No transform: the vertical position comes from the measured height, so a
  // bubble above its control never depends on one.
  node.style.transform = 'none'

  let left = target.left
  let top = target.bottom + GAP
  node.style.left = `${left}px`
  node.style.top = `${top}px`

  for (let pass = 0; pass < 2; pass += 1) {
    const box = node.getBoundingClientRect()
    const wantLeft = Math.max(root.left + EDGE, Math.min(target.left, root.right - EDGE - box.width))
    const wantTop = above ? target.top - GAP - box.height : target.bottom + GAP
    const dx = wantLeft - box.left
    const dy = wantTop - box.top
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break
    left += dx
    top += dy
    node.style.left = `${left}px`
    node.style.top = `${top}px`
  }

  // Safety net: never let the bubble sit on top of its own control.
  const box = node.getBoundingClientRect()
  const overlaps = box.left < target.left + target.width && box.right > target.left
    && box.top < target.bottom && box.bottom > target.top
  if (overlaps) {
    const shift = above ? target.top - GAP - box.bottom : target.bottom + GAP - box.top
    top += shift
    node.style.top = `${top}px`
  }
  node.style.visibility = ''
  current = { text, left, top, above }
}

/** Show `text` near the anchor after the shared hover delay. */
export function showTooltip(text: string, anchor: TooltipAnchor): void {
  clearTimer()
  if (current !== null && element !== null) element.classList.add(cls('is-hiding'))
  timer = window.setTimeout(() => {
    timer = null
    applyPlacement(text.trim(), anchor)
  }, DELAY_MS)
}

/** Show immediately, for keyboard focus. */
export function showTooltipNow(text: string, anchor: TooltipAnchor): void {
  clearTimer()
  applyPlacement(text.trim(), anchor)
}

/** Fade the bubble out, then hide it once the animation has finished. */
export function hideTooltip(): void {
  clearTimer()
  if (current === null || element === null) {
    cancelRemoval()
    return
  }
  cancelRemoval()
  element.classList.add(cls('is-hiding'))
  removal = window.setTimeout(() => {
    removal = null
    current = null
    if (element !== null) {
      element.style.display = 'none'
      element.textContent = ''
      element.classList.remove(cls('is-hiding'))
    }
  }, FADE_OUT_MS)
}

/**
 * Hover/focus handlers that show the panel's own tooltip instead of the
 * browser's `title` bubble, so the look and the delay match everywhere.
 */
export interface TooltipTargetProps {
  onMouseEnter(event: React.MouseEvent<HTMLElement>): void
  onMouseLeave(): void
  onFocus(event: React.FocusEvent<HTMLElement>): void
  onBlur(): void
}

/** `{...tooltipProps(t('label'))}` replaces a native `title` attribute. */
export function tooltipProps(text: string | (() => string)): TooltipTargetProps {
  const value = (): string => (typeof text === 'function' ? text() : text)
  return {
    onMouseEnter(event) {
      const body = value()
      if (body.trim() !== '') showTooltip(body, event.currentTarget)
    },
    onMouseLeave() {
      hideTooltip()
    },
    onFocus(event) {
      if (!event.currentTarget.matches(':focus-visible')) return
      const body = value()
      if (body.trim() !== '') showTooltipNow(body, event.currentTarget)
    },
    onBlur() {
      hideTooltip()
    },
  }
}

/**
 * Mount once per panel. It keeps the single document-level bubble alive and
 * dismisses it on scroll or resize.
 */
export function TooltipHost(): React.ReactElement | null {
  useEffect(() => {
    hosts += 1
    const node = ensureElement()
    const dismiss = (): void => {
      clearTimer()
      hideTooltip()
    }
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      hosts -= 1
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
      if (hosts > 0) return
      hosts = 0
      clearTimer()
      cancelRemoval()
      current = null
      node.remove()
      if (element === node) element = null
    }
  }, [])
  return null
}


