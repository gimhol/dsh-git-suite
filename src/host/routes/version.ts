import { readFile } from 'node:fs/promises'
import { RouteError } from '../errors.js'
import type { VersionPayload } from '../types.js'

const REGISTRY_URL = 'https://registry.npmjs.org/dsh-git-suite/latest'
const FETCH_TIMEOUT_MS = 20_000

/**
 * Version of the installed package, read from its own `package.json`.
 *
 * The value is deliberately not memoized: a local link install can be rebuilt to
 * a new version while DSH keeps running, and a cached value would then keep
 * reporting an update that the checkout already contains.
 * @param packageJsonUrl - the manifest to read; tests point this at a fixture.
 */
export async function installedVersion(
  packageJsonUrl: URL = new URL('../../package.json', import.meta.url),
): Promise<string> {
  try {
    const text = await readFile(packageJsonUrl, 'utf8')
    const parsed = JSON.parse(text) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** Compare two `x.y.z[-pre]` versions; positive when `left` is newer. */
export function compareVersions(left: string, right: string): number {
  const split = (value: string): [number[], string] => {
    const [core = '', pre = ''] = value.split('-', 2)
    const parts = core.split('.').map(part => {
      const parsed = Number.parseInt(part, 10)
      return Number.isFinite(parsed) ? parsed : 0
    })
    return [parts, pre]
  }
  const [leftCore, leftPre] = split(left)
  const [rightCore, rightPre] = split(right)
  for (let index = 0; index < Math.max(leftCore.length, rightCore.length); index += 1) {
    const diff = (leftCore[index] ?? 0) - (rightCore[index] ?? 0)
    if (diff !== 0) return diff
  }
  if (leftPre === rightPre) return 0
  if (leftPre === '') return 1
  if (rightPre === '') return -1
  return leftPre.localeCompare(rightPre)
}

/** Compare the installed version with the latest one published on npm. */
export async function readVersion(): Promise<VersionPayload> {
  const current = await installedVersion()
  let latest = ''
  try {
    const response = await fetch(REGISTRY_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new RouteError(502, 'registry-unreachable', 'The npm registry answered with an error.', { status: response.status })
    }
    const payload = await response.json() as { version?: unknown }
    latest = typeof payload.version === 'string' ? payload.version : ''
  } catch (error) {
    if (error instanceof RouteError) throw error
    throw new RouteError(502, 'registry-unreachable', 'Could not reach the npm registry.', {
      detail: error instanceof Error ? error.message : String(error),
    })
  }
  if (latest === '') {
    throw new RouteError(502, 'registry-invalid', 'The npm registry response had no version.')
  }
  return { ok: true, current, latest, updateAvailable: compareVersions(latest, current) > 0 }
}
