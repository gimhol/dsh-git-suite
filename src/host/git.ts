import { execFile, spawn } from 'node:child_process'
import { RouteError } from './errors.js'

const GIT_TIMEOUT_MS = 60_000
const GIT_MAX_BUFFER = 64 * 1024 * 1024

/** The Node `execFile` error, which carries the captured streams we report on failure. */
export interface GitExecError extends Error {
  code?: string | number
  stdout?: string | Buffer
  stderr?: string | Buffer
}

function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_PAGER: 'cat',
  }
}

/** Run one git command in `cwd` and resolve with its UTF-8 stdout. */
export function runGit(cwd: string, args: readonly string[], signal?: AbortSignal, timeoutMs = GIT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['--no-pager', '-c', 'core.quotepath=false', '-C', cwd, ...args],
      {
        cwd,
        env: gitEnvironment(),
        encoding: 'utf8',
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: GIT_MAX_BUFFER,
        signal,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout)
          return
        }
        const failure = error as GitExecError
        failure.stdout = stdout
        failure.stderr = stderr
        reject(failure)
      },
    )
  })
}

/** Run one git command in `cwd` and resolve with its raw stdout, for binary blobs. */
export function runGitBuffer(cwd: string, args: readonly string[], signal?: AbortSignal, timeoutMs = GIT_TIMEOUT_MS): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['--no-pager', '-c', 'core.quotepath=false', '-C', cwd, ...args],
      {
        cwd,
        env: gitEnvironment(),
        encoding: 'buffer',
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: GIT_MAX_BUFFER,
        signal,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout)
          return
        }
        const failure = error as GitExecError
        failure.stdout = stdout
        failure.stderr = stderr
        reject(failure)
      },
    )
  })
}

/**
 * Run one git command with text on stdin and raw stdout, for bulk object reads
 * such as `git cat-file --batch`, where the reply interleaves headers and blobs.
 */
export function runGitBufferWithInput(
  cwd: string,
  args: readonly string[],
  input: string,
  signal?: AbortSignal,
  timeoutMs = GIT_TIMEOUT_MS,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['--no-pager', '-c', 'core.quotepath=false', '-C', cwd, ...args], {
      cwd,
      env: gitEnvironment(),
      windowsHide: true,
      signal,
    })
    const chunks: Buffer[] = []
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(Object.assign(new Error('git timed out'), { code: 'ETIMEDOUT', stderr }))
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', error => {
      clearTimeout(timer)
      reject(Object.assign(error, { stderr }))
    })
    child.on('close', code => {
      clearTimeout(timer)
      const stdout = Buffer.concat(chunks)
      if (code === 0) resolve(stdout)
      else reject(Object.assign(new Error('git failed'), { code: code ?? 1, stdout, stderr }))
    })
    child.stdin.end(input)
  })
}

/** Map a raw git failure onto the route's user-facing error vocabulary. */
export function gitFailure(error: unknown): RouteError {
  const failed = (error ?? {}) as GitExecError
  const stderr = String(failed.stderr ?? '').trim()
  const detail = stderr.slice(0, 1200) || String(failed.message ?? 'Git failed')

  if (/could not read (Username|Password)|terminal prompts disabled|Authentication failed|Invalid username or password|401 Unauthorized|remote: (Invalid|Bad) credentials/i.test(stderr)) {
    return new RouteError(401, 'auth-required', 'This remote needs credentials.', { detail, scheme: 'https' })
  }
  if (/Permission denied \(publickey\)|Host key verification failed/i.test(stderr)) {
    return new RouteError(401, 'auth-required', 'SSH authentication failed for this remote.', { detail, scheme: 'ssh' })
  }
  if (failed.code === 'ENOENT') {
    return new RouteError(500, 'git-missing', 'Git is not installed or is not available on PATH.', { detail })
  }
  if (/not a git repository/i.test(stderr)) {
    return new RouteError(400, 'not-a-repo', 'This directory is not inside a Git repository.', { detail })
  }
  if (/does not have any commits yet|has no commits yet/i.test(stderr)) {
    return new RouteError(400, 'empty-repo', 'This repository does not have any commits yet.', { detail })
  }
  // Git LFS failures (missing git-lfs, a missing object, a quota error, or a
  // remote rejecting LFS uploads) otherwise arrive as a wall of filter output.
  if (/smudge filter|external filter '[^']*lfs|git-lfs|Error downloading object|Smudge error|batch response|data quota|LFS pointer|missing LFS object|GH008/i.test(stderr)) {
    return new RouteError(409, 'lfs-failed', 'Git LFS could not complete this operation: check that git-lfs is installed and set up in this repository (git lfs install), its objects are downloaded, and the remote accepts LFS uploads.', { detail })
  }
  if (/bad revision|unknown revision|ambiguous argument/i.test(stderr)) {
    return new RouteError(400, 'bad-commit', 'That commit could not be resolved in this repository.', { detail })
  }
  if (failed.code === 'ABORT_ERR') {
    return new RouteError(499, 'cancelled', 'The request was cancelled.', { detail })
  }
  if (failed.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return new RouteError(500, 'git-output-too-large', 'Git produced more output than the viewer can read.', { detail })
  }
  return new RouteError(500, 'git-failed', detail, { detail })
}

/** Run one git command with text on stdin (used for `git credential approve`). */export function runGitWithInput(
  cwd: string,
  args: readonly string[],
  input: string,
  signal?: AbortSignal,
  timeoutMs = GIT_TIMEOUT_MS,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['--no-pager', '-c', 'core.quotepath=false', '-C', cwd, ...args], {
      cwd,
      env: { ...gitEnvironment(), ...extraEnv },
      windowsHide: true,
      signal,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(Object.assign(new Error('git timed out'), { code: 'ETIMEDOUT', stderr }))
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', error => {
      clearTimeout(timer)
      reject(Object.assign(error, { stderr }))
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(Object.assign(new Error('git failed'), { code: code ?? 1, stdout, stderr }))
    })
    child.stdin.end(input)
  })
}

