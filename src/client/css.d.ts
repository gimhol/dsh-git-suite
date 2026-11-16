/**
 * Stylesheet imports.
 *
 * - `*.module.css` is a CSS Module: esbuild hashes its class names and exports
 *   the authored-to-hashed map that `styles.ts` wraps in `cls()`. It is declared
 *   first because TypeScript resolves multiple matching wildcards in
 *   declaration order.
 * - `*.css` is read as text (`--loader:.css=text`) so the panel can mount it.
 */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}

declare module '*.css' {
  const css: string
  export default css
}
