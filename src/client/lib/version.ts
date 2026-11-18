/**
 * Version comparison for the panel's update check.
 *
 * The check compares the registry's latest release with the version compiled
 * into this bundle, not with the value a cached payload recorded when it was
 * fetched: after rebuilding the same checkout, a cached "current" would keep
 * reporting an update that is already installed. The algorithm mirrors the
 * host's `compareVersions` so both sides reach the same verdict.
 */

/** Split `x.y.z[-pre]` into numeric core parts and the prerelease tag. */
function split(value: string): { core: number[]; pre: string } {
  const [core = '', pre = ''] = value.split('-', 2)
  return {
    core: core.split('.').map(part => {
      const parsed = Number.parseInt(part, 10)
      return Number.isFinite(parsed) ? parsed : 0
    }),
    pre,
  }
}

/** Compare two versions; positive when `left` is newer, negative when older. */
export function compareVersions(left: string, right: string): number {
  const leftVersion = split(left)
  const rightVersion = split(right)
  const length = Math.max(leftVersion.core.length, rightVersion.core.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (leftVersion.core[index] ?? 0) - (rightVersion.core[index] ?? 0)
    if (diff !== 0) return diff
  }
  if (leftVersion.pre === rightVersion.pre) return 0
  // A release outranks a prerelease of the same core version.
  if (leftVersion.pre === '') return 1
  if (rightVersion.pre === '') return -1
  return leftVersion.pre.localeCompare(rightVersion.pre)
}

/** Whether `candidate` is a release newer than the version running in this bundle. */
export function isNewerVersion(candidate: string, running: string): boolean {
  return compareVersions(candidate, running) > 0
}
