import { readFile, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { gitFailure, runGit } from '../git.js'
import { lfsTrackedPaths } from '../lfs.js'
import { parseNumstat, parseWorkspaceStatus } from '../parsers.js'
import { resolveRepository } from '../repository.js'
import type { CommitFile, RouteContext, WorkspaceFile, WorkspaceStatus } from '../types.js'

const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024

/** Keep staged/unstaged numstat rows addressable by path. */
function byPath(files: readonly CommitFile[]): Map<string, CommitFile> {
  const map = new Map<string, CommitFile>()
  for (const file of files) map.set(file.path, file)
  return map
}

async function config(root: string, key: string, signal: AbortSignal): Promise<string> {
  try {
    return (await runGit(root, ['config', '--get', key], signal)).trim()
  } catch {
    return ''
  }
}

/** Untracked files have no numstat row; count their lines (bounded) for the +N column. */
async function untrackedStats(root: string, path: string): Promise<{ additions: number | null; binary: boolean }> {
  const absolute = resolve(root, path)
  if (absolute !== root && !absolute.startsWith(root + sep)) return { additions: null, binary: true }
  try {
    const info = await stat(absolute)
    if (!info.isFile() || info.size > MAX_UNTRACKED_BYTES) return { additions: null, binary: true }
    const content = await readFile(absolute)
    if (content.includes(0)) return { additions: null, binary: true }
    const text = content.toString('utf8')
    if (text === '') return { additions: 0, binary: false }
    const lines = text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length
    return { additions: lines, binary: false }
  } catch {
    return { additions: null, binary: true }
  }
}

/** Read staged/unstaged working-tree changes plus the commit author and upstream info. */
export async function readWorkspaceStatus(
  context: RouteContext,
  url: URL,
  signal: AbortSignal,
): Promise<{ ok: true; workspace: WorkspaceStatus }> {
  const repo = await resolveRepository(context, url.searchParams.get('path'), signal)
  try {
    const [statusOutput, stagedOutput, unstagedOutput, name, email] = await Promise.all([
      runGit(repo.root, ['status', '--porcelain=v2', '-z', '--branch', '-uall'], signal),
      runGit(repo.root, ['diff', '--cached', '--numstat', '--find-renames', '--no-color', '--no-ext-diff'], signal),
      runGit(repo.root, ['diff', '--numstat', '--find-renames', '--no-color', '--no-ext-diff'], signal),
      config(repo.root, 'user.name', signal),
      config(repo.root, 'user.email', signal),
    ])
    const parsed = parseWorkspaceStatus(statusOutput)
    const stagedMap = byPath(parseNumstat(stagedOutput))
    const unstagedMap = byPath(parseNumstat(unstagedOutput))
    // An LFS-tracked file's numstat counts pointer lines, so the list labels it
    // instead of showing a misleading +2/-2.
    const tracked = await lfsTrackedPaths(repo.root, parsed.entries.map(entry => entry.path), signal)
    const staged: WorkspaceFile[] = []
    const unstaged: WorkspaceFile[] = []

    for (const entry of parsed.entries) {
      const base = {
        path: entry.path,
        ...(entry.origPath === null ? {} : { origPath: entry.origPath }),
        ...(tracked.has(entry.path) ? { lfs: true } : {}),
      }
      // Unmerged paths only belong to the unstaged list: their index entry is a
      // conflict marker, not a staged change.
      if (entry.index !== '.' && !entry.untracked && !entry.unmerged) {
        const stat = stagedMap.get(entry.path)
        staged.push({
          ...base,
          status: entry.index,
          staged: true,
          untracked: false,
          unmerged: false,
          additions: stat?.additions ?? null,
          deletions: stat?.deletions ?? null,
          binary: stat?.binary ?? false,
        })
      }
      if (entry.untracked || entry.worktree !== '.' || entry.unmerged) {
        const stat = unstagedMap.get(entry.path)
        const untracked = entry.untracked ? await untrackedStats(repo.root, entry.path) : null
        unstaged.push({
          ...base,
          status: entry.untracked ? 'U' : entry.unmerged ? 'U' : entry.worktree,
          staged: false,
          untracked: entry.untracked,
          unmerged: entry.unmerged,
          additions: untracked === null ? stat?.additions ?? null : untracked.additions,
          deletions: untracked === null ? stat?.deletions ?? null : 0,
          binary: untracked === null ? stat?.binary ?? false : untracked.binary,
        })
      }
    }

    staged.sort((left, right) => left.path.localeCompare(right.path))
    unstaged.sort((left, right) => left.path.localeCompare(right.path))
    return {
      ok: true,
      workspace: {
        repoRoot: repo.root,
        branch: parsed.branch,
        upstream: parsed.upstream,
        ahead: parsed.ahead,
        behind: parsed.behind,
        author: { name, email },
        staged,
        unstaged,
      },
    }
  } catch (error) {
    throw gitFailure(error)
  }
}

