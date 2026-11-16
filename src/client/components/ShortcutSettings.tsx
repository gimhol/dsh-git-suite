/**
 * Shortcut section of the panel's Settings dialog.
 *
 * DSH's Settings page owns the full editor, but the plugin's own controls belong
 * next to its other options, so this section lists the two catalog commands this
 * plugin contributes and edits them through the same service: record a
 * combination, clear it (allowed), or restore the default.
 */
import type * as React from 'react'
import { h, useEffect, useState } from '../runtime.js'
import { shortcutService } from '../shortcutBridge.js'
import type { ShortcutCatalogEntry, ShortcutEdit, ShortcutSaveResult } from '../dsh.js'
import type { Translate } from '../types.js'
import { cls } from '../styles.js'

/** The plugin's own commands, in the order the section lists them. */
const COMMANDS = ['gitSuite.page', 'gitSuite.open'] as const

/** @returns the catalog rows for this plugin's commands in a stable order. */
function rowsOf(): readonly ShortcutCatalogEntry[] {
  const service = shortcutService()
  if (service === undefined) return []
  const catalog = service.catalog.getSnapshot()
  const rows: ShortcutCatalogEntry[] = []
  for (const id of COMMANDS) {
    const row = catalog.find(entry => entry.id === id)
    if (row !== undefined) rows.push(row)
  }
  return rows
}

/** @returns localized copy for a failed edit. */
function failureText(result: ShortcutSaveResult, t: Translate): string {
  switch (result.status) {
    case 'conflict': return t('shortcutConflict')
    case 'stale': return t('shortcutStale')
    case 'unreadable': return t('shortcutReadonly')
    default: return t('shortcutSaveFailed')
  }
}

/**
 * The two contributed commands with per-row controls.
 * @param props - the dialog's bound translate function.
 * @returns the section, or its unavailable hint when no service is bound.
 */
export function ShortcutSettings({ t }: { t: Translate }): React.ReactElement {
  const [rows, setRows] = useState<readonly ShortcutCatalogEntry[]>(() => rowsOf())
  const [recording, setRecording] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const service = shortcutService()
    if (service === undefined) return
    const update = (): void => { setRows(rowsOf()) }
    update()
    return service.catalog.subscribe(update)
  }, [])

  const save = (edit: ShortcutEdit): void => {
    const service = shortcutService()
    if (service === undefined) return
    setMessage(null)
    void service.edit(edit, service.config.getSnapshot().revision).then((result) => {
      if (result.status === 'saved') setRecording(null)
      else setMessage(failureText(result, t))
    }, () => { setMessage(t('shortcutSaveFailed')) })
  }

  // A recorder owns the keyboard until it saves or the user cancels: capture the
  // combination before any command or the dialog's own Escape handler sees it.
  useEffect(() => {
    if (recording === null) return
    const service = shortcutService()
    if (service === undefined) return
    void service.recording?.(true).catch(() => {})
    const onKeyDown = (event: KeyboardEvent): void => {
      if (/^(Control|Alt|Shift|Meta)(Left|Right)$/u.test(event.code)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        setRecording(null)
        return
      }
      if (event.repeat) return
      const flags = { control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey }
      const modifiers = (['control', 'alt', 'shift', 'meta'] as const).filter(value => flags[value])
      let described: ReturnType<typeof service.describeBinding>
      try {
        described = service.describeBinding({ code: event.code, modifiers })
      } catch {
        setMessage(t('shortcutInvalid'))
        return
      }
      if (described.issue !== null) { setMessage(t('shortcutInvalid')); return }
      // The command's own current binding is not a conflict with itself.
      if (described.conflicts.some(value => value !== recording)) { setMessage(t('shortcutConflict')); return }
      save({ type: 'set', id: recording, binding: described.binding ?? { code: event.code, modifiers } })
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      void service.recording?.(false).catch(() => {})
    }
    // `t` and `save` are stable enough here: the recorder re-arms on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording])

  const unavailable = rows.length === 0

  return h('div', { className: cls('dsh-gitlog-settings-section') },
    h('h3', null, t('shortcutSection')),
    unavailable
      ? h('p', { className: cls('dsh-gitlog-settings-hint') }, t('shortcutUnavailable'))
      : h('div', { className: cls('dsh-gitlog-shortcut-list') },
        ...rows.map(row => h('div', { key: row.id, className: cls('dsh-gitlog-shortcut-row') },
          h('span', { className: cls('dsh-gitlog-shortcut-label') }, row.label),
          h('span', { className: cls('dsh-gitlog-shortcut-keys') },
            recording === row.id ? t('shortcutRecording') : row.binding === null ? t('shortcutUnbound') : row.keys.join('')),
          h('span', { className: cls('dsh-gitlog-shortcut-actions') },
            h('button', {
              type: 'button',
              className: cls('dsh-gitlog-shortcut-action'),
              onClick: () => {
                setMessage(null)
                setRecording(recording === row.id ? null : row.id)
              },
            }, recording === row.id ? t('cancel') : row.binding === null ? t('shortcutSet') : t('shortcutChange')),
            row.binding === null ? null : h('button', {
              type: 'button',
              className: cls('dsh-gitlog-shortcut-action'),
              onClick: () => { setRecording(null); save({ type: 'set', id: row.id, binding: null }) },
            }, t('shortcutUnset')),
            row.modified ? h('button', {
              type: 'button',
              className: cls('dsh-gitlog-shortcut-action'),
              onClick: () => { setRecording(null); save({ type: 'reset', id: row.id }) },
            }, t('shortcutReset')) : null,
          ),
          row.conflicts.length > 0
            ? h('span', { className: cls('dsh-gitlog-shortcut-warn') }, t('shortcutConflict'))
            : null,
        )),
      ),
    message === null ? null : h('p', { className: cls('dsh-gitlog-note'), role: 'alert' }, message),
  )
}
