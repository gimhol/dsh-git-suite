import type { LocaleKey } from './locales/en.js'

export type Translate = (key: LocaleKey) => string

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
}

export interface CommitDetail extends Commit {
  body: string
  files: CommitFile[]
  patch: string
  patchTruncated: boolean
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

export interface TagRef {
  ref: string
  name: string
  hash: string
  date: string
}

export interface StashRef {
  /** Reflog selector, e.g. `stash@{0}`. */
  ref: string
  /** Commit the stash points at. */
  hash: string
  date: string
  message: string
}

export type SyncAction = 'fetch' | 'pull' | 'push' | 'fetch-tag'

export interface FetchOptions {
  fetchAll: boolean
  prune: boolean
  tags: boolean
  forceTags: boolean
  remote?: string
}

export interface RemoteRemovePayload {
  ok: true
  action: 'remove'
  name: string
}

export interface RemoteAddPayload {
  ok: true
  action: 'add'
  name: string
  url: string
}

export interface RemoteUrlPayload {
  ok: true
  action: 'set-url'
  name: string
  url: string
}

export type BranchAction = 'merge' | 'rebase' | 'rebase-onto' | 'rename' | 'delete' | 'track' | 'delete-remote' | 'upstream'

export interface BranchActionPayload {
  ok: true
  action: BranchAction
  branch: string
  remote?: string
  newName?: string
  /** Remote-tracking ref a local branch now follows, or empty when it tracks nothing. */
  upstream?: string
}

export interface PushTarget {
  local: string
  remote: string
  track: boolean
}

export interface PushOptions {
  remote: string
  refs: PushTarget[]
  tags: boolean
  force: boolean
}

export interface SyncPayload {
  ok: true
  action: SyncAction
  remote?: string
  branch?: string
}

export interface SubmoduleRef {
  /** Repository-relative submodule path. */
  path: string
  /** Display name: the last path segment. */
  name: string
}

/** A supported hosting platform: GitHub, Gitee, or GitLab. */
export type ForgeProvider = 'github' | 'gitee' | 'gitlab'

/** One remote that resolves to a supported forge. */
export interface ForgeInfo {
  provider: ForgeProvider
  host: string
  /** Owner (or GitLab namespace path) and repository name. */
  owner: string
  repo: string
  webUrl: string
}

/** One pull request / merge request as the list shows it. */
/** Filter for the pull request list. */
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
  patch: string
  binary: boolean
}

/** Read-only review summary: approvals and change requests. */
export interface PullReview {
  state: 'approved' | 'changes_requested' | 'pending' | 'none'
  approvals: number
  changesRequested: number
}

/** Gitee's separate review/test approval gate. */
export interface PullApproval {
  review: 'none' | 'pending' | 'partial' | 'passed'
  test: 'none' | 'pending' | 'partial' | 'passed'
  reviewers: number
  testers: number
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

/** One pull request with its description, files, and commits. */
export interface PullDetail extends PullSummary {
  body: string
  additions: number | null
  deletions: number | null
  changedFiles: number | null
  mergeable: boolean | null
  headRepoUrl: string | null
  files: PullFile[]
  commits: PullCommit[]
  filesTruncated: boolean
  checks: PullChecks | null
  review: PullReview | null
  approval?: PullApproval | null
  comments: PullComment[]
}

export interface PullMergeRequest {
  method: 'merge' | 'squash' | 'rebase'
  deleteSourceBranch: boolean
  /** Target branch to fast-forward locally after the merge. */
  base?: string
}

export interface PullMergePayload {
  ok: true
  merged: boolean
  message: string
  sha: string | null
  branchDeleted: boolean
}

export interface PullGiteeDecisionPayload {
  ok: true
  action: 'review' | 'test'
  number: number
}

export interface PullDeletePayload {
  ok: true
  number: number
}

export type AiReviewMode = 'diff' | 'api' | 'worktree'

export interface PullAiReviewPayload {
  ok: true
  review: string
  model: string
  files: number
  truncated: boolean
  /** How full-file context was obtained. */
  context: 'worktree' | 'api' | 'diff'
  contextFiles: number
}

export type AiReviewStreamEvent =
  | {
    type: 'start'
    attempt: number
    model: string
    files: number
    context: 'worktree' | 'api' | 'diff'
    contextFiles: number
  }
  | { type: 'reasoning'; text: string }
  | { type: 'text'; text: string }
  | { type: 'retry'; attempt: number }
  | ({
    type: 'done'
  } & Omit<PullAiReviewPayload, 'ok'>)

/** One streamed event of a pre-commit review of the staged diff. */
export type CommitReviewStreamEvent =
  | { type: 'start'; attempt: number; model: string }
  | { type: 'reasoning'; text: string }
  | { type: 'text'; text: string }
  | { type: 'retry'; attempt: number }
  | { type: 'done'; review: string; model: string; truncated: boolean }

/** Result of a pre-commit review request. */
export interface CommitReviewPayload {
  ok: true
  review: string
  model: string
  truncated: boolean
}

/** Request for an AI-drafted pull request title and body. */
export interface PullDraftRequest {
  path: string
  remote: string
  base: string
  head: string
  language?: string
}

/** AI-drafted pull request title and body. */
export interface PullDraftPayload {
  ok: true
  title: string
  body: string
}

export interface PullsPayload {
  ok: true
  remote: string
  state: PullListState
  forge: ForgeInfo
  page: number
  pulls: PullSummary[]
  defaultBase: string
  hasMore: boolean
}

/** One local branch offered as a request source. */
export interface PullCreateBranch {
  name: string
  /** Upstream ref (`origin/main`) when the branch tracks one. */
  upstream: string | null
}

export interface PullCreateRequest {
  title: string
  body: string
  base: string
  /** Target remote for `base`; defaults to the pulls view's selected remote. */
  remote?: string
  /** Local branch to open the request from; defaults to the checked-out branch. */
  head?: string
  draft: boolean
}

export interface PullCreatePayload {
  ok: true
  pull: PullSummary
  number: number
  webUrl: string
}

export interface PullPayload {
  ok: true
  remote: string
  state: 'open' | 'closed' | 'all'
  forge: ForgeInfo
  pull: PullDetail
}

export interface PullCheckoutPayload {
  ok: true
  branch: string
  hash: string
  /** The local branch already existed and was reused. */
  existing: boolean
}

export interface PullStatePayload {
  ok: true
  action: 'close' | 'reopen'
  number: number
}

export interface RemoteGroup {
  name: string
  url: string
  branches: Branch[]
  /** The forge this remote points at, when it is a supported platform. */
  forge?: ForgeInfo | null
}

export interface Project {
  path: string
  name: string
  workspaceId?: string
  workspaceTitle?: string
  nested?: boolean
}

export interface Repo {
  repoRoot: string
  repoName: string
  branch: string
  defaultPath: string
  /** Superproject working tree when this repository is a submodule. */
  superproject: string | null
}

/** Commit list columns that the header menu can show or hide. */
export type CommitColumn = 'graph' | 'date' | 'author' | 'hash'

export type CommitColumns = Record<CommitColumn, boolean>

/** What the commit list currently shows: HEAD, a scope, or one ref/stash. */
export type Selection =
  | { kind: 'head' }
  | { kind: 'all' }
  | { kind: 'remotes' }
  | { kind: 'branch'; ref: string; name: string; remote: boolean }
  | { kind: 'tag'; ref: string; name: string }
  | { kind: 'stash'; ref: string; hash: string }

export interface ProjectsPayload {
  ok: true
  projects: Project[]
  truncated: boolean
  defaultPath: string
}

export interface BranchesPayload {
  ok: true
  repoRoot: string
  current: string
  branches: Branch[]
}

export interface RefsPayload {
  ok: true
  repoRoot: string
  /** Checked-out branch, or `detached`. */
  current: string
  /** Local branches. */
  branches: Branch[]
  tags: TagRef[]
  remotes: RemoteGroup[]
  stashes: StashRef[]
  submodules: SubmoduleRef[]
}

export interface LogPayload {
  ok: true
  repoRoot: string
  repoName: string
  branch: string
  defaultPath: string
  superproject: string | null
  commits: Commit[]
  hasMore: boolean
  nextOffset: number
}

export interface CommitPayload {
  ok: true
  commit: CommitDetail
}

export interface SwitchPayload {
  ok: true
  repoRoot: string
  /** Branch now checked out. */
  branch: string
  /** Branch that was checked out before the switch. */
  previous: string
}

export type WorkspaceScope = 'staged' | 'unstaged' | 'untracked'

export interface WorkspaceFile {
  path: string
  status: string
  origPath?: string
  staged: boolean
  untracked: boolean
  /** Unmerged: the path is part of a conflict. */
  unmerged?: boolean
  additions: number | null
  deletions: number | null
  binary: boolean
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

export interface WorkspaceStatusPayload {
  ok: true
  workspace: WorkspaceStatus
}

export interface WorkspaceDiffMediaSide {
  /** `data:` URL for this side, or null when it cannot be shown. */
  dataUrl: string | null
  /** Why the side has no media: the blob is missing, or too large to embed. */
  reason: 'absent' | 'large' | null
}

export interface WorkspaceDiffMedia {
  /** Which player the client renders. */
  kind: 'image' | 'audio'
  mime: string
  before: WorkspaceDiffMediaSide
  after: WorkspaceDiffMediaSide
}

export interface WorkspaceDiff {
  path: string
  scope: WorkspaceScope
  patch: string
  binary: boolean
  truncated: boolean
  /** Present for images and audio; `patch` is empty then. */
  media?: WorkspaceDiffMedia
}

export interface WorkspaceDiffPayload {
  ok: true
  diff: WorkspaceDiff
}

export interface WorkspaceCommit {
  hash: string
  shortHash: string
  subject: string
  branch: string
  upstream: string | null
  pushed: boolean
}

export interface WorkspaceActionPayload {
  ok: true
  action: 'stage' | 'unstage' | 'commit'
  commit?: WorkspaceCommit
}

export interface ClonePayload {
  ok: true
  repoRoot: string
}

export interface OpenAppPayload {
  ok: true
  target: 'terminal' | 'explorer' | 'vscode'
  path: string
}

/** External editors the host could launch. */
export interface AppsPayload {
  ok: true
  vscode: boolean
  /** Editors this host can launch, in priority order. */
  editors: Array<{ id: string; name: string }>
}

/** Installed version versus the latest one published on npm. */
export interface VersionPayload {
  ok: true
  current: string
  latest: string
  updateAvailable: boolean
}

/** Result of a cherry-pick, revert, reset, or an abort. */
export interface CommitOpPayload {
  ok: true
  action: 'cherry-pick' | 'revert' | 'reset' | 'abort'
  mode?: 'soft' | 'mixed' | 'hard'
  hash?: string
  head?: string
  operation?: 'merge' | 'rebase' | 'cherry-pick' | 'revert'
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

/** Recent commit messages, newest first, for the message history. */
export interface CommitMessagesPayload {
  ok: true
  messages: string[]
}

/** Result of a stash push/apply/pop/drop. */
export interface StashPayload {
  ok: true
  action: 'save' | 'apply' | 'pop' | 'drop'
  ref?: string
  hash?: string
}

/** One unmerged path while a merge/rebase/cherry-pick/revert is in progress. */
export interface ConflictFile {
  path: string
  ours: boolean
  theirs: boolean
}

export interface OperationPayload {
  ok: true
  operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null
  conflicts: ConflictFile[]
}

export interface RevealPayload {
  ok: true
  file: string
  path: string
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

/** One tag with the commit it points at and its annotation message. */
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
export interface TagStatusPayload {  ok: true
  remote: string
  statuses: Record<string, 'same' | 'different' | 'local-only'>
  /** Tags that exist on the remote but not locally. */
  remoteOnly: string[]
}

export interface GenerateMessagePayload {
  ok: true
  message: string
  source: 'staged' | 'unstaged'
}

export interface PickDirectoryPayload {
  ok: true
  capability: 'native' | 'browse'
  cancelled?: boolean
  path?: string
  name?: string
  hasWorkspace?: boolean
  workspaceTitle?: string
}

export interface TagPayload {
  ok: true
  tag: string
  hash: string
}

export interface BranchPayload {
  ok: true
  branch: string
  hash: string
}

export interface CheckoutPayload {
  ok: true
  branch: string | null
  hash: string
  detached: boolean
}

export type LoadStatus = 'loading' | 'ready' | 'error'
export type DetailStatus = 'idle' | LoadStatus




