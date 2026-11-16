/**
 * Guard the CSS Module contract at build time.
 *
 * The stylesheet is a module, so a class the SCSS never defines silently renders
 * nothing: there is no global `.dsh-gitlog-*` rule left to catch it. This check
 * fails the build for either of the two ways that can happen:
 *  - a `cls('…')` name the compiled stylesheet does not define, and
 *  - a raw `dsh-gitlog-…` string outside `cls()`, which would bypass hashing.
 *
 * Tokens inside a template hole (`is-${kind}`) cannot be resolved statically, so
 * fragments that end with `-` or contain `$`/`{` are skipped; `cls()` still maps
 * them at runtime and unknown names pass through unchanged.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** One class name a stylesheet defines. */
const classPattern = /\.(-?[A-Za-z_][A-Za-z0-9_-]*)/gu

/**
 * Names the markup has always carried without a matching rule. `cls()` passes
 * unknown names through, so these render exactly as they did before the module
 * conversion; listing them keeps the check strict for every other name.
 */
const UNSTYLED = new Set([
  'dsh-gitlog-col-date',
  'dsh-gitlog-col-description',
  'dsh-gitlog-col-graph',
  'dsh-gitlog-columns-menu',
  'dsh-gitlog-detail-message',
  'dsh-gitlog-md-code',
  'dsh-gitlog-md-code-line',
  'dsh-gitlog-md-heading',
])

/**
 * @param css - compiled stylesheet text.
 * @returns every class name it defines.
 */
export function definedClasses(css) {
  return new Set([...css.matchAll(classPattern)].map(match => match[1]))
}

/**
 * Collect the class tokens a `cls()` call names literally.
 * @param source - one TypeScript module's text.
 * @returns literal tokens, with template holes removed.
 */
function clsTokens(source) {
  const tokens = []
  for (const match of source.matchAll(/cls\(\s*(['"`])([\s\S]*?)\1\s*[,)]/gu)) {
    const text = match[2].replace(/\$\{[^}]*\}/gu, ' ')
    for (const token of text.split(/\s+/u)) {
      if (token === '' || token.includes('$') || token.includes('{') || token.includes('}')) continue
      tokens.push(token)
    }
  }
  return tokens
}

/**
 * Verify every class reference resolves against the stylesheet.
 * @param clientDir - absolute `src/client` directory.
 * @param css - compiled stylesheet text.
 * @throws when a reference cannot be validated.
 */
export function checkClassNames(clientDir, css) {
  const defined = definedClasses(css)
  const problems = []
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.(ts|tsx)$/u.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(path)
    }
  }
  walk(clientDir)

  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const token of clsTokens(source)) {
      if (token.endsWith('-') || UNSTYLED.has(token)) continue
      if (!defined.has(token)) problems.push(`${file.replace(clientDir, 'src/client')}: cls() names "${token}", which the stylesheet does not define`)
    }
    const lines = source.split('\n')
    lines.forEach((line, index) => {
      if (!/\bdsh-gitlog\b/u.test(line) || /cls\(/u.test(line)) return
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
      problems.push(`${file.replace(clientDir, 'src/client')}:${index + 1}: raw class reference outside cls(): ${trimmed.slice(0, 120)}`)
    })
  }

  if (problems.length > 0) {
    throw new Error(`class names do not resolve:\n${problems.join('\n')}`)
  }
}
