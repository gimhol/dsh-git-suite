import type * as React from 'react'
import { GitLogPanel } from './GitLogPanel.js'
import { h } from './runtime.js'
import type { Translate } from './types.js'
import { cls } from './styles.js'

/**
 * The right-sidebar tab body. It renders the same panel as the main area, with
 * the sidebar wrapper class that switches to the narrow single-column layout.
 * The slot is Session-scoped, so the panel opens on the repository of the
 * working directory the current Session belongs to.
 */
export function SidebarGitLogPanel({ t, sessionId }: { t: Translate; sessionId?: string }): React.ReactElement {
  return (
    <div className={cls('dsh-gitlog-sidebar')}>
      <GitLogPanel t={t} compact sessionId={sessionId} />
    </div>
  )
}
