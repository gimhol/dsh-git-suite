import type * as React from 'react'
import { h, useEffect, useRef, useState } from '../runtime.js'
import type { Translate } from '../types.js'
import { cls } from '../styles.js'

export interface DialogShellProps {
  title: string
  t: Translate
  /** Wider frame for dialogs that list branches or long URLs. */
  wide?: boolean
  /** Extra class on the frame, e.g. a larger diff dialog. */
  frameClassName?: string
  /** Let the user drag the bottom-right corner to resize the frame. */
  resizable?: boolean
  /** Let the user move the frame by dragging its header. */
  draggable?: boolean
  /**
   * Wrap the content in the shared padded block. A dialog that manages its own
   * padding (for example a two-column layout) passes `false` and pads itself.
   */
  padded?: boolean
  onClose(): void
  children: React.ReactNode
}

/** Smallest frame the resize grip allows. */
const MIN_WIDTH = 380
const MIN_HEIGHT = 260
/** Keeps the frame clear of the viewport edges while resizing or moving. */
const VIEWPORT_MARGIN = 24
/** The half margin a dragged frame may approach before it is clamped. */
const DRAG_EDGE = VIEWPORT_MARGIN / 2

/** A frame the user has moved or resized; sizes stay undefined until resized. */
interface FrameBox {
  left: number
  top: number
  width?: number
  height?: number
}

/** Shared modal frame used by the repository and commit-action dialogs. */
export function DialogShell({
  title,
  t,
  wide = false,
  frameClassName,
  resizable = false,
  draggable = false,
  padded = true,
  onClose,
  children,
}: DialogShellProps): React.ReactElement {
  // A click only dismisses the modal when the press started on the backdrop
  // itself; selecting text inside and releasing outside must not close it.
  const pressedBackdrop = useRef(false)
  const frameRef = useRef<HTMLDivElement | null>(null)
  /** User-chosen frame box; null keeps the CSS default (centered, auto-sized). */
  const [box, setBox] = useState<FrameBox | null>(null)
  const sized = box !== null && box.width !== undefined && box.height !== undefined

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Drag the corner grip: the frame grows with the pointer, clamped to the viewport.
  // The frame is pinned at its current top-left corner for the drag, so the grip
  // stays under the pointer instead of drifting while a centered dialog grows
  // from both sides.
  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    const frame = frameRef.current
    if (frame === null) return
    event.preventDefault()
    const rect = frame.getBoundingClientRect()
    const origin = {
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    }
    setBox({ left: origin.left, top: origin.top, width: origin.width, height: origin.height })
    const grip = event.currentTarget
    grip.setPointerCapture(event.pointerId)
    const move = (moveEvent: PointerEvent): void => {
      const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - origin.left - VIEWPORT_MARGIN)
      const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - origin.top - VIEWPORT_MARGIN)
      const width = Math.max(MIN_WIDTH, Math.min(maxWidth, origin.width + (moveEvent.clientX - origin.x)))
      const height = Math.max(MIN_HEIGHT, Math.min(maxHeight, origin.height + (moveEvent.clientY - origin.y)))
      setBox({ left: origin.left, top: origin.top, width, height })
    }
    const end = (): void => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', end)
      grip.removeEventListener('pointercancel', end)
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', end)
    grip.addEventListener('pointercancel', end)
  }

  // Drag the header to move the frame; buttons inside it keep their own press.
  const startDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!draggable) return
    const frame = frameRef.current
    if (frame === null) return
    if ((event.target as HTMLElement).closest('button, a, input, textarea, select') !== null) return
    event.preventDefault()
    const rect = frame.getBoundingClientRect()
    const origin = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }
    const header = event.currentTarget
    header.setPointerCapture(event.pointerId)
    const move = (moveEvent: PointerEvent): void => {
      const left = Math.min(
        Math.max(DRAG_EDGE, origin.left + (moveEvent.clientX - origin.x)),
        Math.max(DRAG_EDGE, window.innerWidth - rect.width - DRAG_EDGE),
      )
      const top = Math.min(
        Math.max(DRAG_EDGE, origin.top + (moveEvent.clientY - origin.y)),
        Math.max(DRAG_EDGE, window.innerHeight - rect.height - DRAG_EDGE),
      )
      setBox(current => ({ ...current, left, top }))
    }
    const end = (): void => {
      header.removeEventListener('pointermove', move)
      header.removeEventListener('pointerup', end)
      header.removeEventListener('pointercancel', end)
    }
    header.addEventListener('pointermove', move)
    header.addEventListener('pointerup', end)
    header.addEventListener('pointercancel', end)
  }

  return (
    <div
      className={cls('dsh-gitlog-modal-backdrop')}
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
        ref={frameRef}
        className={cls(`dsh-gitlog-modal dsh-gitlog-repo-dialog${wide ? ' dsh-gitlog-dialog-wide' : ''}${frameClassName === undefined ? '' : ` ${frameClassName}`}${sized ? ' is-sized' : ''}`)}
        style={box === null
          ? undefined
          : {
              position: 'fixed',
              left: `${box.left}px`,
              top: `${box.top}px`,
              margin: 0,
              ...(box.width === undefined || box.height === undefined
                ? {}
                : { width: `${box.width}px`, height: `${box.height}px` }),
            }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div
          className={cls(`dsh-gitlog-modal-head${draggable ? ' is-draggable' : ''}`)}
          onPointerDown={startDrag}
        >
          <h2>{title}</h2>
          <button
            type="button"
            className={cls('dsh-gitlog-modal-close')}
            onClick={onClose}
            aria-label={t('close')}
          >
            ×
          </button>
        </div>
        <div className={cls('dsh-gitlog-modal-body')}>
          {padded ? <div className={cls('dsh-gitlog-modal-content')}>{children}</div> : children}
        </div>
        {resizable
          ? (
              <div
                className={cls('dsh-gitlog-dialog-resize')}
                role="separator"
                aria-label={t('dialogResize')}
                onPointerDown={startResize}
              />
            )
          : null}
      </div>
    </div>
  )
}
