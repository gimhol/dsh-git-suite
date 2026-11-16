import type { PullCreateInput, PullListState, PullDetail, PullMergeInput, PullMergeResult, PullSummary } from '../types.js'
import type { ForgeTarget } from './detect.js'
import { getGiteePull, listGiteePulls, closeGiteePull, reopenGiteePull, createGiteePull, mergeGiteePull, reviewGiteePull, testGiteePull } from './gitee.js'
import { getGithubPull, listGithubPulls, closeGithubPull, reopenGithubPull, createGithubPull, mergeGithubPull } from './github.js'
import { getGitlabPull, listGitlabPulls, closeGitlabPull, reopenGitlabPull, createGitlabPull, mergeGitlabPull, deleteGitlabPull } from './gitlab.js'
import { forgeJson } from './http.js'

/** One page of pull requests; the list route reports whether more may exist. */
export const PULL_PAGE_SIZE = 30

/** Read one page of pull requests from the forge that owns this remote. */
export function listPulls(
  target: ForgeTarget,
  token: string | null,
  state: PullListState,
  signal?: AbortSignal,
  fresh = false,
  page = 1,
): Promise<PullSummary[]> {
  if (target.provider === 'github') return listGithubPulls(target, token, state, signal, fresh, page)
  if (target.provider === 'gitee') return listGiteePulls(target, token, state, signal, fresh, page)
  return listGitlabPulls(target, token, state, signal, fresh, page)
}

/** Read one pull request with its files and commits. */
export function getPull(
  target: ForgeTarget,
  number: number,
  token: string | null,
  signal?: AbortSignal,
  fresh = false,
): Promise<PullDetail> {
  if (target.provider === 'github') return getGithubPull(target, number, token, signal, fresh)
  if (target.provider === 'gitee') return getGiteePull(target, number, token, signal, fresh)
  return getGitlabPull(target, number, token, signal, fresh)
}

/**
 * Close one pull/merge request. The close is a state change on the forge; the
 * source branch is left alone.
 */
export function closePull(
  target: ForgeTarget,
  number: number,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  if (target.provider === 'github') return closeGithubPull(target, number, token, signal)
  if (target.provider === 'gitee') return closeGiteePull(target, number, token, signal)
  return closeGitlabPull(target, number, token, signal)
}

/** Reopen a previously closed pull/merge request. */
export function reopenPull(
  target: ForgeTarget,
  number: number,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  if (target.provider === 'github') return reopenGithubPull(target, number, token, signal)
  if (target.provider === 'gitee') return reopenGiteePull(target, number, token, signal)
  return reopenGitlabPull(target, number, token, signal)
}

/** Permanently delete a merge request. GitLab is the only supported forge. */
export function deletePull(
  target: ForgeTarget,
  number: number,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  return deleteGitlabPull(target, number, token, signal)
}

/** Mark one of Gitee's required approval steps (review or test). */
export function decideGiteePull(
  target: ForgeTarget,
  number: number,
  token: string,
  action: 'review' | 'test',
  signal?: AbortSignal,
): Promise<void> {
  return action === 'review'
    ? reviewGiteePull(target, number, token, signal)
    : testGiteePull(target, number, token, signal)
}

/** Open a new pull/merge request from `head` into `base` on the same remote. */
export function createPull(
  target: ForgeTarget,
  token: string,
  input: PullCreateInput,
  signal?: AbortSignal,
): Promise<PullSummary> {
  if (target.provider === 'github') return createGithubPull(target, token, input, signal)
  if (target.provider === 'gitee') return createGiteePull(target, token, input, signal)
  return createGitlabPull(target, token, input, signal)
}

/** Merge a pull request; GitHub also needs the source branch for optional deletion. */
export function mergePull(
  target: ForgeTarget,
  number: number,
  token: string,
  input: PullMergeInput,
  sourceBranch: string,
  signal?: AbortSignal,
): Promise<PullMergeResult> {
  if (target.provider === 'github') return mergeGithubPull(target, number, token, input, sourceBranch, signal)
  if (target.provider === 'gitee') return mergeGiteePull(target, number, token, input, signal)
  return mergeGitlabPull(target, number, token, input, signal)
}

/**
 * The account a token belongs to, used as the git credential username. Gitee's
 * git HTTPS transport requires the real account name (not a placeholder), so
 * storing it correctly is what makes later fetches and pushes work.
 */
export async function readForgeLogin(
  target: ForgeTarget,
  token: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const user = await forgeJson<{ login?: unknown; username?: unknown }>(
      target,
      '/user',
      token,
      signal,
      { fresh: true },
    )
    if (typeof user.login === 'string' && user.login.trim() !== '') return user.login.trim()
    if (typeof user.username === 'string' && user.username.trim() !== '') return user.username.trim()
  } catch {
    // A token without the user scope still saves; the caller falls back.
  }
  return null
}
