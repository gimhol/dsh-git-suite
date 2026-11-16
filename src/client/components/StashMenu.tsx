import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { requestStash, toApiError } from '../lib/api.js'
import type { Selection, Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { toast } from './Toast.js'
import { cls } from '../styles.js'

export interface StashMenuState {
  selection: Selection
  ref: string
  x: number
  y: number
}

export interface StashMenuProps {
  view: GitLogView
  context: StashMenuState | null
  t: Translate
  onChanged(): void
  onClose(): void
}

/** Right-click menu for a stash entry: apply, pop, or drop it. */
export function StashMenu({ view, context, t, onChanged, onClose }: StashMenuProps): React.ReactElement | null {
  const [busy, setBusy] = useState(false)
  const [dropOpen, setDropOpen] = useState(false)

  if (context === null) return null
  const path = view.repo?.repoRoot ?? view.pathInput.trim()
  const { ref } = context

  const run = async (action: 'apply' | 'pop'): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await requestStash({ path, action, ref })
      onChanged()
      toast((action === 'apply' ? t('stashApplied') : t('stashPopped')).replace('{ref}', ref))
      onClose()
    } catch (error) {
      toast(toApiError(error).message, 'error')
      setBusy(false)
    }
  }

  const drop = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await requestStash({ path, action: 'drop', ref })
      onChanged()
      toast(t('stashDropped').replace('{ref}', ref))
      onClose()
    } catch (error) {
      toast(toApiError(error).message, 'error')
      setBusy(false)
      setDropOpen(false)
    }
  }

  if (dropOpen) {
    return (
      <DialogShell title={t('stashDropTitle')} t={t} onClose={onClose}>
        <p className={cls('dsh-gitlog-warning')} role="alert">
          {t('stashDropConfirm').replace('{ref}', ref)}
        </p>
        <DialogActions>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="danger" disabled={busy} onClick={() => { void drop() }}>
            {busy ? t('stashDropping') : t('stashDrop')}
          </Button>
        </DialogActions>
      </DialogShell>
    )
  }

  const left = Math.min(context.x, window.innerWidth - 240)
  const top = Math.min(context.y, window.innerHeight - 150)
  return (
    <div
      className={cls('dsh-gitlog-commit-menu')}
      style={{ left, top }}
      role="menu"
      aria-label={t('stashes')}
    >
      <button type="button" role="menuitem" disabled={busy} onClick={() => { void run('apply') }}>
        {t('stashApply')}
      </button>
      <button type="button" role="menuitem" disabled={busy} onClick={() => { void run('pop') }}>
        {t('stashPop')}
      </button>
      <button type="button" role="menuitem" onClick={() => setDropOpen(true)}>
        {t('stashDrop')}
      </button>
    </div>
  )
}
