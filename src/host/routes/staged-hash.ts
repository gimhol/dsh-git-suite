/**
 * `/git-suite?mode=staged-hash`: the hash of the current staged diff.
 *
 * The commit review dialog keeps the hash its review was produced for, and
 * compares it with this value to warn when the staged content has changed.
 */
import { createHash } from 'node:crypto'
import { runGit } from '../git.js'
import { resolveRepository } from '../repository.js'
import type { RouteContext } from '../types.js'

/** @returns the current staged patch hash, plus whether anything is staged. */
export async function readStagedHash(
  context: RouteContext,
  url: URL,
  signal: AbortSignal,
): Promise<{ ok: true; hash: string; empty: boolean }> {
  const repo = await resolveRepository(context, url.searchParams.get('path'), signal)
  const patch = await runGit(
    repo.root,
    ['diff', '--cached', '--no-color', '--no-ext-diff', '--find-renames', '--unified=3'],
    signal,
  )
  return {
    ok: true,
    hash: createHash('sha256').update(patch).digest('hex'),
    empty: patch.trim() === '',
  }
}
