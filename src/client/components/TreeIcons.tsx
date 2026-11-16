import type * as React from 'react'
import { h } from '../runtime.js'
import { cls } from '../styles.js'

export function ChevronIcon({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      className={cls(`dsh-gitlog-tree-chevron${open ? ' is-open' : ''}`)}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden={true}
    >
      <path d="M4.5 3.5 7 6 4.5 8.5" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Ring marker for the checked-out branch in the refs tree. */
export function CurrentBranchIcon(): React.ReactElement {
  return (
    <svg
      className={cls('dsh-gitlog-tree-current')}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden={true}
    >
      <circle cx="6" cy="6" r="3.2" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  )
}

export function BranchIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden={true}>
      <circle cx="5" cy="4" r="1.7" stroke="currentColor" strokeWidth={1.3} />
      <circle cx="5" cy="12" r="1.7" stroke="currentColor" strokeWidth={1.3} />
      <circle cx="11" cy="6.5" r="1.7" stroke="currentColor" strokeWidth={1.3} />
      <path d="M5 5.7v4.6M11 8.2c0 2.5-3.1 2.3-5.9 2.9" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
    </svg>
  )
}

export function TagIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden={true}>
      <path d="M2.8 3h4.9l5.1 5.1-4.7 4.7L3 7.7V3Z" stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round" />
      <circle cx="5.6" cy="5.7" r="1" fill="currentColor" />
    </svg>
  )
}

export function RemoteIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden={true}>
      <path
        d="M4.6 12.2a3.1 3.1 0 0 1-.4-6.2 4 4 0 0 1 7.7-.4 2.9 2.9 0 0 1 .3 6.6H4.6Z"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function StashIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden={true}>
      <rect x="2.8" y="4.2" width="10.4" height="8.3" rx="1.2" stroke="currentColor" strokeWidth={1.3} />
      <path d="M2.8 6.8h10.4M6.2 4.2V3.1h3.6v1.1" stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round" />
    </svg>
  )
}

export function SubmoduleIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden={true}>
      <path d="M2.5 4.4h4l1.3 1.6h5.7v6.5h-11V4.4Z" stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round" />
      <rect x="5.8" y="8.1" width="4.4" height="2.9" rx="0.6" stroke="currentColor" strokeWidth={1.2} />
      <path d="M7.4 9.5h1.2" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" />
    </svg>
  )
}

export function SectionIcon({ id }: { id: 'branches' | 'tags' | 'remotes' | 'stashes' | 'submodules' }): React.ReactElement {
  if (id === 'tags') return <TagIcon />
  if (id === 'remotes') return <RemoteIcon />
  if (id === 'stashes') return <StashIcon />
  if (id === 'submodules') return <SubmoduleIcon />
  return <BranchIcon />
}
