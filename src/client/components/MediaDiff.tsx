/**
 * Image or audio sides of a working-tree change.
 *
 * These formats have no text to diff, so the host sends both versions as data
 * URLs (the index copy for unstaged, `HEAD` for staged). A missing side is an
 * added or deleted file, and an oversized side is reported instead of embedded.
 * Clicking an image opens a pan/zoom/rotate preview.
 */
import type * as React from 'react'
import Panzoom from '@panzoom/panzoom'
import { cls } from '../styles.js'
import { h, useEffect, useRef, useState } from '../runtime.js'
import type { Translate, WorkspaceDiffMedia } from '../types.js'

export interface MediaDiffProps {
  media: WorkspaceDiffMedia
  /** Repository-relative path, used for the labels. */
  path: string
  t: Translate
}

/** The image currently shown full-size. */
interface Preview {
  src: string
  label: string
}

/**
 * One side of the comparison: its player, or why it cannot be shown.
 * @param media - the change this side belongs to.
 * @param which - which version this is.
 * @param path - repository-relative path for the accessible name.
 * @param t - bound translate function.
 * @param onPreview - opens the full-size preview for an image side.
 * @returns the picture, the audio player, or a short explanation.
 */
function side(
  media: WorkspaceDiffMedia,
  which: 'before' | 'after',
  path: string,
  t: Translate,
  onPreview: (preview: Preview) => void,
): React.ReactElement {
  const label = t(which === 'before' ? 'mediaBefore' : 'mediaAfter')
  const value = media[which]
  if (value.dataUrl !== null) {
    return media.kind === 'audio'
      ? (
          <audio
            className={cls('dsh-gitlog-media-diff-audio')}
            src={value.dataUrl}
            controls
            preload="metadata"
            aria-label={`${path} — ${label}`}
          />
        )
      : (
          <button
            type="button"
            className={cls('dsh-gitlog-media-diff-zoom')}
            title={t('mediaOpenPreview')}
            aria-label={`${path} — ${label}`}
            onClick={() => onPreview({ src: value.dataUrl ?? '', label })}
          >
            <img className={cls('dsh-gitlog-media-diff-img')} src={value.dataUrl} alt={`${path} — ${label}`} />
          </button>
        )
  }
  const message = value.reason === 'large'
    ? t('mediaTooLarge')
    : which === 'before' ? t('mediaAdded') : t('mediaRemoved')
  return <p className={cls('dsh-gitlog-media-diff-note')}>{message}</p>
}

/** Before/after panes for one image or audio file, plus a pan/zoom/rotate preview. */
export function MediaDiff({ media, path, t }: MediaDiffProps): React.ReactElement {
  const [preview, setPreview] = useState<Preview | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const zoomRef = useRef<ReturnType<typeof Panzoom> | null>(null)
  const rotationRef = useRef(0)

  /** Rotate the preview by 90° steps, compounding from the current angle. */
  const rotateBy = (delta: number): void => {
    rotationRef.current = (rotationRef.current + delta + 360) % 360
    const image = imageRef.current
    // Panzoom owns the translate/scale transform; the CSS `rotate` property
    // composes with it, so rotation does not fight the pan/zoom matrix.
    if (image !== null) image.style.rotate = `${rotationRef.current}deg`
  }

  const resetView = (): void => {
    rotationRef.current = 0
    const image = imageRef.current
    if (image !== null) image.style.rotate = ''
    zoomRef.current?.reset()
  }

  // Panzoom owns the transform; the wheel zooms around the pointer.
  useEffect(() => {
    const stage = stageRef.current
    const image = imageRef.current
    if (preview === null || stage === null || image === null) return
    const panzoom = Panzoom(image, { minScale: 0.4, maxScale: 8, cursor: 'grab' })
    zoomRef.current = panzoom
    rotationRef.current = 0
    image.style.rotate = ''
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      panzoom.zoomWithWheel(event)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      stage.removeEventListener('wheel', onWheel)
      panzoom.destroy()
      zoomRef.current = null
    }
  }, [preview])

  // Keyboard: Esc closes, +/- zooms, R rotates, 0 resets.
  useEffect(() => {
    if (preview === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setPreview(null)
        return
      }
      const panzoom = zoomRef.current
      if (panzoom === null) return
      if (event.key === '+' || event.key === '=') panzoom.zoomIn()
      else if (event.key === '-') panzoom.zoomOut()
      else if (event.key === 'r' || event.key === 'R') rotateBy(90)
      else if (event.key === '0') resetView()
      else return
      event.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs only
  }, [preview])

  return (
    <div className={cls('dsh-gitlog-media-diff')}>
      {(['before', 'after'] as const).map(which => (
        <figure key={which} className={cls('dsh-gitlog-media-diff-side')}>
          <figcaption>{t(which === 'before' ? 'mediaBefore' : 'mediaAfter')}</figcaption>
          {side(media, which, path, t, setPreview)}
        </figure>
      ))}
      {preview === null
        ? null
        : (
            <div
              ref={stageRef}
              className={cls('dsh-gitlog-media-lightbox')}
              role="dialog"
              aria-modal="true"
              aria-label={`${path} — ${preview.label}`}
              onClick={() => setPreview(null)}
            >
              <img
                ref={imageRef}
                className={cls('dsh-gitlog-media-lightbox-img')}
                src={preview.src}
                alt={`${path} — ${preview.label}`}
                onClick={event => event.stopPropagation()}
              />
              <button
                type="button"
                className={cls('dsh-gitlog-media-lightbox-close')}
                aria-label={t('close')}
                onClick={() => setPreview(null)}
              >
                ×
              </button>
              <div className={cls('dsh-gitlog-media-lightbox-bar')} onClick={event => event.stopPropagation()}>
                <button
                  type="button"
                  className={cls('dsh-gitlog-media-lightbox-btn')}
                  title={t('mediaZoomOut')}
                  aria-label={t('mediaZoomOut')}
                  onClick={() => zoomRef.current?.zoomOut()}
                >
                  −
                </button>
                <button
                  type="button"
                  className={cls('dsh-gitlog-media-lightbox-btn')}
                  title={t('mediaZoomIn')}
                  aria-label={t('mediaZoomIn')}
                  onClick={() => zoomRef.current?.zoomIn()}
                >
                  +
                </button>
                <button
                  type="button"
                  className={cls('dsh-gitlog-media-lightbox-btn')}
                  title={t('mediaRotateLeft')}
                  aria-label={t('mediaRotateLeft')}
                  onClick={() => rotateBy(-90)}
                >
                  ⟲
                </button>
                <button
                  type="button"
                  className={cls('dsh-gitlog-media-lightbox-btn')}
                  title={t('mediaRotateRight')}
                  aria-label={t('mediaRotateRight')}
                  onClick={() => rotateBy(90)}
                >
                  ⟳
                </button>
                <button
                  type="button"
                  className={cls('dsh-gitlog-media-lightbox-btn')}
                  title={t('mediaResetZoom')}
                  aria-label={t('mediaResetZoom')}
                  onClick={resetView}
                >
                  ⤢
                </button>
              </div>
            </div>
          )}
    </div>
  )
}
