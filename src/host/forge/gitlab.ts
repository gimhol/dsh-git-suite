import type { PullChecks, PullComment, PullCommit, PullCreateInput, PullListState, PullDetail, PullFile, PullMergeInput, PullMergeResult, PullReview, PullSummary } from '../types.js'
import type { ForgeTarget } from './detect.js'
import { forgeJson } from './http.js'

interface GitLabUser {
  name?: string
  username?: string
}

interface GitLabMergeRequest {
  iid?: number
  title?: string
  state?: string
  draft?: boolean
  work_in_progress?: boolean
  author?: GitLabUser | null
  source_branch?: string
  target_branch?: string
  created_at?: string
  updated_at?: string
  web_url?: string
  description?: string | null
  has_conflicts?: boolean
  changes_count?: string
  head_pipeline?: { status?: string; web_url?: string } | null
  merge_commit_sha?: string | null
  detailed_merge_status?: string
  source_project_id?: number
}

interface GitLabProject {
  path_with_namespace?: string
  http_url_to_repo?: string
  web_url?: string
}

interface GitLabNote {
  id?: number
  author?: GitLabUser | null
  body?: string | null
  created_at?: string
  system?: boolean
}

interface GitLabApprovals {
  approved_by?: Array<{ user?: GitLabUser | null }>
}

interface GitLabChange {
  old_path?: string
  new_path?: string
  diff?: string
  new_file?: boolean
  deleted_file?: boolean
  renamed_file?: boolean
  too_large?: boolean
}

interface GitLabChanges {
  changes?: GitLabChange[]
  overflow?: boolean
  changes_count?: string
}

interface GitLabCommit {
  id?: string
  short_id?: string
  title?: string
  author_name?: string
  created_at?: string
}

const PAGE_SIZE = 30

function projectId(target: ForgeTarget): string {
  return `/projects/${encodeURIComponent(target.projectPath)}`
}

function stateOf(pull: GitLabMergeRequest): PullSummary['state'] {
  if (pull.state === 'opened') return 'open'
  if (pull.state === 'merged') return 'merged'
  return 'closed'
}

function statusOf(change: GitLabChange): string {
  if (change.new_file === true) return 'added'
  if (change.deleted_file === true) return 'deleted'
  if (change.renamed_file === true) return 'renamed'
  return 'modified'
}

/** Count changed lines in one GitLab diff, ignoring the file headers. */
function lineCounts(diff: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1
  }
  return { additions, deletions }
}

function summary(pull: GitLabMergeRequest): PullSummary {
  return {
    number: typeof pull.iid === 'number' ? pull.iid : 0,
    title: typeof pull.title === 'string' ? pull.title : '',
    state: stateOf(pull),
    draft: pull.draft === true || pull.work_in_progress === true,
    author: pull.author?.name ?? pull.author?.username ?? '',
    sourceBranch: typeof pull.source_branch === 'string' ? pull.source_branch : '',
    targetBranch: typeof pull.target_branch === 'string' ? pull.target_branch : '',
    createdAt: typeof pull.created_at === 'string' ? pull.created_at : '',
    updatedAt: typeof pull.updated_at === 'string' ? pull.updated_at : '',
    webUrl: typeof pull.web_url === 'string' ? pull.web_url : '',
  }
}

function fileOf(change: GitLabChange): PullFile {
  const diff = typeof change.diff === 'string' ? change.diff : ''
  const counts = lineCounts(diff)
  return {
    path: change.new_path ?? change.old_path ?? '',
    status: statusOf(change),
    additions: counts.additions,
    deletions: counts.deletions,
    patch: diff,
    binary: change.too_large === true,
  }
}

function commitOf(commit: GitLabCommit): PullCommit {
  const hash = typeof commit.id === 'string' ? commit.id : ''
  return {
    hash,
    shortHash: commit.short_id ?? hash.slice(0, 7),
    subject: typeof commit.title === 'string' ? commit.title : '',
    author: typeof commit.author_name === 'string' ? commit.author_name : '',
    date: typeof commit.created_at === 'string' ? commit.created_at : '',
  }
}

function changedFiles(pull: GitLabMergeRequest, fallback: number): number {
  const raw = pull.changes_count
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number.parseInt(raw, 10)
  return fallback
}

function checksOf(pull: GitLabMergeRequest): PullChecks | null {
  const pipeline = pull.head_pipeline
  const status = pipeline?.status
  if (typeof status !== 'string' || status === '') return null
  const state = status === 'failed' || status === 'canceled' || status === 'cancelled'
    ? 'failure'
    : status === 'success'
      ? 'success'
      : status === 'skipped' || status === 'manual'
        ? 'neutral'
        : 'pending'
  return {
    state,
    total: 1,
    url: typeof pipeline?.web_url === 'string' ? pipeline.web_url : null,
  }
}

function reviewOf(approvals: GitLabApprovals | null): PullReview | null {
  if (approvals === null) return null
  const approved = Array.isArray(approvals.approved_by) ? approvals.approved_by.length : 0
  return {
    state: approved > 0 ? 'approved' : 'pending',
    approvals: approved,
    changesRequested: 0,
  }
}

export async function listGitlabPulls(
  target: ForgeTarget,
  token: string | null,
  state: PullListState,
  signal?: AbortSignal,
  fresh = false,
  page = 1,
): Promise<PullSummary[]> {
  // GitLab names the merged state explicitly.
  const query = state === 'all' ? 'state=all' : state === 'merged' ? 'state=merged' : state === 'closed' ? 'state=closed' : 'state=opened'
  const pulls = await forgeJson<GitLabMergeRequest[]>(
    target,
    `${projectId(target)}/merge_requests?${query}&order_by=updated_at&sort=desc&per_page=${PAGE_SIZE}&page=${page}`,
    token,
    signal,
    { fresh },
  )
  const list = Array.isArray(pulls) ? pulls.map(summary) : []
  return state === 'merged' ? list.filter(pull => pull.state === 'merged') : list
}

export async function getGitlabPull(
  target: ForgeTarget,
  number: number,
  token: string | null,
  signal?: AbortSignal,
  fresh = false,
): Promise<PullDetail> {
  const base = `${projectId(target)}/merge_requests/${number}`
  const [pull, changes, commits, notes, approvals] = await Promise.all([
    forgeJson<GitLabMergeRequest>(target, base, token, signal, { fresh }),
    forgeJson<GitLabChanges>(target, `${base}/changes`, token, signal, { fresh }).catch(() => ({} as GitLabChanges)),
    forgeJson<GitLabCommit[]>(target, `${base}/commits?per_page=100`, token, signal, { fresh }).catch(() => [] as GitLabCommit[]),
    forgeJson<GitLabNote[]>(target, `${base}/notes?per_page=100&sort=asc&order_by=created_at`, token, signal, { fresh }).catch(() => [] as GitLabNote[]),
    forgeJson<GitLabApprovals>(target, `${base}/approvals`, token, signal, { fresh }).catch(() => null),
  ])
  const fileList = (Array.isArray(changes.changes) ? changes.changes : []).map(fileOf)
  const commitList = (Array.isArray(commits) ? commits : []).map(commitOf)
  const commentList: PullComment[] = (Array.isArray(notes) ? notes : [])
    .filter(note => note.system !== true)
    .map(note => ({
      id: String(note.id ?? ''),
      author: note.author?.name ?? note.author?.username ?? '',
      body: typeof note.body === 'string' ? note.body : '',
      createdAt: note.created_at ?? '',
      url: null,
    }))
  const additions = fileList.reduce((total, file) => total + (file.additions ?? 0), 0)
  const deletions = fileList.reduce((total, file) => total + (file.deletions ?? 0), 0)
  let headRepoUrl: string | null = null
  if (typeof pull.source_project_id === 'number') {
    try {
      const project = await forgeJson<GitLabProject>(
        target,
        `/projects/${pull.source_project_id}`,
        token,
        signal,
        { fresh },
      )
      if (typeof project.path_with_namespace === 'string' && project.path_with_namespace.toLowerCase() !== target.projectPath.toLowerCase()) {
        headRepoUrl = typeof project.http_url_to_repo === 'string'
          ? project.http_url_to_repo
          : typeof project.web_url === 'string' ? project.web_url : null
      }
    } catch {
      // No access or no project: treat it as the same repository.
    }
  }
  const countText = changes.changes_count ?? pull.changes_count
  return {
    ...summary(pull),
    body: typeof pull.description === 'string' ? pull.description : '',
    additions,
    deletions,
    changedFiles: changedFiles(pull, fileList.length),
    mergeable: pull.has_conflicts === true ? false : pull.has_conflicts === false ? true : null,
    headRepoUrl,
    files: fileList,
    commits: commitList,
    filesTruncated: changes.overflow === true || (typeof countText === 'string' && countText.endsWith('+')),
    checks: checksOf(pull),
    review: reviewOf(approvals),
    comments: commentList,
  }
}

export async function closeGitlabPull(
  target: ForgeTarget,
  number: number,
  token: string | null,
  signal?: AbortSignal,
): Promise<void> {
  await forgeJson<unknown>(target, `${projectId(target)}/merge_requests/${number}`, token, signal, {
    method: 'PUT',
    body: { state_event: 'close' },
  })
}

export async function reopenGitlabPull(
  target: ForgeTarget,
  number: number,
  token: string | null,
  signal?: AbortSignal,
): Promise<void> {
  await forgeJson<unknown>(target, `${projectId(target)}/merge_requests/${number}`, token, signal, {
    method: 'PUT',
    body: { state_event: 'reopen' },
  })
}

export async function createGitlabPull(
  target: ForgeTarget,
  token: string,
  input: PullCreateInput,
  signal?: AbortSignal,
): Promise<PullSummary> {
  let sourceProjectId: number | null = null
  if (input.headProjectPath !== undefined && input.headProjectPath !== null && input.headProjectPath !== target.projectPath) {
    const project = await forgeJson<{ id?: number }>(
      target,
      `/projects/${encodeURIComponent(input.headProjectPath)}`,
      token,
      signal,
    )
    if (typeof project.id === 'number') sourceProjectId = project.id
  }
  const pull = await forgeJson<GitLabMergeRequest>(target, `${projectId(target)}/merge_requests`, token, signal, {
    method: 'POST',
    body: {
      source_branch: input.head,
      target_branch: input.base,
      title: input.title,
      description: input.body,
      draft: input.draft,
      ...(sourceProjectId === null ? {} : { source_project_id: sourceProjectId }),
    },
  })
  return summary(pull)
}

export async function mergeGitlabPull(
  target: ForgeTarget,
  number: number,
  token: string,
  input: PullMergeInput,
  signal?: AbortSignal,
): Promise<PullMergeResult> {
  const pull = await forgeJson<GitLabMergeRequest>(
    target,
    `${projectId(target)}/merge_requests/${number}/merge`,
    token,
    signal,
    {
      method: 'PUT',
      body: {
        squash: input.method === 'squash',
        should_remove_source_branch: input.deleteSourceBranch,
      },
    },
  )
  const merged = pull.state === 'merged'
  return {
    merged,
    message: typeof pull.detailed_merge_status === 'string' ? pull.detailed_merge_status : '',
    sha: typeof pull.merge_commit_sha === 'string' ? pull.merge_commit_sha : null,
    branchDeleted: merged && input.deleteSourceBranch,
  }
}

/** Permanently delete a merge request (GitLab owners/admins only). */
export async function deleteGitlabPull(
  target: ForgeTarget,
  number: number,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  await forgeJson<unknown>(target, `${projectId(target)}/merge_requests/${number}`, token, signal, {
    method: 'DELETE',
  })
}
