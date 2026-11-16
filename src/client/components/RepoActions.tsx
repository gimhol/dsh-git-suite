import type * as React from 'react'
import { h, useCallback, useEffect, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import type { WorkspaceView } from '../hooks/useWorkspace.js'
import { requestApps, requestOpenApp, toApiError, type ErrorDetails } from '../lib/api.js'
import { fileManagerName } from '../lib/platform.js'
import type { ViewMode } from '../lib/ui-state.js'
import type { Translate } from '../types.js'
import { Button } from './Button.js'
import { Switch } from './Switch.js'
import { FetchIcon, FolderIcon, PullIcon, PushIcon, TerminalIcon } from './GitLogIcon.js'
import { EditorGlyph } from './EditorIcons.js'
import { FetchDialog } from './FetchDialog.js'
import { PushDialog } from './PushDialog.js'
import { SyncDialog } from './SyncDialog.js'
import { toast } from './Toast.js'
import { cls } from '../styles.js'

/** `exit 3221225477` / `spawn ENOENT`, the diagnostic a failed launch reports. */
function launchDetail(details: ErrorDetails | undefined): string {
  if (typeof details?.detail === 'string' && details.detail !== '') return details.detail
  if (typeof details?.exitCode === 'number') return `exit ${String(details.exitCode)}`
  if (typeof details?.spawnCode === 'string') return `spawn ${details.spawnCode}`
  return 'error'
}

export interface RepoActionsProps {
  view: GitLogView
  ws: WorkspaceView
  mode: ViewMode
  onModeChange(mode: ViewMode): void
  t: Translate
}

/** View switch plus pull / push / fetch and the "open with" actions, icon-only. */
export function RepoActions({ view, ws, mode, onModeChange, t }: RepoActionsProps): React.ReactElement {
  const path = view.repo?.repoRoot ?? view.pathInput.trim()
  const remotes = view.tree?.remotes ?? []
  const syncBusy = ws.syncState === 'loading'
  const [pullOpen, setPullOpen] = useState(false)
  const [fetchOpen, setFetchOpen] = useState(false)
  const [pushOpen, setPushOpen] = useState(false)
  const [busyEditor, setBusyEditor] = useState<string | null>(null)
  const [editors, setEditors] = useState<Array<{ id: string; name: string }>>([])

  const reloadEditors = useCallback((signal?: AbortSignal): void => {
    // Hide the editor button until this repository's host answers.
    setEditors([])
    requestApps(signal)
      .then(payload => {
        if (signal?.aborted === true) return
        setEditors(Array.isArray(payload.editors) ? payload.editors : [])
      })
      .catch(() => {
        // Detection is best effort: hide the editor button when it fails.
        if (signal?.aborted !== true) setEditors([])
      })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    reloadEditors(controller.signal)
    return () => controller.abort()
  }, [reloadEditors, view.repo?.repoRoot])

  // The button stays disabled until the host answers: a launch that fails is
  // reported here, because the editor's own window never appears to explain it.
  const openEditor = async (editor: { id: string; name: string }): Promise<void> => {
    if (path === '' || editor.id === '') return
    setBusyEditor(editor.id)
    try {
      await requestOpenApp({ path, target: 'editor', editor: editor.id })
    } catch (error) {
      void reloadEditors()
      const failure = toApiError(error)
      toast(
        failure.code === 'launch-failed'
          ? t('openEditorFailed').replace('{name}', editor.name).replace('{detail}', launchDetail(failure.details))
          : failure.message,
        'error',
      )
    } finally {
      setBusyEditor(null)
    }
  }

  const syncLabel = (action: 'pull' | 'push' | 'fetch'): string => {
    if (syncBusy && ws.syncAction === action) {
      return action === 'pull' ? t('pulling') : action === 'push' ? t('pushing') : t('fetching')
    }
    return t(action)
  }

  const openApp = async (target: 'terminal' | 'explorer'): Promise<void> => {
    if (path === '') return
    try {
      await requestOpenApp({ path, target })
    } catch (error) {
      toast(toApiError(error).message, 'error')
    }
  }

  // The OS file manager has a different name on every platform.
  const explorerLabel = fileManagerName(t)
  // The PR view only exists for repositories whose remote is a known forge.
  const forgeAvailable = (view.tree?.remotes ?? []).some(remote => remote.forge !== null && remote.forge !== undefined)
  const modes: Array<{ value: ViewMode; label: string }> = [
    { value: 'history', label: t('history') },
    { value: 'workspace', label: t('commit') },
  ]
  if (forgeAvailable) modes.push({ value: 'pulls', label: t('pulls') })

  return (
    <div className={cls('dsh-gitlog-repo-actions')}>
      <Switch
        value={mode}
        ariaLabel={t('viewMode')}
        options={modes}
        onChange={onModeChange}
      />
      <Button
        variant="ghost"
        iconOnly
        title={syncLabel('pull')}
        icon={<PullIcon />}
        disabled={syncBusy || path === '' || remotes.length === 0}
        onClick={() => setPullOpen(true)}
      />
      <Button
        variant="ghost"
        iconOnly
        title={syncLabel('push')}
        icon={<PushIcon />}
        disabled={syncBusy || path === '' || remotes.length === 0}
        onClick={() => setPushOpen(true)}
      />
      <Button
        variant="ghost"
        iconOnly
        title={syncLabel('fetch')}
        icon={<FetchIcon />}
        disabled={syncBusy || path === ''}
        onClick={() => setFetchOpen(true)}
      />
      <Button
        variant="ghost"
        iconOnly
        title={t('openTerminal')}
        icon={<TerminalIcon />}
        disabled={path === ''}
        onClick={() => { void openApp('terminal') }}
      />
      <Button
        variant="ghost"
        iconOnly
        title={explorerLabel}
        icon={<FolderIcon />}
        disabled={path === ''}
        onClick={() => { void openApp('explorer') }}
      />
      {editors.map(editor => (
        <Button
          key={editor.id}
          variant="ghost"
          iconOnly
          title={busyEditor === editor.id ? t('opening') : t('openInEditorName').replace('{name}', editor.name)}
          icon={<EditorGlyph id={editor.id} />}
          disabled={path === '' || busyEditor !== null}
          onClick={() => { void openEditor(editor) }}
        />
      ))}
      {ws.syncNote !== null ? <p className={cls('dsh-gitlog-note')} role="status">{ws.syncNote}</p> : null}
      {ws.syncError !== null ? <p className={cls('dsh-gitlog-note')} role="alert">{ws.syncError.message}</p> : null}
      {pullOpen
        ? (
            <SyncDialog
              action="pull"
              view={view}
              ws={ws}
              t={t}
              onClose={() => setPullOpen(false)}
            />
          )
        : null}
      {fetchOpen
        ? <FetchDialog ws={ws} t={t} onClose={() => setFetchOpen(false)} />
        : null}
      {pushOpen
        ? <PushDialog view={view} ws={ws} t={t} onClose={() => setPushOpen(false)} />
        : null}
    </div>
  )
}










