/**
 * Resolve the prompt template an AI feature should use.
 *
 * Precedence: a repository override, then a global override, then the built-in
 * template from the host. Settings edits either scope and clears it again.
 */
import {
  PROMPT_DEFINITIONS,
  defaultPrompt,
  type PromptKind,
  type PromptDefinition,
} from '../../host/ai-prompts.js'
import { readRepoUiState, readUiState, writeRepoUiState, writeUiState } from './ui-state.js'

export { PROMPT_DEFINITIONS, defaultPrompt }
export type { PromptKind, PromptDefinition }

/** Which stored template a resolved prompt came from. */
export type PromptScope = 'repo' | 'global' | 'default'

/** One AI feature's configuration shown in Settings. */
export interface PromptChoice {
  kind: PromptKind
  definition: PromptDefinition
  /** The template in force right now. */
  template: string
  scope: PromptScope
}

/** The override stored for one scope, if any. */
export function promptOverride(
  kind: PromptKind,
  scope: 'repo' | 'global',
  repoRoot: string | null,
): string | undefined {
  if (scope === 'global') return readUiState().aiPrompts?.[kind]
  if (repoRoot === null || repoRoot === '') return undefined
  return readRepoUiState(repoRoot).aiPrompts?.[kind]
}

/**
 * The template and its source for one feature in one repository.
 * @param kind - which AI feature.
 * @param repoRoot - repository root for the repo-level override, or null.
 */
export function resolvePrompt(kind: PromptKind, repoRoot: string | null): { template: string; scope: PromptScope } {
  const repo = promptOverride(kind, 'repo', repoRoot)
  if (repo !== undefined && repo.trim() !== '') return { template: repo, scope: 'repo' }
  const global = promptOverride(kind, 'global', repoRoot)
  if (global !== undefined && global.trim() !== '') return { template: global, scope: 'global' }
  return { template: defaultPrompt(kind), scope: 'default' }
}

/** Resolve every feature, for the Settings list. */
export function promptChoices(repoRoot: string | null): PromptChoice[] {
  return PROMPT_DEFINITIONS.map(definition => {
    const resolved = resolvePrompt(definition.kind, repoRoot)
    return { kind: definition.kind, definition, template: resolved.template, scope: resolved.scope }
  })
}

/**
 * Store or clear one override.
 * @param kind - which AI feature.
 * @param scope - which scope to write.
 * @param repoRoot - repository root for the repo scope.
 * @param text - the template; blank text clears the override.
 */
export function savePrompt(
  kind: PromptKind,
  scope: 'repo' | 'global',
  repoRoot: string | null,
  text: string,
): void {
  if (scope === 'global') {
    const next = { ...(readUiState().aiPrompts ?? {}) }
    if (text.trim() === '') delete next[kind]
    else next[kind] = text
    writeUiState({ aiPrompts: next })
    return
  }
  if (repoRoot === null || repoRoot === '') return
  const next = { ...(readRepoUiState(repoRoot).aiPrompts ?? {}) }
  if (text.trim() === '') delete next[kind]
  else next[kind] = text
  writeRepoUiState({ aiPrompts: next }, repoRoot)
}
