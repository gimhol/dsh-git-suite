import { basename } from 'node:path'
import { RouteError } from '../errors.js'
import { gitFailure, runGit } from '../git.js'
import { isCommitHash, isLogRef, parseLimit, parseLog, parseOffset } from '../parsers.js'
import { resolveRepository } from '../repository.js'
import type { Commit, RouteContext } from '../types.js'

const DEFAULT_LIMIT = 50

export type LogScope = 'head' | 'all' | 'remotes' | 'ref' | 'stash'

export interface LogPayload {
  ok: true
  repoRoot: string
  repoName: string
  branch: string
  scope: LogScope
  ref: string | null
  limit: number
  offset: number
  hasMore: boolean
  nextOffset: number
  defaultPath: string
  /** Working tree of the superproject when this repository is a submodule. */
  superproject: string | null
  commits: Commit[]
}

/** Read one page of commits for the selected refs. */
export async function readLog(context: RouteContext, url: URL, signal: AbortSignal): Promise<LogPayload> {
  const repo = await resolveRepository(context, url.searchParams.get('path'), signal)
  const requestedScope = url.searchParams.get('scope') ?? ''
  const stash = requestedScope === 'stash'
  const limit = stash ? 1 : parseLimit(url.searchParams.get('limit'), DEFAULT_LIMIT)
  const offset = stash ? 0 : parseOffset(url.searchParams.get('offset'))
  const ref = (url.searchParams.get('ref') ?? '').trim()
  const sort: 'date' | 'topo' = url.searchParams.get('sort') === 'topo' ? 'topo' : 'date'
  const showRemotes = url.searchParams.get('remotes') === '1'
  const orderArgs = [sort === 'topo' ? '--topo-order' : '--date-order']
  const limitArgs = limit > 0 ? ['-n', String(limit + 1)] : []
  const offsetArgs = offset > 0 ? [`--skip=${offset}`] : []
  let refArgs: string[] = []
  let scope: LogScope = 'head'

  if (requestedScope === 'all') {
    refArgs = showRemotes ? ['--branches', '--remotes'] : ['--branches']
    scope = 'all'
  } else if (requestedScope === 'remotes') {
    refArgs = ['--remotes']
    scope = 'remotes'
  } else if (stash) {
    if (!isCommitHash(ref)) {
      throw new RouteError(400, 'invalid-ref', 'That stash reference is not valid.', { path: repo.root })
    }
    try {
      await runGit(repo.root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], signal)
    } catch {
      throw new RouteError(400, 'stash-not-found', 'That stash could not be resolved in this repository.', {
        path: repo.root,
        ref,
      })
    }
    refArgs = [ref]
    scope = 'stash'
  } else if (ref !== '') {
    if (!isLogRef(ref)) {
      throw new RouteError(400, 'invalid-ref', 'That ref is not valid.', { path: repo.root })
    }
    try {
      await runGit(repo.root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], signal)
    } catch {
      throw new RouteError(400, 'ref-not-found', 'That ref could not be resolved in this repository.', {
        path: repo.root,
        ref,
      })
    }
    refArgs = [ref]
    scope = 'ref'
  }

  // `%D` decorates with every ref pointing at a commit, remote-tracking ones
  // included, so hiding remotes has to exclude them explicitly or the history
  // keeps showing `origin/main` next to the branch.
  const decorateArgs = !showRemotes && (scope === 'head' || scope === 'all')
    ? ['--decorate-refs-exclude=refs/remotes/*']
    : []

  const logArgs = stash
    ? [
        '--no-walk',
        '--date=iso-strict',
        '--encoding=UTF-8',
        '--decorate=short',
        ...decorateArgs,
        '-z',
        '--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%P%x1f%D%x1f%s',
        '-n',
        '1',
        ...refArgs,
      ]
    : [
        ...orderArgs,
        '--date=iso-strict',
        '--encoding=UTF-8',
        '--decorate=short',
        ...decorateArgs,
        '-z',
        '--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%P%x1f%D%x1f%s',
        ...offsetArgs,
        ...limitArgs,
        ...refArgs,
      ]

  try {
    const [branchOutput, logOutput, superprojectOutput] = await Promise.all([
      runGit(repo.root, ['branch', '--show-current'], signal),
      runGit(repo.root, ['log', ...logArgs], signal),
      runGit(repo.root, ['rev-parse', '--show-superproject-working-tree'], signal).catch(() => ''),
    ])

    const branch = branchOutput.trim() === '' ? 'detached' : branchOutput.trim()
    const superproject = superprojectOutput.trim()
    const commits = parseLog(logOutput)
    const hasMore = !stash && limit > 0 && commits.length > limit
    const page = stash ? commits.slice(0, 1) : hasMore ? commits.slice(0, limit) : commits
    return {
      ok: true,
      repoRoot: repo.root,
      repoName: basename(repo.root) || repo.root,
      branch,
      scope,
      ref: ref === '' ? null : ref,
      limit,
      offset,
      hasMore,
      nextOffset: offset + page.length,
      defaultPath: context.defaultPath(),
      superproject: superproject === '' ? null : superproject,
      commits: page,
    }
  } catch (error) {
    throw gitFailure(error).withDetails({ path: repo.root })
  }
}
