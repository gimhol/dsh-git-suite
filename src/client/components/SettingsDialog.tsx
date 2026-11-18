import type * as React from 'react'
import { h, useEffect, useState } from '../runtime.js'
import { requestVersionCheck, toApiError } from '../lib/api.js'
import type { Translate, VersionPayload } from '../types.js'
import { Dropdown } from './Dropdown.js'
import { Button } from './Button.js'
import { PromptSettings } from './PromptSettings.js'
import { ShortcutSettings } from './ShortcutSettings.js'
import { cls } from '../styles.js'

const LIMITS = [25, 50, 100, 200, 0] as const

/** Gear glyph for the header's settings button. */
export function SettingsIcon(): React.ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable={false}
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export interface SettingsDialogProps {
  limit: number
  t: Translate
  /** Latest automatic version check, so the dialog opens with the result. */
  version?: VersionPayload | null
  /** Repository root, enabling the repository-level prompt scope. */
  repoRoot?: string | null
  onChange(limit: number): void
  onClose(): void
}

/** Modal settings: commit page size and a version/update check. */
export function SettingsDialog({ limit, t, version, repoRoot, onChange, onClose }: SettingsDialogProps): React.ReactElement {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<VersionPayload | null>(version ?? null)
  const [checkError, setCheckError] = useState<string | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const check = async (): Promise<void> => {
    if (checking) return
    setChecking(true)
    setCheckError(null)
    try {
      setResult(await requestVersionCheck())
    } catch (error) {
      setResult(null)
      setCheckError(toApiError(error).message)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div
      className={cls('dsh-gitlog-modal-backdrop')}
      onClick={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={cls('dsh-gitlog-modal')} role="dialog" aria-modal="true" aria-label={t('settings')}>
        <div className={cls('dsh-gitlog-modal-head')}>
          <h2>{t('settings')}</h2>
          <button
            type="button"
            className={cls('dsh-gitlog-modal-close')}
            onClick={onClose}
            aria-label={t('close')}
          >
            ×
          </button>
        </div>
        <div className={cls('dsh-gitlog-modal-body')}>
          <div className={cls('dsh-gitlog-modal-content')}>
          <label className={cls('dsh-gitlog-field')}>
            <span>{t('pageSize')}</span>
            <Dropdown
              value={String(limit)}
              options={LIMITS.map(value => ({
                value: String(value),
                label: value === 0 ? t('allCommits') : String(value),
              }))}
              onChange={value => onChange(Number(value))}
              ariaLabel={t('pageSize')}
              autoFocus
            />
          </label>
          <p className={cls('dsh-gitlog-modal-hint')}>{t('settingsHint')}</p>

          <ShortcutSettings t={t} />

          <PromptSettings t={t} repoRoot={repoRoot ?? null} />

          <div className={cls('dsh-gitlog-modal-section')}>
            <h3>{t('versionSection')}</h3>
            <p className={cls('dsh-gitlog-modal-hint')}>
              {t('currentVersion').replace('{version}', __GIT_SUITE_VERSION__)}
            </p>
            <Button onClick={() => { void check() }} disabled={checking}>
              {checking ? t('checkingUpdate') : t('checkUpdate')}
            </Button>
            {checkError === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{checkError}</p>}
            {result !== null && result.updateAvailable
              ? <p className={cls('dsh-gitlog-note')} role="status">{t('updateAvailable').replace('{version}', result.latest)}</p>
              : null}
            {result !== null && result.updateAvailable
              ? <p className={cls('dsh-gitlog-modal-hint')}>{t('updateHint')}</p>
              : null}
            {result !== null && !result.updateAvailable
              ? <p className={cls('dsh-gitlog-note')} role="status">{t('updateUpToDate')}</p>
              : null}
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}


