/**
 * File history: the commits that touched one path, and the diff of that path in
 * one of them. Used by the "change history" window opened from a changed file.
 */
import { resolve, sep } from 'node:path'
import { RouteError } from '../errors.js'
import { gitFailure, runGit } from '../git.js'
import { lfsChangeInSection, type LfsChange } from '../lfs.js'
import { resolveRepository } from '../repository.js'
import type { RouteContext } from '../types.js'

const MAX_PATCH_CHARS = 400_000
const MAX_COMMITS = 200
const HASH = /^[0-9a-f]{4,64}$/
const SEP = '\u001f'

/** One commit in a file's history. */
export interface FileHistoryCommit {
  hash: string
  shortHash: string
  author: string
  date: string
  subject: string
}

/** Validate the `file` parameter and keep it inside the repository. */
function relativeFile(repoRoot: string, file: string): string {
  const clean = file.trim()
  if (clean === '' || clean.includes('\0')) {
    throw new RouteError(400, 'invalid-path', 'A file path is required.', { path: repoRoot })
  }
  const absolute = resolve(repoRoot, clean)
  if (absolute !== repoRoot && !absolute.startsWith(repoRoot + sep)) {
    throw new RouteError(400, 'invalid-path', 'That path is outside the repository.', { path: repoRoot })
  }
  return clean
}

/**
 * List the commits that touched one path.
 * @param context - route context.
 * @param url - `path` and `file` parameters.
 * @param signal - aborts the git calls.
 */
export async function readFileLog(
  context: RouteContext,
  url: URL,
  signal: AbortSignal,
): Promise<{ ok: true; file: string; commits: FileHistoryCommit[] }> {
  const repo = await resolveRepository(context, url.searchParams.get('path'), signal)
  const file = relativeFile(repo.root, url.searchParams.get('file') ?? '')
  try {
    const output = await runGit(repo.root, [
      'log',
      '-z',
      '--follow',
      '--no-color',
      '--date=iso-strict',
      `--max-count=${MAX_COMMITS}`,
      `--pretty=format:%H${SEP}%h${SEP}%an${SEP}%aI${SEP}%s`,
      '--',
      file,
    ], signal)
    const commits: FileHistoryCommit[] = []
    for (const record of output.split('\0')) {
      const line = record.replace(/^\r?\n+/, '')
      if (line === '') continue
      const [hash = '', shortHash = '', author = '', date = '', ...subject] = line.split(SEP)
      if (!HASH.test(hash)) continue
      commits.push({ hash, shortHash, author, date, subject: subject.join(SEP) })
    }
    return { ok: true, file, commits }
  } catch (error) {
    throw gitFailure(error)
  }
}

/** One commit's patch for one path. */
export interface FileCommitDiffPayload {
  ok: true
  file: string
  hash: string
  patch: string
  binary: boolean
  truncated: boolean
  /** Present when the change only rewrites a Git LFS pointer. */
  lfs?: LfsChange
}

/**
 * The patch one commit made to one path.
 * @param context - route context.
 * @param url - `path`, `hash`, and `file` parameters.
 * @param signal - aborts the git calls.
 */
export async function readFileCommitDiff(
  context: RouteContext,
  url: URL,
  signal: AbortSignal,
): Promise<FileCommitDiffPayload> {
  const repo = await resolveRepository(context, url.searchParams.get('path'), signal)
  const hash = (url.searchParams.get('hash') ?? '').trim().toLowerCase()
  if (!HASH.test(hash)) {
    throw new RouteError(400, 'invalid-commit', 'A commit hash is required.', { path: repo.root })
  }
  const file = relativeFile(repo.root, url.searchParams.get('file') ?? '')
  try {
    const patch = await runGit(repo.root, [
      'show',
      '--no-color',
      '--no-ext-diff',
      '--format=',
      '--unified=3',
      '--first-parent',
      hash,
      '--',
      file,
    ], signal)
    const lfs = lfsChangeInSection(patch)
    const truncated = patch.length > MAX_PATCH_CHARS
    return {
      ok: true,
      file,
      hash,
      patch: truncated ? patch.slice(0, MAX_PATCH_CHARS) : patch,
      binary: /^Binary files /m.test(patch),
      truncated,
      ...(lfs === null ? {} : { lfs }),
    }
  } catch (error) {
    throw gitFailure(error)
  }
}
