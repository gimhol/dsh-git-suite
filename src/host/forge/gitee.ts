import type { PullApproval, PullComment, PullCommit, PullCreateInput, PullListState, PullDetail, PullFile, PullMergeInput, PullMergeResult, PullSummary } from '../types.js'
import type { ForgeTarget } from './detect.js'
import { forgeJson } from './http.js'

interface GiteeUser {
  login?: string
  accept?: boolean
}

interface GiteePull {
  number?: number
  title?: string
  state?: string
  draft?: boolean
  merged_at?: string | null
  user?: GiteeUser | null
  head?: { ref?: string; repo?: { html_url?: string; full_name?: string } | null } | null
  base?: { ref?: string } | null
  created_at?: string
  updated_at?: string
  html_url?: string
  body?: string | null
  mergeable?: boolean | null
  assignees?: GiteeUser[] | null
  testers?: GiteeUser[] | null
}

interface GiteeFile {
  filename?: string
  new_path?: string
  old_path?: string
  status?: string | null
  additions?: string | number
  deletions?: string | number
  patch?: { diff?: string } | string | null
  new_file?: boolean
  deleted_file?: boolean
  renamed_file?: boolean
  too_large?: boolean
}

interface GiteeCommit {
  sha?: string
  commit?: {
    message?: string
    author?: { name?: string; date?: string } | null
  }
  author?: GiteeUser | null
}

interface GiteeComment {
  id?: number
  user?: { login?: string; name?: string } | null
  body?: string | null
  created_at?: string
  html_url?: string
}

const PAGE_SIZE = 30
const MAX_FILES = 300

function repoPath(target: ForgeTarget): string {
  return `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`
}

function count(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function stateOf(pull: GiteePull): PullSummary['state'] {
  if (pull.state === 'open') return 'open'
  if (pull.state === 'merged' || (typeof pull.merged_at === 'string' && pull.merged_at !== '')) return 'merged'
  return 'closed'
}

function patchOf(file: GiteeFile): string {
  if (typeof file.patch === 'string') return file.patch
  const diff = file.patch?.diff
  return typeof diff === 'string' ? diff : ''
}

function statusOf(file: GiteeFile): string {
  if (file.new_file === true) return 'added'
  if (file.deleted_file === true) return 'deleted'
  if (file.renamed_file === true) return 'renamed'
  if (typeof file.status === 'string' && file.status !== '') return file.status
  return 'modified'
}

function summary(pull: GiteePull): PullSummary {
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

function fileOf(file: GiteeFile): PullFile {
  return {
    path: file.filename ?? file.new_path ?? file.old_path ?? '',
    status: statusOf(file),
    additions: count(file.additions),
    deletions: count(file.deletions),
    patch: patchOf(file),
    binary: file.too_large === true,
  }
}

function commitOf(commit: GiteeCommit): PullCommit {
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

export async function listGiteePulls(
  target: ForgeTarget,
  token: string | null,
  state: PullListState,
  signal?: AbortSignal,
  fresh = false,
  page = 1,
): Promise<PullSummary[]> {
  // Gitee has a real merged state.
  const query = state === 'all' ? 'state=all' : state === 'merged' ? 'state=merged' : state === 'closed' ? 'state=closed' : 'state=open'
  const pulls = await forgeJson<GiteePull[]>(
    target,
    `${repoPath(target)}/pulls?${query}&sort=updated&direction=desc&per_page=${PAGE_SIZE}&page=${page}`,
    token,
    signal,
    { fresh },
  )
  const list = Array.isArray(pulls) ? pulls.map(summary) : []
  return state === 'merged' ? list.filter(pull => pull.state === 'merged') : list
}

export async function getGiteePull(
  target: ForgeTarget,
  number: number,
  token: string | null,
  signal?: AbortSignal,
  fresh = false,
): Promise<PullDetail> {
  const base = `${repoPath(target)}/pulls/${number}`
  const [pull, files, commits, comments] = await Promise.all([
    forgeJson<GiteePull>(target, base, token, signal, { fresh }),
    forgeJson<GiteeFile[]>(target, `${base}/files?per_page=100&page=1`, token, signal, { fresh }).catch(() => [] as GiteeFile[]),
    forgeJson<GiteeCommit[]>(target, `${base}/commits?per_page=100&page=1`, token, signal, { fresh }).catch(() => [] as GiteeCommit[]),
    forgeJson<GiteeComment[]>(target, `${repoPath(target)}/issues/${number}/comments?per_page=100&page=1`, token, signal, { fresh }).catch(() => [] as GiteeComment[]),
  ])
  const fileList = (Array.isArray(files) ? files : []).slice(0, MAX_FILES).map(fileOf)
  const commitList = (Array.isArray(commits) ? commits : []).map(commitOf)
  const commentList: PullComment[] = (Array.isArray(comments) ? comments : []).map(comment => ({
    id: String(comment.id ?? ''),
    author: comment.user?.login ?? comment.user?.name ?? '',
    body: typeof comment.body === 'string' ? comment.body : '',
    createdAt: comment.created_at ?? '',
    url: typeof comment.html_url === 'string' ? comment.html_url : null,
  }))
  const additions = fileList.reduce<number | null>((total, file) => {
    if (file.additions === null) return total
    return (total ?? 0) + file.additions
  }, null)
  const deletions = fileList.reduce<number | null>((total, file) => {
    if (file.deletions === null) return total
    return (total ?? 0) + file.deletions
  }, null)
  return {
    ...summary(pull),
    body: typeof pull.body === 'string' ? pull.body : '',
    additions,
    deletions,
    changedFiles: fileList.length,
    mergeable: typeof pull.mergeable === 'boolean' ? pull.mergeable : null,
    headRepoUrl: headRepositoryUrl(pull),
    files: fileList,
    commits: commitList,
    filesTruncated: Array.isArray(files) && files.length >= MAX_FILES,
    checks: null,
    review: null,
    approval: {
      review: approvalOf(pull.assignees),
      test: approvalOf(pull.testers),
      reviewers: Array.isArray(pull.assignees) ? pull.assignees.length : 0,
      testers: Array.isArray(pull.testers) ? pull.testers.length : 0,
    },
    comments: commentList,
  }
}

function approvalOf(users: GiteeUser[] | null | undefined): PullApproval['review'] {
  const list = (Array.isArray(users) ? users : []).filter(user => typeof user.login === 'string' && user.login !== '')
  if (list.length === 0) return 'none'
  const accepted = list.filter(user => user.accept === true).length
  if (accepted === 0) return 'pending'
  return accepted === list.length ? 'passed' : 'partial'
}

function headRepositoryUrl(pull: GiteePull): string | null {
  const htmlUrl = pull.head?.repo?.html_url
  if (typeof htmlUrl === 'string' && htmlUrl !== '') return htmlUrl
  const fullName = pull.head?.repo?.full_name
  if (typeof fullName === 'string' && fullName !== '') return `https://gitee.com/${fullName}.git`
  return null
}

export async function closeGiteePull(
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

export async function reopenGiteePull(
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

export async function createGiteePull(
  target: ForgeTarget,
  token: string,
  input: PullCreateInput,
  signal?: AbortSignal,
): Promise<PullSummary> {
  const pull = await forgeJson<GiteePull>(target, `${repoPath(target)}/pulls`, token, signal, {
    method: 'POST',
    body: {
      title: input.title,
      head: input.head,
      base: input.base,
      body: input.body,
      draft: input.draft,
      prune_source_branch: false,
    },
  })
  return summary(pull)
}

export async function mergeGiteePull(
  target: ForgeTarget,
  number: number,
  token: string,
  input: PullMergeInput,
  signal?: AbortSignal,
): Promise<PullMergeResult> {
  const result = await forgeJson<{ merged?: boolean; message?: string; sha?: string }>(
    target,
    `${repoPath(target)}/pulls/${number}/merge`,
    token,
    signal,
    {
      method: 'PUT',
      body: {
        merge_method: input.method,
        prune_source_branch: input.deleteSourceBranch,
      },
    },
  )
  return {
    merged: result?.merged !== false,
    message: typeof result?.message === 'string' ? result.message : '',
    sha: typeof result?.sha === 'string' ? result.sha : null,
    branchDeleted: input.deleteSourceBranch,
  }
}

/** Mark the PR review step as passed (`POST …/pulls/{number}/review`). */
export async function reviewGiteePull(
  target: ForgeTarget,
  number: number,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  await forgeJson<unknown>(target, `${repoPath(target)}/pulls/${number}/review`, token, signal, {
    method: 'POST',
  })
}

/** Mark the PR test step as passed (`POST …/pulls/{number}/test`). */
export async function testGiteePull(
  target: ForgeTarget,
  number: number,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  await forgeJson<unknown>(target, `${repoPath(target)}/pulls/${number}/test`, token, signal, {
    method: 'POST',
  })
}
