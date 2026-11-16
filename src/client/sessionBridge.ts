/**
 * Bridge from the Git Suite UI to the current session's composer.
 *
 * A review is inserted as a Markdown file attachment when the conversation
 * service is available (the composer uploads it in the background); if the
 * attachment path is unavailable the draft text is written instead.
 */
import type { ClientContext } from './dsh.js'

/** One browser-owned draft attachment, as created by the conversation service. */
interface ComposerDraft {
  readonly id: unknown
}

/** Per-session composer facade from the conversation service. */
interface SessionInputFacade {
  addAttachments(ids: readonly unknown[]): boolean
  setDraft(text: string): void
}

/** Narrow face of `ctx.conversation` used here. */
interface ConversationService {
  createDrafts(sessionId: string, files: readonly File[], uploadImages: boolean): readonly ComposerDraft[]
  input: {
    for(scope: unknown): SessionInputFacade
  }
}

/** Narrow face of `ctx.sessions` used here. */
interface SessionsService {
  scope(id: string): unknown
}

/** Composer operations the review dialog may call. */
export interface SessionInsert {
  /** Add a Markdown file attachment to a session's composer. */
  attachMarkdown(sessionId: string, name: string, text: string): boolean
  /** Replace a session's composer draft text. */
  setDraft(sessionId: string, text: string): boolean
}

let bridge: SessionInsert | null = null

/** @returns the bound composer operations, or null when the conversation services are absent. */
export function sessionInsert(): SessionInsert | null {
  return bridge
}

/** Bind composer operations from the client's conversation and sessions services. */
export function bindSessionInsert(ctx: ClientContext): void {
  ctx.inject(['conversation', 'sessions'], scope => {
    const conversation = (scope as unknown as { conversation?: ConversationService }).conversation
    const sessions = (scope as unknown as { sessions?: SessionsService }).sessions
    if (conversation === undefined || sessions === undefined) return
    const input = (sessionId: string): SessionInputFacade => conversation.input.for(sessions.scope(sessionId))
    bridge = {
      attachMarkdown(sessionId, name, text) {
        try {
          const file = new File([text], name, { type: 'text/markdown' })
          const drafts = conversation.createDrafts(sessionId, [file], false)
          return input(sessionId).addAttachments(drafts.map(draft => draft.id))
        } catch {
          return false
        }
      },
      setDraft(sessionId, text) {
        try {
          input(sessionId).setDraft(text)
          return true
        } catch {
          return false
        }
      },
    }
    scope.effect(() => () => {
      bridge = null
    }, 'git-suite: composer bridge')
  })
}
