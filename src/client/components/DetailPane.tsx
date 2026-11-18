import type * as React from 'react'
import { h, useEffect, useMemo, useRef, useState } from '../runtime.js'
import { requestCommitMedia, type ApiError } from '../lib/api.js'
import { formatDateTime } from '../lib/format.js'
import { splitPatch } from '../lib/patch.js'
import type { CommitDetail, DetailStatus, Translate, WorkspaceDiffMedia } from '../types.js'
import { useDiffMode } from '../lib/use-diff-mode.js'
import { useSplitSize } from '../lib/use-split-size.js'
import { tooltipProps } from './Tooltip.js'
import { Refs } from './Refs.js'
import { DiffView } from './DiffView.js'
import { MediaDiff } from './MediaDiff.js'
import { FileHistoryDialog } from './FileHistoryDialog.js'
import { mediaKindOf } from '../lib/media.js'
import { LfsDiff } from './LfsDiff.js'
import { Spinner } from './States.js'
import { ExpandIcon, SplitDiffIcon, UnifiedDiffIcon } from './GitLogIcon.js'
import { DiffDialog } from './DiffDialog.js'
import { Splitter } from './Splitter.js'
import { cls } from '../styles.js'

/** Path from a patch section's `+++ b/…` line, which also resolves renames. */
function mediaPathOf(section: string | undefined, fallback: string): string {
  if (section === undefined) return fallback
  for (const line of section.split('\n')) {
    if (!line.startsWith('+++ ')) continue
    let value = line.slice(4)
    if (value === '/dev/null') return ''
    if (value.startsWith('b/')) value = value.slice(2)
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    return value
  }
  return fallback
}

export interface DetailPaneProps {
  detail: CommitDetail | null
  status: DetailStatus
  error: ApiError | null
  t: Translate
  /** Repository root, needed to load the media of an image/audio file. */
  repoRoot: string
  /** Tooltip text for one ref chip; null leaves it silent. */
  refTooltipOf?(ref: string): string | null
}

const DEFAULT_INFO_RATIO = 0.4
const MIN_INFO_PX = 240

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * The pane under the log: commit metadata and changed files on the left, the
 * patch on the right. The sidebar layout stacks the two columns instead.
 */
export function DetailPane({ detail, status, error, t, repoRoot, refTooltipOf }: DetailPaneProps): React.ReactElement {
  const [fileChoice, setFileChoice] = useState<{ hash: string | null; index: number }>({ hash: null, index: 0 })
  /** The selected file's patch shown in its own modal window. */
  const [diffDialogOpen, setDiffDialogOpen] = useState(false)
  const diffMode = useDiffMode()
  const sections = useMemo(() => splitPatch(detail?.patch ?? ''), [detail?.patch])
  const innerRef = useRef<HTMLDivElement | null>(null)
  const infoRef = useRef<HTMLDivElement | null>(null)
  const summaryRef = useRef<HTMLDivElement | null>(null)

  const width = (): number => innerRef.current?.getBoundingClientRect().width ?? 0
  const infoMin = (): number => {
    const measured = width()
    return measured <= 0 ? 0.24 : clamp(MIN_INFO_PX / measured, 0.24, 0.5)
  }
  const info = useSplitSize({
    initial: DEFAULT_INFO_RATIO,
    axis: 'x',
    min: infoMin,
    max: () => {
      const measured = width()
      const low = infoMin()
      return measured <= 0 ? 0.78 : Math.min(0.78, Math.max(low + 0.1, 1 - MIN_INFO_PX / measured))
    },
    reference: width,
  })
  const summary = useSplitSize({
    initial: 160,
    axis: 'y',
    min: 80,
    measure: () => summaryRef.current?.getBoundingClientRect().height ?? 0,
    max: () => {
      const current = summaryRef.current?.getBoundingClientRect().height ?? 80
      return Math.max(current, (infoRef.current?.clientHeight ?? 0) - 200)
    },
  })

  // Media of the selected file: an image or audio change has no text patch to show.
  const mediaSelected = detail !== null && fileChoice.hash === detail.hash ? fileChoice.index : 0
  const mediaSection = sections[mediaSelected]
  const mediaFile = detail?.files[mediaSelected]
  const mediaPath = mediaPathOf(mediaSection, mediaFile?.path ?? '')
  const mediaKind = mediaPath === '' ? null : mediaKindOf(mediaPath)
  const [media, setMedia] = useState<WorkspaceDiffMedia | null>(null)
  /** Right-click menu on one changed-file row. */
  const [fileMenu, setFileMenu] = useState<{ file: string; x: number; y: number } | null>(null)
  const fileMenuRef = useRef<HTMLDivElement | null>(null)
  /** Path whose change-history window is open. */
  const [historyFile, setHistoryFile] = useState<string | null>(null)

  useEffect(() => {
    setMedia(null)
    if (mediaKind === null || detail === null || repoRoot === '') return
    const controller = new AbortController()
    void requestCommitMedia({ path: repoRoot, hash: detail.hash, file: mediaPath }, controller.signal)
      .then(payload => {
        if (!controller.signal.aborted) setMedia(payload.media)
      })
      .catch(() => {
        // Keep the text or LFS fallback when the media cannot be read.
      })
    return () => controller.abort()
  }, [detail, repoRoot, mediaPath, mediaKind])

  // Close the file menu on any press outside it.
  useEffect(() => {
    if (fileMenu === null) return
    const onPress = (event: MouseEvent): void => {
      if (fileMenuRef.current !== null && !fileMenuRef.current.contains(event.target as Node)) {
        setFileMenu(null)
      }
    }
    document.addEventListener('mousedown', onPress)
    return () => document.removeEventListener('mousedown', onPress)
  }, [fileMenu])

  if (status === 'idle') {
    return (
      <div className={cls('dsh-gitlog-state')}>
        <h2>{t('selectCommit')}</h2>
        <p>{t('selectCommitHint')}</p>
      </div>
    )
  }
  if (status === 'loading') {
    return (
      <div className={cls('dsh-gitlog-state')}>
        <Spinner />
        <p>{t('loadingCommit')}</p>
      </div>
    )
  }
  if (status === 'error' || detail === null) {
    return (
      <div className={cls('dsh-gitlog-state')}>
        <h2>{t('errorTitle')}</h2>
        <p>{error?.message || t('unknownError')}</p>
      </div>
    )
  }

  // The first changed file is selected for every commit. Storing the hash with
  // the choice makes a new commit fall back to the first file without an effect.
  const selectedFile = fileChoice.hash === detail.hash ? fileChoice.index : 0
  const activeFile = detail.files[selectedFile]
  const activeSection = sections[selectedFile]
  /** Set when the selected file is stored in Git LFS: the patch is only its pointer. */
  const activeLfs = activeFile?.lfs

  const innerStyle: React.CSSProperties = {
    gridTemplateColumns: `${info.size * 100}% 6px minmax(0, 1fr)`,
  }

  const summaryStyle: React.CSSProperties | undefined = summary.touched
    ? { flexBasis: `${summary.size}px`, flexGrow: 0 }
    : undefined

  return (
    <div key={detail.hash} ref={innerRef} className={cls('dsh-gitlog-detail-inner')} style={innerStyle}>
      <div ref={infoRef} className={cls('dsh-gitlog-detail-info')}>
        <div ref={summaryRef} className={cls('dsh-gitlog-detail-summary')} style={summaryStyle}>
          <dl className={cls('dsh-gitlog-meta-grid')}>
            <dt>{t('author')}</dt>
            <dd>{`${detail.author} <${detail.email}>`}</dd>
            <dt>{t('date')}</dt>
            <dd>{formatDateTime(detail.date, t('localeId'))}</dd>
            <dt>{t('commit')}</dt>
            <dd className={cls('dsh-gitlog-detail-commit')}>
              <code className={cls('dsh-gitlog-hash')}>{detail.shortHash}</code>
              {detail.parents.length > 1
                ? <span className={cls('dsh-gitlog-merge')}>{t('merge')}</span>
                : null}
            </dd>
            <dt>{t('parents')}</dt>
            <dd>{detail.parents.length === 0 ? t('rootCommit') : detail.parents.map(parent => parent.slice(0, 12)).join(', ')}</dd>
            <dt>{t('commitRefs')}</dt>
            <dd><Refs refs={detail.refs} tooltipOf={refTooltipOf} /></dd>
            <dt>{t('commitMessage')}</dt>
            <dd className={cls('dsh-gitlog-detail-message')}>
              <div className={cls('dsh-gitlog-detail-subject')}>{detail.subject || t('noSubject')}</div>
              {detail.body === '' ? null : <pre className={cls('dsh-gitlog-detail-body')}>{detail.body}</pre>}
            </dd>
          </dl>
        </div>
        <Splitter
          orientation="horizontal"
          className={cls('dsh-gitlog-detail-summary-split')}
          label={t('resizeSummary')}
          onStart={summary.start}
          onDrag={summary.drag}
        />
        <div className={cls('dsh-gitlog-detail-files')}>
          <h3>{`${t('changedFiles')}(${detail.files.length})`}</h3>
          {detail.files.length === 0
            ? <p className={cls('dsh-gitlog-note')}>{t('noPatch')}</p>
            : (
                <ul className={cls('dsh-gitlog-files')}>
                  {detail.files.map((file, index) => (
                    <li key={file.path}>
                      <button
                        type="button"
                        className={cls(`dsh-gitlog-file${index === selectedFile ? ' is-selected' : ''}`)}
                        aria-pressed={index === selectedFile}
                        {...tooltipProps(file.path)}
                        onClick={() => setFileChoice({ hash: detail.hash, index })}
                        onContextMenu={event => {
                          event.preventDefault()
                          event.stopPropagation()
                          setFileMenu({ file: file.path, x: event.clientX, y: event.clientY })
                        }}
                      >
                        <span className={cls('dsh-gitlog-file-path')}>{file.path}</span>
                        {file.lfs !== undefined
                          ? <span className={cls('dsh-gitlog-lfs')}>{t('lfsBadge')}</span>
                          : file.binary
                            ? <span className={cls('dsh-gitlog-binary')}>{t('binary')}</span>
                            : <span className={cls('dsh-gitlog-add')}>{`+${file.additions ?? 0}`}</span>}
                        {file.lfs !== undefined || file.binary ? <span /> : <span className={cls('dsh-gitlog-del')}>{`-${file.deletions ?? 0}`}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
        </div>
      </div>
      <Splitter
        orientation="vertical"
        label={t('resizePatch')}
        onStart={info.start}
        onDrag={info.drag}
      />
      <div className={cls('dsh-gitlog-detail-patch')}>
        <div className={cls('dsh-gitlog-detail-patch-head')}>
          <h3>{t('patch')}</h3>
          {activeFile !== undefined
            ? <code className={cls('dsh-gitlog-patch-file')} {...tooltipProps(activeFile.path)}>{activeFile.path}</code>
            : null}
          <span className={cls('dsh-gitlog-diff-actions')}>
            {activeSection === undefined || activeLfs !== undefined || media !== null
              ? null
              : (
                  <button
                    type="button"
                    className={cls('dsh-gitlog-diff-mode')}
                    aria-label={t('diffDialogOpen')}
                    {...tooltipProps(t('diffDialogOpen'))}
                    onClick={() => setDiffDialogOpen(true)}
                  >
                    <ExpandIcon />
                  </button>
                )}
            <button
              type="button"
              className={cls('dsh-gitlog-diff-mode')}
              aria-label={diffMode.mode === 'split' ? t('diffUnified') : t('diffSplit')}
              {...tooltipProps(diffMode.mode === 'split' ? t('diffUnified') : t('diffSplit'))}
              onClick={diffMode.toggle}
            >
              {diffMode.mode === 'split' ? <UnifiedDiffIcon /> : <SplitDiffIcon />}
            </button>
          </span>
        </div>
        {detail.files.length === 0
          ? <p className={cls('dsh-gitlog-note')}>{t('noPatch')}</p>
          : media !== null
            ? <MediaDiff media={media} path={mediaPath} t={t} />
            : activeLfs !== undefined
            ? <LfsDiff lfs={activeLfs} path={activeFile?.path} t={t} />
            : activeSection !== undefined
              ? (
                  <DiffView
                    key={`${detail.hash}:${selectedFile}`}
                    patch={activeSection}
                    t={t}
                    path={detail.files[selectedFile]?.path}
                    empty={t('fileNoPatch')}
                    mode={diffMode.mode}
                  />
                )
              : <p className={cls('dsh-gitlog-note')}>{detail.patchTruncated ? t('patchTruncated') : t('fileNoPatch')}</p>}
        {detail.patchTruncated && activeSection !== undefined
          ? <p className={cls('dsh-gitlog-note')}>{t('patchTruncated')}</p>
          : null}
      </div>
      {diffDialogOpen && activeSection !== undefined && activeLfs === undefined && media === null
        ? (
            <DiffDialog
              path={detail.files[selectedFile]?.path ?? ''}
              patch={activeSection}
              t={t}
              mode={diffMode.mode}
              onToggleMode={diffMode.toggle}
              onClose={() => setDiffDialogOpen(false)}
            />
          )
        : null}
      {fileMenu === null
        ? null
        : (
            <div
              ref={fileMenuRef}
              className={cls('dsh-gitlog-commit-menu dsh-gitlog-file-menu')}
              style={{
                left: Math.min(fileMenu.x, window.innerWidth - 220),
                top: Math.min(fileMenu.y, window.innerHeight - 100),
              }}
              role="menu"
              aria-label={t('fileHistoryOpen')}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setHistoryFile(fileMenu.file)
                  setFileMenu(null)
                }}
              >
                {t('fileHistoryOpen')}
              </button>
            </div>
          )}
      {historyFile === null
        ? null
        : <FileHistoryDialog repoRoot={repoRoot} file={historyFile} t={t} onClose={() => setHistoryFile(null)} />}
    </div>
  )
}









