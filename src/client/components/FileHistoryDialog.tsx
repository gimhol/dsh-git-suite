/**
 * Change history of one working-tree file: the commits that touched it on the
 * left, the selected commit's diff for that file on the right.
 */
import type * as React from 'react'
import { h, useEffect, useState } from '../runtime.js'
import {
  requestFileCommitDiff,
  requestFileLog,
  toApiError,
} from '../lib/api.js'
import { formatDateTime } from '../lib/format.js'
import { useDiffMode } from '../lib/use-diff-mode.js'
import type { FileCommitDiffPayload, FileHistoryCommit, Translate } from '../types.js'
import { Button } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { DiffView } from './DiffView.js'
import { LfsDiff } from './LfsDiff.js'
import { LoadingLine } from './States.js'
import { HistoryListIcon, SplitDiffIcon, UnifiedDiffIcon } from './GitLogIcon.js'
import { tooltipProps } from './Tooltip.js'
import { cls } from '../styles.js'

export interface FileHistoryDialogProps {
  /** Repository root the file belongs to. */
  repoRoot: string
  /** Repository-relative path whose history is shown. */
  file: string
  t: Translate
  onClose(): void
}

/** Commit list plus the selected commit's file diff, in one modal. */
export function FileHistoryDialog({ repoRoot, file, t, onClose }: FileHistoryDialogProps): React.ReactElement {
  const diffMode = useDiffMode()
  const [commits, setCommits] = useState<FileHistoryCommit[] | null>(null)
  const [logError, setLogError] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)
  const [diff, setDiff] = useState<FileCommitDiffPayload | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  /** Whether the commit list is shown beside the diff. */
  const [listOpen, setListOpen] = useState(true)

  // Load the file's commit list once per repository/path pair.
  useEffect(() => {
    const controller = new AbortController()
    setCommits(null)
    setLogError(null)
    requestFileLog({ path: repoRoot, file }, controller.signal)
      .then(payload => {
        if (controller.signal.aborted) return
        setCommits(payload.commits)
        setSelected(0)
      })
      .catch(failure => {
        if (controller.signal.aborted) return
        setLogError(toApiError(failure).message)
        setCommits([])
      })
    return () => controller.abort()
  }, [repoRoot, file])

  // Load the selected commit's diff for this file.
  useEffect(() => {
    const commit = commits?.[selected]
    if (commit === undefined) {
      setDiff(null)
      return
    }
    const controller = new AbortController()
    setDiff(null)
    setDiffError(null)
    setDiffLoading(true)
    requestFileCommitDiff({ path: repoRoot, hash: commit.hash, file }, controller.signal)
      .then(payload => {
        if (controller.signal.aborted) return
        setDiff(payload)
        setDiffLoading(false)
      })
      .catch(failure => {
        if (controller.signal.aborted) return
        setDiffError(toApiError(failure).message)
        setDiffLoading(false)
      })
    return () => controller.abort()
  }, [commits, selected, repoRoot, file])

  return (
    <DialogShell
      title={t('fileHistoryTitle').replace('{file}', file)}
      t={t}
      wide
      resizable
      draggable
      padded={false}
      frameClassName={cls('dsh-gitlog-file-history-dialog')}
      onClose={onClose}
    >
      <div className={cls(`dsh-gitlog-file-history${listOpen ? '' : ' is-list-collapsed'}`)}>
        <div className={cls(`dsh-gitlog-file-history-list${listOpen ? '' : ' is-hidden'}`)}>
          {logError !== null
            ? <p className={cls('dsh-gitlog-note')} role="alert">{logError}</p>
            : commits === null
              ? <LoadingLine label={t('loadingCommits')} />
              : commits.length === 0
                ? <p className={cls('dsh-gitlog-note')}>{t('fileHistoryEmpty')}</p>
                : commits.map((commit, index) => (
                    <button
                      key={commit.hash}
                      type="button"
                      className={cls(`dsh-gitlog-file-history-row${index === selected ? ' is-selected' : ''}`)}
                      onClick={() => setSelected(index)}
                    >
                      <span className={cls('dsh-gitlog-file-history-subject')}>{commit.subject || t('noSubject')}</span>
                      <span className={cls('dsh-gitlog-file-history-meta')}>
                        {`${commit.shortHash} · ${formatDateTime(commit.date, t('localeId'))}`}
                      </span>
                    </button>
                  ))}
        </div>
        <div className={cls('dsh-gitlog-file-history-diff')}>
          <div className={cls('dsh-gitlog-file-history-diff-head')}>
            <span className={cls('dsh-gitlog-file-history-diff-title')}>
              <Button
                variant="ghost"
                iconOnly
                ariaPressed={listOpen}
                title={t('fileHistoryToggleList')}
                icon={<HistoryListIcon />}
                onClick={() => setListOpen(value => !value)}
                {...tooltipProps(t('fileHistoryToggleList'))}
              />
              <code className={cls('dsh-gitlog-patch-file')}>{file}</code>
            </span>
            <Button
              variant="ghost"
              iconOnly
              title={diffMode.mode === 'split' ? t('diffUnified') : t('diffSplit')}
              icon={diffMode.mode === 'split' ? <UnifiedDiffIcon /> : <SplitDiffIcon />}
              onClick={diffMode.toggle}
              {...tooltipProps(diffMode.mode === 'split' ? t('diffUnified') : t('diffSplit'))}
            />
          </div>
          {diffLoading
            ? <LoadingLine label={t('loadingCommit')} />
            : diffError !== null
              ? <p className={cls('dsh-gitlog-note')} role="alert">{diffError}</p>
              : diff === null
                ? null
                : diff.lfs !== undefined
                  ? <LfsDiff lfs={diff.lfs} path={file} t={t} />
                  : diff.patch.trim() !== ''
                    ? <DiffView patch={diff.patch} t={t} path={file} mode={diffMode.mode} />
                    : <p className={cls('dsh-gitlog-note')}>{diff.binary ? t('binary') : t('fileNoPatch')}</p>}
        </div>
      </div>
    </DialogShell>
  )
}
