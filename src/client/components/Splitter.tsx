import type * as React from 'react'
import { h, useRef, useState } from '../runtime.js'
import { cls } from '../styles.js'

export interface SplitterProps {
  /** A vertical bar resizes widths; a horizontal bar resizes heights. */
  orientation: 'vertical' | 'horizontal'
  label: string
  onStart(): void
  onDrag(deltaX: number, deltaY: number): void
  onEnd?(): void
  /** Double-click restores the default size. */
  onReset?(): void
  className?: string
}

/**
 * Drag handle between two regions. It only reports pointer deltas; the owner
 * decides which size changes and clamps the result.
 */
export function Splitter({ orientation, label, onStart, onDrag, onEnd, onReset, className }: SplitterProps): React.ReactElement {
  const [dragging, setDragging] = useState(false)
  const origin = useRef<{ x: number; y: number } | null>(null)

  const stop = (element: Element, pointerId: number): void => {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
    document.documentElement.style.cursor = ''
    document.body.style.userSelect = ''
    origin.current = null
    setDragging(false)
    onEnd?.()
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      className={cls(`dsh-gitlog-split is-${orientation}${dragging ? ' is-dragging' : ''}${className === undefined ? '' : ` ${className}`}`)}
      onPointerDown={event => {
        if (event.button !== 0) return
        event.preventDefault()
        origin.current = { x: event.clientX, y: event.clientY }
        setDragging(true)
        event.currentTarget.setPointerCapture(event.pointerId)
        document.documentElement.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize'
        document.body.style.userSelect = 'none'
        onStart()
      }}
      onPointerMove={event => {
        const start = origin.current
        if (start === null) return
        onDrag(event.clientX - start.x, event.clientY - start.y)
      }}
      onPointerUp={event => {
        if (origin.current === null) return
        stop(event.currentTarget, event.pointerId)
      }}
      onPointerCancel={event => {
        if (origin.current === null) return
        stop(event.currentTarget, event.pointerId)
      }}
      onKeyDown={event => {
        const step = event.shiftKey ? 64 : 16
        let deltaX = 0
        let deltaY = 0
        if (orientation === 'vertical') {
          if (event.key === 'ArrowLeft') deltaX = -step
          else if (event.key === 'ArrowRight') deltaX = step
        } else {
          if (event.key === 'ArrowUp') deltaY = -step
          else if (event.key === 'ArrowDown') deltaY = step
        }
        if (deltaX === 0 && deltaY === 0) return
        event.preventDefault()
        onStart()
        onDrag(deltaX, deltaY)
      }}
      onDoubleClick={() => onReset?.()}
    />
  )
}
