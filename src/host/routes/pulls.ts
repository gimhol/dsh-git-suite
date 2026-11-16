import { RouteError } from '../errors.js'
import { detectForge, toForgeInfo, type ForgeTarget } from '../forge/detect.js'
import { getPull, listPulls, PULL_PAGE_SIZE } from '../forge/index.js'
import { resolveRemote, readDefaultBase } from '../forge/remote.js'
import { resolveForgeToken } from '../forge/token.js'
import { readReviewCache } from '../pr-review-cache.js'
import { resolveRepository } from '../repository.js'
import type { ForgeInfo, PullDetail, PullSummary, RouteContext } from '../types.js'

export interface PullsPayload {
  ok: true
  remote: string
  state: 'open' | 'closed' | 'merged' | 'all'
  forge: ForgeInfo
  page: number
  pulls: PullSummary[]
  /** The remote's default branch, used to prefill the create form. */
  defaultBase: string
  /** The page was full, so older pull requests may exist. */
  hasMore: boolean
}

export interface PullPayload {
  ok: true
  remote: string
  state: 'open' | 'closed' | 'merged' | 'all'
  forge: ForgeInfo
  pull: PullDetail
  /** Cached AI review matching this PR version, when one exists. */
  cachedReview: string | null
}

interface ResolvedForge {
  remote: string
  target: ForgeTarget
  root: string
}

/** Resolve the repository, remote, and forge shared by both read modes. */
async function resolveForge(context: RouteContext, url: URL, signal: AbortSignal): Promise<ResolvedForge> {
  const repo = await resolveRepository(context, url.searchParams.get('path'), signal)
  const remote = await resolveRemote(repo.root, url.searchParams.get('remote') ?? '', signal)
  const target = detectForge(remote.url)
  if (target === null) {
    throw new RouteError(400, 'forge-unsupported', 'This remote is not hosted on a supported forge.', { remote: remote.name })
  }
  return { remote: remote.name, target, root: repo.root }
}

function annotate(error: unknown, resolved: ResolvedForge): unknown {
  if (error instanceof RouteError) {
    return error.withDetails({ remote: resolved.remote, provider: resolved.target.provider })
  }
  return error
}

function stateFilter(url: URL): 'open' | 'closed' | 'merged' | 'all' {
  const value = url.searchParams.get('state')
  return value === 'closed' || value === 'merged' || value === 'all' ? value : 'open'
}

/** Read one page of open, closed, or all pull requests for this repository. */
export async function readPulls(context: RouteContext, url: URL, signal: AbortSignal): Promise<PullsPayload> {
  const resolved = await resolveForge(context, url, signal)
  const state = stateFilter(url)
  const fresh = url.searchParams.get('fresh') === '1'
  const requestedPage = Number.parseInt(url.searchParams.get('page') ?? '1', 10)
  const page = Number.isFinite(requestedPage) && requestedPage >= 1 && requestedPage <= 100 ? requestedPage : 1
  const defaultBase = await readDefaultBase(resolved.root, resolved.remote, signal)
  let pulls: PullSummary[]
  try {
    const token = await resolveForgeToken(resolved.root, resolved.target, signal)
    pulls = await listPulls(resolved.target, token, state, signal, fresh, page)
  } catch (error) {
    throw annotate(error, resolved)
  }
  const hasMore = pulls.length >= PULL_PAGE_SIZE
  if (state === 'merged') pulls = pulls.filter(pull => pull.state === 'merged')
  return {
    ok: true,
    remote: resolved.remote,
    state,
    forge: toForgeInfo(resolved.target),
    page,
    pulls,
    defaultBase,
    hasMore,
  }
}

/** Read one pull request with its description, files, and commits. */
export async function readPull(context: RouteContext, url: URL, signal: AbortSignal): Promise<PullPayload> {
  const resolved = await resolveForge(context, url, signal)
  const raw = (url.searchParams.get('number') ?? '').trim()
  const number = Number.parseInt(raw, 10)
  if (!Number.isInteger(number) || number <= 0 || number > 2_147_483_647 || String(number) !== raw) {
    throw new RouteError(400, 'invalid-number', 'That pull request number is not valid.', { remote: resolved.remote })
  }
  const state = stateFilter(url)
  const fresh = url.searchParams.get('fresh') === '1'
  let pull: PullDetail
  try {
    const token = await resolveForgeToken(resolved.root, resolved.target, signal)
    pull = await getPull(resolved.target, number, token, signal, fresh)
  } catch (error) {
    throw annotate(error, resolved)
  }
  const cachedReview = await readReviewCache(resolved.root, resolved.remote, number, pull.updatedAt)
  return {
    ok: true,
    remote: resolved.remote,
    state,
    forge: toForgeInfo(resolved.target),
    pull,
    cachedReview,
  }
}
