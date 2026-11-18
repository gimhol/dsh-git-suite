/** Image and audio formats the diff renders instead of a text patch. */
const MEDIA_KINDS: Readonly<Record<string, 'image' | 'audio'>> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  ico: 'image',
  avif: 'image',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  oga: 'audio',
  opus: 'audio',
  flac: 'audio',
  m4a: 'audio',
  aac: 'audio',
  weba: 'audio',
}

/**
 * @param path - repository-relative file path.
 * @returns the media kind when the extension is one the host can embed.
 */
export function mediaKindOf(path: string): 'image' | 'audio' | null {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return null
  return MEDIA_KINDS[path.slice(dot + 1).toLowerCase()] ?? null
}
