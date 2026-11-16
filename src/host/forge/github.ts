import type { PullChecks, PullComment, PullCommit, PullCreateInput, PullListState, PullDetail, PullFile, PullMergeInput, PullMergeResult, PullReview, PullSummary } from '../types.js'
import type { ForgeTarget } from './detect.js'
import { forgeJson } from './http.js'

interface GitHubUser {
  login?: string
}

interface GitHubRepository {
  clone_url?: string
}

interface GitHubPull {
  number?: number
  title?: string
  state?: string
  draft?: boolean
  merged_at?: string | null
  user?: GitHubUser | null
  head?: { ref?: string; sha?: string; repo?: GitHubRepository | null } | null
  base?: { ref?: string } | null
  created_at?: string
  updated_at?: string
  html_url?: string
  body?: string | null
  additions?: number
  deletions?: number
  changed_files?: number
  mergeable?: boolean | null
}

interface GitHubFile {
  filename?: string
  previous_filename?: string
  status?: string
  additions?: number
  deletions?: number
  patch?: string
}

interface GitHubCommit {
  sha?: string
  commit?: {
    message?: string
    author?: { name?: string; date?: string } | null
  }
  author?: GitHubUser | null
}

interface GitHubStatus {
  state?: string
  total_count?: number
  statuses?: Array<{ state?: string; target_url?: string }>
}

interface GitHubCheckRuns {
  total_count?: number
  check_runs?: Array<{ status?: string; conclusion?: string | null; html_url?: string }>
}

interface GitHubComment {
  id?: number
  user?: GitHubUser | null
  body?: string | null
  created_at?: string
  html_url?: string
}

interface GitHubReview {
  user?: GitHubUser | null
  state?: string
}

const PAGE_SIZE = 30

function repoPath(target: ForgeTarget): string {
  return `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`
}

function stateOf(pull: GitHubPull): PullSummary['state'] {
  if (pull.state === 'open') return 'open'
  return typeof pull.merged_at === 'string' && pull.merged_at !== '' ? 'merged' : 'closed'
}

function fileStatus(status: string | undefined): string {
  if (status === 'removed') return 'deleted'
  if (status === 'added' || status === 'renamed' || status === 'copied') return status
  return 'modified'
}

function summary(pull: GitHubPull): PullSummary {
  return {
    number: typeof pull.number === 'number' ? pull.number : 0,
    title: typeof pull.title === 'string' ? pull.title : '',
    state: stateOf(pull),
    draft: pull.draft === true,
    author: typeof pull.user?.login === 'string' ? pull.user.login : '',
    sourceBranch: typeof pull.head?.ref === 'string' ? pull.head.ref : '',
    targetBranch: typeof pull.base?.ref === 'string' ? pull.base.ref : '',
    createdAt: typeof pull.created_at === 'string' ? pull.created_at : '',
    updatedAt: typeof pull.updated_at === 'string' ? pull.updated_at : '',
    webUrl: typeof pull.html_url === 'string' ? pull.html_url : '',
  }
}

function fileOf(file: GitHubFile): PullFile {
  return {
    path: file.filename ?? file.previous_filename ?? '',
    status: fileStatus(file.status),
    additions: typeof file.additions === 'number' ? file.additions : null,
    deletions: typeof file.deletions === 'number' ? file.deletions : null,
    patch: typeof file.patch === 'string' ? file.patch : '',
    binary: false,
  }
}

function commitOf(commit: GitHubCommit): PullCommit {
  const hash = typeof commit.sha === 'string' ? commit.sha : ''
  const message = typeof commit.commit?.message === 'string' ? commit.commit.message : ''
  return {
    hash,
    shortHash: hash.slice(0, 7),
    subject: message.split('\n')[0] ?? '',
    author: commit.commit?.author?.name ?? commit.author?.login ?? '',
    date: typeof commit.commit?.author?.date === 'string' ? commit.commit.author.date : '',
  }
}

export async function listGithubPulls(
  target: ForgeTarget,
  token: string | null,
  state: PullListState,
  signal?: AbortSignal,
  fresh = false,
  page = 1,
): Promise<PullSummary[]> {
  // GitHub has no merged state: merged requests are closed ones with merged_at set.
  const query = state === 'all' ? 'state=all' : state === 'open' ? 'state=open' : 'state=closed'
  const pulls = await forgeJson<GitHubPull[]>(
    target,
    `${repoPath(target)}/pulls?${query}&sort=updated&direction=desc&per_page=${PAGE_SIZE}&page=${page}`,
    token,
    signal,
    { fresh },
  )
  const list = Array.isArray(pulls) ? pulls.map(summary) : []
  return state === 'merged' ? list.filter(pull => pull.state === 'merged') : list
}

export async function closeGithubPull(
  target: ForgeTarget,
  number: number,
  token: string | null,
  signal?: AbortSignal,
): Promise<void> {
  await forgeJson<unknown>(target, `${repoPath(target)}/pulls/${number}`, token, signal, {
    method: 'PATCH',
    body: { state: 'closed' },
  })
}

export async function reopenGithubPull(
  target: ForgeTarget,
  number: number,
  token: string | null,
  signal?: AbortSignal,
): Promise<void> {
  await forgeJson<unknown>(target, `${repoPath(target)}/pulls/${number}`, token, signal, {
    method: 'PATCH',
    body: { state: 'open' },
  })
}

export async function createGithubPull(
  target: ForgeTarget,
  token: string,
  input: PullCreateInput,
  signal?: AbortSignal,
): Promise<PullSummary> {
  const pull = await forgeJson<GitHubPull>(target, `${repoPath(target)}/pulls`, token, signal, {
    method: 'POST',
    body: {
      title: input.title,
      head: input.head,
      base: input.base,
      body: input.body,
      draft: input.draft,
    },
  })
  return summary(pull)
}

export async function mergeGithubPull(
  target: ForgeTarget,
  number: number,
  token: string,
  input: PullMergeInput,
  sourceBranch: string,
  signal?: AbortSignal,
): Promise<PullMergeResult> {
  const result = await forgeJson<{ merged?: boolean; message?: string; sha?: string }>(
    target,
    `${repoPath(target)}/pulls/${number}/merge`,
    token,
    signal,
    { method: 'PUT', body: { merge_method: input.method } },
  )
  const merged = result?.merged === true
  let branchDeleted = false
  if (merged && input.deleteSourceBranch && sourceBranch !== '') {
    // GitHub deletes branches separately; forks will reject this harmlessly.
    const path = sourceBranch.split('/').map(encodeURIComponent).join('/')
    try {
      await forgeJson<unknown>(target, `${repoPath(target)}/git/refs/heads/${path}`, token, signal, { method: 'DELETE' })
      branchDeleted = true
    } catch {
      branchDeleted = false
    }
  }
  return {
    merged,
    message: typeof result?.message === 'string' ? result.message : '',
    sha: typeof result?.sha === 'string' ? result.sha : null,
    branchDeleted,
  }
}

function commentOf(comment: GitHubComment): PullComment {
  return {
    id: String(comment.id ?? ''),
    author: comment.user?.login ?? '',
    body: typeof comment.body === 'string' ? comment.body : '',
    createdAt: comment.created_at ?? '',
    url: typeof comment.html_url === 'string' ? comment.html_url : null,
  }
}

function reviewFrom(reviews: GitHubReview[]): PullReview | null {
  if (reviews.length === 0) return null
  const latest = new Map<string, string>()
  for (const review of reviews) {
    const login = review.user?.login ?? ''
    const state = typeof review.state === 'string' ? review.state : ''
    if (login === '' || state === '' || state === 'COMMENTED') continue
    latest.set(login, state)
  }
  let approvals = 0
  let changesRequested = 0
  for (const state of latest.values()) {
    if (state === 'APPROVED') approvals += 1
    if (state === 'CHANGES_REQUESTED') changesRequested += 1
  }
  return {
    state: changesRequested > 0 ? 'changes_requested' : approvals > 0 ? 'approved' : 'pending',
    approvals,
    changesRequested,
  }
}

function checksFrom(status: GitHubStatus | null, runs: GitHubCheckRuns | null): PullChecks | null {
  const statuses = Array.isArray(status?.statuses) ? status.statuses : []
  const checks = Array.isArray(runs?.check_runs) ? runs.check_runs : []
  const total = (status?.total_count ?? statuses.length) + (runs?.total_count ?? checks.length)
  if (total === 0) return null
  let failure = false
  let pending = false
  for (const entry of statuses) {
    if (entry.state === 'failure' || entry.state === 'error') failure = true
    else if (entry.state === 'pending') pending = true
  }
  for (const check of checks) {
    if (check.conclusion === 'failure' || check.conclusion === 'timed_out' || check.conclusion === 'cancelled' || check.conclusion === 'action_required' || check.conclusion === 'startup_failure') {
      failure = true
    } else if (check.status === 'queued' || check.status === 'in_progress' || check.status === 'requested' || check.status === 'waiting' || check.status === 'pending') {
      pending = true
    }
  }
  if (status?.state === 'failure' || status?.state === 'error') failure = true
  if (status?.state === 'pending') pending = true
  const url = statuses.find(entry => typeof entry.target_url === 'string' && entry.target_url !== '')?.target_url
    ?? checks.find(check => typeof check.html_url === 'string' && check.html_url !== '')?.html_url
    ?? null
  return { state: failure ? 'failure' : pending ? 'pending' : 'success', total, url }
}

export async function getGithubPull(
  target: ForgeTarget,
  number: number,
  token: string | null,
  signal?: AbortSignal,
  fresh = false,
): Promise<PullDetail> {
  const base = `${repoPath(target)}/pulls/${number}`
  const [pull, files, commits, comments, reviews] = await Promise.all([
    forgeJson<GitHubPull>(target, base, token, signal, { fresh }),
    forgeJson<GitHubFile[]>(target, `${base}/files?per_page=100`, token, signal, { fresh }).catch(() => [] as GitHubFile[]),
    forgeJson<GitHubCommit[]>(target, `${base}/commits?per_page=100`, token, signal, { fresh }).catch(() => [] as GitHubCommit[]),
    forgeJson<GitHubComment[]>(target, `${repoPath(target)}/issues/${number}/comments?per_page=100`, token, signal, { fresh }).catch(() => [] as GitHubComment[]),
    forgeJson<GitHubReview[]>(target, `${base}/reviews?per_page=100`, token, signal, { fresh }).catch(() => [] as GitHubReview[]),
  ])
  const fileList = Array.isArray(files) ? files.map(fileOf) : []
  const commitList = Array.isArray(commits) ? commits.map(commitOf) : []
  const commentList = Array.isArray(comments) ? comments.map(commentOf) : []
  const review = reviewFrom(Array.isArray(reviews) ? reviews : [])
  const sha = typeof pull.head?.sha === 'string' ? pull.head.sha : ''
  const [status, runs] = sha === ''
    ? [null, null]
    : await Promise.all([
        forgeJson<GitHubStatus>(target, `${repoPath(target)}/commits/${sha}/status`, token, signal, { fresh }).catch(() => null),
        forgeJson<GitHubCheckRuns>(target, `${repoPath(target)}/commits/${sha}/check-runs?per_page=100`, token, signal, { fresh }).catch(() => null),
      ])
  return {
    ...summary(pull),
    body: typeof pull.body === 'string' ? pull.body : '',
    additions: typeof pull.additions === 'number' ? pull.additions : null,
    deletions: typeof pull.deletions === 'number' ? pull.deletions : null,
    changedFiles: typeof pull.changed_files === 'number' ? pull.changed_files : fileList.length,
    mergeable: typeof pull.mergeable === 'boolean' ? pull.mergeable : null,
    headRepoUrl: typeof pull.head?.repo?.clone_url === 'string' ? pull.head.repo.clone_url : null,
    files: fileList,
    commits: commitList,
    filesTruncated: fileList.length >= 100 || (typeof pull.changed_files === 'number' && pull.changed_files > fileList.length),
    checks: checksFrom(status, runs),
    review,
    comments: commentList,
  }
}
