import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const dist = pathToFileURL(join(process.cwd(), 'dist')).href + '/'
const { compareVersions, installedVersion } = await import(`${dist}routes/version.js`)

test('orders release versions', () => {
  assert.ok(compareVersions('1.6.0', '1.5.0') > 0)
  assert.ok(compareVersions('1.5.0', '1.6.0') < 0)
  assert.equal(compareVersions('1.6.0', '1.6.0'), 0)
  assert.ok(compareVersions('1.6.1', '1.6.0') > 0)
  assert.ok(compareVersions('2.0.0', '1.99.99') > 0)
  assert.ok(compareVersions('1.6.0', '1.6.0-beta.1') > 0)
  assert.ok(compareVersions('1.6.0-beta.2', '1.6.0-beta.1') > 0)
})

test('reads the installed version on every call, not once per process', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-version-'))
  const manifest = join(dir, 'package.json')
  try {
    writeFileSync(manifest, JSON.stringify({ version: '1.5.0' }))
    const url = pathToFileURL(manifest)
    assert.equal(await installedVersion(url), '1.5.0')
    // A link install rebuilt to a new version has to be visible right away;
    // caching this value made the panel claim an update it already contained.
    writeFileSync(manifest, JSON.stringify({ version: '1.6.0' }))
    assert.equal(await installedVersion(url), '1.6.0')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('falls back to 0.0.0 for an unreadable manifest', async () => {
  const missing = pathToFileURL(join(tmpdir(), 'dsh-version-missing', 'package.json'))
  assert.equal(await installedVersion(missing), '0.0.0')
})
