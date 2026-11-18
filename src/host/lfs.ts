/**
 * Git LFS pointer files.
 *
 * An LFS-tracked path is committed as a small text pointer; the payload lives in
 * the object store. Commands that read the object store (`git show`, `git diff`)
 * therefore expose the pointer, which is why an image would arrive as three lines
 * of text, while `git cat-file --filters` runs the smudge filter and returns the
 * payload. Everything here is about telling the two apart, so the viewer can send
 * real media instead of pointer bytes and label a pointer-only change honestly.
 */
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { runGit, runGitBuffer, runGitBufferWithInput, runGitWithInput } from './git.js'

/** First line of every Git LFS v1 pointer file. */
const POINTER_HEADER = 'version https://git-lfs.github.com/spec/v1'
/** The oid line of a pointer file. */
const POINTER_OID = /^oid sha256:([0-9a-f]{64})$/
/** The size line of a pointer file. */
const POINTER_SIZE = /^size (\d+)$/
/** A pointer is a few hundred bytes at most; anything bigger is file content. */
const MAX_POINTER_BYTES = 1024
const POINTER_HEADER_BYTES = Buffer.from(POINTER_HEADER)

/** The object a pointer names, as the pointer records it. */
export interface LfsPointer {
  /** `sha256:<64 hex>` payload id, including the algorithm prefix. */
  oid: string
  /** Payload size in bytes, as the pointer records it. */
  size: number
}

/** One file's pointer before and after a change; a null side is added or deleted. */
export interface LfsChange {
  before: LfsPointer | null
  after: LfsPointer | null
}

/**
 * Parse a complete pointer file.
 * @param text - the whole blob as UTF-8.
 * @returns the pointer, or null when the text is ordinary content.
 */
export function parseLfsPointer(text: string): LfsPointer | null {
  const lines = text.split('\n').map(line => line.replace(/\r$/, ''))
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length !== 3) return null
  if (lines[0] !== POINTER_HEADER) return null
  const oid = POINTER_OID.exec(lines[1] ?? '')
  const size = POINTER_SIZE.exec(lines[2] ?? '')
  if (oid === null || size === null) return null
  const sha = oid[1]
  if (sha === undefined) return null
  const bytes = Number(size[1])
  if (!Number.isSafeInteger(bytes) || bytes < 0) return null
  return { oid: `sha256:${sha}`, size: bytes }
}

/**
 * @param bytes - a blob read from the object store or the working tree.
 * @returns the pointer when these bytes are a pointer rather than payload.
 */
export function pointerFromBytes(bytes: Buffer): LfsPointer | null {
  if (bytes.byteLength > MAX_POINTER_BYTES) return null
  if (bytes.byteLength < POINTER_HEADER_BYTES.byteLength) return null
  if (!bytes.subarray(0, POINTER_HEADER_BYTES.byteLength).equals(POINTER_HEADER_BYTES)) return null
  return parseLfsPointer(bytes.toString('utf8'))
}

/**
 * Read one object with its checkout filters applied, so an LFS payload arrives
 * expanded instead of as its pointer. Resolves the raw blob when the filter is
 * unavailable (git-lfs not installed, or the object is not downloaded), which the
 * caller recognizes with {@link pointerFromBytes}.
 * @param root - repository root to run git in.
 * @param spec - a `rev:path` or `:path` object name.
 * @param signal - aborts the git call.
 */
export async function readFilteredBlob(root: string, spec: string, signal: AbortSignal): Promise<Buffer> {
  try {
    return await runGitBuffer(root, ['cat-file', '--filters', spec], signal)
  } catch {
    return runGitBuffer(root, ['show', spec], signal)
  }
}

/**
 * Read a pointer's payload straight from the repository's local LFS store.
 *
 * `git cat-file --filters` only expands a pointer when the smudge filter and a
 * downloaded object are both available; the object itself usually sits in
 * `.git/lfs/objects/<aa>/<bb>/<sha256>`, which works even without git-lfs on
 * PATH, as long as the payload was fetched at some point.
 * @param root - repository root (also names the common Git dir).
 * @param pointer - the pointer naming the payload.
 * @param signal - aborts the `rev-parse` call.
 * @returns the payload bytes, or null when this checkout does not have them.
 */
export async function readLfsPayload(
  root: string,
  pointer: LfsPointer,
  signal: AbortSignal,
): Promise<Buffer | null> {
  const sha = pointer.oid.startsWith('sha256:') ? pointer.oid.slice('sha256:'.length) : ''
  if (!/^[0-9a-f]{64}$/.test(sha)) return null
  let lfsPath = ''
  try {
    lfsPath = (await runGit(root, ['rev-parse', '--git-path', 'lfs'], signal)).trim()
  } catch {
    return null
  }
  if (lfsPath === '') return null
  const file = join(resolve(root, lfsPath), 'objects', sha.slice(0, 2), sha.slice(2, 4), sha)
  try {
    return await readFile(file)
  } catch {
    return null
  }
}

/**
 * Read a blob with its LFS payload resolved: the checkout filters first, then
 * the local LFS store. Only when both miss does the caller receive the pointer
 * bytes with `pointer` set, so a media diff can say the payload is unavailable.
 * @param root - repository root.
 * @param spec - a `rev:path` or `:path` object name.
 * @param signal - aborts the git calls.
 */
export async function readBlobExpanded(
  root: string,
  spec: string,
  signal: AbortSignal,
): Promise<{ bytes: Buffer; pointer: LfsPointer | null }> {
  const bytes = await readFilteredBlob(root, spec, signal)
  const pointer = pointerFromBytes(bytes)
  if (pointer === null) return { bytes, pointer: null }
  const payload = await readLfsPayload(root, pointer, signal)
  if (payload === null) return { bytes, pointer }
  return { bytes: payload, pointer: null }
}

/**
 * Split combined `git show --patch` output into one section per changed file.
 *
 * `git show --numstat` and `git show --patch` walk the same diff in the same
 * order, so section `i` belongs to changed-file `i`. A truncated patch can end
 * before a later file, which leaves the tail of the list without a section.
 * @param patch - the combined patch.
 */
export function splitPatchSections(patch: string): string[] {
  const sections: string[] = []
  let current: string[] | null = null

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current !== null) sections.push(current.join('\n'))
      current = []
    }
    if (current !== null) current.push(line)
  }
  if (current !== null) sections.push(current.join('\n'))

  return sections.filter(section => section.trim() !== '')
}

/**
 * Find the pointers one patch section rewrites.
 *
 * A change to an LFS file shows the pointer lines as `-`/`+` rows, with the
 * `version` line left as context, so each side is rebuilt from the hunk rows in
 * order before parsing. Sections that are not pointer-only changes parse as
 * ordinary content and return null.
 * @param section - one file's section from {@link splitPatchSections}.
 * @returns the pointers, or null when the section is not a pointer-only change.
 */
export function lfsChangeInSection(section: string): LfsChange | null {
  const before: string[] = []
  const after: string[] = []
  for (const line of section.split('\n')) {
    // File headers (`diff --git`, `index`, `---`, `+++`, modes, renames) are not content.
    if (line.startsWith('diff --git ') || line.startsWith('index ')) continue
    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue
    if (line.startsWith('@@')) continue
    if (line.startsWith('new file mode ') || line.startsWith('deleted file mode ')) continue
    if (line.startsWith('old mode ') || line.startsWith('new mode ')) continue
    if (line.startsWith('similarity index ') || line.startsWith('rename from ') || line.startsWith('rename to ')) continue
    if (line.startsWith('\\')) continue
    if (line.startsWith('+')) after.push(line.slice(1))
    else if (line.startsWith('-')) before.push(line.slice(1))
    else if (line.startsWith(' ')) {
      before.push(line.slice(1))
      after.push(line.slice(1))
    }
  }
  const pointerBefore = parseLfsPointer(before.join('\n'))
  const pointerAfter = parseLfsPointer(after.join('\n'))
  if (pointerBefore === null && pointerAfter === null) return null
  return { before: pointerBefore, after: pointerAfter }
}

/**
 * Which of these paths Git LFS is configured to store, according to the
 * repository's `.gitattributes`. `git status` reports a tracked LFS file's diff
 * as pointer line counts, so the list uses this to label the entry instead.
 * @param root - repository root.
 * @param paths - repository-relative paths, from a status or commit payload.
 * @param signal - aborts the git call.
 * @returns the subset stored through LFS; an attribute failure yields none.
 */
export async function lfsTrackedPaths(
  root: string,
  paths: readonly string[],
  signal: AbortSignal,
): Promise<Set<string>> {
  const tracked = new Set<string>()
  const unique = [...new Set(paths.filter(path => path !== ''))]
  if (unique.length === 0) return tracked
  try {
    // `--stdin` keeps thousands of paths off the command line; with `-z` both
    // the input paths and the output fields are NUL-separated, which survives
    // spaces and line breaks in names.
    const output = await runGitWithInput(
      root,
      ['check-attr', '--stdin', '-z', 'filter'],
      `${unique.join('\0')}\0`,
      signal,
    )
    const parts = output.split('\0')
    for (let index = 0; index + 2 < parts.length; index += 3) {
      const path = parts[index]
      if (path !== undefined && parts[index + 2] === 'lfs') tracked.add(path)
    }
  } catch {
    // Without usable attributes the file keeps its ordinary diff; nothing to label.
  }
  return tracked
}

/** One line describing a pointer change, for prompts that would otherwise see pointer text. */
function lfsPromptNote(lfs: LfsChange): string {
  const side = (pointer: LfsPointer | null): string =>
    pointer === null ? 'none' : `${pointer.oid.slice(0, 19)}… (${pointer.size} bytes)`
  return `[LFS] content is stored in Git LFS; the pointer changed from ${side(lfs.before)} to ${side(lfs.after)}.`
}

/**
 * Blob sizes for several `rev:path` specs, without reading any content.
 * @returns the size in bytes per spec; specs git could not resolve are absent.
 */
async function blobSizes(root: string, specs: readonly string[], signal: AbortSignal): Promise<Map<string, number>> {
  const sizes = new Map<string, number>()
  let output = ''
  try {
    output = await runGitWithInput(root, ['cat-file', '--batch-check'], `${specs.join('\n')}\n`, signal)
  } catch {
    return sizes
  }
  const lines = output.split('\n')
  specs.forEach((spec, index) => {
    // `<oid> blob <size>`; a missing spec answers `<spec> missing`.
    const match = /^\S+ blob (\d+)\r?$/.exec(lines[index] ?? '')
    if (match === null) return
    const size = Number(match[1])
    if (Number.isSafeInteger(size)) sizes.set(spec, size)
  })
  return sizes
}

/**
 * Read several blobs in one `git cat-file --batch` run, so a commit full of
 * small files costs one process instead of one per file.
 * @returns the content per spec; names git could not resolve are absent.
 */
async function readBlobs(root: string, specs: readonly string[], signal: AbortSignal): Promise<Map<string, Buffer>> {
  const blobs = new Map<string, Buffer>()
  if (specs.length === 0) return blobs
  let output: Buffer
  try {
    output = await runGitBufferWithInput(root, ['cat-file', '--batch'], `${specs.join('\n')}\n`, signal)
  } catch {
    return blobs
  }
  let offset = 0
  for (const spec of specs) {
    const headerEnd = output.indexOf(0x0a, offset)
    if (headerEnd < 0) break
    // `<oid> blob <size>`, or `<spec> missing` for an unresolvable name.
    const match = /^\S+ blob (\d+)\r?$/.exec(output.subarray(offset, headerEnd).toString('utf8'))
    if (match === null) {
      offset = headerEnd + 1
      continue
    }
    const size = Number(match[1])
    const start = headerEnd + 1
    if (!Number.isSafeInteger(size) || start + size > output.length) break
    blobs.set(spec, output.subarray(start, start + size))
    // The blob is followed by a newline that git adds after the content.
    offset = start + size + 1
  }
  return blobs
}

/**
 * Find the pointers among several object specs.
 *
 * Only blobs small enough to be a pointer are read, so a commit full of large
 * binaries costs one `--batch-check` call and no payload reads.
 * @param root - repository root.
 * @param specs - `rev:path` object names.
 * @param signal - aborts the git calls.
 * @returns the pointers found, keyed by the spec they were read from.
 */
export async function pointersForSpecs(
  root: string,
  specs: readonly string[],
  signal: AbortSignal,
): Promise<Map<string, LfsPointer>> {
  const pointers = new Map<string, LfsPointer>()
  const unique = [...new Set(specs.filter(spec => spec !== ''))]
  if (unique.length === 0) return pointers
  const sizes = await blobSizes(root, unique, signal)
  const candidates = unique.filter(spec => {
    const size = sizes.get(spec)
    return size !== undefined && size > 0 && size <= MAX_POINTER_BYTES
  })
  const blobs = await readBlobs(root, candidates, signal)
  for (const spec of candidates) {
    const bytes = blobs.get(spec)
    if (bytes === undefined) continue
    const pointer = pointerFromBytes(bytes)
    if (pointer !== null) pointers.set(spec, pointer)
  }
  return pointers
}

/** The `diff --git` line of a section, so an annotated LFS entry still names its file. */
function sectionHeader(section: string): string {
  const first = section.split('\n')[0] ?? ''
  return first.startsWith('diff --git ') ? first : 'diff --git'
}

/**
 * Replace pointer-only diff sections with a one-line LFS description.
 *
 * The AI features read a patch as the change under discussion; three lines of
 * pointer text would invite comments about `oid sha256` instead of the actual
 * edit. Every other section is left byte-for-byte intact.
 * @param patch - a combined patch (`git diff`, `git show --patch`).
 */
export function annotateLfsPatch(patch: string): string {
  const sections = splitPatchSections(patch)
  if (sections.length === 0) return patch
  let annotated = false
  const mapped = sections.map(section => {
    const lfs = lfsChangeInSection(section)
    if (lfs === null) return section
    annotated = true
    return `${sectionHeader(section)}\n${lfsPromptNote(lfs)}\n`
  })
  return annotated ? mapped.join('') : patch
}
