import type * as React from 'react'
import { h, useMemo, useRef, useState } from '../runtime.js'
import type { ApiError } from '../lib/api.js'
import { formatDateTime } from '../lib/format.js'
import { splitPatch } from '../lib/patch.js'
import type { CommitDetail, DetailStatus, Translate } from '../types.js'
import { useDiffMode } from '../lib/use-diff-mode.js'
import { useSplitSize } from '../lib/use-split-size.js'
import { tooltipProps } from './Tooltip.js'
import { Refs } from './Refs.js'
import { DiffView } from './DiffView.js'
import { Spinner } from './States.js'
import { SplitDiffIcon, UnifiedDiffIcon } from './GitLogIcon.js'
import { Splitter } from './Splitter.js'
import { cls } from '../styles.js'

export interface DetailPaneProps {
  detail: CommitDetail | null
  status: DetailStatus
  error: ApiError | null
  t: Translate
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
export function DetailPane({ detail, status, error, t }: DetailPaneProps): React.ReactElement {
  const [fileChoice, setFileChoice] = useState<{ hash: string | null; index: number }>({ hash: null, index: 0 })
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
            <dd><Refs refs={detail.refs} /></dd>
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
                      >
                        <span className={cls('dsh-gitlog-file-path')}>{file.path}</span>
                        {file.binary
                          ? <span className={cls('dsh-gitlog-binary')}>{t('binary')}</span>
                          : <span className={cls('dsh-gitlog-add')}>{`+${file.additions ?? 0}`}</span>}
                        {file.binary ? <span /> : <span className={cls('dsh-gitlog-del')}>{`-${file.deletions ?? 0}`}</span>}
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
        {detail.files.length === 0
          ? <p className={cls('dsh-gitlog-note')}>{t('noPatch')}</p>
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
    </div>
  )
}









