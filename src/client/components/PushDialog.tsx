import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import type { WorkspaceView } from '../hooks/useWorkspace.js'
import type { Translate } from '../types.js'
import { DialogShell } from './DialogShell.js'
import { Button, DialogActions } from './Button.js'
import { Dropdown, type DropdownOption } from './Dropdown.js'
import { tooltipProps } from './Tooltip.js'
import { cls } from '../styles.js'

export interface PushDialogProps {
  view: GitLogView
  ws: WorkspaceView
  t: Translate
  onClose(): void
}

/** Multi-branch push: choose the remote, which local branches to push, targets, tracking, tags, force. */
export function PushDialog({ view, ws, t, onClose }: PushDialogProps): React.ReactElement {
  const groups = view.tree?.remotes ?? []
  const locals = view.tree?.branches ?? []
  const current = ws.status?.branch ?? ''
  const upstream = ws.status?.upstream ?? ''
  const slash = upstream.indexOf('/')
  const upstreamRemote = slash > 0 ? upstream.slice(0, slash) : ''
  const initialRemote = groups.some(group => group.name === upstreamRemote) ? upstreamRemote : groups[0]?.name ?? ''
  const [remote, setRemote] = useState(initialRemote)
  const remoteGroup = groups.find(group => group.name === remote)
  /**
   * Remote branch a local branch already tracks on `remoteName`, when its
   * upstream lives on that remote. Pushing should reuse that target instead of
   * a same-named branch, so `main-dev → origin-dev/main` keeps its pairing.
   */
  const trackedTarget = (branch: { upstream?: string }, remoteName: string): string | null => {
    const value = branch.upstream ?? ''
    const prefix = `${remoteName}/`
    return value.startsWith(prefix) ? value.slice(prefix.length) : null
  }
  const [checked, setChecked] = useState<Record<string, boolean>>(() => Object.fromEntries(
    locals.map(branch => [branch.name, branch.name === current]),
  ))
  const [targets, setTargets] = useState<Record<string, string>>(() => Object.fromEntries(
    locals.map(branch => [branch.name, trackedTarget(branch, initialRemote) ?? branch.name]),
  ))
  const [tracks, setTracks] = useState<Record<string, boolean>>(() => Object.fromEntries(
    locals.map(branch => [branch.name, trackedTarget(branch, initialRemote) !== null]),
  ))
  const [tags, setTags] = useState(false)
  const [force, setForce] = useState(false)

  const remoteNames = remoteGroup?.branches.map(branch => {
    const prefix = `${remote}/`
    return branch.name.startsWith(prefix) ? branch.name.slice(prefix.length) : branch.name
  }) ?? []
  const allNames = [...new Set([...remoteNames, ...locals.map(branch => branch.name)])].sort((left, right) => left.localeCompare(right))
  const targetOptions: DropdownOption[] = allNames.map(name => ({ value: name, label: name, title: name }))
  const allChecked = locals.length > 0 && locals.every(branch => checked[branch.name] === true)
  const anyChecked = locals.some(branch => checked[branch.name] === true)
  const canPush = (anyChecked || tags) && remote !== '' && ws.syncState === 'idle'

  const toggleAll = (value: boolean): void => {
    setChecked(Object.fromEntries(locals.map(branch => [branch.name, value])))
  }
  const chooseRemote = (value: string): void => {
    setRemote(value)
    // Keep a branch paired with the remote branch it already tracks on that remote.
    setTargets(Object.fromEntries(
      locals.map(branch => [branch.name, trackedTarget(branch, value) ?? branch.name]),
    ))
    // The tracking column shows whether the branch already follows that remote branch.
    setTracks(Object.fromEntries(
      locals.map(branch => [branch.name, trackedTarget(branch, value) !== null]),
    ))
  }

  return (
    <DialogShell title={`${t('push')}: ${view.repo?.repoName ?? ''}`} t={t} wide onClose={onClose}>
      <div className={cls('dsh-gitlog-push')}>
        <div className={cls('dsh-gitlog-push-remote')}>
          <label className={cls('dsh-gitlog-field')}>
            <span>{t('pushToRepository')}</span>
            <Dropdown
              value={remote}
              options={groups.map(group => ({ value: group.name, label: group.name, title: group.name }))}
              onChange={chooseRemote}
              ariaLabel={t('remote')}
              placeholder={t('remote')}
            />
          </label>
          <code className={cls('dsh-gitlog-push-url')} {...(remoteGroup?.url === undefined ? {} : tooltipProps(remoteGroup.url))}>{remoteGroup?.url ?? ''}</code>
        </div>

        <h3 className={cls('dsh-gitlog-push-title')}>{t('branchesToPush')}</h3>
        <div className={cls('dsh-gitlog-push-table')}>
          <div className={cls('dsh-gitlog-push-row dsh-gitlog-push-row-head')}>
            <span>{t('pushBranch')}</span>
            <span>{t('localBranch')}</span>
            <span>{t('remoteBranch')}</span>
            <span>{t('trackBranch')}</span>
          </div>
          <div className={cls('dsh-gitlog-push-scroll')}>
            {locals.map(branch => (
              <div key={branch.ref} className={cls('dsh-gitlog-push-row')}>
                <input
                  type="checkbox"
                  checked={checked[branch.name] === true}
                  onChange={event => setChecked(currentChecked => ({ ...currentChecked, [branch.name]: event.target.checked }))}
                  aria-label={`${t('pushBranch')} ${branch.name}`}
                />
                <span className={cls('dsh-gitlog-push-local')}>{branch.name}</span>
                <Dropdown
                  className={cls('dsh-gitlog-push-target')}
                  value={targets[branch.name] ?? branch.name}
                  options={targetOptions}
                  onChange={value => {
                    setTargets(currentTargets => ({ ...currentTargets, [branch.name]: value }))
                    setTracks(currentTracks => ({
                      ...currentTracks,
                      [branch.name]: branch.upstream === `${remote}/${value}`,
                    }))
                  }}
                  ariaLabel={`${branch.name} ${t('remoteBranch')}`}
                  placeholder={branch.name}
                />
                <input
                  type="checkbox"
                  checked={tracks[branch.name] === true}
                  onChange={event => setTracks(currentTracks => ({ ...currentTracks, [branch.name]: event.target.checked }))}
                  aria-label={`${branch.name} ${t('trackBranch')}`}
                />
              </div>
            ))}
          </div>
        </div>

        <label className={cls('dsh-gitlog-check dsh-gitlog-push-select-all')}>
          <input type="checkbox" checked={allChecked} onChange={event => toggleAll(event.target.checked)} />
          {t('selectAll')}
        </label>
        <div className={cls('dsh-gitlog-push-options')}>
          <label className={cls('dsh-gitlog-check')}>
            <input type="checkbox" checked={tags} onChange={event => setTags(event.target.checked)} />
            {t('pushAllTags')}
          </label>
          <label className={cls('dsh-gitlog-check')}>
            <input type="checkbox" checked={force} onChange={event => setForce(event.target.checked)} />
            {t('forcePush')}
          </label>
        </div>

        <DialogActions>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            variant="primary"
            disabled={!canPush}
            onClick={() => {
              const refs = locals
                .filter(branch => checked[branch.name] === true)
                .map(branch => ({
                  local: branch.name,
                  remote: targets[branch.name] ?? branch.name,
                  track: tracks[branch.name] === true,
                }))
              ws.pushBranches({ remote, refs, tags, force })
              onClose()
            }}
          >
            {t('push')}
          </Button>
        </DialogActions>
      </div>
    </DialogShell>
  )
}


