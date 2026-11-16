import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnDetached } from './launch.js'
import { readRegistryIndex, type RegistryIndex, type UninstallRecord } from './registry.js'

/** One external editor the panel can open a repository in. */
export interface EditorDefinition {
  id: string
  /** Product name; not localized. */
  name: string
  /** macOS app bundle names, checked under `/Applications` and `~/Applications`. */
  macAppNames?: string[]
  /** Windows `App Paths` executable names (lower-case match). */
  winAppPaths?: string[]
  /** Windows uninstall entries: display-name pattern and the exe under the install root. */
  winUninstalls?: Array<{ pattern: RegExp; exe: readonly string[] }>
  /** Extra Windows candidates (vendor keys, Toolbox, standard install dirs). */
  winCandidates?: (registry: RegistryIndex) => string[]
  /** Linux absolute paths checked before `PATH` (snap, /opt, Toolbox). */
  linuxPaths?: string[]
  /** Linux commands looked up on `PATH`. */
  linuxCommands?: string[]
}

function env(name: string): string {
  return process.env[name] ?? ''
}

function winRoots(): string[] {
  return [env('LOCALAPPDATA'), env('ProgramFiles'), env('ProgramFiles(x86)')].filter(root => root !== '')
}

function underWin(parts: string[]): string[] {
  return winRoots().map(root => join(root, ...parts))
}

function scanDirs(root: string, depth: number): string[] {
  if (depth <= 0) return []
  let entries: string[] = []
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    const full = join(root, entry)
    try {
      if (!statSync(full).isDirectory()) continue
    } catch {
      continue
    }
    out.push(full, ...scanDirs(full, depth - 1))
  }
  return out
}

function jetBrainsWinCandidates(folder: RegExp, exe: string): string[] {
  const roots = [join(env('LOCALAPPDATA'), 'JetBrains', 'Toolbox', 'apps'), join(env('ProgramFiles'), 'JetBrains')]
    .filter(root => root !== '')
  const candidates: string[] = []
  for (const root of roots) {
    for (const dir of scanDirs(root, 3)) {
      const name = dir.split(/[\\/]/).pop() ?? ''
      if (!folder.test(name)) continue
      candidates.push(join(dir, 'bin', exe), join(dir, 'bin', exe.replace('64', '')))
    }
  }
  return candidates
}

/** `Program Files\Microsoft Visual Studio\<year>\<edition>\Common7\IDE\devenv.exe`. */
function visualStudioScans(): string[] {
  const candidates: string[] = []
  for (const root of [env('ProgramFiles'), env('ProgramFiles(x86)')].filter(item => item !== '')) {
    const base = join(root, 'Microsoft Visual Studio')
    for (const year of scanDirs(base, 1)) {
      for (const edition of scanDirs(year, 1)) candidates.push(join(edition, 'Common7', 'IDE', 'devenv.exe'))
    }
  }
  return candidates
}

/** Editors in priority order: the first available one backs the toolbar button. */
export const EDITORS: readonly EditorDefinition[] = [
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    macAppNames: ['Visual Studio Code.app'],
    winAppPaths: ['Code.exe'],
    winUninstalls: [{ pattern: /^Microsoft Visual Studio Code$/i, exe: ['Code.exe'] }],
    winCandidates: () => [
      ...underWin(['Programs', 'Microsoft VS Code', 'Code.exe']),
      ...underWin(['Microsoft VS Code', 'Code.exe']),
    ],
    linuxCommands: ['code'],
  },
  {
    id: 'vscode-insiders',
    name: 'Visual Studio Code Insiders',
    macAppNames: ['Visual Studio Code - Insiders.app'],
    winAppPaths: ['Code - Insiders.exe'],
    winUninstalls: [{ pattern: /Visual Studio Code - Insiders/i, exe: ['Code - Insiders.exe'] }],
    winCandidates: () => [
      ...underWin(['Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe']),
      ...underWin(['Microsoft VS Code Insiders', 'Code - Insiders.exe']),
    ],
    linuxCommands: ['code-insiders'],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    macAppNames: ['Cursor.app'],
    winAppPaths: ['Cursor.exe'],
    winUninstalls: [{ pattern: /^Cursor$/i, exe: ['Cursor.exe'] }],
    winCandidates: () => [...underWin(['Programs', 'cursor', 'Cursor.exe']), ...underWin(['Cursor', 'Cursor.exe'])],
    linuxCommands: ['cursor'],
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    macAppNames: ['Windsurf.app'],
    winAppPaths: ['Windsurf.exe'],
    winUninstalls: [{ pattern: /^Windsurf$/i, exe: ['Windsurf.exe'] }],
    winCandidates: () => [...underWin(['Programs', 'Windsurf', 'Windsurf.exe'])],
    linuxCommands: ['windsurf'],
  },
  {
    id: 'vscodium',
    name: 'VSCodium',
    macAppNames: ['VSCodium.app'],
    winAppPaths: ['VSCodium.exe'],
    winUninstalls: [{ pattern: /^VSCodium/i, exe: ['VSCodium.exe'] }],
    winCandidates: () => [...underWin(['Programs', 'VSCodium', 'VSCodium.exe']), ...underWin(['VSCodium', 'VSCodium.exe'])],
    linuxCommands: ['codium'],
  },
  {
    id: 'zed',
    name: 'Zed',
    macAppNames: ['Zed.app'],
    winAppPaths: ['zed.exe'],
    winUninstalls: [{ pattern: /^Zed$/i, exe: ['zed.exe'] }],
    winCandidates: () => [...underWin(['Programs', 'Zed', 'zed.exe'])],
    linuxCommands: ['zed'],
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    macAppNames: ['Sublime Text.app'],
    winAppPaths: ['sublime_text.exe'],
    winUninstalls: [{ pattern: /^Sublime Text/i, exe: ['sublime_text.exe'] }],
    winCandidates: () => [
      ...underWin(['Sublime Text', 'sublime_text.exe']),
      ...underWin(['Sublime Text 3', 'sublime_text.exe']),
    ],
    linuxCommands: ['subl', 'sublime_text'],
  },
  {
    id: 'textmate',
    name: 'TextMate',
    macAppNames: ['TextMate.app'],
    linuxCommands: ['mate'],
  },
  {
    id: 'idea',
    name: 'IntelliJ IDEA',
    macAppNames: ['IntelliJ IDEA.app', 'IntelliJ IDEA CE.app', 'IntelliJ IDEA Ultimate.app'],
    winAppPaths: ['idea64.exe'],
    winUninstalls: [{ pattern: /IntelliJ IDEA/i, exe: ['bin', 'idea64.exe'] }],
    winCandidates: () => jetBrainsWinCandidates(/IntelliJ IDEA/i, 'idea64.exe'),
    linuxCommands: ['idea'],
  },
  {
    id: 'webstorm',
    name: 'WebStorm',
    macAppNames: ['WebStorm.app'],
    winAppPaths: ['webstorm64.exe'],
    winUninstalls: [{ pattern: /WebStorm/i, exe: ['bin', 'webstorm64.exe'] }],
    winCandidates: () => jetBrainsWinCandidates(/WebStorm/i, 'webstorm64.exe'),
    linuxCommands: ['webstorm'],
  },
  {
    id: 'pycharm',
    name: 'PyCharm',
    macAppNames: ['PyCharm.app', 'PyCharm CE.app', 'PyCharm Professional.app'],
    winAppPaths: ['pycharm64.exe'],
    winUninstalls: [{ pattern: /PyCharm/i, exe: ['bin', 'pycharm64.exe'] }],
    winCandidates: () => jetBrainsWinCandidates(/PyCharm/i, 'pycharm64.exe'),
    linuxCommands: ['pycharm'],
  },
  {
    id: 'goland',
    name: 'GoLand',
    macAppNames: ['GoLand.app'],
    winAppPaths: ['goland64.exe'],
    winUninstalls: [{ pattern: /GoLand/i, exe: ['bin', 'goland64.exe'] }],
    winCandidates: () => jetBrainsWinCandidates(/GoLand/i, 'goland64.exe'),
    linuxCommands: ['goland'],
  },
  {
    id: 'visualstudio',
    name: 'Visual Studio',
    macAppNames: ['Visual Studio.app'],
    winAppPaths: ['devenv.exe'],
    winUninstalls: [{ pattern: /^Visual Studio (Community|Professional|Enterprise|Preview)/i, exe: ['Common7', 'IDE', 'devenv.exe'] }],
    winCandidates: () => visualStudioScans(),
    linuxCommands: [],
  },
  {
    id: 'android-studio',
    name: 'Android Studio',
    macAppNames: ['Android Studio.app', 'Android Studio Preview.app'],
    winAppPaths: ['studio64.exe'],
    winUninstalls: [{ pattern: /Android Studio/i, exe: ['bin', 'studio64.exe'] }],
    winCandidates: registry => {
      const paths: string[] = []
      if (registry.vendor.androidStudio !== null) paths.push(join(registry.vendor.androidStudio, 'bin', 'studio64.exe'))
      paths.push(...underWin(['Android', 'Android Studio', 'bin', 'studio64.exe']))
      paths.push(...jetBrainsWinCandidates(/Android Studio/i, 'studio64.exe'))
      return paths
    },
    linuxPaths: ['/opt/android-studio/bin/studio.sh', '/snap/bin/android-studio', '/usr/local/bin/android-studio'],
    linuxCommands: ['studio', 'android-studio'],
  },
]

export function editorName(id: string): string {
  return EDITORS.find(editor => editor.id === id)?.name ?? id
}

/** macOS bundles live in the system and the per-user Applications folder. */
function macBundles(names: readonly string[]): string[] {
  const roots = ['/Applications', join(process.env.HOME ?? '', 'Applications')].filter(root => root !== '')
  const out: string[] = []
  for (const root of roots) {
    for (const name of names) out.push(join(root, name))
  }
  return out
}

function isMacBundle(bundle: string): boolean {
  return existsSync(join(bundle, 'Contents', 'MacOS'))
}

/** Look one command up on `PATH` without spawning a shell. */
function onPath(command: string): string | null {
  const dirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd'] : ['']
  for (const dir of dirs) {
    if (dir === '') continue
    for (const extension of extensions) {
      const candidate = join(dir, command + extension)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function fromUninstall(record: UninstallRecord, exe: readonly string[]): string | null {
  if (record.installLocation !== null && record.installLocation !== '') {
    return join(record.installLocation, ...exe)
  }
  if (record.displayIcon !== null && record.displayIcon.toLowerCase().endsWith('.exe')) return record.displayIcon
  return null
}

/** Windows resolution: App Paths, then uninstall entries, then vendor keys/scans. */
export function windowsCandidates(editor: EditorDefinition, registry: RegistryIndex): string[] {
  const paths: string[] = []
  for (const name of editor.winAppPaths ?? []) {
    const registered = registry.appPaths.get(name.toLowerCase())
    if (registered !== undefined) paths.push(registered)
  }
  for (const rule of editor.winUninstalls ?? []) {
    for (const record of registry.uninstalls) {
      if (!rule.pattern.test(record.displayName)) continue
      const resolved = fromUninstall(record, rule.exe)
      if (resolved !== null) paths.push(resolved)
    }
  }
  paths.push(...(editor.winCandidates?.(registry) ?? []))
  return paths
}

export interface InstalledEditor {
  id: string
  name: string
  /** What to launch: an executable, a macOS bundle, or a PATH command. */
  launch: string
  kind: 'exe' | 'bundle' | 'command'
}

/** Editors installed on this host, in priority order. */
export async function installedEditors(): Promise<InstalledEditor[]> {
  const registry = process.platform === 'win32'
    ? await readRegistryIndex()
    : { appPaths: new Map<string, string>(), uninstalls: [], vendor: { androidStudio: null, visualStudio: null } }
  const out: InstalledEditor[] = []
  for (const editor of EDITORS) {
    if (process.platform === 'win32') {
      const exe = windowsCandidates(editor, registry).find(candidate => existsSync(candidate))
      if (exe !== undefined) out.push({ id: editor.id, name: editor.name, launch: exe, kind: 'exe' })
      continue
    }
    if (process.platform === 'darwin') {
      const bundle = macBundles(editor.macAppNames ?? []).find(candidate => isMacBundle(candidate))
      if (bundle !== undefined) out.push({ id: editor.id, name: editor.name, launch: bundle, kind: 'bundle' })
      continue
    }
    const absolute = (editor.linuxPaths ?? []).find(candidate => existsSync(candidate))
    if (absolute !== undefined) {
      out.push({ id: editor.id, name: editor.name, launch: absolute, kind: 'command' })
      continue
    }
    const command = (editor.linuxCommands ?? []).map(name => onPath(name)).find(path => path !== null)
    if (command !== undefined && command !== null) {
      out.push({ id: editor.id, name: editor.name, launch: command, kind: 'command' })
    }
  }
  return out
}

/** How a launch ended: opened, not installed, or nothing appeared. */
export type LaunchResult =
  | { ok: true }
  | { ok: false; reason: 'not-installed' }
  | { ok: false; reason: 'failed'; spawnCode?: string; exitCode?: number }

/**
 * Open `root` in one editor. The desktop is not asked to hide the window — that
 * would suppress the editor's own window and make a working launch look dead —
 * and a process that dies at once is reported instead of ignored.
 */
export async function launchEditor(id: string, root: string): Promise<LaunchResult> {
  const editor = (await installedEditors()).find(entry => entry.id === id)
  if (editor === undefined) return { ok: false, reason: 'not-installed' }
  const bundle = editor.kind === 'bundle'
  const outcome = await spawnDetached(
    bundle ? 'open' : editor.launch,
    bundle ? ['-a', editor.launch, root] : [root],
    { cwd: root, windowsHide: false },
  )
  if (outcome.ok) return { ok: true }
  return {
    ok: false,
    reason: 'failed',
    ...(outcome.spawnCode === undefined ? {} : { spawnCode: outcome.spawnCode }),
    ...(outcome.exitCode === undefined ? {} : { exitCode: outcome.exitCode }),
  }
}

