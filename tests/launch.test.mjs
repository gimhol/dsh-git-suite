import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const dist = pathToFileURL(join(process.cwd(), 'dist')).href + '/'
const { launchEnvironment, spawnDetached } = await import(`${dist}launch.js`)

test('the launch environment drops the Electron switches the host runs under', () => {
  const environment = launchEnvironment({
    PATH: 'C:\\bin',
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
    GIT_SUITE_KEEP: 'yes',
  })
  assert.deepEqual(environment, { PATH: 'C:\\bin', GIT_SUITE_KEEP: 'yes' })
})

test('a process that cannot be created reports its spawn code', async () => {
  const spawner = () => {
    const child = new EventEmitter()
    child.pid = undefined
    child.unref = () => {}
    setImmediate(() => {
      child.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' }))
    })
    return child
  }
  const outcome = await spawnDetached('missing-editor', [], { cwd: process.cwd(), windowsHide: false }, spawner)
  assert.deepEqual(outcome, { ok: false, spawnCode: 'ENOENT' })
})

test('a process that exits non-zero is a failed launch', async () => {
  const outcome = await spawnDetached(process.execPath, ['-e', 'process.exit(3)'], {
    cwd: process.cwd(),
    windowsHide: true,
    settleMs: 10_000,
  })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.exitCode, 3)
})

test('a zero exit is a handoff to an instance that was already running', async () => {
  const outcome = await spawnDetached(process.execPath, ['-e', 'process.exit(0)'], {
    cwd: process.cwd(),
    windowsHide: true,
    settleMs: 10_000,
  })
  assert.deepEqual(outcome, { ok: true })
})

test('a process that keeps running counts as a started application', async () => {
  const outcome = await spawnDetached(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], {
    cwd: process.cwd(),
    windowsHide: true,
    settleMs: 500,
  })
  assert.deepEqual(outcome, { ok: true })
})

test('a launcher whose exit code is not trusted still counts as started', async () => {
  const outcome = await spawnDetached(process.execPath, ['-e', 'process.exit(1)'], {
    cwd: process.cwd(),
    windowsHide: true,
    settleMs: 10_000,
    verifyExit: false,
  })
  assert.deepEqual(outcome, { ok: true })
})
