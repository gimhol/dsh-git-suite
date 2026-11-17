/**
 * Prefer DSH's own terminal plugin over an external terminal app.
 *
 * When the right-sidebar terminal plugin is installed in this window, "Open
 * terminal" opens one of its tabs for the Session on screen; the host's
 * external terminal stays the fallback for profiles without that plugin.
 */
import type { ClientContext } from './dsh.js'

/** The sidebar navigation face used here. */
interface SidebarRightLike {
  /** Open a tab kind for the Session on screen. */
  openTab(kind: string): void
}

/** The tab registry face used here. */
interface TabRegistryLike {
  /** @returns the type registered for a kind, or undefined. */
  get(kind: string): unknown
}

/** Kind the DSH terminal plugin registers its tabs under. */
const TERMINAL_KIND = 'terminal'

/** Terminal actions the panel may use. */
export interface DshTerminal {
  /** Whether the terminal tab type is registered in this window. */
  available(): boolean
  /**
   * Open a terminal tab for the Session on screen.
   * @returns whether the tab was opened.
   */
  open(): boolean
}

let bridge: DshTerminal | null = null

/** @returns the bound DSH terminal actions, or null when the sidebar is absent. */
export function dshTerminal(): DshTerminal | null {
  return bridge
}

/** Bind the terminal actions from the client's sidebar services. */
export function bindDshTerminal(ctx: ClientContext): void {
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], scope => {
    const sidebar = (scope as unknown as { sidebarRight?: SidebarRightLike }).sidebarRight
    const tabs = (scope as unknown as { sidebarRightTabs?: TabRegistryLike }).sidebarRightTabs
    if (sidebar === undefined || tabs === undefined) return
    bridge = {
      available: () => tabs.get(TERMINAL_KIND) !== undefined,
      open() {
        try {
          sidebar.openTab(TERMINAL_KIND)
          return true
        } catch {
          // No Session on screen yet: the caller falls back to the external app.
          return false
        }
      },
    }
    scope.effect(() => () => {
      bridge = null
    }, 'git-suite: DSH terminal bridge')
  })
}
