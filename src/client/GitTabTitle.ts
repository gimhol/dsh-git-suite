/**
 * The right sidebar chip (and a floating panel's header) of a Git Suite tab.
 *
 * A tab type that registers no title shows only the plain text captured when the
 * tab opened. Registering this seat is what puts the branch glyph on the capsule;
 * the label stays `t('panel')`, so a language change re-renders without touching
 * the layout record.
 */
import type * as React from 'react'
import { GitLogIcon } from './components/GitLogIcon.js'
import { h } from './runtime.js'
import type { Translate } from './types.js'

/** Inline-flex row: the glyph keeps its size and the label truncates instead of the chip. */
const CHIP = { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }
const GLYPH = { display: 'inline-flex', flex: 'none' }
const LABEL = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

/**
 * The title as the tab capsule shows it.
 * @param props - the slot's bound translate function.
 * @returns the Git glyph followed by the localized tab label.
 */
export function GitTabTitle({ t }: { t: Translate }): React.ReactElement {
  return h('span', { style: CHIP },
    h('span', { style: GLYPH }, h(GitLogIcon, { size: 14 })),
    h('span', { style: LABEL }, t('panel')))
}
