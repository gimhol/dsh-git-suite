/**
 * Built-in prompt templates for the plugin's AI features and the renderer that
 * fills their placeholders.
 *
 * A template is the user prompt sent to the model; `{name}` placeholders are
 * replaced with the request's content. Users may override a template globally
 * or per repository, so the defaults live here and are shared by the host (which
 * renders them) and the client (which shows them in Settings).
 */

export type PromptKind = 'commitMessage' | 'prDraft' | 'commitReview' | 'prReview'

export interface PromptDefinition {
  kind: PromptKind
  /** Placeholders the template may use, in the order shown to the user. */
  placeholders: readonly string[]
  /** Built-in template; the same text the host used before prompts were editable. */
  template: string
}

/** One built-in template per AI feature, in the order Settings lists them. */
export const PROMPT_DEFINITIONS: readonly PromptDefinition[] = [
  {
    kind: 'commitMessage',
    placeholders: ['recent', 'source', 'files', 'diff'],
    template: [
      'Write a Git commit message for the changes below.',
      'Reply with only the commit message: no code fences, no quotes, and no explanation.',
      'Use the imperative mood and a concise subject line; match the repository style.',
      '',
      'Recent commit subjects:',
      '{recent}',
      '',
      'Changed files ({source}):',
      '{files}',
      '',
      'Diff ({source}):',
      '{diff}',
    ].join('\n'),
  },
  {
    kind: 'prDraft',
    placeholders: ['head', 'base', 'commits', 'diff', 'language'],
    template: [
      'Write a pull request that merges "{head}" into "{base}".',
      'Reply with the title on the first line (at most 72 characters), then a blank line, then a Markdown description.',
      'Use these sections in the description: Summary, Changes, Testing.',
      'Do not wrap the reply in code fences, do not repeat the title in the body, and do not invent changes.',
      '',
      'Commits between the base and the head:',
      '{commits}',
      '',
      'Diff (base...head):',
      '{diff}',
      '',
      'Respond in {language}.',
    ].join('\n'),
  },
  {
    kind: 'commitReview',
    placeholders: ['diff', 'language'],
    template: [
      'Review the staged changes that are about to be committed.',
      '',
      'Staged diff:',
      '{diff}',
      '',
      'Write a code review in Markdown. Focus only on these staged changes:',
      '- Correctness bugs, edge cases, and regressions.',
      '- Security, data-loss, and performance risks.',
      '- Missing or inadequate tests.',
      '- Concrete suggestions with file paths and, when possible, hunk context.',
      'Use sections: Summary, Issues (with severity high/medium/low), Tests, Suggestions.',
      'If something is uncertain or not visible in the diff, say so instead of guessing.',
      'Do not praise, and do not invent code that is not in the diff.',
      'Respond in {language}.',
    ].join('\n'),
  },
  {
    kind: 'prReview',
    placeholders: ['number', 'title', 'source', 'target', 'author', 'description', 'commitsCount', 'commits', 'filesCount', 'diff', 'fullFiles', 'language'],
    template: [
      'Review pull request #{number}: {title}',
      'Source: {source} → {target}',
      'Author: {author}',
      '',
      'Description:',
      '{description}',
      '',
      'Commits ({commitsCount}):',
      '{commits}',
      '',
      'Changed files ({filesCount}):',
      '{diff}',
      '',
      'Some patches may be unavailable from the forge; when complete file contents are supplied below, trust them over missing patches.',
      '',
      'Full contents of changed files at the PR head (read from a temporary read-only checkout; nothing was executed):',
      '{fullFiles}',
      '',
      'Write a code review in Markdown. Focus only on the changes above:',
      '- Correctness bugs, edge cases, and regressions.',
      '- Security, data-loss, and performance risks.',
      '- Missing or inadequate tests.',
      '- Concrete suggestions with file paths and, when possible, hunk context.',
      'Use sections: Summary, Issues (with severity high/medium/low), Tests, Suggestions.',
      'If something is uncertain or not visible in the excerpt, say so instead of guessing.',
      'Do not praise, do not repeat the description, and do not invent code that is not in the diff.',
      'Respond in {language}.',
    ].join('\n'),
  },
]

/** @returns the built-in template for one feature. */
export function defaultPrompt(kind: PromptKind): string {
  return PROMPT_DEFINITIONS.find(definition => definition.kind === kind)?.template ?? ''
}

/**
 * Fill `{name}` placeholders with the request's content.
 * @param template - the prompt template.
 * @param values - placeholder values; unknown placeholders are left untouched.
 * @returns the rendered user prompt.
 */
export function renderPrompt(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, key: string) => {
    const value = values[key]
    return value === undefined ? match : value
  })
}
