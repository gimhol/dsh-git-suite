import type { HostContext, SessionStoreLike, WorkspaceRegistry, WorkspaceRegistryEntry } from './dsh.js'
import { createCloneHandler } from './clone-handler.js'
import { createBranchActionHandler } from './branch-action-handler.js'
import { createCredentialHandler } from './credential-handler.js'
import { createBranchHandler, createCheckoutHandler, createTagHandler } from './commit-actions.js'
import { createGenerateMessageHandler } from './generate-handler.js'
import { createPickDirectoryHandler } from './pick-handler.js'
import { createPullHandler } from './pr-handler.js'
import { createPullCreateHandler } from './pr-create-handler.js'
import { createGiteeDecisionHandler } from './pr-gitee-decision-handler.js'
import { createPullDeleteHandler } from './pr-delete-handler.js'
import { createCommitAiReviewHandler } from './commit-ai-review-handler.js'
import { createPullAiReviewHandler } from './pr-ai-review-handler.js'
import { createRemoteHandler } from './remote-handler.js'
import { createRevealHandler } from './reveal-handler.js'
import { createOpenHandler } from './open-handler.js'
import { createCommitOpsHandler } from './commit-ops.js'
import { createStashHandler } from './stash-handler.js'
import { createResource } from './resource.js'
import { createSwitchHandler } from './switch-handler.js'
import { createSyncHandler } from './sync-handler.js'
import { createWorkspaceActionHandler } from './workspace-action.js'
import type { RouteContext, WorkspaceRef } from './types.js'

const ROUTE_PATH = '/git-suite'
const SWITCH_PATH = '/git-suite/switch'
const ACTION_PATH = '/git-suite/action'
const CLONE_PATH = '/git-suite/clone'
const GENERATE_PATH = '/git-suite/generate-message'
const PICK_PATH = '/git-suite/pick-directory'
const TAG_PATH = '/git-suite/tag'
const BRANCH_PATH = '/git-suite/branch'
const CHECKOUT_PATH = '/git-suite/checkout'
const SYNC_PATH = '/git-suite/sync'
const REMOTE_PATH = '/git-suite/remote'
const REVEAL_PATH = '/git-suite/reveal'
const OPEN_PATH = '/git-suite/open'
const COMMIT_OP_PATH = '/git-suite/commit-op'
const STASH_PATH = '/git-suite/stash'
const BRANCH_ACTION_PATH = '/git-suite/branch-action'
const CREDENTIAL_PATH = '/git-suite/credential'
const PR_PATH = '/git-suite/pr'
const PR_CLOSE_PATH = '/git-suite/pr-close'
const PR_REOPEN_PATH = '/git-suite/pr-reopen'
const PR_CREATE_PATH = '/git-suite/pr-create'
const PR_MERGE_PATH = '/git-suite/pr-merge'
const PR_AI_REVIEW_PATH = '/git-suite/pr-ai-review'
const COMMIT_REVIEW_PATH = '/git-suite/commit-ai-review'
const PR_GITEE_DECISION_PATH = '/git-suite/pr-gitee-decision'
const PR_DELETE_PATH = '/git-suite/pr-delete'

export const inject = ['webServer', 'workingDirectory', 'directoryPicker', 'llm', 'agentDefaultModel']

/** Register the read-only Git suite route with the host web server. */
export function apply(ctx: HostContext): void {
  const workspaceRegistry = ctx.get<WorkspaceRegistry>('workspaceRegistry')
  const listWorkspaces = (): WorkspaceRegistryEntry[] => {
    try {
      return workspaceRegistry?.list?.() ?? []
    } catch {
      return []
    }
  }
  /** The Host session store, when this profile has one. */
  const readSessionCwd = (sessionId: string): string | null => {
    const store = ctx.get<SessionStoreLike>('sessions')
    if (store === undefined) return null
    const cwdOf = (session: unknown): string | null => {
      if (typeof session !== 'object' || session === null) return null
      const header = (session as { header?: { cwd?: unknown } }).header
      const cwd = header?.cwd
      return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : null
    }
    try {
      const direct = typeof store.get === 'function' ? store.get(sessionId) : undefined
      const directCwd = cwdOf(direct)
      if (directCwd !== null) return directCwd
      for (const session of typeof store.list === 'function' ? store.list() : []) {
        if ((session as { id?: unknown }).id === sessionId) return cwdOf(session)
      }
    } catch {
      return null
    }
    return null
  }

  const context: RouteContext = {
    workspaces: (): WorkspaceRef[] => listWorkspaces(),
    defaultPath(): string {
      const workspace = listWorkspaces()[0]
      return workspace?.path || ctx.workingDirectory.defaultDirectory || process.cwd()
    },
    sessionDirectory: readSessionCwd,
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    resource: createResource(context),
  }), 'git-suite: read-only route')
  // Resource routes are GET/HEAD only; the switch POST needs a Node handler.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SWITCH_PATH,
    handler: createSwitchHandler(context),
  }), 'git-suite: switch route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ACTION_PATH,
    handler: createWorkspaceActionHandler(context),
  }), 'git-suite: workspace actions route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CLONE_PATH,
    handler: createCloneHandler(),
  }), 'git-suite: clone route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: GENERATE_PATH,
    handler: createGenerateMessageHandler(context, ctx.llm, ctx.agentDefaultModel),
  }), 'git-suite: generate message route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PICK_PATH,
    handler: createPickDirectoryHandler(context, ctx.directoryPicker, listWorkspaces),
  }), 'git-suite: pick directory route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: TAG_PATH,
    handler: createTagHandler(context),
  }), 'git-suite: tag route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: BRANCH_PATH,
    handler: createBranchHandler(context),
  }), 'git-suite: branch route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CHECKOUT_PATH,
    handler: createCheckoutHandler(context),
  }), 'git-suite: checkout route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SYNC_PATH,
    handler: createSyncHandler(context),
  }), 'git-suite: sync route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: REMOTE_PATH,
    handler: createRemoteHandler(context),
  }), 'git-suite: remote route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: REVEAL_PATH,
    handler: createRevealHandler(context),
  }), 'git-suite: reveal route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: OPEN_PATH,
    handler: createOpenHandler(context),
  }), 'git-suite: open route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: COMMIT_OP_PATH,
    handler: createCommitOpsHandler(context),
  }), 'git-suite: commit operations route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STASH_PATH,
    handler: createStashHandler(context),
  }), 'git-suite: stash route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CREDENTIAL_PATH,
    handler: createCredentialHandler(context),
  }), 'git-suite: credential route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: BRANCH_ACTION_PATH,
    handler: createBranchActionHandler(context),
  }), 'git-suite: branch action route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PR_PATH,
    handler: createPullHandler(context),
  }), 'git-suite: pull request route')
  // A separate path keeps the close action 404 on older hosts instead of
  // falling through to the checkout handler.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PR_CLOSE_PATH,
    handler: createPullHandler(context, { defaultAction: 'close' }),
  }), 'git-suite: close pull request route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PR_REOPEN_PATH,
    handler: createPullHandler(context, { defaultAction: 'reopen' }),
  }), 'git-suite: reopen pull request route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PR_CREATE_PATH,
    handler: createPullCreateHandler(context),
  }), 'git-suite: create pull request route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PR_MERGE_PATH,
    handler: createPullHandler(context, { defaultAction: 'merge' }),
  }), 'git-suite: merge pull request route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PR_AI_REVIEW_PATH,
    handler: createPullAiReviewHandler(context, ctx.llm, ctx.agentDefaultModel),
  }), 'git-suite: AI pull request review route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: COMMIT_REVIEW_PATH,
    handler: createCommitAiReviewHandler(context, ctx.llm, ctx.agentDefaultModel),
  }), 'git-suite: AI commit review route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PR_GITEE_DECISION_PATH,
    handler: createGiteeDecisionHandler(context),
  }), 'git-suite: Gitee review/test route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PR_DELETE_PATH,
    handler: createPullDeleteHandler(context),
  }), 'git-suite: delete pull request route')
}


