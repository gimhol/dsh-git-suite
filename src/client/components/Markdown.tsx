import type * as React from 'react'
import { h, useMemo } from '../runtime.js'
import { highlightLines, languageForAlias } from '../lib/highlight.js'
import { cls } from '../styles.js'

export interface MarkdownProps {
  text: string
  className?: string
}

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; language: string; code: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'rule' }

const SAFE_LINK = /^https?:\/\//i
const MAX_MARKDOWN_CHARS = 200_000
const MAX_INLINE_DEPTH = 8
const LIST_ITEM = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/

function inline(text: string, prefix: string, depth = 0): React.ReactNode[] {
  if (depth > MAX_INLINE_DEPTH) return [text]
  const nodes: React.ReactNode[] = []
  const pattern = /`([^`]+)`|(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*\*\*([\s\S]+?)\*\*\*|\*\*([\s\S]+?)\*\*|(?<![\w])__([\s\S]+?)__(?![\w])|\*([^*\n]+)\*|(?<![\w])_([^_\n]+)_(?![\w])|~~([^~]+)~~/g
  let last = 0
  let index = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const key = `${prefix}-${index++}`
    if (match[1] !== undefined) {
      nodes.push(<code key={key}>{match[1]}</code>)
    } else if (match[3] !== undefined) {
      const label = match[3]
      const url = match[4] ?? ''
      if (match[2] === '!') {
        nodes.push(...inline(label, key, depth + 1))
      } else if (SAFE_LINK.test(url)) {
        nodes.push(
          <a key={key} href={url} target="_blank" rel="noreferrer noopener">
            {inline(label, key, depth + 1)}
          </a>,
        )
      } else {
        nodes.push(...inline(label, key, depth + 1))
      }
    } else if (match[5] !== undefined) {
      nodes.push(
        <strong key={key}>
          <em>{inline(match[5], key, depth + 1)}</em>
        </strong>,
      )
    } else if (match[6] !== undefined || match[7] !== undefined) {
      nodes.push(<strong key={key}>{inline(match[6] ?? match[7] ?? '', key, depth + 1)}</strong>)
    } else if (match[8] !== undefined || match[9] !== undefined) {
      nodes.push(<em key={key}>{inline(match[8] ?? match[9] ?? '', key, depth + 1)}</em>)
    } else if (match[10] !== undefined) {
      nodes.push(<del key={key}>{inline(match[10], key, depth + 1)}</del>)
    }
    last = pattern.lastIndex
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? ''
  if (/^\s*$/.test(line)) return true
  if (/^(?:```|~~~)/.test(line)) return true
  if (/^#{1,6}\s+/.test(line)) return true
  if (/^>\s?/.test(line)) return true
  if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line)) return true
  if (RULE.test(line)) return true
  if (line.includes('|') && TABLE_DIVIDER.test(lines[index + 1] ?? '')) return true
  return false
}

function splitRow(line: string): string[] {
  let raw = line.trim()
  if (raw.startsWith('|')) raw = raw.slice(1)
  if (raw.endsWith('|') && !raw.endsWith('\\|')) raw = raw.slice(0, -1)
  const cells: string[] = []
  let current = ''
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    if (char === '\\' && raw[index + 1] === '|') {
      current += '|'
      index += 1
    } else if (char === '|') {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  return cells
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '') {
      index += 1
      continue
    }

    const fence = /^(```|~~~)\s*([\w#+.-]*)\s*$/.exec(line)
    if (fence !== null) {
      const marker = fence[1] ?? '```'
      const language = fence[2] ?? ''
      index += 1
      const code: string[] = []
      while (index < lines.length && !(lines[index] ?? '').startsWith(marker)) {
        code.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ kind: 'code', language, code: code.join('\n') })
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      blocks.push({ kind: 'heading', level: (heading[1] ?? '#').length, text: heading[2] ?? '' })
      index += 1
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      index += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        quote.push((lines[index] ?? '').replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push({ kind: 'quote', text: quote.join('\n') })
      continue
    }

    if (line.includes('|') && TABLE_DIVIDER.test(lines[index + 1] ?? '')) {
      const header = splitRow(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length) {
        const row = lines[index] ?? ''
        if (row.trim() === '' || !row.includes('|')) break
        rows.push(splitRow(row))
        index += 1
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    const listItem = LIST_ITEM.exec(line)
    if (listItem !== null) {
      const ordered = listItem[2] !== undefined
      const items: string[] = []
      while (index < lines.length) {
        const currentLine = lines[index] ?? ''
        const next = LIST_ITEM.exec(currentLine)
        if (next !== null && (next[2] !== undefined) === ordered) {
          items.push(next[3] ?? '')
          index += 1
          // Indented continuation lines belong to the item, not a new paragraph.
          while (index < lines.length) {
            const continuation = lines[index] ?? ''
            if (continuation.trim() === '' || LIST_ITEM.test(continuation)) break
            if (!/^(?:\s{2,}|\t)/.test(continuation)) break
            items[items.length - 1] = `${items[items.length - 1]} ${continuation.trim()}`
            index += 1
          }
          continue
        }
        // Loose lists may have blank lines between items.
        if (currentLine.trim() === '') {
          let lookahead = index
          while (lookahead < lines.length && (lines[lookahead] ?? '').trim() === '') lookahead += 1
          const afterGap = LIST_ITEM.exec(lines[lookahead] ?? '')
          if (afterGap !== null && (afterGap[2] !== undefined) === ordered) {
            index = lookahead
            continue
          }
        }
        break
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length && !isBlockStart(lines, index)) {
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n') })
  }
  return blocks
}

function CodeBlock({ block }: { block: Extract<Block, { kind: 'code' }> }): React.ReactElement {
  const language = block.language === '' ? null : languageForAlias(block.language)
  const lines = useMemo(() => block.code.split('\n'), [block.code])
  const highlighted = useMemo(
    () => language === null || lines.length > 6000 || block.code.length > 400_000
      ? null
      : highlightLines(lines, language),
    [block.code, language, lines],
  )
  return (
    <pre className={cls('dsh-gitlog-md-code')}>
      <code>
        {highlighted === null
          ? block.code
          : highlighted.map((line, lineIndex) => (
              <span key={lineIndex} className={cls('dsh-gitlog-md-code-line')}>
                {line.map((token, tokenIndex) => token.type === null
                  ? token.text
                  : <span key={tokenIndex} className={cls(`dsh-gitlog-tok-${token.type}`)}>{token.text}</span>)}
                {lineIndex < highlighted.length - 1 ? '\n' : ''}
              </span>
            ))}
      </code>
    </pre>
  )
}

function renderBlock(block: Block, key: string): React.ReactNode {
  if (block.kind === 'heading') {
    return (
      <h3 key={key} className={cls(`dsh-gitlog-md-heading md-level-${block.level}`)}>
        {inline(block.text, key)}
      </h3>
    )
  }
  if (block.kind === 'paragraph') return <p key={key}>{inline(block.text, key)}</p>
  if (block.kind === 'code') return <CodeBlock key={key} block={block} />
  if (block.kind === 'list') {
    const children = block.items.map((item, index) => <li key={`${key}-${index}`}>{inline(item, `${key}-${index}`)}</li>)
    return block.ordered ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>
  }
  if (block.kind === 'quote') return <blockquote key={key}>{inline(block.text, key)}</blockquote>
  if (block.kind === 'rule') return <hr key={key} />
  return (
    <table key={key}>
      <thead>
        <tr>
          {block.header.map((cell, index) => <th key={`${key}-h-${index}`}>{inline(cell, `${key}-h-${index}`)}</th>)}
        </tr>
      </thead>
      <tbody>
        {block.rows.map((row, rowIndex) => (
          <tr key={`${key}-r-${rowIndex}`}>
            {row.map((cell, cellIndex) => (
              <td key={`${key}-r-${rowIndex}-${cellIndex}`}>{inline(cell, `${key}-r-${rowIndex}-${cellIndex}`)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Safe Markdown for discussion comments and AI reviews; no raw HTML is rendered. */
export function Markdown({ text, className }: MarkdownProps): React.ReactElement {
  const tooLarge = text.length > MAX_MARKDOWN_CHARS
  const blocks = useMemo(() => tooLarge ? [] : parseBlocks(text), [text, tooLarge])
  const classes = cls(`dsh-gitlog-markdown${className === undefined ? '' : ` ${className}`}`)
  if (tooLarge) return <pre className={classes}>{text}</pre>
  return (
    <div className={classes}>
      {blocks.map((block, index) => renderBlock(block, `md-${index}`))}
    </div>
  )
}
