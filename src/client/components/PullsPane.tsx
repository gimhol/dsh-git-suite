import type * as React from 'react'
import { h, useEffect, useRef, useState } from '../runtime.js'
import type { PullsView } from '../hooks/usePulls.js'
import { formatDateTime } from '../lib/format.js'
import { forgeLabel } from '../lib/forge.js'
import { useDiffMode } from '../lib/use-diff-mode.js'
import { useSplitSize } from '../lib/use-split-size.js'
import { readRepoUiState, writeRepoUiState } from '../lib/ui-state.js'
import type { PullDetail, PullFile, PullSummary, Translate } from '../types.js'
import { Button } from './Button.js'
import { AiReviewDialog } from './AiReviewDialog.js'
import { CreatePullDialog } from './CreatePullDialog.js'
import { DeletePullDialog } from './DeletePullDialog.js'
import { DiffView } from './DiffView.js'
import { Dropdown } from './Dropdown.js'
import { ForgeAuthDialog } from './ForgeAuthDialog.js'
import { MergePullDialog } from './MergePullDialog.js'
import { Markdown } from './Markdown.js'
import { PullChecksBadge } from './PullChecksBadge.js'
import { PullApprovalBadges } from './PullApprovalBadges.js'
import { PullReviewBadge } from './PullReviewBadge.js'
import { PullStateDialog, type PullStateAction } from './PullStateDialog.js'
import { RefreshIcon, SplitDiffIcon, UnifiedDiffIcon } from './GitLogIcon.js'
import { LoadingLine, Spinner } from './States.js'
import { Splitter } from './Splitter.js'
import { Switch } from './Switch.js'
import { tooltipProps } from './Tooltip.js'
import { VirtualList } from './VirtualList.js'
import { cls } from '../styles.js'

export interface PullsPaneProps {
  view: PullsView
  t: Translate
  /** Sidebar/narrow layout: the list sits above the detail. */
  narrow: boolean
  /** Repository key used to persist the splitter sizes. */
  repoKey: string
}

/** Fixed row height, shared by the CSS and the virtual list. */
const PULL_ROW_HEIGHT = 48

function statusLabel(status: string, t: Translate): string {
  if (status === 'added') return t('statusAdded')
  if (status === 'deleted') return t('statusDeleted')
  if (status === 'renamed') return t('statusRenamed')
  if (status === 'copied') return t('statusCopied')
  return t('statusModified')
}

function statusLetter(status: string): string {
  if (status === 'added') return 'A'
  if (status === 'deleted') return 'D'
  if (status === 'renamed') return 'R'
  if (status === 'copied') return 'C'
  return 'M'
}

/** Add the file headers the forge patches omit, so DiffView can number lines. */
function patchText(file: PullFile): string {
  if (file.patch === '') return ''
  if (file.patch.startsWith('diff --git ') || file.patch.startsWith('--- ')) return file.patch
  return `diff --git a/${file.path} b/${file.path}\n--- a/${file.path}\n+++ b/${file.path}\n${file.patch}`
}

/** Extract `owner/repo` from a forge URL (clone or web). */
function repositoryFromUrl(url: string | null): string {
  if (url === null) return ''
  try {
    return new URL(url).pathname.replace(/^\/+/, '').replace(/\.git$/i, '')
  } catch {
    return ''
  }
}

function PullBadge({ pull, t }: { pull: PullSummary; t: Translate }): React.ReactElement {
  if (pull.draft) return <span className={cls('dsh-gitlog-pull-badge is-draft')}>{t('pullDraft')}</span>
  const label = pull.state === 'merged'
    ? t('pullStateMerged')
    : pull.state === 'closed'
      ? t('pullStateClosed')
      : t('pullStateOpen')
  return <span className={cls(`dsh-gitlog-pull-badge is-${pull.state}`)}>{label}</span>
}

/** Mergeability of an open request; only the detail payload carries it per forge. */
function PullMergeState({ pull, t }: { pull: PullDetail; t: Translate }): React.ReactElement | null {
  // A draft cannot merge, and the state badge already covers merged/closed.
  if (pull.state !== 'open' || pull.draft || pull.mergeable === null) return null
  const view = pull.mergeable
    ? { className: cls('dsh-gitlog-pull-merge-state is-mergeable'), text: t('pullMergeable') }
    : { className: cls('dsh-gitlog-pull-merge-state is-conflict'), text: t('pullMergeConflicts') }
  return <span className={view.className}>{view.text}</span>
}

type PullSectionKey = 'description' | 'ai' | 'files' | 'commits' | 'discussion'

const OPEN_SECTIONS: Record<PullSectionKey, boolean> = {
  description: true,
  ai: true,
  files: true,
  commits: true,
  discussion: true,
}

interface PullSectionProps {
  title: string
  meta?: string
  open: boolean
  onToggle(): void
  actions?: React.ReactNode
  children: React.ReactNode
}

/** A collapsible PR detail module with an optional action row. */
function PullSection({ title, meta, open, onToggle, actions, children }: PullSectionProps): React.ReactElement {
  return (
    <section className={cls('dsh-gitlog-pull-section')}>
      <div className={cls('dsh-gitlog-pull-section-head')}>
        <h3>
          <button
            type="button"
            className={cls('dsh-gitlog-pull-section-toggle')}
            aria-expanded={open}
            onClick={onToggle}
          >
            <span className={cls(`dsh-gitlog-pull-chevron${open ? ' is-open' : ''}`)} aria-hidden={true} />
            <span className={cls('dsh-gitlog-pull-section-title')}>{title}</span>
            {meta === undefined ? null : <span className={cls('dsh-gitlog-pull-section-meta')}>{meta}</span>}
          </button>
        </h3>
        {actions === undefined ? null : <div className={cls('dsh-gitlog-pull-section-actions')}>{actions}</div>}
      </div>
      {open ? <div className={cls('dsh-gitlog-pull-section-body')}>{children}</div> : null}
    </section>
  )
}

function PullDetail({ view, t }: { view: PullsView; t: Translate }): React.ReactElement {
  const [fileIndex, setFileIndex] = useState(0)
  const [stateDialog, setStateDialog] = useState<PullStateAction | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [aiDialogOpen, setAiDialogOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [openSections, setOpenSections] = useState<Record<PullSectionKey, boolean>>(OPEN_SECTIONS)
  const diffMode = useDiffMode()
  const pull = view.detail
  const locale = t('localeId')

  useEffect(() => {
    setFileIndex(0)
    setStateDialog(null)
    setMergeOpen(false)
    setAiDialogOpen(false)
    setDeleteOpen(false)
    setOpenSections(OPEN_SECTIONS)
  }, [pull?.number, pull?.webUrl])

  useEffect(() => {
    if (view.aiReviewStatus !== 'loading') return
    setOpenSections(current => current.ai ? current : { ...current, ai: true })
  }, [view.aiReviewStatus])

  const toggleSection = (key: PullSectionKey): void => {
    setOpenSections(current => ({ ...current, [key]: !current[key] }))
  }

  if (view.detailStatus === 'loading') return <LoadingLine label={t('pullLoading')} />
  if (view.detailStatus === 'error') {
    return (
      <div className={cls('dsh-gitlog-pulls-error')} role="alert">
        <p>{t('pullDetailFailed')}</p>
        <p className={cls('dsh-gitlog-error-code')}>{view.detailError?.message ?? ''}</p>
        {view.selected === null ? null : (
          <Button variant="ghost" onClick={() => view.selectPull(view.selected ?? 0)}>{t('tryAgain')}</Button>
        )}
      </div>
    )
  }
  if (pull === null) return <p className={cls('dsh-gitlog-pulls-hint')}>{t('pullSelectHint')}</p>

  const file = pull.files[fileIndex]
  const comments = pull.comments ?? []
  const checks = pull.checks ?? null
  const forge = view.remotes.find(item => item.name === view.remote)?.forge ?? null
  const baseRepo = forge === null ? '' : `${forge.owner}/${forge.repo}`
  const headRepo = repositoryFromUrl(pull.headRepoUrl) || baseRepo
  const crossRepo = baseRepo !== '' && headRepo !== '' && headRepo !== baseRepo
  const repoLabel = crossRepo ? `${headRepo} → ${baseRepo}` : baseRepo
  const webUrl = /^https?:\/\//i.test(pull.webUrl) ? pull.webUrl : ''
  const counts: string[] = []
  if (pull.additions !== null) counts.push(`+${pull.additions}`)
  if (pull.deletions !== null) counts.push(`−${pull.deletions}`)

  return (
    <div className={cls('dsh-gitlog-pull-content')}>
      <header className={cls('dsh-gitlog-pull-head')}>
        <div className={cls('dsh-gitlog-pull-headline')}>
          <h2>
            <span className={cls('dsh-gitlog-pull-number')}>{`#${pull.number}`}</span>
            {pull.title}
          </h2>
          <PullBadge pull={pull} t={t} />
        </div>
        <p className={cls('dsh-gitlog-pull-head-meta')}>
          <span>{pull.author === '' ? '—' : pull.author}</span>
          {repoLabel === ''
            ? null
            : (
                <span className={cls('dsh-gitlog-pull-repo')} title={repoLabel}>
                  {`${t('project')}: ${repoLabel}`}
                </span>
              )}
          <span>{`${pull.sourceBranch} → ${pull.targetBranch}`}</span>
          <span>{`${t('pullUpdated')} ${formatDateTime(pull.updatedAt, locale)}`}</span>
          {counts.length === 0 ? null : <span className={cls('dsh-gitlog-pull-counts')}>{counts.join(' ')}</span>}
          <PullChecksBadge checks={checks} t={t} />
          <PullReviewBadge review={pull.review ?? null} t={t} />
          {pull.approval === undefined || pull.approval === null
            ? null
            : <PullApprovalBadges approval={pull.approval} t={t} />}
          <PullMergeState pull={pull} t={t} />
        </p>
        <div className={cls('dsh-gitlog-pull-actions')}>
          {webUrl === ''
            ? null
            : (
                <a
                  className={cls('dsh-gitlog-btn')}
                  href={webUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t('pullOpenBrowser')}
                </a>
              )}
          <Button
            variant="primary"
            loading={view.checkingOut === pull.number}
            onClick={() => { void view.checkout(pull.number) }}
          >
            {view.checkingOut === pull.number ? t('pullCheckingOut') : t('pullCheckout')}
          </Button>
          <Button
            disabled={view.aiReviewStatus === 'loading'}
            onClick={() => setAiDialogOpen(true)}
          >
            {view.aiReviewStatus === 'loading' ? t('pullAiReviewing') : t('pullAiReview')}
          </Button>
          {pull.state === 'open'
            ? <Button onClick={() => setMergeOpen(true)}>{t('pullMerge')}</Button>
            : null}
          {pull.state === 'open'
            ? <Button variant="danger" onClick={() => setStateDialog('close')}>{t('pullClose')}</Button>
            : pull.state === 'closed'
              ? <Button onClick={() => setStateDialog('reopen')}>{t('pullReopen')}</Button>
              : null}
          {forge?.provider === 'gitlab' && pull.state !== 'merged'
            ? <Button variant="danger" onClick={() => setDeleteOpen(true)}>{t('pullDelete')}</Button>
            : null}
        </div>
      </header>

      <PullSection
        title={t('pullDescription')}
        open={openSections.description}
        onToggle={() => toggleSection('description')}
      >
        {pull.body.trim() === ''
          ? <p className={cls('dsh-gitlog-pulls-hint')}>{t('pullNoBody')}</p>
          : <Markdown text={pull.body} className={cls('dsh-gitlog-pull-description')} />}
      </PullSection>

      {view.aiReviewStatus === 'idle' && view.aiReview === ''
        ? null
        : (
            <PullSection
              title={t('pullAiReviewTitle')}
              open={openSections.ai}
              onToggle={() => toggleSection('ai')}
              actions={(
                <div className={cls('dsh-gitlog-pull-ai-actions')}>
                  {view.aiReviewStatus === 'ready'
                    ? (
                        <Button variant="ghost" onClick={() => setAiDialogOpen(true)}>
                          {t('pullAiReviewRegenerate')}
                        </Button>
                      )
                    : null}
                  <Button variant="ghost" onClick={view.clearAiReview}>
                    {view.aiReviewStatus === 'loading' ? t('pullAiReviewStop') : t('pullAiReviewClear')}
                  </Button>
                </div>
              )}
            >
              {view.aiReviewStatus === 'loading'
                ? (
                    <div className={cls('dsh-gitlog-pull-ai-progress')}>
                      <LoadingLine label={t('pullAiReviewing')} />
                      <p className={cls('dsh-gitlog-field-hint')}>
                        {t('pullAiReviewProgress')
                          .replace('{attempt}', String(view.aiReviewAttempt))
                          .replace('{reasoning}', String(view.aiReviewReasoning.length))
                          .replace('{output}', String(view.aiReview.length))}
                      </p>
                      {view.aiReviewReasoning === ''
                        ? null
                        : (
                            <details className={cls('dsh-gitlog-pull-ai-thinking')} open>
                              <summary>{t('pullAiReviewThinking')}</summary>
                              <pre>{view.aiReviewReasoning}</pre>
                            </details>
                          )}
                      {view.aiReview === ''
                        ? null
                        : <pre className={cls('dsh-gitlog-pull-ai-preview')}>{view.aiReview}</pre>}
                    </div>
                  )
                : view.aiReviewStatus === 'error'
                  ? (
                      <div className={cls('dsh-gitlog-pulls-error')} role="alert">
                        <p>{t('pullAiReviewFailed')}</p>
                        <p className={cls('dsh-gitlog-error-code')}>{view.aiReviewError ?? ''}</p>
                        <Button variant="ghost" onClick={() => setAiDialogOpen(true)}>{t('tryAgain')}</Button>
                      </div>
                    )
                  : (
                      <div className={cls('dsh-gitlog-pull-ai-result')}>
                        {view.aiReviewReasoning === ''
                          ? null
                          : (
                              <details className={cls('dsh-gitlog-pull-ai-thinking')}>
                                <summary>{t('pullAiReviewThinking')}</summary>
                                <pre>{view.aiReviewReasoning}</pre>
                              </details>
                            )}
                        <Markdown text={view.aiReview} className={cls('dsh-gitlog-pull-ai-review')} />
                      </div>
                    )}
            </PullSection>
          )}

      <PullSection
        title={t('pullFiles')}
        meta={`(${pull.changedFiles ?? pull.files.length})`}
        open={openSections.files}
        onToggle={() => toggleSection('files')}
      >
        {pull.files.length === 0
          ? <p className={cls('dsh-gitlog-note')}>{t('pullNoFiles')}</p>
          : (
              <div className={cls('dsh-gitlog-pull-files-wrap')}>
                <div className={cls('dsh-gitlog-pull-files')}>
                  {pull.files.map((item, index) => (
                    <button
                      key={`${item.path}:${String(index)}`}
                      type="button"
                      className={cls(`dsh-gitlog-pull-file${index === fileIndex ? ' is-selected' : ''}`)}
                      onClick={() => setFileIndex(index)}
                    >
                      <span
                        className={cls(`dsh-gitlog-pull-file-status is-${item.status}`)}
                        {...tooltipProps(statusLabel(item.status, t))}
                      >
                        {statusLetter(item.status)}
                      </span>
                      <span className={cls('dsh-gitlog-pull-file-path')}>{item.path}</span>
                      {item.additions === null ? null : <span className={cls('dsh-gitlog-pull-file-add')}>{`+${item.additions}`}</span>}
                      {item.deletions === null ? null : <span className={cls('dsh-gitlog-pull-file-del')}>{`−${item.deletions}`}</span>}
                    </button>
                  ))}
                </div>
                {file === undefined
                  ? null
                  : file.binary || file.patch === ''
                    ? <p className={cls('dsh-gitlog-note')}>{t('pullBinary')}</p>
                    : (
                        <div className={cls('dsh-gitlog-pulls-patch')}>
                          <div className={cls('dsh-gitlog-pull-patch-head')}>
                            <code className={cls('dsh-gitlog-patch-file')} {...tooltipProps(file.path)}>{file.path}</code>
                            <button
                              type="button"
                              className={cls('dsh-gitlog-diff-mode')}
                              aria-label={diffMode.mode === 'split' ? t('diffUnified') : t('diffSplit')}
                              {...tooltipProps(diffMode.mode === 'split' ? t('diffUnified') : t('diffSplit'))}
                              onClick={diffMode.toggle}
                            >
                              {diffMode.mode === 'split' ? <UnifiedDiffIcon /> : <SplitDiffIcon />}
                            </button>
                          </div>
                          <DiffView
                            key={`${pull.number}:${file.path}`}
                            patch={patchText(file)}
                            path={file.path}
                            t={t}
                            empty={t('pullBinary')}
                            mode={diffMode.mode}
                          />
                        </div>
                      )}
                {pull.filesTruncated ? <p className={cls('dsh-gitlog-note')}>{t('pullFilesTruncated')}</p> : null}
              </div>
            )}
      </PullSection>

      <PullSection
        title={t('pullCommits')}
        meta={`(${pull.commits.length})`}
        open={openSections.commits}
        onToggle={() => toggleSection('commits')}
      >
        {pull.commits.length === 0
          ? null
          : (
              <div className={cls('dsh-gitlog-pull-commits')}>
                {pull.commits.map(commit => (
                  <div key={commit.hash} className={cls('dsh-gitlog-pull-commit')}>
                    <code>{commit.shortHash}</code>
                    <span className={cls('dsh-gitlog-pull-commit-subject')}>{commit.subject}</span>
                    <span className={cls('dsh-gitlog-pull-commit-meta')}>{commit.author}</span>
                    <span className={cls('dsh-gitlog-pull-commit-meta')}>{formatDateTime(commit.date, locale)}</span>
                  </div>
                ))}
              </div>
            )}
      </PullSection>

      <PullSection
        title={t('pullComments')}
        meta={`(${comments.length})`}
        open={openSections.discussion}
        onToggle={() => toggleSection('discussion')}
      >
        {comments.length === 0
          ? <p className={cls('dsh-gitlog-pulls-hint')}>{t('pullNoComments')}</p>
          : (
              <div className={cls('dsh-gitlog-pull-comments')}>
                {comments.map(comment => (
                  <article key={comment.id} className={cls('dsh-gitlog-pull-comment')}>
                    <header>
                      <span>{comment.author === '' ? '—' : comment.author}</span>
                      <span>{formatDateTime(comment.createdAt, locale)}</span>
                    </header>
                    <Markdown text={comment.body} />
                  </article>
                ))}
              </div>
            )}
      </PullSection>

      {mergeOpen
        ? <MergePullDialog view={view} pull={pull} t={t} onClose={() => setMergeOpen(false)} />
        : null}

      {aiDialogOpen
        ? <AiReviewDialog view={view} t={t} onClose={() => setAiDialogOpen(false)} />
        : null}

      {deleteOpen
        ? <DeletePullDialog view={view} number={pull.number} t={t} onClose={() => setDeleteOpen(false)} />
        : null}

      {stateDialog === null
        ? null
        : (
            <PullStateDialog
              view={view}
              number={pull.number}
              action={stateDialog}
              t={t}
              onClose={() => setStateDialog(null)}
            />
          )}
    </div>
  )
}

/** The PR view: a remote and state filter, the request list, and the detail. */
export function PullsPane({ view, t, narrow, repoKey }: PullsPaneProps): React.ReactElement {
  const forge = view.remotes.find(item => item.name === view.remote)?.forge ?? null
  const currentPull = view.pulls.find(pull => pull.state === 'open' && (
    pull.sourceBranch === view.headBranch || pull.sourceBranch.endsWith(`:${view.headBranch}`)
  ))
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  // A different repository, remote, or filter starts with a clear search.
  useEffect(() => {
    setQuery('')
    setCreateOpen(false)
  }, [repoKey, view.remote, view.state])

  const listWidth = useSplitSize({
    initial: () => Math.min(720, Math.max(220, readRepoUiState(repoKey).pullsListWidth ?? 320)),
    min: 220,
    max: () => {
      const width = bodyRef.current?.getBoundingClientRect().width ?? 0
      return width <= 0 ? 720 : Math.max(240, Math.min(720, width - 300))
    },
    axis: 'x',
    persist: value => writeRepoUiState({ pullsListWidth: value }, repoKey),
  })
  const listHeight = useSplitSize({
    initial: () => Math.min(520, Math.max(140, readRepoUiState(repoKey).pullsListHeight ?? 220)),
    min: 140,
    max: () => {
      const height = bodyRef.current?.getBoundingClientRect().height ?? 0
      return height <= 0 ? 520 : Math.max(160, Math.min(520, height - 220))
    },
    axis: 'y',
    persist: value => writeRepoUiState({ pullsListHeight: value }, repoKey),
  })
  const listSize = narrow ? listHeight : listWidth
  const bodyStyle = {
    '--gitlog-pulls-w': `${listWidth.size}px`,
    '--gitlog-pulls-h': `${listHeight.size}px`,
  } as unknown as React.CSSProperties

  const needle = query.trim().toLowerCase()
  const visiblePulls = needle === ''
    ? view.pulls
    : view.pulls.filter(pull => `${pull.number} ${pull.title} ${pull.author} ${pull.sourceBranch} ${pull.targetBranch}`
      .toLowerCase()
      .includes(needle))

  const total = visiblePulls.length

  return (
    <div className={cls('dsh-gitlog-pulls')}>
      <div className={cls('dsh-gitlog-pulls-toolbar')}>
        {view.remotes.length > 1
          ? (
              <Dropdown
                className={cls('dsh-gitlog-pulls-remote')}
                value={view.remote}
                options={view.remotes.map(item => ({ value: item.name, label: item.name, title: item.name }))}
                onChange={view.selectRemote}
                ariaLabel={t('pullRemote')}
              />
            )
          : null}
        <Switch
          value={view.state}
          ariaLabel={t('pullFilter')}
          options={[
            { value: 'open' as const, label: t('pullOpen') },
            { value: 'closed' as const, label: t('pullClosedFilter') },
            { value: 'all' as const, label: t('pullAll') },
          ]}
          onChange={view.setState}
        />
        <input
          type="search"
          className={cls('dsh-gitlog-pulls-search')}
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={t('pullSearch')}
          aria-label={t('pullSearch')}
          spellCheck={false}
          autoComplete="off"
        />
        <div className={cls('dsh-gitlog-pulls-end')}>
          {forge === null
            ? null
            : (
                <span
                  className={cls('dsh-gitlog-pulls-forge')}
                  title={`${t('project')}: ${forge.owner}/${forge.repo}`}
                  aria-label={`${t('project')}: ${forge.owner}/${forge.repo}`}
                >
                  <span className={cls('dsh-gitlog-pulls-provider')}>{forgeLabel(forge.provider)}</span>
                  <span className={cls('dsh-gitlog-pulls-repo')}>{`${forge.owner}/${forge.repo}`}</span>
                </span>
              )}
          <Button onClick={() => setCreateOpen(true)}>{t('pullCreate')}</Button>
          {currentPull === undefined
            ? null
            : (
                <Button
                  variant="ghost"
                  title={t('pullCurrentBranch')}
                  onClick={() => view.selectPull(currentPull.number)}
                >
                  {`#${currentPull.number}`}
                </Button>
              )}
          <Button
            variant="ghost"
            iconOnly
            title={t('refresh')}
            disabled={view.status === 'loading'}
            onClick={view.refresh}
            icon={<RefreshIcon size={16} />}
          />
        </div>
      </div>

      <div
        ref={bodyRef}
        className={cls(`dsh-gitlog-pulls-body${narrow ? ' is-narrow' : ''}`)}
        style={bodyStyle}
      >
        <VirtualList
          className={cls('dsh-gitlog-pulls-list')}
          role="listbox"
          ariaLabel={t('pulls')}
          items={visiblePulls}
          rowHeight={PULL_ROW_HEIGHT}
          resetKey={`${repoKey}\u0000${view.remote}\u0000${view.state}\u0000${query}`}
          onReachEnd={query.trim() === '' ? view.loadMore : undefined}
          empty={
            view.status === 'loading' && view.pulls.length === 0
              ? <LoadingLine label={t('pullLoading')} />
              : view.status === 'error'
                ? (
                    <div className={cls('dsh-gitlog-pulls-error')} role="alert">
                      <p>{t('pullFailed')}</p>
                      <p className={cls('dsh-gitlog-error-code')}>{view.error?.message ?? ''}</p>
                      {view.error?.code === 'forge-rate-limited' || view.error?.code === 'forge-not-found'
                        ? <p className={cls('dsh-gitlog-note')}>{t('pullAuthHint')}</p>
                        : null}
                      <Button variant="ghost" onClick={view.refresh}>{t('tryAgain')}</Button>
                    </div>
                  )
                : (
                    <p className={cls('dsh-gitlog-pulls-empty')}>
                      {needle === ''
                        ? t(view.state === 'all' ? 'pullEmptyAll' : view.state === 'closed' ? 'pullEmptyClosed' : 'pullEmpty')
                        : t('pullNoMatches')}
                    </p>
                  )
          }
          footer={view.hasMore && view.status === 'ready'
            ? (
                <div className={cls('dsh-gitlog-pulls-more')}>
                  {view.loadingMore
                    ? (
                        <span className={cls('dsh-gitlog-pulls-more-label')}>
                          <Spinner size={14} />
                          {t('pullLoadingMore')}
                        </span>
                      )
                    : <Button variant="ghost" onClick={view.loadMore}>{t('pullLoadMore')}</Button>}
                </div>
              )
            : null}
          renderRow={(pull, index) => (
            <button
              key={pull.number}
              type="button"
              role="option"
              aria-selected={view.selected === pull.number}
              aria-posinset={index + 1}
              aria-setsize={total}
              className={cls(`dsh-gitlog-pull${view.selected === pull.number ? ' is-selected' : ''}`)}
              onClick={() => view.selectPull(pull.number)}
            >
              <span className={cls('dsh-gitlog-pull-line')}>
                <span className={cls('dsh-gitlog-pull-number')}>{`#${pull.number}`}</span>
                <span className={cls('dsh-gitlog-pull-title')}>{pull.title}</span>
                <PullBadge pull={pull} t={t} />
              </span>
              <span className={cls('dsh-gitlog-pull-meta')}>
                <span>{pull.author === '' ? '—' : pull.author}</span>
                <span>{`${pull.sourceBranch} → ${pull.targetBranch}`}</span>
                <span>{`${t('pullUpdated')} ${formatDateTime(pull.updatedAt, t('localeId'))}`}</span>
              </span>
            </button>
          )}
        />
        <Splitter
          orientation={narrow ? 'horizontal' : 'vertical'}
          label={t('resizePullList')}
          onStart={listSize.start}
          onDrag={listSize.drag}
          onReset={listSize.reset}
        />
        <div className={cls('dsh-gitlog-pulls-detail')}>
          <PullDetail view={view} t={t} />
        </div>
      </div>

      {createOpen
        ? <CreatePullDialog view={view} t={t} onClose={() => setCreateOpen(false)} />
        : null}

      {view.authPrompt === null
        ? null
        : (
            <ForgeAuthDialog
              prompt={view.authPrompt}
              busy={view.authBusy}
              error={view.authError}
              t={t}
              onSubmit={(username, token) => { void view.submitToken(username, token) }}
              onClose={view.dismissAuth}
            />
          )}
    </div>
  )
}
