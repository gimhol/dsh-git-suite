/**
 * The panel's stylesheet is a CSS Module.
 *
 * `styles.module.scss` compiles to `styles.module.css`; the client build lets
 * esbuild hash every class name in it, writes that hashed text to
 * `styles.generated.css`, and the panel mounts it. Components never spell a raw
 * class: they call `cls()`, so a rename in the stylesheet cannot silently leave
 * an element unstyled.
 */
import classes from './styles.module.css'
import cssText from './styles.generated.css'

/** The stylesheet the panel mounts; it already carries the hashed class names. */
export const CSS = cssText

/** Hashed names, cached because the same class strings repeat on every row. */
const cache = new Map<string, string>()

/**
 * Resolve authored class names to their hashed names.
 * @param values - class strings, or false/null/undefined entries to skip.
 * @returns the space-joined hashed class list; unknown names pass through.
 */
export function cls(...values: readonly (string | false | null | undefined)[]): string {
  const parts: string[] = []
  for (const value of values) {
    if (value === undefined || value === null || value === false || value === '') continue
    for (const name of value.split(/\s+/)) {
      if (name === '') continue
      parts.push(hashed(name))
    }
  }
  return parts.join(' ')
}

/**
 * @param name - one authored class name.
 * @returns its hashed name, or the name itself when the stylesheet defines none.
 */
function hashed(name: string): string {
  const cached = cache.get(name)
  if (cached !== undefined) return cached
  const resolved = (classes as Readonly<Record<string, string>>)[name] ?? name
  cache.set(name, resolved)
  return resolved
}
