/**
 * The patch in its own modal: same DiffView, a much larger frame, and its own
 * unified/split toggle so the inline pane keeps its layout.
 */
import type * as React from 'react'
import { h } from '../runtime.js'
import type { Translate } from '../types.js'
import type { DiffMode } from './DiffView.js'
import { DiffView } from './DiffView.js'
import { DialogShell } from './DialogShell.js'
import { SplitDiffIcon, UnifiedDiffIcon } from './GitLogIcon.js'
import { tooltipProps } from './Tooltip.js'
import { cls } from '../styles.js'

export interface DiffDialogProps {
  /** Path shown as the dialog title; the patch belongs to this file. */
  path: string
  patch: string
  t: Translate
  mode: DiffMode
  onToggleMode(): void
  onClose(): void
}

/** Read-only diff rendered in a large modal window. */
export function DiffDialog({ path, patch, t, mode, onToggleMode, onClose }: DiffDialogProps): React.ReactElement {
  const modeLabel = mode === 'split' ? t('diffUnified') : t('diffSplit')
  return (
    <DialogShell title={path} t={t} frameClassName={cls('dsh-gitlog-diff-dialog')} onClose={onClose}>
      <div className={cls('dsh-gitlog-diff-dialog-toolbar')}>
        <button
          type="button"
          className={cls('dsh-gitlog-diff-mode')}
          aria-label={modeLabel}
          {...tooltipProps(modeLabel)}
          onClick={onToggleMode}
        >
          {mode === 'split' ? <UnifiedDiffIcon /> : <SplitDiffIcon />}
        </button>
      </div>
      <div className={cls('dsh-gitlog-diff-dialog-body')}>
        <DiffView patch={patch} t={t} path={path} mode={mode} empty={t('fileNoPatch')} />
      </div>
    </DialogShell>
  )
}
