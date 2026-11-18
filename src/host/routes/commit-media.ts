/**
 * `/git-suite?mode=commit-media`: both sides of an image or audio file in one
 * commit, so the history diff can render the media instead of a pointer or a
 * binary note. LFS payloads resolve through the checkout filters and then the
 * local LFS object store.
 */
import { RouteError } from '../errors.js'
import { gitFailure, runGit } from '../git.js'
import { readBlobExpanded } from '../lfs.js'
import { mediaSide, mediaType } from '../media.js'
import { resolveRepository } from '../repository.js'
import type { RouteContext, WorkspaceDiffMedia } from '../types.js'

const HASH = /^[0-9a-f]{4,64}$/

/**
 * Read the before/after media of one file in a commit.
 * @param context - route context.
 * @param url - `path`, `hash`, and `file` parameters.
 * @param signal - aborts the git calls.
 */
export async function readCommitMedia(
  context: RouteContext,
  url: URL,
  signal: AbortSignal,
): Promise<{ ok: true; media: WorkspaceDiffMedia }> {
  const repo = await resolveRepository(context, url.searchParams.get('path'), signal)
  const hash = (url.searchParams.get('hash') ?? '').trim().toLowerCase()
  if (!HASH.test(hash)) {
    throw new RouteError(400, 'invalid-commit', 'A commit hash is required.', { path: repo.root })
  }
  const file = (url.searchParams.get('file') ?? '').trim()
  if (file === '' || file.includes('\0')) {
    throw new RouteError(400, 'invalid-path', 'A file path is required.', { path: repo.root })
  }
  const media = mediaType(file)
  if (media === null) {
    throw new RouteError(400, 'not-media', 'That file is not an image or audio file.', { path: file })
  }

  try {
    // A root commit has no parent; both sides then read as absent/added.
    const parent = (await runGit(repo.root, ['rev-parse', '--verify', '--quiet', `${hash}^`], signal)
      .catch(() => '')).trim()
    const side = (spec: string) => mediaSide(media.mime, async () => {
      const blob = await readBlobExpanded(repo.root, spec, signal)
      return { bytes: blob.bytes, pointer: blob.pointer !== null }
    })
    const before = parent === ''
      ? { dataUrl: null, reason: 'absent' as const }
      : await side(`${parent}:${file}`)
    const after = await side(`${hash}:${file}`)
    return { ok: true, media: { kind: media.kind, mime: media.mime, before, after } }
  } catch (error) {
    throw gitFailure(error)
  }
}
