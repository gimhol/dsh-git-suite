import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import type { WorkspaceView } from '../hooks/useWorkspace.js'
import type { Translate } from '../types.js'
import { DialogShell } from './DialogShell.js'
import { Button, DialogActions } from './Button.js'
import { Dropdown } from './Dropdown.js'
import { cls } from '../styles.js'

export interface SyncDialogProps {
  action: 'pull' | 'push'
  view: GitLogView
  ws: WorkspaceView
  t: Translate
  onClose(): void
}

/** Pick the remote and branch for a pull or push. */
export function SyncDialog({ action, view, ws, t, onClose }: SyncDialogProps): React.ReactElement {
  const groups = view.tree?.remotes ?? []
  const upstream = ws.status?.upstream ?? ''
  const slash = upstream.indexOf('/')
  const upstreamRemote = slash > 0 ? upstream.slice(0, slash) : ''
  const upstreamBranch = slash > 0 ? upstream.slice(slash + 1) : ''
  const current = ws.status?.branch ?? ''

  const branchOptionsFor = (remoteName: string): { value: string; label: string; title: string }[] => {
    const group = groups.find(item => item.name === remoteName)
    if (group === undefined) return []
    const prefix = `${remoteName}/`
    return group.branches.map(branch => {
      const name = branch.name.startsWith(prefix) ? branch.name.slice(prefix.length) : branch.name
      return { value: name, label: name, title: branch.name }
    })
  }
  const defaultBranchFor = (remoteName: string): string => {
    const names = branchOptionsFor(remoteName).map(option => option.value)
    if (upstreamBranch !== '' && names.includes(upstreamBranch)) return upstreamBranch
    if (names.includes(current)) return current
    return names[0] ?? ''
  }

  const initialRemote = groups.some(group => group.name === upstreamRemote) ? upstreamRemote : groups[0]?.name ?? ''
  const [remote, setRemote] = useState(initialRemote)
  const [branch, setBranch] = useState(defaultBranchFor(initialRemote))
  const branchOptions = branchOptionsFor(remote)
  const canSubmit = remote !== '' && branch !== '' && ws.syncState === 'idle'
  const title = action === 'pull' ? t('pull') : t('push')

  return (
    <DialogShell title={title} t={t} wide onClose={onClose}>
      <div className={cls('dsh-gitlog-field')}>
        <span>{t('remote')}</span>
        <Dropdown
          value={remote}
          options={groups.map(group => ({ value: group.name, label: group.name, title: group.name }))}
          onChange={value => {
            setRemote(value)
            setBranch(defaultBranchFor(value))
          }}
          ariaLabel={t('remote')}
          placeholder={t('remote')}
        />
      </div>
      <div className={cls('dsh-gitlog-field')}>
        <span>{t('branch')}</span>
        <Dropdown
          value={branch}
          options={branchOptions}
          onChange={setBranch}
          ariaLabel={t('branch')}
          placeholder={t('branch')}
        />
      </div>
      <p className={cls('dsh-gitlog-note')}>
        {action === 'pull'
          ? `${t('pull')} ${remote}/${branch} → ${current}`
          : `${t('push')} ${current} → ${remote}/${branch}`}
      </p>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button
          variant="primary"
          disabled={!canSubmit}
          onClick={() => {
            ws.sync(action, { remote, branch })
            onClose()
          }}
        >
          {title}
        </Button>
      </DialogActions>
    </DialogShell>
  )
}
