import type * as React from 'react'
import { h } from '../runtime.js'
import type { IconProps } from '../dsh.js'

/** Sidebar icon: two commit nodes joined by a branch line. */
export function GitLogIcon({ size }: IconProps): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable={false}
    >
      <circle cx={6.5} cy={5.5} r={2} />
      <circle cx={6.5} cy={18.5} r={2} />
      <circle cx={17.5} cy={8.5} r={2} />
      <path d="M6.5 7.5v9" />
      <path d="M17.5 10.5c0 4-5 4.2-9 4.7" />
    </svg>
  )
}

/** Circular-arrow icon for the refresh buttons. */
export function RefreshIcon({ size = 16 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable={false}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

/** Plus glyph for the add-repository button. */
export function PlusIcon({ size = 16 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      aria-hidden={true}
      focusable={false}
    >
      <path d="M8 3.2v9.6M3.2 8h9.6" />
    </svg>
  )
}

/** Two opposed arrows: compare with a remote. */
export function CompareIcon({ size = 14 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable={false}
    >
      <path d="M2.5 5.5h9M9.2 3.2 11.5 5.5 9.2 7.8" />
      <path d="M13.5 10.5h-9M6.8 8.2 4.5 10.5l2.3 2.3" />
    </svg>
  )
}



/**
 * The VS Code mark, taken from `@vscode/codicons` (`src/icons/vscode.svg`) so it
 * matches the editor's own icon set. Filled with `currentColor`.
 */
/** The codicon scode path, shared with the Insiders variant. */
export const VSCODE_CODICON_PATH = 'M15.434 1.72887L12.14 0.144875C12.002 0.078875 11.855 0.046875 11.709 0.046875C11.353 0.046875 11.18 0.211875 11.155 0.228875C11.073 0.270875 11.005 0.337875 11.004 0.338875L4.698 6.08888L1.951 4.00488C1.832 3.91388 1.69 3.86987 1.548 3.86987C1.387 3.86987 1.226 3.92788 1.1 4.04288L0.219 4.84387C0.074 4.97587 0.001 5.15688 0.001 5.33687C0.001 5.51687 0.073 5.69688 0.218 5.82888L2.6 8.00088L0.217 10.1719C0.072 10.3039 0 10.4839 0 10.6639C0 10.8439 0.073 11.0249 0.218 11.1569L1.099 11.9579C1.226 12.0729 1.386 12.1309 1.547 12.1309C1.688 12.1309 1.83 12.0859 1.95 11.9959L4.697 9.91187L11.003 15.6619C11.003 15.6619 11.072 15.7299 11.155 15.7719C11.179 15.7889 11.353 15.9529 11.709 15.9529C11.855 15.9529 12.003 15.9209 12.141 15.8549L15.435 14.2709C15.781 14.1049 16.001 13.7539 16.001 13.3699V2.62888C16.001 2.24487 15.781 1.89488 15.435 1.72787L15.434 1.72887ZM7.217 7.99988L12.002 4.36987V11.6299L7.217 7.99988Z'

export function VscodeIcon({ size = 18 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-1.6 -1.6 19.2 19.2"
      fill="currentColor"
      aria-hidden={true}
      focusable={false}
    >
      <path d={VSCODE_CODICON_PATH} />
    </svg>
  )
}
/** Terminal window with a prompt, for the "open a command line" action. */
export function TerminalIcon({ size = 18 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable={false}
    >
      <rect x="2.6" y="3.6" width="14.8" height="12.8" rx="2.4" />
      <path d="M6.2 8.1 8.8 10.3l-2.6 2.2" />
      <path d="M10.6 12.5h3.4" />
    </svg>
  )
}

/** Folder outline, for the "open the file manager" action. */
export function FolderIcon({ size = 18 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable={false}
    >
      <path d="M2.8 6.1c0-1 .8-1.8 1.8-1.8h3.1l1.5 1.9h6.2c1 0 1.8.8 1.8 1.8v5.9c0 1-.8 1.8-1.8 1.8H4.6c-1 0-1.8-.8-1.8-1.8z" />
    </svg>
  )
}

/** Three full-width bars, for the unified diff layout. */
export function UnifiedDiffIcon({ size = 16 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden={true}
      focusable={false}
    >
      <rect x="2" y="3.5" width="12" height="2.2" rx="1.1" />
      <rect x="2" y="6.9" width="12" height="2.2" rx="1.1" />
      <rect x="2" y="10.3" width="12" height="2.2" rx="1.1" />
    </svg>
  )
}

/** Two columns of three bars, for the side-by-side layout. */
export function SplitDiffIcon({ size = 16 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden={true}
      focusable={false}
    >
      <rect x="2" y="3.5" width="5.3" height="2.2" rx="1.1" />
      <rect x="8.7" y="3.5" width="5.3" height="2.2" rx="1.1" />
      <rect x="2" y="6.9" width="5.3" height="2.2" rx="1.1" />
      <rect x="8.7" y="6.9" width="5.3" height="2.2" rx="1.1" />
      <rect x="2" y="10.3" width="5.3" height="2.2" rx="1.1" />
      <rect x="8.7" y="10.3" width="5.3" height="2.2" rx="1.1" />
    </svg>
  )
}

/** Minus glyph for removing a file from the staged set. */
export function MinusIcon({ size = 16 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      aria-hidden={true}
      focusable={false}
    >
      <path d="M3.2 8h9.6" />
    </svg>
  )
}

/** Upload arrow: this tag exists only in the local repository. */
export function TagLocalIcon({ size = 12 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable={false}
    >
      <path d="M8 11V3.4M4.9 6.5 8 3.4l3.1 3.1" />
      <path d="M3.2 13h9.6" />
    </svg>
  )
}

/** Inequality mark: the local tag points at a different commit than the remote. */
export function TagDiffIcon({ size = 12 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      aria-hidden={true}
      focusable={false}
    >
      <path d="M2.8 5.8h10.4M2.8 10.2h10.4" />
      <path d="M10.6 2.6 5.4 13.4" />
    </svg>
  )
}

/** Sparkle icon for the AI commit-message button. */
export function SparkleIcon({ size = 16 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable={false}
    >
      <path d="M11 3l1.7 4.8L17.5 9.5l-4.8 1.7L11 16l-1.7-4.8L4.5 9.5l4.8-1.7L11 3z" />
      <path d="M18 15l.8 2.2 2.2.8-2.2.8L18 21l-.8-2.2-2.2-.8 2.2-.8L18 15z" />
    </svg>
  )
}

function CircleArrow({ direction, dashed = false }: { direction: 'down' | 'up'; dashed?: boolean }): React.ReactElement {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable={false}
    >
      <circle cx="10" cy="10" r="7.4" strokeDasharray={dashed ? '2.6 2.2' : undefined} />
      {direction === 'down'
        ? <path d="M10 6.2v7.4M7.3 10.9 10 13.6l2.7-2.7" />
        : <path d="M10 13.8V6.4M7.3 9.1 10 6.4l2.7 2.7" />}
    </svg>
  )
}

/** Two arrows pointing out of a frame: open the diff in its own dialog. */
export function ExpandIcon({ size = 16 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable={false}
    >
      <path d="M14 4h6v6" />
      <path d="M20 4l-6 6" />
      <path d="M10 20H4v-6" />
      <path d="M4 20l6-6" />
    </svg>
  )
}

/** Clipboard with a check: the AI review action. */
export function ReviewIcon({ size = 16 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable={false}
    >
      <path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z" />
      <path d="M8 6H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2" />
      <path d="M8.5 13.5l2.2 2.2 4.3-4.3" />
    </svg>
  )
}

/** Panel-with-lines glyph: the commit list beside a diff. */
export function HistoryListIcon({ size = 16 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable={false}
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8.5 4v16" />
      <path d="M12 9.5h5.5M12 13h5.5M12 16.5h3.5" />
    </svg>
  )
}

export function CommitIcon(): React.ReactElement {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable={false}
    >
      <circle cx="10" cy="10" r="7.4" />
      <path d="M10 6.5v7M6.5 10h7" />
    </svg>
  )
}

export function PullIcon(): React.ReactElement {
  return <CircleArrow direction="down" />
}

export function PushIcon(): React.ReactElement {
  return <CircleArrow direction="up" />
}

export function FetchIcon(): React.ReactElement {
  return <CircleArrow direction="down" dashed />
}








/** Generic "open in editor" glyph for editors without their own mark. */
export function EditorIcon({ size = 18 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable={false}
    >
      <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />
    </svg>
  )
}

/** Warning triangle beside a conflicted file's status letter. */
export function ConflictIcon({ size = 12 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable={false}
    >
      <path d="M8 2.2 14.2 13H1.8L8 2.2Z" />
      <path d="M8 6.1v3.2" />
      <circle cx="8" cy="11.2" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  )
}

