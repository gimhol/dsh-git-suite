import type * as React from 'react'
import { h, useState } from '../runtime.js'
import type { PullsView } from '../hooks/usePulls.js'
import type { Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { SparkleIcon } from './GitLogIcon.js'
import { DialogShell } from './DialogShell.js'
import { Dropdown } from './Dropdown.js'
import { requestPullDraft, toApiError } from '../lib/api.js'
import { resolvePrompt } from '../lib/ai-prompts.js'
import { forgeLabel, forgeOf } from '../lib/forge.js'
import { cls } from '../styles.js'

export interface CreatePullDialogProps {
  view: PullsView
  t: Translate
  onClose(): void
}

/** Opens a new pull request from the checked-out branch into a remote base. */
export function CreatePullDialog({ view, t, onClose }: CreatePullDialogProps): React.ReactElement {
  /** Branch names of one remote, without the `remote/` prefix. */
  const branchNamesOf = (remoteName: string): string[] => {
    const group = view.remotes.find(item => item.name === remoteName)
    if (group === undefined) return []
    const prefix = `${remoteName}/`
    return [...new Set(group.branches.map(branch => (
      branch.name.startsWith(prefix) ? branch.name.slice(prefix.length) : branch.name
    )))].sort()
  }

  // Sources: every local branch, always including the checked-out one.
  const locals = view.localBranches.length > 0
    ? view.localBranches
    : [{ name: view.headBranch, upstream: null }]
  const [head, setHead] = useState(view.headBranch)
  /** Forge address (`provider:host`) of one remote, or '' when unknown. */
  const addressOf = (remoteName: string): string => {
    const forge = forgeOf(view.remotes, remoteName)
    return forge === null ? '' : `${forge.provider}:${forge.host.toLowerCase()}`
  }
  /** Brand name of a remote's forge ('Gitee', 'GitHub'), or '' when unknown. */
  const forgeLabelOf = (remoteName: string): string => {
    const forge = forgeOf(view.remotes, remoteName)
    return forge === null ? '' : forgeLabel(forge.provider)
  }
  /** Label prefixed with the forge brand, so the address is visible in the picker. */
  const brandedLabel = (remoteName: string, text: string): string => {
    const brand = forgeLabelOf(remoteName)
    return brand === '' ? text : `${brand} · ${text}`
  }
  /** Whether two remotes live on the same forge address. */
  const sameAddress = (left: string, right: string): boolean => {
    const address = addressOf(left)
    return address !== '' && address === addressOf(right)
  }
  /** Remote that owns a source branch (its upstream's remote), without a fallback. */
  const upstreamRemoteOf = (name: string): string => {
    const upstream = locals.find(branch => branch.name === name)?.upstream ?? ''
    const slash = upstream.indexOf('/')
    if (slash <= 0) return ''
    const remote = upstream.slice(0, slash)
    return remote === '.' ? '' : remote
  }
  const [baseRemote, setBaseRemote] = useState(() => {
    const remote = upstreamRemoteOf(view.headBranch)
    // Start on a remote that shares the source's forge address.
    if (remote === '' || sameAddress(remote, view.remote)) return view.remote
    return remote
  })

  /** Remote branch this local branch already tracks on `remoteName`. */
  const trackedBase = (name: string, remoteName: string): string => {
    const upstream = locals.find(branch => branch.name === name)?.upstream ?? ''
    const prefix = `${remoteName}/`
    return upstream.startsWith(prefix) ? upstream.slice(prefix.length) : ''
  }
  /** Target to prefill: the source's tracking branch on that remote, else its default. */
  const defaultBaseFor = (name: string, remoteName: string): string => {
    const names = branchNamesOf(remoteName)
    const tracked = trackedBase(name, remoteName)
    if (tracked !== '' && names.includes(tracked)) return tracked
    const fallback = remoteName === view.remote ? view.defaultBase : ''
    if (fallback !== '' && names.includes(fallback)) return fallback
    return names[0] ?? ''
  }

  /** Remote that owns the source branch: its upstream's remote, else the chosen target remote. */
  const headRemoteOf = (name: string): string => upstreamRemoteOf(name) || baseRemote

  /** `remote/branch` a local branch is pushed as: its upstream, else the target remote. */
  const headLabel = (name: string): string => {
    const upstream = locals.find(branch => branch.name === name)?.upstream ?? ''
    const slash = upstream.indexOf('/')
    if (slash <= 0) return `${baseRemote}/${name}`
    const remote = upstream.slice(0, slash)
    const branch = upstream.slice(slash + 1)
    return `${remote === '.' ? baseRemote : remote}/${branch}`
  }

  // Targets: the branches of remotes on the source's forge address, labelled `remote/branch`.
  const targetValue = (remoteName: string, branch: string): string => `${remoteName}\u0000${branch}`
  const headRemote = headRemoteOf(head)
  const headAddress = addressOf(headRemote)
  const toOptions = view.remotes
    .filter(group => headAddress === '' || addressOf(group.name) === '' || addressOf(group.name) === headAddress)
    .flatMap(group => branchNamesOf(group.name)
      .filter(name => group.name !== view.remote || name !== view.headBranch)
      .map(name => {
        const label = brandedLabel(group.name, `${group.name}/${name}`)
        return { value: targetValue(group.name, name), label, title: label }
      }))

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [base, setBase] = useState(() => defaultBaseFor(view.headBranch, baseRemote))
  const [draft, setDraft] = useState(false)
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Switch the source, moving the target to that source's forge address and tracking branch. */
  const chooseHead = (name: string): void => {
    const remote = upstreamRemoteOf(name)
    const nextBaseRemote = remote === '' || sameAddress(remote, baseRemote) ? baseRemote : remote
    setHead(name)
    setBaseRemote(nextBaseRemote)
    setBase(defaultBaseFor(name, nextBaseRemote))
  }

  const submit = async (): Promise<void> => {
    if (busy) return
    const value = title.trim()
    if (value === '') {
      setError(t('pullTitleRequired'))
      return
    }
    if (base === '') {
      setError(t('pullBaseRequired'))
      return
    }
    setBusy(true)
    setError(null)
    const message = await view.createPull({ title: value, body, base, remote: baseRemote, head, draft })
    if (message === null) {
      onClose()
      return
    }
    setError(message)
    setBusy(false)
  }

  /** Ask the default model for a title and description of base...head. */
  const generate = async (): Promise<void> => {
    if (generating || base === '' || head === '') return
    setGenerating(true)
    setError(null)
    try {
      const draft = await requestPullDraft({
        path: view.repoRoot,
        remote: baseRemote,
        base,
        head,
        language: t('localeId'),
        prompt: resolvePrompt('prDraft', view.repoRoot).template,
      })
      setTitle(draft.title)
      setBody(draft.body)
    } catch (failure) {
      setError(toApiError(failure).message)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <DialogShell title={forgeLabelOf(baseRemote) === '' ? t('pullCreateTitle') : `${t('pullCreateTitle')} · ${forgeLabelOf(baseRemote)}`} t={t} onClose={onClose}>
      <div className={cls('dsh-gitlog-pull-create')}>
        <div className={cls('dsh-gitlog-pull-create-branches')}>
          <label className={cls('dsh-gitlog-field')}>
            <span>{t('pullCreateHead')}</span>
            <Dropdown
              value={head}
              options={locals.map(branch => {
                const label = brandedLabel(upstreamRemoteOf(branch.name) || baseRemote, headLabel(branch.name))
                return { value: branch.name, label, title: label }
              })}
              onChange={chooseHead}
              ariaLabel={t('pullCreateHead')}
              placeholder={t('pullCreateHead')}
              searchable
              searchPlaceholder={t('search')}
              noMatchesLabel={t('noMatches')}
            />
          </label>
          <label className={cls('dsh-gitlog-field grow')}>
            <span>{t('pullCreateBase')}</span>
            <Dropdown
              value={targetValue(baseRemote, base)}
              options={toOptions}
              onChange={value => {
                const separator = value.indexOf('\u0000')
                if (separator < 0) return
                setBaseRemote(value.slice(0, separator))
                setBase(value.slice(separator + 1))
              }}
              ariaLabel={t('pullCreateBase')}
              placeholder={t('pullCreateBase')}
              searchable
              searchPlaceholder={t('search')}
              noMatchesLabel={t('noMatches')}
            />
          </label>
        </div>
        <div className={cls('dsh-gitlog-field')}>
          <span>{t('pullCreateTitleLabel')}</span>
          <div className={cls('dsh-gitlog-pull-create-title')}>
            <input
              type="text"
              value={title}
              onChange={event => setTitle(event.target.value)}
              placeholder={t('pullCreateTitlePlaceholder')}
              spellCheck={false}
              autoComplete="off"
              autoFocus
              aria-label={t('pullCreateTitleLabel')}
            />
            <Button
              iconOnly
              variant="ghost"
              title={generating ? t('pullCreateGenerating') : t('pullCreateGenerate')}
              disabled={generating || base === '' || head === ''}
              onClick={() => { void generate() }}
              icon={<SparkleIcon />}
            />
          </div>
        </div>
        <label className={cls('dsh-gitlog-field')}>
          <span>{t('pullCreateBody')}</span>
          <textarea
            className={cls('dsh-gitlog-pull-create-body')}
            value={body}
            onChange={event => setBody(event.target.value)}
            placeholder={t('pullCreateBodyPlaceholder')}
            spellCheck={false}
          />
        </label>
        <label className={cls('dsh-gitlog-check')}>
          <input type="checkbox" checked={draft} onChange={event => setDraft(event.target.checked)} />
          {t('pullCreateDraft')}
        </label>
        <p className={cls('dsh-gitlog-field-hint')}>{t('pullCreateHint')}</p>
        {headRemoteOf(head) !== view.remote
          ? (
              <p className={cls('dsh-gitlog-field-hint')}>
                {t('pullCreateCrossRepo').replace('{head}', headRemoteOf(head)).replace('{base}', view.remote)}
              </p>
            )
          : null}
      </div>
      {error === null ? null : <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>}
      <DialogActions>
        <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="primary" disabled={busy || base === ''} onClick={() => { void submit() }}>
          {busy ? t('pullCreating') : t('pullCreateAction')}
        </Button>
      </DialogActions>
    </DialogShell>
  )
}
