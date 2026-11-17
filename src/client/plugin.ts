import { GitLogIcon } from './components/GitLogIcon.js'
import type { ClientContext, ClientPlugin } from './dsh.js'
import { GitLogPanel } from './GitLogPanel.js'
import { GitTabTitle } from './GitTabTitle.js'
import { en } from './locales/en.js'
import { zh } from './locales/zh.js'
import { bindShortcuts } from './shortcutBridge.js'
import { bindSessionInsert } from './sessionBridge.js'
import { bindDshTerminal } from './terminalBridge.js'
import { SidebarGitLogPanel } from './SidebarPanel.js'


const NS = 'gitSuite'

/** ID of the right-sidebar tab type; also the key its body registers under. */
const TAB_ID = 'dsh-git-suite'

/** Kind the right sidebar opens for this page. */
const TAB_KIND = 'git'

/** Main-column panel key shared by the sidebar entry and its page. */
const PANEL_ID = 'git'

/** After the shipped files (10), terminal (20), and browser (30) entries. */
const GUIDE_ORDER = 40

/** Catalog command that opens the right-sidebar tab; the guide card shows its keycap. */
const OPEN_COMMAND = 'gitSuite.open'

/** Catalog command that opens the same content as a page in the main column. */
const PAGE_COMMAND = 'gitSuite.page'

/** The client plugin face DSH mounts: dictionaries, slots, and the right-sidebar tab. */
export function createPlugin(): ClientPlugin {
  return {
    inject: ['slots', 'locale'],
    apply(ctx: ClientContext): void {
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'git-suite: dictionaries')
      bindSessionInsert(ctx)
      bindDshTerminal(ctx)
      const t = ctx.locale.bind(NS)

      ctx.effect(
        () => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
        }, GitLogPanel)),
        'git-suite: main panel',
      )

      ctx.effect(
        () => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 15,
          label: () => t('panel'),
          locale: NS,
        }, GitLogIcon)),
        'git-suite: sidebar entry',
      )

      // Ctrl+Shift+G keeps its original meaning: open the tab in the right
      // sidebar. Both commands are DSH catalog entries, so this window's
      // Settings → Shortcuts lists and rebinds them.
      ctx.inject(['sidebarRight', 'shortcuts'], (scope) => {
        const sidebar = scope.sidebarRight
        const shortcuts = scope.shortcuts
        if (sidebar === undefined || shortcuts === undefined) return
        scope.effect(() => bindShortcuts(shortcuts), 'git-suite: shortcut bridge')
        scope.effect(() => shortcuts.register({
          id: OPEN_COMMAND,
          label: () => t('openCommand'),
          aliases: ['git suite', 'git panel', 'open git'],
          defaults: {
            'desktop:macos': { code: 'KeyG', modifiers: ['primary', 'shift'] },
            'desktop:windows': { code: 'KeyG', modifiers: ['primary', 'shift'] },
            'desktop:linux': { code: 'KeyG', modifiers: ['primary', 'shift'] },
            'web:macos': { code: 'KeyG', modifiers: ['primary', 'shift'] },
            'web:windows': { code: 'KeyG', modifiers: ['primary', 'shift'] },
          },
          regions: ['page', 'editable'],
          modals: [],
          resolve: () => {
            try {
              sidebar.openTab(TAB_KIND)
            } catch {
              // No foreground Session yet: the sidebar cannot open.
            }
            return { status: 'handled', run: () => {} }
          },
        }), 'git-suite: open command')
      })

      // A separate command selects the full page in the main column — the same
      // navigation as the left sidebar's Git entry, without touching the
      // right-sidebar binding above.
      ctx.inject(['layout', 'shortcuts'], (scope) => {
        const layout = scope.layout
        const shortcuts = scope.shortcuts
        if (layout === undefined || shortcuts === undefined) return
        scope.effect(() => bindShortcuts(shortcuts), 'git-suite: shortcut bridge')
        scope.effect(() => shortcuts.register({
          id: PAGE_COMMAND,
          label: () => t('pageCommand'),
          aliases: ['git suite page', 'open git page'],
          defaults: {
            'desktop:macos': { code: 'KeyP', modifiers: ['primary', 'shift'] },
            'desktop:windows': { code: 'KeyP', modifiers: ['primary', 'shift'] },
            'desktop:linux': { code: 'KeyP', modifiers: ['primary', 'shift'] },
            'web:macos': { code: 'KeyP', modifiers: ['primary', 'shift'] },
            'web:windows': { code: 'KeyP', modifiers: ['primary', 'shift'] },
          },
          regions: ['page', 'editable'],
          modals: [],
          resolve: () => {
            try {
              layout.selectPanel(PANEL_ID)
            } catch {
              // The panel registry has not materialized this page in this window.
            }
            return { status: 'handled', run: () => {} }
          },
        }), 'git-suite: page command')
      })

      // Optional: keep the main panel working when the right sidebar is absent.
      ctx.inject(['sidebarRightTabs'], (scope) => {
        const tabs = scope.sidebarRightTabs
        if (tabs === undefined) return

        scope.effect(() => tabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          priority: 'extension',
          title: () => t('panel'),
          guide: [{
            id: 'git',
            order: GUIDE_ORDER,
            title: () => t('panel'),
            description: () => t('guideDescription'),
            commandId: OPEN_COMMAND,
            icon: GitLogIcon,
          }],
        }), 'git-suite: right sidebar tab')

        scope.effect(
          () => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
            name: 'sidebar.right.pane.tab',
            key: TAB_ID,
            locale: NS,
          }, SidebarGitLogPanel)),
          'git-suite: right sidebar panel',
        )

        // The capsule's own title seat: an icon plus the localized label, instead
        // of the plain text captured when the tab was opened.
        scope.effect(
          () => scope.slots.inject('sidebar.right.pane.tab.title', () => scope.slots.register({
            name: 'sidebar.right.pane.tab.title',
            key: TAB_ID,
            locale: NS,
          }, GitTabTitle)),
          'git-suite: right sidebar tab title',
        )
      })
    },
  }
}


