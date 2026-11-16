/**
 * Host-side cache of finished AI pull request reviews.
 *
 * Reviews are generated content, not UI state, so they live next to the other
 * DSH caches (under `$DSH_HOME/cache`) instead of the browser's localStorage.
 * An entry is keyed by repository, remote, and pull request number, and carries
 * the PR `updatedAt` it was produced for: a PR with new commits no longer
 * matches and starts fresh.
 *
 * Every failure is swallowed; a cache miss only means the review runs again.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

interface CachedReview {
  /** Review Markdown. */
  text: string
  /** PR `updatedAt` the review was generated for. */
  updatedAt: string
  /** Cache time (ms), used to keep only the newest entries. */
  at: number
}

const MAX_ENTRIES = 30
const MAX_TEXT_CHARS = 20_000

/** Serializes read-modify-write operations so concurrent writers cannot lose entries. */
let queue: Promise<void> = Promise.resolve()

function serialize<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run)
  queue = next.then(() => undefined, () => undefined)
  return next
}

/** @returns the JSON file backing the cache. */
function cacheFile(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'cache', 'dsh-git-suite', 'pr-reviews.json')
}

/** @returns the composite key of one review. */
function cacheKey(root: string, remote: string, number: number): string {
  return `${root}\u0000${remote}\u0000${number}`
}

/** Read and parse the cache file; unreadable or corrupt content reads as empty. */
async function readAll(): Promise<Record<string, CachedReview>> {
  try {
    const raw = await readFile(cacheFile(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as Record<string, CachedReview>
  } catch {
    return {}
  }
}

/** Atomically replace the cache file, keeping the newest entries. */
async function writeAll(map: Record<string, CachedReview>): Promise<void> {
  try {
    const newest = Object.entries(map)
      .filter(([, entry]) => typeof entry?.text === 'string' && typeof entry?.at === 'number')
      .sort((left, right) => right[1].at - left[1].at)
      .slice(0, MAX_ENTRIES)
    const file = cacheFile()
    await mkdir(dirname(file), { recursive: true })
    const temp = `${file}.tmp`
    await writeFile(temp, `${JSON.stringify(Object.fromEntries(newest))}\n`, 'utf8')
    await rename(temp, file)
  } catch {
    // Best-effort: caching never blocks a review.
  }
}

/**
 * Read the cached review for one pull request.
 * @param root - repository top level.
 * @param remote - remote name.
 * @param number - pull request number.
 * @param updatedAt - current PR `updatedAt`; a mismatch invalidates the entry.
 * @returns the cached review, or null when there is none for this version.
 */
export async function readReviewCache(
  root: string,
  remote: string,
  number: number,
  updatedAt: string,
): Promise<string | null> {
  const entry = (await readAll())[cacheKey(root, remote, number)]
  if (entry === undefined || entry.updatedAt !== updatedAt) return null
  return typeof entry.text === 'string' && entry.text !== '' ? entry.text : null
}

/**
 * Store a finished review.
 * @param root - repository top level.
 * @param remote - remote name.
 * @param number - pull request number.
 * @param updatedAt - PR `updatedAt` the review belongs to.
 * @param text - review Markdown.
 */
export async function writeReviewCache(
  root: string,
  remote: string,
  number: number,
  updatedAt: string,
  text: string,
): Promise<void> {
  if (text === '') return
  await serialize(async () => {
    const map = await readAll()
    const previous = Object.values(map).reduce((max, entry) => Math.max(max, entry.at), 0)
    map[cacheKey(root, remote, number)] = {
      text: text.slice(0, MAX_TEXT_CHARS),
      updatedAt,
      at: Math.max(Date.now(), previous + 1),
    }
    await writeAll(map)
  })
}

/**
 * Drop one cached review, so a cleared review stays cleared.
 * @param root - repository top level.
 * @param remote - remote name.
 * @param number - pull request number.
 */
export async function forgetReviewCache(root: string, remote: string, number: number): Promise<void> {
  await serialize(async () => {
    const map = await readAll()
    const key = cacheKey(root, remote, number)
    if (!(key in map)) return
    delete map[key]
    await writeAll(map)
  })
}
