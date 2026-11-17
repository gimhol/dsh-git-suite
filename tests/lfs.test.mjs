import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const dist = pathToFileURL(join(process.cwd(), 'dist')).href + '/'
const {
  annotateLfsPatch,
  lfsChangeInSection,
  lfsTrackedPaths,
  parseLfsPointer,
  pointerFromBytes,
  pointersForSpecs,
  splitPatchSections,
} = await import(`${dist}lfs.js`)

const OLD_OID = 'c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77'
const NEW_OID = '772fdf20cbeed2ea74ad3c113398f4a26795b98318795d07f9bc31c49a06ef3c'

const OLD_POINTER = [
  'version https://git-lfs.github.com/spec/v1',
  `oid sha256:${OLD_OID}`,
  'size 70',
  '',
].join('\n')

const NEW_POINTER = [
  'version https://git-lfs.github.com/spec/v1',
  `oid sha256:${NEW_OID}`,
  'size 78',
  '',
].join('\n')

/** A `git diff` section for an LFS file: the version line stays context. */
const MODIFIED_SECTION = [
  'diff --git a/pic.png b/pic.png',
  'index 62a5532..ff519fc 100644',
  '--- a/pic.png',
  '+++ b/pic.png',
  '@@ -1,3 +1,3 @@',
  ' version https://git-lfs.github.com/spec/v1',
  `-oid sha256:${OLD_OID}`,
  '-size 70',
  `+oid sha256:${NEW_OID}`,
  '+size 78',
  '',
].join('\n')

/** The same pointer arriving as a new file: every line is an addition. */
const ADDED_SECTION = [
  'diff --git a/pic.png b/pic.png',
  'new file mode 100644',
  'index 0000000..0010380',
  '--- /dev/null',
  '+++ b/pic.png',
  '@@ -0,0 +1,3 @@',
  '+version https://git-lfs.github.com/spec/v1',
  `+oid sha256:${NEW_OID}`,  '+size 78',
  '',
].join('\n')

test('parses a complete pointer file', () => {
  assert.deepEqual(parseLfsPointer(OLD_POINTER), { oid: `sha256:${OLD_OID}`, size: 70 })
  assert.deepEqual(parseLfsPointer(OLD_POINTER.trimEnd()), { oid: `sha256:${OLD_OID}`, size: 70 })
})

test('rejects anything that is not a pointer file', () => {
  assert.equal(parseLfsPointer(''), null)
  assert.equal(parseLfsPointer('hello\n'), null)
  assert.equal(parseLfsPointer(OLD_POINTER.replace('size 70', 'size 7O')), null)
  assert.equal(parseLfsPointer(OLD_POINTER.replace(/[0-9a-f]{64}/, 'abc')), null)
  // A pointer plus trailing content is not a pointer.
  assert.equal(parseLfsPointer(`${OLD_POINTER}extra\n`), null)
})

test('recognizes pointer bytes and ignores payload bytes', () => {
  assert.deepEqual(pointerFromBytes(Buffer.from(OLD_POINTER)), { oid: `sha256:${OLD_OID}`, size: 70 })
  // A real PNG is far longer and has no pointer header.
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(2048)])
  assert.equal(pointerFromBytes(png), null)
  assert.equal(pointerFromBytes(Buffer.from('version https://git-lfs.github.com/spec/v1\n')), null)
})

test('splits a combined patch into one section per file', () => {
  const combined = `${MODIFIED_SECTION}diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n`
  const sections = splitPatchSections(combined)
  assert.equal(sections.length, 2)
  assert.ok(sections[0]?.startsWith('diff --git a/pic.png'))
  assert.ok(sections[1]?.includes('README.md'))
})

test('finds both pointers of a modified LFS file', () => {
  assert.deepEqual(lfsChangeInSection(MODIFIED_SECTION), {
    before: { oid: `sha256:${OLD_OID}`, size: 70 },
    after: { oid: `sha256:${NEW_OID}`, size: 78 },
  })
})

test('finds the one pointer of an added LFS file', () => {
  assert.deepEqual(lfsChangeInSection(ADDED_SECTION), {
    before: null,
    after: { oid: `sha256:${NEW_OID}`, size: 78 },
  })
})

test('leaves ordinary text diffs alone', () => {
  const section = [
    'diff --git a/README.md b/README.md',
    'index 1234567..89abcde 100644',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1,2 +1,2 @@',
    ' title',
    '-old line',
    '+new line',
    ' tail',
    '',
  ].join('\n')
  assert.equal(lfsChangeInSection(section), null)
})

test('replaces a pointer section with an LFS description', () => {
  const annotated = annotateLfsPatch(MODIFIED_SECTION)
  assert.ok(annotated.includes('diff --git a/pic.png b/pic.png'))
  assert.ok(annotated.includes('[LFS]'))
  assert.ok(annotated.includes('sha256:c414cd0e204d'))
  assert.ok(annotated.includes('70 bytes'))
  assert.ok(!annotated.includes('-oid sha256'))
  assert.ok(!annotated.includes('+size'))
})

test('keeps ordinary sections byte-for-byte', () => {
  const text = [
    'diff --git a/README.md b/README.md',
    'index 1234567..89abcde 100644',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    '',
  ].join('\n')
  assert.equal(annotateLfsPatch(text), text)
  const mixed = annotateLfsPatch(MODIFIED_SECTION + text)
  assert.ok(mixed.includes('[LFS]'))
  assert.ok(mixed.includes('-old\n+new'))
})

test('maps an LFS failure to its own error code', async () => {
  const { gitFailure } = await import(`${dist}git.js`)
  const failure = gitFailure({
    stderr: "error: external filter 'git-lfs smudge -- pic.png' failed\nSmudge error: Error downloading object",
  })
  assert.equal(failure.code, 'lfs-failed')
  assert.equal(failure.status, 409)
  assert.match(failure.message, /Git LFS/)
  // An ordinary git failure keeps its generic mapping.
  assert.equal(gitFailure({ stderr: 'fatal: not a git repository' }).code, 'not-a-repo')
})

test('reads pointers and LFS attributes from a real repository', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-lfs-'))
  const pointer = NEW_POINTER
  const lfsArgs = ['-c', 'filter.lfs.clean=cat', '-c', 'filter.lfs.smudge=cat', '-c', 'filter.lfs.required=false']
  try {
    execFileSync('git', ['init', '-q', '-b', 'main', root], { encoding: 'utf8' })
    execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8' })
    execFileSync('git', ['-C', root, 'config', 'user.name', 'Test'], { encoding: 'utf8' })
    // Tracking is declared but the filter is a no-op, so the pointer text is
    // stored verbatim and the test needs no git-lfs binary or network.
    writeFileSync(join(root, '.gitattributes'), '*.png filter=lfs diff=lfs merge=lfs -text\n')
    writeFileSync(join(root, 'pic.png'), pointer)
    writeFileSync(join(root, 'readme.md'), 'hello\n')
    execFileSync('git', [...lfsArgs, '-C', root, 'add', '-A'], { encoding: 'utf8' })
    execFileSync('git', [...lfsArgs, '-C', root, 'commit', '-qm', 'add'], { encoding: 'utf8' })

    const tracked = await lfsTrackedPaths(root, ['pic.png', 'readme.md'], AbortSignal.timeout(5000))
    assert.ok(tracked.has('pic.png'))
    assert.ok(!tracked.has('readme.md'))

    const pointers = await pointersForSpecs(
      root,
      ['HEAD:pic.png', 'HEAD:readme.md', 'HEAD:missing.png'],
      AbortSignal.timeout(5000),
    )
    assert.deepEqual(pointers.get('HEAD:pic.png'), { oid: `sha256:${NEW_OID}`, size: 78 })
    assert.equal(pointers.get('HEAD:readme.md'), undefined)
    assert.equal(pointers.get('HEAD:missing.png'), undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
