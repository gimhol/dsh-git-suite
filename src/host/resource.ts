import { RouteError } from './errors.js'
import { admit, failure, json } from './http.js'
import { readBranches } from './routes/branches.js'
import { readCommit } from './routes/commit.js'
import { readLog } from './routes/log.js'
import { readRefs } from './routes/refs.js'
import { resolveRef } from './routes/resolve.js'
import { readTag } from './routes/tag.js'
import { readTagStatus } from './routes/tag-status.js'
import { readVersion } from './routes/version.js'
import { readReflog } from './routes/reflog.js'
import { readOperation } from './routes/operation.js'
import { readApps } from './routes/apps.js'
import { readCommitMessages } from './routes/commit-messages.js'
import { readSessionRepo } from './routes/session-repo.js'
import { readPull, readPulls } from './routes/pulls.js'
import { readWorkspaceStatus } from './routes/status.js'
import { readWorkspaceDiff } from './routes/workspace-diff.js'
import { readStagedHash } from './routes/staged-hash.js'
import { scanProjects } from './scan.js'
import type { RouteContext } from './types.js'

export type RouteResource = (request: Request) => Promise<Response>

/** Build the `/git-suite` request handler bound to the plugin's host context. */
export function createResource(context: RouteContext): RouteResource {
  return async function resource(request: Request): Promise<Response> {
    if (!admit(request)) {
      return json({
        ok: false,
        error: { code: 'forbidden', message: 'This request is not allowed to read Git data.' },
      }, 403)
    }

    try {
      const url = new URL(request.url, 'http://dsh.local')
      const mode = url.searchParams.get('mode') ?? 'log'
      if (mode === 'projects') return json(await scanProjects(context, request.signal))
      if (mode === 'tree') return json(await readRefs(context, url, request.signal))
      if (mode === 'branches') return json(await readBranches(context, url, request.signal))
      if (mode === 'log') return json(await readLog(context, url, request.signal))
      if (mode === 'commit') return json(await readCommit(context, url, request.signal))
      if (mode === 'resolve') return json(await resolveRef(context, url, request.signal))
      if (mode === 'tag') return json(await readTag(context, url, request.signal))
      if (mode === 'tag-status') return json(await readTagStatus(context, url, request.signal))
      if (mode === 'version') return json(await readVersion())
      if (mode === 'reflog') return json(await readReflog(context, url, request.signal))
      if (mode === 'operation') return json(await readOperation(context, url, request.signal))
      if (mode === 'apps') return json(await readApps())
      if (mode === 'commit-messages') return json(await readCommitMessages(context, url, request.signal))
      if (mode === 'status') return json(await readWorkspaceStatus(context, url, request.signal))
      if (mode === 'workspace-diff') return json(await readWorkspaceDiff(context, url, request.signal))
      if (mode === 'staged-hash') return json(await readStagedHash(context, url, request.signal))
      if (mode === 'session-repo') return json(await readSessionRepo(context, url, request.signal))
      if (mode === 'pulls') return json(await readPulls(context, url, request.signal))
      if (mode === 'pull') return json(await readPull(context, url, request.signal))
      return json({
        ok: false,
        error: { code: 'invalid-request', message: 'Unknown Git mode.' },
      }, 400)
    } catch (error) {
      if (error instanceof RouteError) return failure(error)
      return failure(new RouteError(500, 'internal', error instanceof Error ? error.message : String(error)))
    }
  }
}


