import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'

/**
 * Electron switches that must not reach a launched application. Its Node-mode
 * child processes (the plugin host is one of them) carry
 * `ELECTRON_RUN_AS_NODE=1`, and an Electron-based editor that inherits it starts
 * as a plain Node process instead of opening a window, so the button looks dead.
 */
const STRIPPED_SWITCHES = [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ELECTRON_NO_ASAR',
  'ELECTRON_ENABLE_LOGGING',
  'ELECTRON_ENABLE_STACK_DUMPING',
  'ELECTRON_DEFAULT_ERROR_MODE',
  'ELECTRON_FORCE_IS_PACKAGED',
]

/** The environment for a launched application: the host's, without its own switches. */
export function launchEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = { ...environment }
  for (const name of STRIPPED_SWITCHES) delete copy[name]
  return copy
}

/** How a detached launch ended, as far as the host can tell. */
export interface LaunchOutcome {
  ok: boolean
  /** Why the process could not be created: `ENOENT`, `EACCES`, `EPERM`, … */
  spawnCode?: string
  /** The process started and exited with this non-zero code before it was left alone. */
  exitCode?: number
}

export interface DetachedOptions {
  cwd: string
  /**
   * Hide the process' first window. Leave `false` for GUI programs: `SW_HIDE`
   * suppresses the window they create, so the application runs invisibly.
   */
  windowsHide: boolean
  /**
   * Count a non-zero exit as a failed launch. `explorer.exe` reports a non-zero
   * exit even when it opened the folder, so that caller turns this off.
   */
  verifyExit?: boolean
  /** How long the process must survive before it counts as started. */
  settleMs?: number
}

export type Spawner = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess

const SETTLE_MS = 1200

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'unknown'
}

/**
 * Wait until the launch is known to have worked or failed. A GUI application
 * either keeps running or hands the request to an instance that is already
 * running and exits `0`; both count as started.
 */
function settle(child: ChildProcess, verifyExit: boolean, settleMs: number): Promise<LaunchOutcome> {
  return new Promise(resolve => {
    let timer: NodeJS.Timeout | undefined
    const finish = (outcome: LaunchOutcome): void => {
      if (timer !== undefined) clearTimeout(timer)
      child.off('error', onError)
      child.off('exit', onExit)
      resolve(outcome)
    }
    const onError = (error: Error): void => {
      finish({ ok: false, spawnCode: errorCode(error) })
    }
    const onExit = (code: number | null): void => {
      if (!verifyExit || code === null || code === 0) finish({ ok: true })
      else finish({ ok: false, exitCode: code })
    }
    child.once('error', onError)
    child.once('exit', onExit)
    // A child that survives the settle window has opened its own window.
    timer = setTimeout(() => {
      finish(child.pid === undefined ? { ok: false, spawnCode: 'unknown' } : { ok: true })
    }, settleMs)
  })
}

/**
 * Start a detached process the host does not wait for and report whether it
 * actually ran. Failures are returned instead of thrown so the caller can tell
 * the panel why nothing opened.
 */
export async function spawnDetached(
  command: string,
  args: readonly string[],
  options: DetachedOptions,
  spawner: Spawner = spawn,
): Promise<LaunchOutcome> {
  let child: ChildProcess
  try {
    child = spawner(command, args, {
      cwd: options.cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: options.windowsHide,
      env: launchEnvironment(),
    })
  } catch (error) {
    return { ok: false, spawnCode: errorCode(error) }
  }
  const outcome = await settle(child, options.verifyExit !== false, options.settleMs ?? SETTLE_MS)
  child.unref()
  return outcome
}
