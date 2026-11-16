/**
 * Repoints one local branch at a different remote-tracking branch.
 *
 * `git branch --set-upstream-to=<remote>/<branch>` is what runs; the empty choice
 * clears the tracking configuration with `--unset-upstream`, which is the only way
 * to stop a branch from tracking an unrelated remote branch.
 */
import type * as React from 'react'
import { cls } from '../styles.js'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { requestBranchAction, toApiError } from '../lib/api.js'
import type { Branch, Translate } from '../types.js'
import { DialogShell } from './DialogShell.js'
import { Button, DialogActions } from './Button.js'
import { Dropdown } from './Dropdown.js'

export interface UpstreamDialogProps {
  view: GitLogView
  branch: Branch
  t: Translate
  onClose(): void
}

/** Pick the remote branch a local branch should follow (or none). */
export function UpstreamDialog({ view, branch, t, onClose }: UpstreamDialogProps): React.ReactElement {
  const current = branch.upstream ?? ''
  const options = (() => {
    const list: Array<{ value: string; label: string; group?: string }> = [
      { value: '', label: t('upstreamNone') },
    ]
    let known = current === ''
    for (const group of view.tree?.remotes ?? []) {
      for (const remoteBranch of group.branches) {
        if (remoteBranch.name === current) known = true
        list.push({ value: remoteBranch.name, label: remoteBranch.name, group: group.name })
      }
    }
    // A branch may track a remote branch that has since disappeared; keep it visible.
    if (!known) list.push({ value: current, label: current })
    return list
  })()
  const [upstream, setUpstream] = useState(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await requestBranchAction({
        action: 'upstream',
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        branch: branch.name,
        upstream,
      })
      view.refresh()
      onClose()
    } catch (failure) {
      const api = toApiError(failure)
      setError(
        api.code === 'upstream-not-found'
          ? t('upstreamMissing')
          : api.code === 'no-upstream' ? t('upstreamNotTracking') : api.message,
      )
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('upstreamDialogTitle')} t={t} onClose={onClose}>
      <div className={cls('dsh-gitlog-repo-form')}>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('branchName')}</span>
          <input type="text" value={branch.name} readOnly spellCheck={false} autoComplete="off" />
        </label>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('upstreamLabel')}</span>
          <Dropdown
            value={upstream}
            options={options}
            onChange={setUpstream}
            ariaLabel={t('upstreamLabel')}
            searchable
            searchPlaceholder={t('upstreamLabel')}
            noMatchesLabel={t('upstreamMissing')}
          />
        </label>
        <p className={cls('dsh-gitlog-settings-hint')}>{t('upstreamHint')}</p>
        {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
        <DialogActions className={cls('dsh-gitlog-settings-actions')}>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => { void save() }}>
            {busy ? t('upstreamSaving') : t('upstreamSave')}
          </Button>
        </DialogActions>
      </div>
    </DialogShell>
  )
}
