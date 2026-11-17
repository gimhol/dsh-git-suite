/**
 * The block a Git LFS change gets instead of a text diff.
 *
 * Git stores an LFS-tracked file as a three-line pointer, so `git diff` only ever
 * shows `version` / `oid sha256` / `size` rows changing. Those rows are not
 * content and must not be offered for partial staging, so the viewer names the
 * two objects instead and says where the payload lives.
 */
import type * as React from 'react'
import { h } from '../runtime.js'
import { cls } from '../styles.js'
import { formatBytes } from '../lib/format.js'
import type { LfsChange, LfsPointer, Translate } from '../types.js'

export interface LfsDiffProps {
  /** The pointer change to describe. */
  lfs: LfsChange
  /** Repository-relative path, when the caller knows it. */
  path?: string
  t: Translate
}

/** `sha256:0f762895…` — the algorithm and enough of the digest to compare. */
function shortOid(pointer: LfsPointer): string {
  const digest = pointer.oid.slice(pointer.oid.indexOf(':') + 1)
  return `sha256:${digest.slice(0, 8)}`
}

/** One side's object id and payload size, or why that side has no pointer. */
function side(pointer: LfsPointer | null, which: 'before' | 'after', t: Translate): string {
  if (pointer === null) return t(which === 'before' ? 'mediaAdded' : 'mediaRemoved')
  return `${shortOid(pointer)} · ${formatBytes(pointer.size)}`
}

/** Before/after pointer summary for one LFS-tracked file. */
export function LfsDiff({ lfs, path, t }: LfsDiffProps): React.ReactElement {
  return (
    <div className={cls('dsh-gitlog-lfs-diff')}>
      <p className={cls('dsh-gitlog-lfs-note')}>
        <span className={cls('dsh-gitlog-lfs-badge')}>{t('lfsBadge')}</span>
        {t('lfsManaged')}
      </p>
      {path === undefined ? null : <code className={cls('dsh-gitlog-lfs-path')}>{path}</code>}
      <dl className={cls('dsh-gitlog-lfs-sides')}>
        <dt>{t('mediaBefore')}</dt>
        <dd>{side(lfs.before, 'before', t)}</dd>
        <dt>{t('mediaAfter')}</dt>
        <dd>{side(lfs.after, 'after', t)}</dd>
      </dl>
      <p className={cls('dsh-gitlog-note')}>{t('lfsStageWhole')}</p>
    </div>
  )
}
