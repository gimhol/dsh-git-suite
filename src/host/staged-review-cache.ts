/**
 * Host-side cache of pre-commit AI reviews.
 *
 * The staged patch is hashed, so a review is reused only while the staged
 * content is byte-identical; staging or unstaging anything produces a new key
 * and a fresh review. Files live beside the other DSH caches, and every failure
 * is swallowed: a cache miss just means the review runs again.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface StagedReview {
  /** Review Markdown. */
  text: string
  /** Model that produced the review. */
  model: string
  /** Whether the staged diff was truncated when the review ran. */
  truncated: boolean
  /** Cache time (ms), used to keep only the newest entries. */
  at: number
}

const MAX_ENTRIES = 15
const MAX_TEXT_CHARS = 20_000

/** Serializes read-modify-write operations so concurrent writers cannot lose entries. */
let queue: Promise<void> = Promise.resolve()

function serialize<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run)
  queue = next.then(() => undefined, () => undefined)
  return next
}

/** @returns the JSON file backing the staged review cache. */
function cacheFile(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'cache', 'dsh-git-suite', 'staged-reviews.json')
}

/** @returns the cache key for one repository and staged patch. */
function cacheKey(root: string, hash: string): string {
  return `${root}\u0000${hash}`
}

/** Read and parse the cache file; unreadable or corrupt content reads as empty. */
async function readAll(): Promise<Record<string, StagedReview>> {
  try {
    const raw = await readFile(cacheFile(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as Record<string, StagedReview>
  } catch {
    return {}
  }
}

/** Atomically replace the cache file, keeping the newest entries. */
async function writeAll(map: Record<string, StagedReview>): Promise<void> {
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
 * Read the cached review of one staged patch.
 * @param root - repository top level.
 * @param hash - hash of the staged patch.
 * @returns the cached review, or null when this patch was not reviewed.
 */
export async function readStagedReview(root: string, hash: string): Promise<StagedReview | null> {
  const entry = (await readAll())[cacheKey(root, hash)]
  if (entry === undefined || typeof entry.text !== 'string' || entry.text === '') return null
  return {
    text: entry.text,
    model: typeof entry.model === 'string' ? entry.model : '',
    truncated: entry.truncated === true,
    at: typeof entry.at === 'number' ? entry.at : 0,
  }
}

/**
 * Store a finished staged review.
 * @param root - repository top level.
 * @param hash - hash of the staged patch.
 * @param text - review Markdown.
 * @param model - model that produced it.
 * @param truncated - whether the diff was truncated.
 */
export async function writeStagedReview(
  root: string,
  hash: string,
  text: string,
  model: string,
  truncated: boolean,
): Promise<void> {
  if (text === '') return
  await serialize(async () => {
    const map = await readAll()
    const previous = Object.values(map).reduce((max, entry) => Math.max(max, entry.at), 0)
    map[cacheKey(root, hash)] = {
      text: text.slice(0, MAX_TEXT_CHARS),
      model,
      truncated,
      at: Math.max(Date.now(), previous + 1),
    }
    await writeAll(map)
  })
}
