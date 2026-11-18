/**
 * Media files (images and audio) that a diff shows as data URLs instead of
 * text patches. Shared by the working-tree diff and the commit diff.
 */
import type { WorkspaceDiffMediaSide } from './types.js'

/** Largest media side embedded in a JSON payload, before base64 expansion. */
export const MAX_MEDIA_BYTES = 3 * 1024 * 1024

/** Formats a browser can render directly; SVG and other text stays a text diff. */
const MEDIA_TYPES: Readonly<Record<string, { kind: 'image' | 'audio'; mime: string }>> = {
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
  bmp: { kind: 'image', mime: 'image/bmp' },
  ico: { kind: 'image', mime: 'image/x-icon' },
  avif: { kind: 'image', mime: 'image/avif' },
  mp3: { kind: 'audio', mime: 'audio/mpeg' },
  wav: { kind: 'audio', mime: 'audio/wav' },
  ogg: { kind: 'audio', mime: 'audio/ogg' },
  oga: { kind: 'audio', mime: 'audio/ogg' },
  opus: { kind: 'audio', mime: 'audio/ogg' },
  flac: { kind: 'audio', mime: 'audio/flac' },
  m4a: { kind: 'audio', mime: 'audio/mp4' },
  aac: { kind: 'audio', mime: 'audio/aac' },
  weba: { kind: 'audio', mime: 'audio/webm' },
}

/** @returns the media kind and MIME type when the path names one, else null. */
export function mediaType(file: string): { kind: 'image' | 'audio'; mime: string } | null {
  const dot = file.lastIndexOf('.')
  if (dot < 0) return null
  return MEDIA_TYPES[file.slice(dot + 1).toLowerCase()] ?? null
}

/**
 * Read one side of a media diff.
 * @param mime - MIME type of the path.
 * @param read - loads the blob; a rejection means the side does not exist.
 * @param pointer - whether the bytes are still an unresolved LFS pointer.
 * @returns a data URL, or the reason the side cannot be shown.
 */
export async function mediaSide(
  mime: string,
  read: () => Promise<{ bytes: Buffer; pointer: boolean }>,
): Promise<WorkspaceDiffMediaSide> {
  let bytes: Buffer
  let pointer = false
  try {
    const result = await read()
    bytes = result.bytes
    pointer = result.pointer
  } catch {
    return { dataUrl: null, reason: 'absent' }
  }
  if (bytes.byteLength > MAX_MEDIA_BYTES) return { dataUrl: null, reason: 'large' }
  // An unresolved LFS blob is the pointer, not the picture; embedding it would
  // render a broken image, so report the missing object instead.
  if (pointer) return { dataUrl: null, reason: 'lfs' }
  return { dataUrl: `data:${mime};base64,${bytes.toString('base64')}`, reason: null }
}
