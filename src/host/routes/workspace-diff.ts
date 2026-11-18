import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { RouteError } from '../errors.js'
import { gitFailure, runGit } from '../git.js'
import { lfsChangeInSection, pointerFromBytes, readBlobExpanded } from '../lfs.js'
import { mediaSide, mediaType } from '../media.js'
import { resolveRepository } from '../repository.js'
import type { RouteContext, WorkspaceDiff, WorkspaceDiffMedia, WorkspaceDiffMediaSide } from '../types.js'

const MAX_PATCH_CHARS = 400_000

/**
 * Describe both sides of an image or audio change: unstaged compares the index
 * with the working tree, staged compares `HEAD` with the index, untracked has no
 * old side. Git sides resolve LFS payloads, through the checkout filters or the
 * local LFS object store.
 */
async function readMediaDiff(
  root: string,
  absolute: string,
  file: string,
  scope: 'staged' | 'unstaged' | 'untracked',
  kind: 'image' | 'audio',
  mime: string,
  signal: AbortSignal,
): Promise<WorkspaceDiffMedia> {
  const fromGit = (spec: string) => mediaSide(mime, async () => {
    const blob = await readBlobExpanded(root, spec, signal)
    return { bytes: blob.bytes, pointer: blob.pointer !== null }
  })
  const fromDisk = () => mediaSide(mime, async () => {
    const bytes = await readFile(absolute)
    return { bytes, pointer: pointerFromBytes(bytes) !== null }
  })
  let before: WorkspaceDiffMediaSide
  let after: WorkspaceDiffMediaSide
  if (scope === 'untracked') {
    before = { dataUrl: null, reason: 'absent' }
    after = await fromDisk()
  } else if (scope === 'unstaged') {
    before = await fromGit(`:${file}`)
    after = await fromDisk()
  } else {
    before = await fromGit(`HEAD:${file}`)
    after = await fromGit(`:${file}`)
  }
  return { kind, mime, before, after }
}

/** Build the `/dev/null -> file` diff Git would show for an untracked file. */
function untrackedPatch(path: string, text: string): string {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const body = lines.map(line => `+${line}`).join('\n')
  return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${body}\n`
}

/** Diff one path for the staged, unstaged, or untracked list. */
export async function readWorkspaceDiff(
  context: RouteContext,
  url: URL,
  signal: AbortSignal,
): Promise<{ ok: true; diff: WorkspaceDiff }> {
  const repo = await resolveRepository(context, url.searchParams.get('path'), signal)
  const file = (url.searchParams.get('file') ?? '').trim()
  const scope = url.searchParams.get('scope')
  if (file === '' || file.includes('\0')) {
    throw new RouteError(400, 'invalid-path', 'A file path is required.', { path: repo.root })
  }
  if (scope !== 'staged' && scope !== 'unstaged' && scope !== 'untracked') {
    throw new RouteError(400, 'invalid-scope', 'The diff scope must be staged, unstaged, or untracked.')
  }
  const absolute = resolve(repo.root, file)
  if (absolute !== repo.root && !absolute.startsWith(repo.root + sep)) {
    throw new RouteError(400, 'invalid-path', 'That path is outside the repository.', { path: repo.root })
  }

  try {
    // Images and audio have no text to diff; hand the client both sides instead.
    const media = mediaType(file)
    if (media !== null) {
      const payload = await readMediaDiff(repo.root, absolute, file, scope, media.kind, media.mime, signal)
      return {
        ok: true,
        diff: { path: file, scope, patch: '', binary: true, truncated: false, media: payload },
      }
    }

    if (scope === 'untracked') {
      const content = await readFile(absolute)
      if (content.includes(0)) {
        const patch = `Binary files /dev/null and b/${file} differ\n`
        return { ok: true, diff: { path: file, scope, patch, binary: true, truncated: false } }
      }
      // A skipped-smudge checkout leaves the pointer itself in the working tree.
      const pointer = pointerFromBytes(content)
      if (pointer !== null) {
        return {
          ok: true,
          diff: { path: file, scope, patch: '', binary: false, truncated: false, lfs: { before: null, after: pointer } },
        }
      }
      const patch = untrackedPatch(file, content.toString('utf8'))
      const truncated = patch.length > MAX_PATCH_CHARS
      return {
        ok: true,
        diff: {
          path: file,
          scope,
          patch: truncated ? patch.slice(0, MAX_PATCH_CHARS) : patch,
          binary: false,
          truncated,
        },
      }
    }

    const args = scope === 'staged'
      ? ['diff', '--cached', '--no-color', '--no-ext-diff', '--find-renames', '--unified=3', '--', file]
      : ['diff', '--no-color', '--no-ext-diff', '--find-renames', '--unified=3', '--', file]
    const patch = await runGit(repo.root, args, signal)
    // An LFS file diffs as its pointer; the pointer lines are not content and
    // would offer partial staging that corrupts the pointer, so report the
    // pointer change on its own.
    const lfs = lfsChangeInSection(patch)
    if (lfs !== null) {
      return { ok: true, diff: { path: file, scope, patch: '', binary: false, truncated: false, lfs } }
    }
    const truncated = patch.length > MAX_PATCH_CHARS
    return {
      ok: true,
      diff: {
        path: file,
        scope,
        patch: truncated ? patch.slice(0, MAX_PATCH_CHARS) : patch,
        binary: /^Binary files /m.test(patch),
        truncated,
      },
    }
  } catch (error) {
    throw gitFailure(error)
  }
}
