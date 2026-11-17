import { RouteError } from '../errors.js'
import { gitFailure, runGit } from '../git.js'
import { lfsChangeInSection, pointersForSpecs, splitPatchSections } from '../lfs.js'
import { parseCommitHeader, parseNumstat } from '../parsers.js'
import { resolveRepository } from '../repository.js'
import type { CommitDetail, RouteContext } from '../types.js'

const MAX_PATCH_CHARS = 400_000
const HASH = /^[0-9a-f]{4,64}$/

export interface CommitPayload {
  ok: true
  commit: CommitDetail
}

/** Read one commit's header, changed files, and patch. */
export async function readCommit(context: RouteContext, url: URL, signal: AbortSignal): Promise<CommitPayload> {
  const repo = await resolveRepository(context, url.searchParams.get('path'), signal)
  const hash = (url.searchParams.get('hash') ?? '').trim().toLowerCase()
  if (!HASH.test(hash)) {
    throw new RouteError(400, 'invalid-commit', 'A commit hash is required.', { path: repo.root })
  }

  try {
    const [headerOutput, numstatOutput, patchOutput] = await Promise.all([
      runGit(repo.root, [
        'show',
        '-s',
        '--encoding=UTF-8',
        '--date=iso-strict',
        '--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%P%x1f%D%x1f%s%x1f%b',
        hash,
      ], signal),
      runGit(repo.root, [
        'show',
        '--no-color',
        '--no-ext-diff',
        '--format=',
        '--numstat',
        '--find-renames',
        // A merge commit has no default patch; `--first-parent` diffs it
        // against the branch it was merged into, which is also what the file
        // list shows.
        '--first-parent',
        hash,
      ], signal),
      runGit(repo.root, [
        'show',
        '--no-color',
        '--no-ext-diff',
        '--format=',
        '--patch',
        '--find-renames',
        '--unified=3',
        '--first-parent',
        hash,
      ], signal),
    ])

    const commit = parseCommitHeader(headerOutput)
    const files = parseNumstat(numstatOutput)
    // A file stored in Git LFS diffs as its pointer; mark those entries so the
    // client can describe the pointer change instead of showing three text lines.
    const sections = splitPatchSections(patchOutput)
    for (const [index, file] of files.entries()) {
      const section = sections[index]
      if (section === undefined) continue
      const lfs = lfsChangeInSection(section)
      if (lfs !== null) file.lfs = lfs
    }
    // A binary-attribute LFS file has no pointer rows in its patch, so read the
    // blob only when it is pointer-sized; a real binary is never read.
    const unmarked = files.filter(file => file.binary && file.lfs === undefined && !file.path.includes(':'))
    if (unmarked.length > 0) {
      const parent = commit.parents[0]
      const specs: string[] = []
      for (const file of unmarked) {
        specs.push(`${hash}:${file.path}`)
        if (parent !== undefined) specs.push(`${parent}:${file.path}`)
      }
      const pointers = await pointersForSpecs(repo.root, specs, signal)
      for (const file of unmarked) {
        const after = pointers.get(`${hash}:${file.path}`) ?? null
        const before = parent === undefined ? null : pointers.get(`${parent}:${file.path}`) ?? null
        if (after !== null || before !== null) file.lfs = { before, after }
      }
    }
    const patchTruncated = patchOutput.length > MAX_PATCH_CHARS
    return {
      ok: true,
      commit: {
        ...commit,
        files,
        patch: patchTruncated ? patchOutput.slice(0, MAX_PATCH_CHARS) : patchOutput,
        patchTruncated,
      },
    }
  } catch (error) {
    throw gitFailure(error).withDetails({ path: repo.root, hash })
  }
}
