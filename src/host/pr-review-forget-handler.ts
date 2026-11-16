/**
 * POST /git-suite/pr-review-forget: drop the cached AI review of one pull
 * request, so clearing a review keeps it cleared on the next open.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { RouteError } from './errors.js'
import { admitHeaders, failure, json, readJsonBody } from './http.js'
import { forgetReviewCache } from './pr-review-cache.js'
import { resolveRepository } from './repository.js'
import type { RouteContext } from './types.js'

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name]
  if (value === undefined) return null
  return Array.isArray(value) ? value.join(', ') : value
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  res.end(Buffer.from(await response.arrayBuffer()))
}

/** Create the forget-review handler for one plugin context. */
export function createForgetReviewHandler(context: RouteContext): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (!admitHeaders(name => header(req, name))) {
      await send(res, json({
        ok: false,
        error: { code: 'forbidden', message: 'This request is not allowed to change the review cache.' },
      }, 403))
      return
    }
    if (req.method !== 'POST') {
      await send(res, json({
        ok: false,
        error: { code: 'method-not-allowed', message: 'Clearing a cached review requires POST.' },
      }, 405))
      return
    }
    try {
      const body = await readJsonBody<{ path?: unknown; remote?: unknown; number?: unknown }>(req)
      const repo = await resolveRepository(context, typeof body.path === 'string' ? body.path : '')
      const remote = typeof body.remote === 'string' ? body.remote : ''
      if (remote === '') {
        throw new RouteError(400, 'invalid-remote', 'A remote name is required.')
      }
      const number = typeof body.number === 'number' ? body.number : Number.NaN
      if (!Number.isInteger(number) || number <= 0) {
        throw new RouteError(400, 'invalid-number', 'That pull request number is not valid.')
      }
      await forgetReviewCache(repo.root, remote, number)
      await send(res, json({ ok: true }))
    } catch (error) {
      await send(res, failure(error))
    }
  }
}
