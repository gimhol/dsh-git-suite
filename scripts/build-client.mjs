/**
 * Bundle the client half into the single artifact DSH serves as `exports["./client"]`.
 *
 * DSH loads a client bundle as a lazy factory (`window.__ModuleLoader__.load`);
 * the entry in `src/client/index.tsx` registers that factory, so this build only
 * has to emit one self-contained IIFE. React stays out of the bundle: the factory
 * receives it from the loader's module table at materialization time.
 *
 * Styles are a CSS Module. Sass compiles `styles.module.scss` to
 * `styles.module.css`, a first esbuild pass treats `.module.css` as a CSS module
 * (hash every class name) and emits the hashed stylesheet, and the second pass
 * bundles the panel with that text inlined, so the single artifact still carries
 * its own rules and the panel mounts them for its lifetime.
 *
 * The esbuild CLI is used instead of its Node API so the build also runs where
 * the process sandbox forbids the API service's piped stdio.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, watch as watchDirectory, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as sass from 'sass'
import { checkClassNames } from './check-classes.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const cli = join(root, 'node_modules', 'esbuild', 'bin', 'esbuild')
const clientDir = join(root, 'src', 'client')
const scssFile = join(clientDir, 'styles.module.scss')
const moduleCssFile = join(clientDir, 'styles.module.css')
const generatedFile = join(clientDir, 'styles.generated.css')
const tempDir = join(root, '.tmp-build')
const distDir = join(root, 'dist')
const watch = process.argv.includes('--watch')
const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

/**
 * esbuild arguments for one pass; only the output path differs between them.
 * @param outfile - absolute output path.
 * @returns the `.module.css` hash pass and the final pass share these flags.
 */
function esbuildArgs(outfile) {
  return [
    'src/client/index.tsx',
    '--bundle',
    '--format=iife',
    '--platform=browser',
    '--target=chrome120',
    '--jsx=transform',
    '--jsx-factory=h',
    // Plain stylesheets stay text; `*.module.css` is hashed by esbuild instead.
    '--loader:.css=text',
    // Lets the settings dialog show the installed version without a request.
    `--define:__GIT_SUITE_VERSION__=${JSON.stringify(packageVersion)}`,
    '--sourcemap',
    '--legal-comments=none',
    `--outfile=${outfile}`,
  ]
}

/**
 * Run one esbuild pass and exit the build on failure.
 * @param outfile - absolute output path; esbuild writes its CSS companion beside it.
 */
function runEsbuild(outfile) {
  const result = spawnSync(process.execPath, [cli, ...esbuildArgs(outfile)], { cwd: root, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

/** Compile the stylesheet to plain CSS; esbuild hashes it afterwards. */
function compileStyles() {
  const result = sass.compile(scssFile, { style: 'expanded', loadPaths: [clientDir] })
  writeFileSync(moduleCssFile, `${result.css.trim()}\n`)
}

/** Full build: stylesheet, class-name check, hash pass, inlined-text bundle. */
function build() {
  compileStyles()
  checkClassNames(clientDir, readFileSync(moduleCssFile, 'utf8'))
  mkdirSync(tempDir, { recursive: true })
  const passJs = join(tempDir, 'pass.js')
  runEsbuild(passJs)
  writeFileSync(generatedFile, readFileSync(join(tempDir, 'pass.css'), 'utf8'))
  mkdirSync(distDir, { recursive: true })
  runEsbuild(join(distDir, 'client.js'))
  // The bundle carries the stylesheet as text, so esbuild's companions are unused.
  rmSync(join(distDir, 'client.css'), { force: true })
  rmSync(join(distDir, 'client.css.map'), { force: true })
  rmSync(tempDir, { recursive: true, force: true })
}

build()

if (watch) {
  let timer
  let building = false
  const rebuild = (_event, filename) => {
    // The build writes these two files itself; reacting to them would loop.
    if (typeof filename === 'string' && /styles\.(module|generated)\.css$/u.test(filename)) return
    if (building) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      building = true
      try {
        build()
        console.log('client: rebuilt')
      } catch (error) {
        console.error(`client: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        building = false
      }
    }, 120)
  }
  // Recursive so every client source and asset is covered, not just the entry.
  watchDirectory(clientDir, { recursive: true }, rebuild)
  console.log(`client: watching ${clientDir}`)
}
