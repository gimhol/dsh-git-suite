/**
 * The window's keyboard service, reachable from the panel's Settings dialog.
 *
 * The plugin's `apply` owns the registration scopes that carry `shortcuts`, but
 * the dialog renders deep inside the panel tree. This module-level handle is the
 * one thing both sides share; it is cleared when that scope disposes, so the
 * dialog degrades to a read-only hint instead of holding a dead service.
 */
import type { ShortcutsService } from './dsh.js'

let bound: ShortcutsService | undefined

/**
 * Publish the window's shortcut service to the panel's own controls.
 * @param service - the service injected by the shortcut registration scope.
 * @returns disposer that clears only this binding.
 */
export function bindShortcuts(service: ShortcutsService): () => void {
  bound = service
  return () => { if (bound === service) bound = undefined }
}

/** @returns the bound service, or undefined in a window that has none. */
export function shortcutService(): ShortcutsService | undefined {
  return bound
}
