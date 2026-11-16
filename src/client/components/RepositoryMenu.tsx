import type * as React from 'react'
import { h, useEffect, useRef, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { requestClone, requestPickDirectory, toApiError } from '../lib/api.js'
import { projectDropdownOptions } from '../lib/project-dropdown.js'
import type { Translate } from '../types.js'
import { DialogShell } from './DialogShell.js'
import { Button, DialogActions } from './Button.js'
import { Dropdown } from './Dropdown.js'
import { PlusIcon } from './GitLogIcon.js'
import { cls } from '../styles.js'

interface DialogProps {
  view: GitLogView
  t: Translate
  onClose(): void
}

/** Last path segment of the remote URL, with a trailing `.git` removed. */
function repositoryName(url: string): string {
  return url.replace(/[/\\]+$/, '').split(/[/\\:]/).filter(Boolean).pop()?.replace(/\.git$/i, '') ?? ''
}

/** Suggest a sibling directory for the clone, named after the remote repository. */
function suggestedDestination(repoRoot: string | undefined, url: string): string {
  const name = repositoryName(url)
  if (repoRoot === undefined || name === '') return ''
  const parent = repoRoot.replace(/[\\/][^\\/]+$/, '')
  if (parent === '' || parent === repoRoot) return ''
  return `${parent}${parent.includes('\\') ? '\\' : '/'}${name}`
}

function CloneDialog({ view, t, onClose }: DialogProps): React.ReactElement {
  const [url, setUrl] = useState('')
  const [destination, setDestination] = useState('')
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const suggested = suggestedDestination(view.repo?.repoRoot, url)

  const chooseDestination = async (): Promise<void> => {
    setPicking(true)
    setError(null)
    try {
      const payload = await requestPickDirectory('directory')
      if (payload.cancelled === true) return
      if (payload.path === undefined) throw new Error(t('pickFailed'))
      const name = repositoryName(url)
      const base = payload.path.replace(/[\\/]+$/, '')
      const separator = payload.path.includes('\\') ? '\\' : '/'
      setDestination(name === '' ? base : `${base}${separator}${name}`)
    } catch (failure) {
      setError(toApiError(failure).message)
    } finally {
      setPicking(false)
    }
  }

  const clone = async (): Promise<void> => {
    if (busy) return
    const remote = url.trim()
    const target = destination.trim() || suggested
    if (remote === '' || target === '') {
      setError(t('cloneRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const payload = await requestClone({ url: remote, path: target })
      view.openPath(payload.repoRoot)
      view.rescanProjects()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('cloneTitle')} t={t} onClose={onClose}>
      <div className={cls('dsh-gitlog-repo-form')}>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('remoteUrl')}</span>
          <input
            type="text"
            value={url}
            onChange={event => setUrl(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              void clone()
            }}
            placeholder={t('remoteUrlPlaceholder')}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </label>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('cloneTo')}</span>
          <div className={cls('dsh-gitlog-field-row')}>
            <input
              type="text"
              value={destination}
              onChange={event => setDestination(event.target.value)}
              onKeyDown={event => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                event.preventDefault()
                void clone()
              }}
              placeholder={suggested === '' ? t('cloneToPlaceholder') : suggested}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              className={cls('dsh-gitlog-btn')}
              onClick={() => { void chooseDestination() }}
              disabled={picking || busy}
            >
              {picking ? t('choosingFolder') : t('chooseFolder')}
            </button>
          </div>
        </label>
        <p className={cls('dsh-gitlog-settings-hint')}>{t('cloneHint')}</p>
        {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
        <DialogActions className={cls('dsh-gitlog-settings-actions')}>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => { void clone() }}>
            {busy ? t('cloning') : t('clone')}
          </Button>
        </DialogActions>
      </div>
    </DialogShell>
  )
}

function ChooseDialog({ view, t, onClose }: DialogProps): React.ReactElement {
  const [path, setPath] = useState(view.pathInput)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changePath = (value: string): void => {
    setPath(value)
    view.changePathText(value)
  }

  const chooseDirectory = async (): Promise<void> => {
    setPicking(true)
    setError(null)
    try {
      const payload = await requestPickDirectory('repo')
      if (payload.cancelled === true) return
      if (payload.capability !== 'native' || payload.path === undefined) {
        setError(t('pickUnavailable'))
        return
      }
      setPath(payload.path)
      view.changePathText(payload.path)
    } catch (failure) {
      setError(toApiError(failure).message)
    } finally {
      setPicking(false)
    }
  }

  const openRepository = async (): Promise<void> => {
    if (busy) return
    const target = path.trim()
    if (target === '') return
    setBusy(true)
    setError(null)
    try {
      view.openPath(target)
      view.rescanProjects()
      onClose()
    } catch (failure) {
      setError(toApiError(failure).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogShell title={t('chooseLocalTitle')} t={t} onClose={onClose}>
      <div className={cls('dsh-gitlog-repo-form')}>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('project')}</span>
          <Dropdown
            value={view.selectedProjectPath}
            options={projectDropdownOptions(view, t)}
            onChange={value => changePath(value)}
            disabled={view.projectsStatus === 'loading'}
            ariaLabel={t('project')}
            placeholder={t('selectProject')}
            searchable
            searchPlaceholder={t('search')}
            noMatchesLabel={t('noMatches')}
          />
        </label>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('path')}</span>
          <div className={cls('dsh-gitlog-field-row')}>
            <input
              type="text"
              value={path}
              onChange={event => changePath(event.target.value)}
              onKeyDown={event => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                event.preventDefault()
                void openRepository()
              }}
              placeholder={t('pathPlaceholder')}
              spellCheck={false}
              autoComplete="off"
              autoFocus
            />
            <button
              type="button"
              className={cls('dsh-gitlog-btn')}
              onClick={() => { void chooseDirectory() }}
              disabled={picking || busy}
            >
              {picking ? t('choosingFolder') : t('chooseDirectory')}
            </button>
          </div>
        </label>
        <p className={cls('dsh-gitlog-settings-hint')}>{t('chooseLocalHint')}</p>
        {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
        <DialogActions className={cls('dsh-gitlog-settings-actions')}>
          <Button
            onClick={view.rescanProjects}
            disabled={view.projectsStatus === 'loading'}
          >
            {t('rescan')}
          </Button>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" variant="primary" disabled={path.trim() === '' || busy} onClick={() => { void openRepository() }}>
            {busy ? t('opening') : t('open')}
          </Button>
        </DialogActions>
      </div>
    </DialogShell>
  )
}

const MENU_WIDTH = 200

/** The header's "+" button: clone a remote repository or select a local one. */
export function RepositoryMenu({ view, t }: { view: GitLogView; t: Translate }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<'clone' | 'choose' | null>(null)
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const timer = useRef<number | null>(null)

  /** Anchor the menu to the button but keep it inside the viewport. */
  const place = (): void => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect === undefined) {
      setAnchor(null)
      return
    }
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))
    const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 96))
    setAnchor({ top, left })
  }

  const show = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    place()
    setOpen(true)
  }

  const hide = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      setOpen(false)
    }, 160)
  }

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    const reposition = (): void => place()
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  const choose = (mode: 'clone' | 'choose'): void => {
    setOpen(false)
    setDialog(mode)
  }

  return (
    <div
      ref={rootRef}
      className={cls('dsh-gitlog-add')}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <Button
        iconOnly
        className={cls('dsh-gitlog-add-btn')}
        title={t('addRepository')}
        ariaHasPopup="menu"
        ariaExpanded={open}
        onClick={() => { place(); setOpen(value => !value) }}
        icon={<PlusIcon />}
      />
      {open
        ? (
            <div
              className={cls('dsh-gitlog-add-menu is-floating')}
              style={{ top: anchor?.top ?? 0, left: anchor?.left ?? 0 }}
              role="menu"
              aria-label={t('addRepository')}
            >
              <button type="button" role="menuitem" onClick={() => choose('clone')}>
                {t('cloneRemote')}
              </button>
              <button type="button" role="menuitem" onClick={() => choose('choose')}>
                {t('selectLocal')}
              </button>
            </div>
          )
        : null}
      {dialog === 'clone' ? <CloneDialog view={view} t={t} onClose={() => setDialog(null)} /> : null}
      {dialog === 'choose' ? <ChooseDialog view={view} t={t} onClose={() => setDialog(null)} /> : null}
    </div>
  )
}

