import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const dist = pathToFileURL(join(process.cwd(), 'dist')).href + '/'
const { createBranchActionHandler } = await import(`${dist}branch-action-handler.js`)

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
}

function makeRepo(t, { conflict = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-merge-commit-'))
  t.after(() => {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    } catch {
      // Windows can keep a transient handle after an aborting git process.
    }
  })
  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['config', 'user.email', 'test@example.com'])
  git(root, ['config', 'user.name', 'Test'])
  writeFileSync(join(root, 'base.txt'), 'base\n')
  git(root, ['add', '.'])
  git(root, ['commit', '-q', '-m', 'base'])

  git(root, ['switch', '-q', '-c', 'side'])
  writeFileSync(join(root, conflict ? 'base.txt' : 'side.txt'), 'side\n')
  git(root, ['add', '.'])
  git(root, ['commit', '-q', '-m', 'side'])

  git(root, ['switch', '-q', 'main'])
  if (conflict) writeFileSync(join(root, 'base.txt'), 'main\n')
  else writeFileSync(join(root, 'main.txt'), 'main\n')
  git(root, ['add', '.'])
  git(root, ['commit', '-q', '-m', 'main'])
  return root
}

async function call(handler, root, body) {
  const server = http.createServer((req, res) => { void handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, {
      method: 'POST',
      headers: { 'x-dsh-git-suite': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ path: root, ...body }),
    })
    return { status: response.status, payload: await response.json() }
  } finally {
    server.closeAllConnections()
    server.close()
  }
}

function head(root) {
  return git(root, ['rev-parse', 'HEAD']).trim()
}

function hasMergeHead(root) {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'])
    return true
  } catch {
    return false
  }
}

test('merge commit target with --no-ff and a custom message', async t => {
  const root = makeRepo(t)
  const target = git(root, ['rev-parse', 'side']).trim()
  const result = await call(createBranchActionHandler({ workspaces: () => [], defaultPath: () => root }), root, {
    action: 'merge',
    target,
    noFf: true,
    message: 'Merge side',
  })
  assert.equal(result.status, 200)
  assert.equal(result.payload.branch, 'main')
  assert.equal(result.payload.target, target)
  assert.equal(result.payload.noFf, true)
  assert.equal(result.payload.stopped, false)
  assert.equal(git(root, ['show', '-s', '--format=%P', 'HEAD']).trim().split(/\s+/).length, 2)
  assert.equal(git(root, ['show', '-s', '--format=%s', 'HEAD']).trim(), 'Merge side')
})

test('default mode fast-forwards when possible', async t => {
  const root = makeRepo(t)
  git(root, ['reset', '-q', '--hard', 'HEAD~1'])
  const target = git(root, ['rev-parse', 'side']).trim()
  const result = await call(createBranchActionHandler({ workspaces: () => [], defaultPath: () => root }), root, {
    action: 'merge',
    target,
  })
  assert.equal(result.status, 200)
  assert.equal(head(root), target)
  assert.equal(git(root, ['show', '-s', '--format=%P', 'HEAD']).trim().split(/\s+/).length, 1)
})

test('--ff-only refuses a diverged branch without starting a merge', async t => {
  const root = makeRepo(t)
  const before = head(root)
  const target = git(root, ['rev-parse', 'side']).trim()
  const result = await call(createBranchActionHandler({ workspaces: () => [], defaultPath: () => root }), root, {
    action: 'merge',
    target,
    ffOnly: true,
  })
  assert.equal(result.status, 409)
  assert.equal(result.payload.error.code, 'not-fast-forwardable')
  assert.equal(head(root), before)
  assert.equal(hasMergeHead(root), false)
})

test('--squash stages the result without committing', async t => {
  const root = makeRepo(t)
  const before = head(root)
  const target = git(root, ['rev-parse', 'side']).trim()
  const result = await call(createBranchActionHandler({ workspaces: () => [], defaultPath: () => root }), root, {
    action: 'merge',
    target,
    squash: true,
  })
  assert.equal(result.status, 200)
  assert.equal(result.payload.squash, true)
  assert.equal(result.payload.stopped, true)
  assert.equal(head(root), before)
  assert.match(git(root, ['status', '--porcelain']), /^A {2}side\.txt$/m)
  assert.equal(hasMergeHead(root), false)
})

test('--no-commit prepares the merge and leaves it running', async t => {
  const root = makeRepo(t)
  const target = git(root, ['rev-parse', 'side']).trim()
  const result = await call(createBranchActionHandler({ workspaces: () => [], defaultPath: () => root }), root, {
    action: 'merge',
    target,
    noCommit: true,
  })
  assert.equal(result.status, 200)
  assert.equal(result.payload.noFf, true)
  assert.equal(result.payload.stopped, true)
  assert.equal(hasMergeHead(root), true)
  git(root, ['merge', '--abort'])
})

test('a conflicted merge reports operation-conflict and can be aborted', async t => {
  const root = makeRepo(t, { conflict: true })
  const target = git(root, ['rev-parse', 'side']).trim()
  const result = await call(createBranchActionHandler({ workspaces: () => [], defaultPath: () => root }), root, {
    action: 'merge',
    target,
  })
  assert.equal(result.status, 409)
  assert.equal(result.payload.error.code, 'operation-conflict')
  assert.equal(result.payload.error.details.operation, 'merge')
  assert.equal(hasMergeHead(root), true)
  git(root, ['merge', '--abort'])
})

test('unrelated histories need the explicit option', async t => {
  const root = makeRepo(t)
  git(root, ['switch', '-q', '--orphan', 'unrelated'])
  git(root, ['clean', '-fdx'])
  writeFileSync(join(root, 'other.txt'), 'other\n')
  git(root, ['add', '.'])
  git(root, ['commit', '-q', '-m', 'other root'])
  const target = git(root, ['rev-parse', 'unrelated']).trim()
  git(root, ['switch', '-q', 'main'])

  const handler = createBranchActionHandler({ workspaces: () => [], defaultPath: () => root })
  const refused = await call(handler, root, { action: 'merge', target, noFf: true })
  assert.equal(refused.status, 409)
  assert.equal(refused.payload.error.code, 'unrelated-histories')
  assert.equal(hasMergeHead(root), false)

  const allowed = await call(handler, root, { action: 'merge', target, noFf: true, allowUnrelated: true })
  assert.equal(allowed.status, 200)
  assert.equal(git(root, ['show', '-s', '--format=%P', 'HEAD']).trim().split(/\s+/).length, 2)
})

test('a merge message implies --no-ff even when a fast-forward is possible', async t => {
  const root = makeRepo(t)
  git(root, ['reset', '-q', '--hard', 'HEAD~1'])
  const target = git(root, ['rev-parse', 'side']).trim()
  const result = await call(createBranchActionHandler({ workspaces: () => [], defaultPath: () => root }), root, {
    action: 'merge',
    target,
    message: 'Keep a merge commit',
  })
  assert.equal(result.status, 200)
  assert.equal(result.payload.noFf, true)
  assert.equal(git(root, ['show', '-s', '--format=%P', 'HEAD']).trim().split(/\s+/).length, 2)
  assert.equal(git(root, ['show', '-s', '--format=%s', 'HEAD']).trim(), 'Keep a merge commit')
})

test('--squash conflicts are reported without a merge operation', async t => {
  const root = makeRepo(t, { conflict: true })
  const target = git(root, ['rev-parse', 'side']).trim()
  const result = await call(createBranchActionHandler({ workspaces: () => [], defaultPath: () => root }), root, {
    action: 'merge',
    target,
    squash: true,
  })
  assert.equal(result.status, 409)
  assert.equal(result.payload.error.code, 'merge-conflict')
  assert.equal(hasMergeHead(root), false)
  assert.notEqual(git(root, ['ls-files', '-u']).trim(), '')
})

test('incompatible merge options are rejected before git runs', async t => {
  const root = makeRepo(t)
  const target = git(root, ['rev-parse', 'side']).trim()
  const before = head(root)
  const result = await call(createBranchActionHandler({ workspaces: () => [], defaultPath: () => root }), root, {
    action: 'merge',
    target,
    noFf: true,
    ffOnly: true,
  })
  assert.equal(result.status, 400)
  assert.equal(result.payload.error.code, 'invalid-merge-options')
  assert.equal(head(root), before)
})
