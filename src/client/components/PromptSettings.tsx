/**
 * Settings section for the AI prompt templates.
 *
 * The section only lists each feature and where its template comes from; the
 * actual editor lives in its own modal, opened from a row's button.
 */
import type * as React from 'react'
import { h, useEffect, useState } from '../runtime.js'
import type { Translate } from '../types.js'
import {
  PROMPT_DEFINITIONS,
  defaultPrompt,
  promptChoices,
  promptOverride,
  resolvePrompt,
  savePrompt,
  type PromptKind,
  type PromptScope,
} from '../lib/ai-prompts.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { Dropdown } from './Dropdown.js'
import { cls } from '../styles.js'

export interface PromptSettingsProps {
  t: Translate
  /** Repository root for the repository scope; null disables that scope. */
  repoRoot: string | null
}

/** Localized name of one AI feature. */
function kindLabel(kind: PromptKind, t: Translate): string {
  switch (kind) {
    case 'commitMessage':
      return t('promptKindCommitMessage')
    case 'prDraft':
      return t('promptKindPrDraft')
    case 'commitReview':
      return t('promptKindCommitReview')
    case 'prReview':
      return t('promptKindPrReview')
  }
}

/** Localized name of the source a template currently comes from. */
function scopeLabel(scope: PromptScope, t: Translate): string {
  switch (scope) {
    case 'repo':
      return t('promptScopeRepo')
    case 'global':
      return t('promptScopeGlobal')
    default:
      return t('promptSourceDefault')
  }
}

/**
 * The text the editor starts from for one scope.
 * @param kind - AI feature.
 * @param scope - which override the editor is changing.
 * @param repoRoot - repository root for the repository scope.
 */
function initialText(kind: PromptKind, scope: 'repo' | 'global', repoRoot: string | null): string {
  if (scope === 'repo') return resolvePrompt(kind, repoRoot).template
  return promptOverride(kind, 'global', repoRoot) ?? defaultPrompt(kind)
}

interface PromptEditorDialogProps {
  t: Translate
  repoRoot: string | null
  kind: PromptKind
  onChanged(): void
  onClose(): void
}

/** One feature's template in a modal: scope, text, save, reset. */
function PromptEditorDialog({ t, repoRoot, kind: initialKind, onChanged, onClose }: PromptEditorDialogProps): React.ReactElement {
  const repoAvailable = repoRoot !== null && repoRoot !== ''
  const [kind, setKind] = useState<PromptKind>(initialKind)
  const [scope, setScope] = useState<'repo' | 'global'>(repoAvailable ? 'repo' : 'global')
  const [text, setText] = useState(() => initialText(initialKind, repoAvailable ? 'repo' : 'global', repoRoot))
  const [dirty, setDirty] = useState(false)

  // Reload the editor when the feature, scope, or repository changes.
  useEffect(() => {
    setText(initialText(kind, scope, repoRoot))
    setDirty(false)
  }, [kind, scope, repoRoot])

  const definition = PROMPT_DEFINITIONS.find(item => item.kind === kind)
  const placeholders = (definition?.placeholders ?? []).map(name => `{${name}}`).join(' ')
  const stored = promptOverride(kind, scope, repoRoot)
  const resolved = resolvePrompt(kind, repoRoot)
  const sourceHint = stored !== undefined
    ? t('promptCustomized')
    : scope === 'repo' && resolved.scope === 'global'
      ? t('promptInheritedGlobal')
      : t('promptUsingDefault')

  const save = (): void => {
    savePrompt(kind, scope, repoRoot, text)
    setDirty(false)
    onChanged()
  }

  const reset = (): void => {
    savePrompt(kind, scope, repoRoot, '')
    setText(initialText(kind, scope, repoRoot))
    setDirty(false)
    onChanged()
  }

  return (
    <DialogShell
      title={t('promptEditorTitle')}
      t={t}
      wide
      frameClassName={cls('dsh-gitlog-prompt-dialog')}
      onClose={onClose}
    >
      <div className={cls('dsh-gitlog-prompt-fields')}>
        <label className={cls('dsh-gitlog-field dsh-gitlog-prompt-field')}>
          <span>{t('promptFeature')}</span>
          <Dropdown
            value={kind}
            options={PROMPT_DEFINITIONS.map(item => ({ value: item.kind, label: kindLabel(item.kind, t) }))}
            onChange={value => setKind(value as PromptKind)}
            ariaLabel={t('promptFeature')}
          />
        </label>
        <label className={cls('dsh-gitlog-field dsh-gitlog-prompt-field')}>
          <span>{t('promptScope')}</span>
          <Dropdown
            value={scope}
            options={[
              { value: 'repo', label: t('promptScopeRepo') },
              { value: 'global', label: t('promptScopeGlobal') },
            ]}
            onChange={value => setScope(value === 'global' ? 'global' : 'repo')}
            ariaLabel={t('promptScope')}
          />
        </label>
      </div>
      {scope === 'repo' && !repoAvailable
        ? <p className={cls('dsh-gitlog-settings-hint')}>{t('promptRepoOnly')}</p>
        : null}
      <textarea
        className={cls('dsh-gitlog-prompt-text')}
        value={text}
        rows={14}
        spellCheck={false}
        aria-label={t('promptText')}
        onChange={event => {
          setText(event.target.value)
          setDirty(true)
        }}
      />
      <p className={cls('dsh-gitlog-settings-hint')}>
        {t('promptPlaceholders').replace('{list}', placeholders)}
      </p>
      <p className={cls('dsh-gitlog-settings-hint')}>{sourceHint}</p>
      <DialogActions>
        <Button onClick={onClose}>{t('close')}</Button>
        <Button onClick={reset} disabled={stored === undefined}>{t('promptReset')}</Button>
        <Button variant="primary" onClick={save} disabled={!dirty}>{t('promptSave')}</Button>
      </DialogActions>
    </DialogShell>
  )
}

/** Settings section: one row per AI feature with its template source. */
export function PromptSettings({ t, repoRoot }: PromptSettingsProps): React.ReactElement {
  const [editing, setEditing] = useState<PromptKind | null>(null)
  const [, setRevision] = useState(0)
  const choices = promptChoices(repoRoot)

  return (
    <div className={cls('dsh-gitlog-settings-section')}>
      <h3>{t('promptsSection')}</h3>
      <div className={cls('dsh-gitlog-prompt-list')}>
        {choices.map(choice => (
          <div key={choice.kind} className={cls('dsh-gitlog-prompt-row')}>
            <span className={cls('dsh-gitlog-prompt-name')}>{kindLabel(choice.kind, t)}</span>
            <span className={cls('dsh-gitlog-prompt-source')}>{scopeLabel(choice.scope, t)}</span>
            <Button onClick={() => setEditing(choice.kind)}>{t('promptEdit')}</Button>
          </div>
        ))}
      </div>
      {editing === null
        ? null
        : (
            <PromptEditorDialog
              t={t}
              repoRoot={repoRoot}
              kind={editing}
              onChanged={() => setRevision(value => value + 1)}
              onClose={() => setEditing(null)}
            />
          )}
    </div>
  )
}
