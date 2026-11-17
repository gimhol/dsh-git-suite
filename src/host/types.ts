import type { LfsChange } from './lfs.js'

export type { LfsChange, LfsPointer } from './lfs.js'

export interface Commit {
  hash: string
  shortHash: string
  author: string
  email: string
  date: string
  parents: string[]
  refs: string[]
  subject: string
}

export interface CommitFile {
  path: string
  additions: number | null
  deletions: number | null
  binary: boolean
  /** Set when the change rewrites a Git LFS pointer rather than file content. */
  lfs?: LfsChange
}

export interface CommitHeader extends Commit {
  body: string
}

export interface CommitDetail extends CommitHeader {
  files: CommitFile[]
  patch: string
  patchTruncated: boolean
}

export interface WorkspaceFile {
  path: string
  /** One-letter status shown in the list: A/M/D/R/C/U (U also covers untracked). */
  status: string
  /** Original path for a rename/copy. */
  origPath?: string
  staged: boolean
  untracked: boolean
  /** Unmerged: the path is part of a conflict, not a normal change. */
  unmerged: boolean
  additions: number | null
  deletions: number | null
  binary: boolean
  /** Git LFS stores this path, so its diff and line counts describe a pointer. */
  lfs?: boolean
}

export interface WorkspaceStatus {
  repoRoot: string
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  author: { name: string; email: string }
  staged: WorkspaceFile[]
  unstaged: WorkspaceFile[]
}

export interface WorkspaceDiffMediaSide {
  /** `data:` URL for this side, or null when it cannot be shown. */
  dataUrl: string | null
  /** Why the side has no media: the blob is missing, too large, or an LFS pointer. */
  reason: 'absent' | 'large' | 'lfs' | null
}

export interface WorkspaceDiffMedia {
  /** Which player the client renders. */
  kind: 'image' | 'audio'
  mime: string
  /** The version before the change (index for unstaged, HEAD for staged). */
  before: WorkspaceDiffMediaSide
  /** The version after the change (working tree, or index when staged). */
  after: WorkspaceDiffMediaSide
}

export interface WorkspaceDiff {
  path: string
  scope: 'staged' | 'unstaged' | 'untracked'
  patch: string
  binary: boolean
  truncated: boolean
  /** Present for images and audio; `patch` is empty then. */
  media?: WorkspaceDiffMedia
  /** Present when the change only rewrites a Git LFS pointer; `patch` is empty then. */
  lfs?: LfsChange
}

export interface WorkspaceCommit {
  hash: string
  shortHash: string
  subject: string
  branch: string
  upstream: string | null
  pushed: boolean
}

/** One ref resolved to the commit it points at. */
export interface ResolvePayload {
  ok: true
  hash: string
  shortHash: string
  author: string
  date: string
  subject: string
}

/** Installed version versus the latest one published on npm. */
export interface VersionPayload {
  ok: true
  current: string
  latest: string
  updateAvailable: boolean
}

/** One recent HEAD movement from `git reflog`. */
export interface ReflogEntry {
  hash: string
  shortHash: string
  selector: string
  action: string
  author: string
  date: string
}

export interface ReflogPayload {
  ok: true
  entries: ReflogEntry[]
}

/** One unmerged path while a merge/rebase/cherry-pick/revert is in progress. */
export interface ConflictFile {
  path: string
  /** Stage 2 exists: the current branch's version is available. */
  ours: boolean
  /** Stage 3 exists: the incoming version is available. */
  theirs: boolean
}

export interface OperationPayload {
  ok: true
  operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null
  conflicts: ConflictFile[]
}

/** Recent commit messages, newest first, for the message history. */
export interface CommitMessagesPayload {
  ok: true
  messages: string[]
}

/** External editors the host could launch, for the "open with" actions. */
export interface AppsPayload {
  ok: true
  /** True when any VS Code-compatible build is installed (kept for older clients). */
  vscode: boolean
  /** Editors this host can launch, in priority order, with display names. */
  editors: Array<{ id: string; name: string }>
}

/** One local tag with the commit it points at and its annotation message. */
export interface TagInfoPayload {
  ok: true
  name: string
  hash: string
  shortHash: string
  subject: string
  message: string
  annotated: boolean
  objectHash: string
}

/** How each local tag compares with one remote's tags. */
export interface TagStatusPayload {
  ok: true
  remote: string
  statuses: Record<string, 'same' | 'different' | 'local-only'>
  /** Tags that exist on the remote but not locally. */
  remoteOnly: string[]
}

export interface Branch {
  ref: string
  name: string
  kind: 'local' | 'remote'
  hash: string
  current: boolean
  upstream?: string
  /** Commits the branch is ahead of its upstream. */
  ahead?: number
  /** Commits the branch is behind its upstream. */
  behind?: number
  /** Upstream branch no longer exists on the remote. */
  gone?: boolean
}

export interface Project {
  path: string
  name: string
  workspaceId: string
  workspaceTitle: string
  nested: boolean
}

export interface WorkspaceRef {
  id: string
  title: string
  path: string
}

/** A supported hosting platform: GitHub, Gitee, or GitLab. */
export type ForgeProvider = 'github' | 'gitee' | 'gitlab'

/** One remote that resolves to a supported forge, without any credentials. */
export interface ForgeInfo {
  provider: ForgeProvider
  /** Host name used for the API and for stored credentials. */
  host: string
  /** Owner (or GitLab namespace path) and repository name. */
  owner: string
  repo: string
  /** Browser URL of the repository. */
  webUrl: string
}

/** One pull request / merge request as the list shows it. */
/** Filter for a pull request list page. */
export type PullListState = 'open' | 'closed' | 'merged' | 'all'

export interface PullSummary {
  number: number
  title: string
  state: 'open' | 'closed' | 'merged'
  draft: boolean
  author: string
  sourceBranch: string
  targetBranch: string
  createdAt: string
  updatedAt: string
  webUrl: string
}

/** One changed file in a pull request. */
export interface PullFile {
  path: string
  status: string
  additions: number | null
  deletions: number | null
  /** Hunk text from the forge; empty when the forge sends none. */
  patch: string
  binary: boolean
}

/** Read-only review summary: approvals and change requests. */
export interface PullReview {
  state: 'approved' | 'changes_requested' | 'pending' | 'none'
  approvals: number
  changesRequested: number
}

/** CI status rolled up for a pull request head commit. */
export interface PullChecks {
  state: 'success' | 'failure' | 'pending' | 'neutral' | 'unknown'
  total: number
  url: string | null
}

/** One discussion comment on a pull request. */
export interface PullComment {
  id: string
  author: string
  body: string
  createdAt: string
  url: string | null
}

/** One commit of a pull request. */
export interface PullCommit {
  hash: string
  shortHash: string
  subject: string
  author: string
  date: string
}

/** What a new pull request needs: both branches live on the same remote. */
export interface PullCreateInput {
  title: string
  body: string
  head: string
  base: string
  draft: boolean
  /** GitLab only: the fork project path when the source is another repository. */
  headProjectPath?: string | null
}

/** One pull request with its description, files, and commits. */
/** Gitee's separate review/test approval gate. */
export interface PullApproval {
  review: 'none' | 'pending' | 'partial' | 'passed'
  test: 'none' | 'pending' | 'partial' | 'passed'
  reviewers: number
  testers: number
}

export interface PullDetail extends PullSummary {
  body: string
  additions: number | null
  deletions: number | null
  changedFiles: number | null
  mergeable: boolean | null
  /** HTTPS clone URL of the head repository (for fork pull requests). */
  headRepoUrl: string | null
  files: PullFile[]
  commits: PullCommit[]
  filesTruncated: boolean
  /** Rolled-up CI status of the head commit, when the forge exposes it. */
  checks: PullChecks | null
  review: PullReview | null
  approval?: PullApproval | null
  comments: PullComment[]
}

/** How to merge a pull request. */
export interface PullMergeInput {
  method: 'merge' | 'squash' | 'rebase'
  deleteSourceBranch: boolean
}

export interface PullMergeResult {
  merged: boolean
  message: string
  sha: string | null
  branchDeleted: boolean
}

/** What the route needs from the host context: the workspace registry and a fallback directory. */
export interface RouteContext {
  workspaces(): WorkspaceRef[]
  defaultPath(): string
  /** Working directory of one Session, when the host keeps a record of it. */
  sessionDirectory?(sessionId: string): string | null
}





