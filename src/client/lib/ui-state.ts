/**
 * Persisted panel state. Repository-specific values live in a bucket per
 * normalized repository root (`repos[<key>]`), while true preferences — the
 * global preference.
 */

import type { PromptKind } from '../../host/ai-prompts.js'

export type ViewMode = 'history' | 'workspace' | 'pulls'
export type SortMode = 'date' | 'topo'

/** State that belongs to one repository. */
export interface RepoUiState {
  viewMode?: ViewMode
  limit?: number
  sort?: SortMode
  showRemotes?: boolean
  treeWidth?: number
  treeHeight?: number
  detailRatio?: number
  /** Width of the staged/unstaged column in the commit view. */
  commitFilesWidth?: number
  /** Height of the staged list in the commit view. */
  commitStagedHeight?: number
  /** Height of the commit message form in the commit view. */
  commitFormHeight?: number
  /** Height the user dragged the form to in the stacked (sidebar/narrow) layout. */
  commitNarrowHeight?: number
  /** Height of the file column in the stacked layout, above the diff. */
  commitFilesHeight?: number
  /** Width of the pull-request list in the wide layout. */
  pullsListWidth?: number
  /** Height of the pull-request list in the stacked layout. */
  pullsListHeight?: number
  /** Ref-tree section expansion for this repository. */
  openSections?: Record<string, boolean>
  /** Collapsed ref-tree folders for this repository. */
  collapsedFolders?: Record<string, boolean>
  /** Per-view visibility of the refs tree, each page owning its own choice. */
  treeVisible?: Partial<Record<ViewMode, boolean>>
  /** The history scope last chosen in the branch dropdown. */
  logSelection?: { kind: 'head' | 'all' | 'branch'; ref?: string; name?: string; remote?: boolean }
  /** Prompt template overrides for this repository's AI features. */
  aiPrompts?: Partial<Record<PromptKind, string>>
  /** The unsent commit message of this repository. */
  draft?: string
}

/** State shared by every repository. */
export interface UiState {
  /** Diff layout: unified rows or a side-by-side split. */
  diffMode?: 'unified' | 'split'
  /** Prompt template overrides shared by every repository. */
  aiPrompts?: Partial<Record<PromptKind, string>>
  /** Per-repository buckets keyed by `normalizeRepoKey(repoRoot)`. */
  repos?: Record<string, RepoUiState>
}

const STORAGE_KEY = 'dsh-git-suite:ui-state'

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function viewModeOf(value: unknown): ViewMode | undefined {
  return value === 'history' || value === 'workspace' || value === 'pulls' ? value : undefined
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}

/** Parse a per-view visibility map, accepting a legacy single boolean. */
function treeVisibility(value: unknown): Partial<Record<ViewMode, boolean>> | undefined {
  if (typeof value === 'boolean') return { history: value, workspace: value }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const out: Partial<Record<ViewMode, boolean>> = {}
  for (const mode of ['history', 'workspace', 'pulls'] as const) {
    if (typeof source[mode] === 'boolean') out[mode] = source[mode]
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Parse the stored history scope; only the dropdown kinds are persisted. */
function logSelectionOf(value: unknown): RepoUiState['logSelection'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  if (source.kind === 'head' || source.kind === 'all') return { kind: source.kind }
  if (source.kind !== 'branch') return undefined
  if (typeof source.ref !== 'string' || source.ref === '') return undefined
  if (typeof source.name !== 'string' || source.name === '') return undefined
  return { kind: 'branch', ref: source.ref, name: source.name, remote: source.remote === true }
}

/** Parse prompt overrides: non-empty strings keyed by prompt kind. */
function promptRecord(value: unknown): Partial<Record<PromptKind, string>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const out: Partial<Record<PromptKind, string>> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && item.trim() !== '') out[key as PromptKind] = item
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function booleanRecord(value: unknown): Record<string, boolean> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const out: Record<string, boolean> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'boolean') out[key] = item
  }
  return out
}

/** Normalize a repository root into a stable bucket key. */
export function normalizeRepoKey(path: string): string {
  const slashed = path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  // Windows paths are case-insensitive; POSIX paths are not.
  return /^[a-z]:\//i.test(slashed) ? slashed.toLowerCase() : slashed
}

let activeRepo: string | null = null

/** Remember the repository the panel is showing, so hooks can read its bucket. */
export function setActiveRepo(repoRoot: string | null): void {
  activeRepo = repoRoot === null || repoRoot === '' ? null : normalizeRepoKey(repoRoot)
}

export function getActiveRepo(): string | null {
  return activeRepo
}

interface RawState {
  global: UiState
  /** Pre-bucket flat fields, used as a fallback for every repository. */
  legacy: RepoUiState
  /** Pre-bucket commitDrafts: Record<repoRoot, message>. */
  legacyDrafts?: Record<string, string>
}

/** Parse the stored JSON once; unknown or malformed fields are ignored. */
function readRaw(): RawState {
  const empty: RawState = { global: {}, legacy: {} }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return empty
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return empty
    const source = parsed as Record<string, unknown>
    const global: UiState = {}
    const legacy: RepoUiState = {}

    if (source.diffMode === 'unified' || source.diffMode === 'split') global.diffMode = source.diffMode
    const aiPrompts = promptRecord(source.aiPrompts)
    if (aiPrompts !== undefined) global.aiPrompts = aiPrompts

    if (typeof source.repos === 'object' && source.repos !== null && !Array.isArray(source.repos)) {
      const repos: Record<string, RepoUiState> = {}
      for (const [key, value] of Object.entries(source.repos as Record<string, unknown>)) {
        const bucket = parseRepoState(value)
        if (bucket !== undefined) repos[normalizeRepoKey(key)] = bucket
      }
      if (Object.keys(repos).length > 0) global.repos = repos
    }

    // Flat fields are the old schema: read them as a fallback for every repo.
    const legacyViewMode = viewModeOf(source.viewMode)
    if (legacyViewMode !== undefined) legacy.viewMode = legacyViewMode
    const limit = finite(source.limit)
    if (limit !== undefined && limit > 0) legacy.limit = Math.round(limit)
    if (source.sort === 'date' || source.sort === 'topo') legacy.sort = source.sort
    if (typeof source.showRemotes === 'boolean') legacy.showRemotes = source.showRemotes
    const legacySelection = logSelectionOf(source.logSelection)
    if (legacySelection !== undefined) legacy.logSelection = legacySelection
    const legacyTree = treeVisibility(source.treeVisible)
    if (legacyTree !== undefined) legacy.treeVisible = legacyTree
    for (const key of ['treeWidth', 'treeHeight', 'detailRatio', 'commitFilesWidth', 'commitStagedHeight', 'commitFormHeight', 'commitNarrowHeight', 'commitFilesHeight', 'pullsListWidth', 'pullsListHeight'] as const) {
      const value = finite(source[key])
      if (value !== undefined) legacy[key] = value
    }
    const openSections = booleanRecord(source.openSections)
    if (openSections !== undefined) legacy.openSections = openSections
    const collapsedFolders = booleanRecord(source.collapsedFolders)
    if (collapsedFolders !== undefined) legacy.collapsedFolders = collapsedFolders
    const drafts = stringRecord(source.commitDrafts)

    return { global, legacy, legacyDrafts: drafts }
  } catch {
    return empty
  }
}

function parseRepoState(value: unknown): RepoUiState | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const bucket: RepoUiState = {}
  const storedViewMode = viewModeOf(source.viewMode)
  if (storedViewMode !== undefined) bucket.viewMode = storedViewMode
  const limit = finite(source.limit)
  if (limit !== undefined && limit > 0) bucket.limit = Math.round(limit)
  if (source.sort === 'date' || source.sort === 'topo') bucket.sort = source.sort
  if (typeof source.showRemotes === 'boolean') bucket.showRemotes = source.showRemotes
  const aiPrompts = promptRecord(source.aiPrompts)
  if (aiPrompts !== undefined) bucket.aiPrompts = aiPrompts
  const logSelection = logSelectionOf(source.logSelection)
  if (logSelection !== undefined) bucket.logSelection = logSelection
  const treeVisible = treeVisibility(source.treeVisible)
  if (treeVisible !== undefined) bucket.treeVisible = treeVisible
  for (const key of ['treeWidth', 'treeHeight', 'detailRatio', 'commitFilesWidth', 'commitStagedHeight', 'commitFormHeight', 'commitNarrowHeight', 'commitFilesHeight', 'pullsListWidth', 'pullsListHeight'] as const) {
    const value = finite(source[key])
    if (value !== undefined) bucket[key] = value
  }
  const openSections = booleanRecord(source.openSections)
  if (openSections !== undefined) bucket.openSections = openSections
  const collapsedFolders = booleanRecord(source.collapsedFolders)
  if (collapsedFolders !== undefined) bucket.collapsedFolders = collapsedFolders
  if (typeof source.draft === 'string') bucket.draft = source.draft
  return bucket
}

/** Read the global preferences. */
export function readUiState(): UiState {
  return readRaw().global
}

/** Merge global preference changes into storage; storage failures are ignored. */
export function writeUiState(patch: Partial<UiState>): void {
  try {
    const raw = readRaw()
    const next: UiState = { ...raw.global, ...patch }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // A disabled or full localStorage must not break the panel.
  }
}

/**
 * Read one repository's bucket, falling back to the pre-bucket flat values so
 * existing installs keep their settings.
 */
export function readRepoUiState(repo?: string | null): RepoUiState {
  const raw = readRaw()
  const key = repo === undefined ? activeRepo : repo === null || repo === '' ? null : normalizeRepoKey(repo)
  const bucket = key === null ? undefined : raw.global.repos?.[key]
  const merged: RepoUiState = { ...raw.legacy, ...bucket }
  if (merged.draft === undefined && typeof repo === 'string' && repo !== '') {
    // Very old builds kept `commitDrafts: Record<repoRoot, message>` with raw paths.
    const draft = raw.legacyDrafts?.[repo]
    if (draft !== undefined) merged.draft = draft
  }
  return merged
}

/** Merge a change into one repository's bucket; a missing key is a no-op. */
export function writeRepoUiState(patch: Partial<RepoUiState>, repo?: string | null): void {
  const key = repo === undefined ? activeRepo : repo === null || repo === '' ? null : normalizeRepoKey(repo)
  if (key === null) return
  try {
    const raw = readRaw()
    const repos = { ...(raw.global.repos ?? {}) }
    repos[key] = { ...(repos[key] ?? {}), ...patch }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...raw.global, repos }))
  } catch {
    // Ignore storage failures.
  }
}






