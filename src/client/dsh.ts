import type * as React from 'react'
import type { LocaleKey } from './locales/en.js'

/** The `require` function DSH hands each client factory. */
export interface ClientRequire {
  (specifier: 'react'): typeof React
  (specifier: string): unknown
}

export interface ModuleDefinition {
  id: string
  factory(require: ClientRequire): unknown
}

export interface ModuleLoader {
  load(definition: ModuleDefinition): void
}

export interface LocaleDictionaries {
  en: Record<LocaleKey, string>
  zh: Record<LocaleKey, string>
}

export interface LocaleService {
  register(namespace: string, dictionaries: LocaleDictionaries): () => void
  bind(namespace: string): (key: LocaleKey) => string
}

export interface SlotRegistrationOptions {
  name: string
  key?: string
  id?: string
  order?: number
  label?: () => string
  locale?: string
}

/** The minimal slot props this plugin's components receive from the host. */
export interface IconProps {
  size: number
}

export interface SlotsService {
  inject(slot: string, setup: () => unknown): void
  register(options: SlotRegistrationOptions, component: React.ComponentType<never>): () => void
}

/** One entry box the right sidebar's Start page offers. */
export interface SidebarRightGuideEntry {
  id: string
  order: number
  /** Catalog command whose effective keycap the guide card shows. */
  commandId?: string
  title(): string
  description?(): string
  icon?: React.ComponentType<IconProps>
}

export interface SidebarRightTabDefinition {
  id: string
  kind: string
  priority?: 'extension' | 'builtin' | 'fallback'
  multiple?: boolean
  keepMounted?: boolean
  title(address: string): string
  guide?: readonly SidebarRightGuideEntry[]
}

/** The right sidebar's tab-type registry (stage one of a tab type's registration). */
export interface SidebarRightTabsService {
  register(definition: SidebarRightTabDefinition): () => void
}

/** A keyboard shortcut contributed to DSH's catalog (shown on guide cards too). */
export interface ShortcutCommandRegistration {
  id: string
  label(): string
  aliases: readonly string[]
  defaults: Readonly<Record<string, { code: string; modifiers: readonly string[] }>>
  regions: readonly string[]
  modals: readonly string[]
  resolve(context: { modal?: string | null }): { status: 'handled'; run(): void } | { status: 'blocked'; reason: string } | { status: 'pass' }
}

/** A physical key combination, as the shortcut registry represents it. */
export interface ShortcutBindingDescriptor {
  code: string
  secondCode?: string
  modifiers: readonly string[]
}

/** One row of the window's effective keyboard catalog. */
export interface ShortcutCatalogEntry {
  id: string
  label: string
  keys: readonly string[]
  binding: ShortcutBindingDescriptor | null
  modified: boolean
  conflicts: readonly string[]
  issue: string | null
}

/** Accepted preference state and its opaque revision. */
export interface ShortcutConfigSnapshot {
  revision: string
  status: 'loading' | 'ready' | 'unreadable'
  error: string | null
}

/** One revision-checked preference edit. */
export type ShortcutEdit =
  | { type: 'set'; id: string; binding: ShortcutBindingDescriptor | null }
  | { type: 'reset'; id: string }

/** Classified outcome of a preference edit; failures keep the accepted state. */
export interface ShortcutSaveResult {
  status: 'saved' | 'stale' | 'unreadable' | 'write-failed' | 'not-ready' | 'conflict'
  issue?: string
  conflicts?: readonly string[]
}

/** Snapshot source shared by the browser store and the Host bridge. */
export interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** The window's keyboard service: registration plus the catalog users edit. */
export interface ShortcutsService {
  register(command: ShortcutCommandRegistration): () => void
  readonly catalog: ObservableSnapshot<readonly ShortcutCatalogEntry[]>
  readonly config: ObservableSnapshot<ShortcutConfigSnapshot>
  /** Explain a candidate combination before saving it. */
  describeBinding(binding: ShortcutBindingDescriptor | null): {
    binding: ShortcutBindingDescriptor | null
    keys: readonly string[]
    issue: string | null
    conflicts: readonly string[]
  }
  /** Persist one reviewed edit against the accepted revision. */
  edit(edit: ShortcutEdit, revision: string): Promise<ShortcutSaveResult>
  /** Suppress native menu accelerators while a recorder owns the keyboard. */
  recording?(active: boolean): Promise<void>
}

/** Cross-plugin navigation of the main column's registered panels. */
export interface LayoutService {
  /** Select a registered main panel by key; null returns to the Conversation. */
  selectPanel(panelId: string | null): void
}

/** The right sidebar's navigation service: open (and focus) a tab by kind. */
export interface SidebarRightService {
  openTab(kind: string, options?: { revealIfOpened?: boolean; params?: unknown }): void
  isExpanded?(): boolean
  toggleExpanded?(): void
}

export interface ClientContext {
  effect(setup: () => (() => void) | void, label?: string): void
  /** Run `setup` in a child fiber that waits for every named service. */
  inject(deps: readonly string[], setup: (scope: ClientContext) => void): void
  locale: LocaleService
  slots: SlotsService
  /** Present only inside `inject(['sidebarRightTabs'], …)`. */
  sidebarRightTabs?: SidebarRightTabsService
  /** Present only inside `inject(['sidebarRight'], …)`. */
  sidebarRight?: SidebarRightService
  /** Present only inside `inject(['shortcuts'], …)`. */
  shortcuts?: ShortcutsService
  /** Present only inside `inject(['layout'], …)`. */
  layout?: LayoutService
}

export interface ClientPlugin {
  inject: string[]
  apply(ctx: ClientContext): void
}

declare global {
  interface Window {
    __ModuleLoader__: ModuleLoader
  }
}

export function moduleLoader(): ModuleLoader {
  return window.__ModuleLoader__
}



