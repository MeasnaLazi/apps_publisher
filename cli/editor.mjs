import path from 'node:path'
import { existsSync, openSync, closeSync, readFileSync, writeFileSync, constants as FS, promises as fs } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { EXIT } from './exit-codes.mjs'
import { run } from './proc.mjs'
import * as state from './run-state.mjs'
import { TOOLKIT_ROOT } from './roots.mjs'

/**
 * `design-ss editor` -- install, start and stop the strip editor without needing
 * to know where the toolkit was installed.
 *
 * Three verbs, and each does exactly one thing:
 *
 *   install   fetch the editor's dependencies (~200 MB, once, into the toolkit)
 *   start     spawn it in the background and print the URL
 *   stop      signal its process group and forget it
 *
 * install is separate on purpose. The editor is a Vite dev server that lives in
 * the toolkit, not in the project: strip_editor/ ships inside the package, its
 * node_modules do not. Somebody has to fetch them -- but a `start` that decides
 * to download 200 MB while you wait for a window is a command you cannot
 * predict. So start checks, names the missing step, and exits.
 *
 * Background by default, because a dev server you have to keep a terminal open
 * for is not something `stop` can help with. The pid and process group land in
 * <workRoot>/.design-ss/editor.json -- the same trick `design-ss stop` uses for
 * a run, and the reason neither needs a daemon.
 *
 * The one thing this does NOT do is tell the editor where the project is. The
 * editor still resolves strips relative to its own parent directory (see
 * strip_editor/vite-plugin-editor-api.ts, REPO_ROOT), so it serves the
 * TOOLKIT's strips/, not the work root's. Start says which directory it is
 * serving and warns when that directory is empty, rather than presenting an
 * empty strip list as if the project had none. Fixing it properly is the
 * two-root change render.mjs and check-schema.mjs already went through.
 */

const say = (msg) => process.stderr.write(`design-ss: ${msg}\n`)

export const DEFAULT_PORT = 4714
export const EDITOR_DIR = path.join(TOOLKIT_ROOT, 'strip_editor')
export const STATE_FILE = 'editor.json'
export const LOG_FILE = 'editor.log'

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const VITE_BIN = path.join(EDITOR_DIR, 'node_modules', 'vite', 'bin', 'vite.js')
const READY_TIMEOUT_MS = 90_000   // a cold Vite start also pre-bundles React
const READY_POLL_MS = 250
const STOP_GRACE_MS = 5_000

/**
 * A port is a number or it is nothing. `--port` with no value parses to `true`
 * upstream, and `--port abc` would otherwise reach Vite as NaN and fail there,
 * a layer too late to say anything useful.
 */
export function parsePort(value, fallback = DEFAULT_PORT) {
  if (value === undefined || value === null || value === true) return { port: fallback }
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 65535) return { error: `--port must be an integer 1-65535, got "${value}"` }
  return { port: n }
}

/**
 * Installed means the package is on disk, not that node_modules exists: an
 * interrupted install leaves the directory behind with nothing usable in it,
 * and "already installed" is then a lie that surfaces as a spawn failure.
 */
export const depsInstalled = (dir = EDITOR_DIR) => existsSync(path.join(dir, 'node_modules', 'vite', 'package.json'))

/**
 * node_modules is not portable, and "the files are there" does not mean "this
 * machine can run them". Vite pulls a native binding chosen by platform and
 * arch -- @rolldown/binding-darwin-arm64, @tailwindcss/oxide-linux-x64-gnu --
 * and npm installs only the one matching the machine doing the installing.
 * Carry that tree to another OS and every file is present, `vite` resolves,
 * and the server dies on a MODULE_NOT_FOUND for a binding nobody fetched.
 *
 * So the installer stamps what it installed for, inside node_modules, where a
 * reinstall wipes it along with everything else. An install made by plain
 * `npm install` has no stamp; unknown is not a mismatch, so that case proceeds
 * and falls back to the hint in the start failure path.
 *
 * This is not hypothetical. It is how this function came to exist: an install
 * run against a shared folder from a Linux container replaced a macOS tree,
 * and the check in place at the time -- does vite/package.json exist -- said
 * yes on both sides.
 */
const MARKER = (dir = EDITOR_DIR) => path.join(dir, 'node_modules', '.design-ss-install.json')

export const hereNow = () => ({ platform: process.platform, arch: process.arch })

export function installMismatch(dir = EDITOR_DIR, now = hereNow()) {
  let stamp
  try { stamp = JSON.parse(readFileSync(MARKER(dir), 'utf8')) } catch { return null }
  if (!stamp?.platform || !stamp?.arch) return null
  if (stamp.platform === now.platform && stamp.arch === now.arch) return null
  return `installed for ${stamp.platform}-${stamp.arch}, this machine is ${now.platform}-${now.arch}`
}

/**
 * A pid is not an identity. Pids are reused, and a state file outlives the
 * process it describes -- so `process.kill(pid, 0)` succeeding proves only that
 * SOMETHING holds that number. Measured, not assumed: on a machine handing out
 * two-digit pids, a stale editor.json reported "running" against an unrelated
 * process seconds after the editor had died. Check what the pid actually is
 * before believing it, and above all before signalling it.
 */
export function isEditor(pid) {
  if (!pid || !state.alive(pid)) return false
  if (process.platform === 'win32') return true   // no ps; the pid is all we have
  try {
    return /vite/.test(execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }))
  } catch { return false }
}

const writable = async (dir) => { try { await fs.access(dir, FS.W_OK); return true } catch { return false } }

/**
 * The decision `start` makes before it spawns anything, as a function of two
 * facts and nothing else, so it can be tested without a filesystem or a spawn.
 *
 * start never installs. A command that quietly downloads 200 MB because you
 * asked it to open a window is a command you cannot predict, and the cost lands
 * while you are waiting for a server. `editor install` is the place to pay it,
 * and it is one line to run.
 */
export function startPreflight({ hasEditor, installed, mismatch = null }) {
  if (!hasEditor) return {
    code: EXIT.USAGE,
    lines: [`no editor at ${EDITOR_DIR}`,
            `  this build of the toolkit did not ship strip_editor/ -- reinstall design-ss, or run the editor from a checkout.`],
  }
  if (!installed) return {
    code: EXIT.USAGE,
    lines: [`the editor is not installed yet`,
            `  run:  design-ss editor install      (~200 MB, once, into ${EDITOR_DIR})`],
  }
  if (mismatch) return {
    code: EXIT.USAGE,
    lines: [`the editor is installed, but not for this machine -- ${mismatch}`,
            `  node_modules carries native binaries chosen at install time; they do not travel.`,
            `  run:  design-ss editor install --force`],
  }
  return { code: null, lines: [] }
}

/**
 * `design-ss editor install` -- the one command that is allowed to be slow.
 *
 * The dependencies go where the TOOLKIT is, not where your project is:
 * strip_editor/ ships inside the package and its node_modules do not, because
 * the files allowlist excludes them and they are ~200 MB.
 */
export async function installEditor({ force = false } = {}) {
  if (!existsSync(path.join(EDITOR_DIR, 'package.json'))) {
    for (const l of startPreflight({ hasEditor: false, installed: false }).lines) say(l)
    return EXIT.USAGE
  }
  const mismatch = installMismatch()
  if (mismatch) say(`reinstalling: ${mismatch}`)
  else if (depsInstalled() && !force) {
    say(`already installed in ${EDITOR_DIR}`)
    say(`start it with: design-ss editor start        (reinstall with --force)`)
    return EXIT.OK
  }

  if (!await writable(EDITOR_DIR)) {
    say(`${EDITOR_DIR} is not writable`)
    say(`  the editor installs into the toolkit, not into your project. Either reinstall design-ss`)
    say(`  somewhere you own (npm prefix), or run: sudo npm --prefix ${EDITOR_DIR} install --include=dev`)
    return EXIT.USAGE
  }

  // --include=dev is not belt-and-braces: vite itself is a devDependency, so a
  // machine with `npm config set production true`, or NODE_ENV=production in the
  // environment, would install cleanly and leave nothing to run.
  const lockfile = existsSync(path.join(EDITOR_DIR, 'package-lock.json'))
  const cmd = lockfile ? 'ci' : 'install'
  // `npm ci` deletes node_modules before it installs. That is what makes it
  // the right command for a cross-platform tree -- and what makes an
  // interrupted run leave you worse off than before, so say it first.
  if (lockfile && depsInstalled()) say(`replacing the existing node_modules (npm ci deletes it first)`)
  say(`installing the editor in ${EDITOR_DIR} (~200 MB, once)`)
  const r = await run(NPM, [cmd, '--include=dev'], { cwd: EDITOR_DIR })
  if (r.code !== 0) { say(`npm ${cmd} exited ${r.code}`); return EXIT.USAGE }
  // npm's exit code is its self-report; the file on disk is the fact.
  if (!depsInstalled()) { say(`npm reported success but ${VITE_BIN} is still missing`); return EXIT.USAGE }
  // Stamp what this tree was built for, so start can refuse it on another
  // machine instead of letting Vite die on a missing native binding.
  try { writeFileSync(MARKER(), JSON.stringify({ ...hereNow(), node: process.versions.node, at: new Date().toISOString() }, null, 2)) } catch { /* the check degrades to unknown */ }
  say(`installed. Start it with: design-ss editor start`)
  return EXIT.OK
}

/**
 * Ready means the server answered, not that the spawn returned. A detached
 * child that dies immediately -- a port already held by something that is not
 * ours, a broken install -- otherwise gets reported as a successful start, and
 * the URL we printed 404s in the browser.
 */
async function waitForReady(url, exitedRef) {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (exitedRef.value) return { ok: false, exited: exitedRef.value }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (res.ok || res.status < 500) return { ok: true }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, READY_POLL_MS))
  }
  return { ok: false, timedOut: true }
}

const tail = async (file, lines = 20) => {
  try { return (await fs.readFile(file, 'utf8')).trimEnd().split('\n').slice(-lines).join('\n') } catch { return '' }
}

export async function startEditor(roots, { port = DEFAULT_PORT } = {}) {
  const existing = await state.read(roots.stateDir, STATE_FILE)
  if (existing && isEditor(existing.pid)) {
    say(`already running (pid ${existing.pid}, started ${existing.startedAt})`)
    process.stdout.write(`${existing.url}\n`)
    return EXIT.OK
  }
  if (existing) await state.clear(roots.stateDir, STATE_FILE)

  const pre = startPreflight({
    hasEditor: existsSync(path.join(EDITOR_DIR, 'package.json')),
    installed: depsInstalled(),
    mismatch: installMismatch(),
  })
  if (pre.code !== null) { for (const l of pre.lines) say(l); return pre.code }

  await fs.mkdir(roots.stateDir, { recursive: true })
  const logPath = path.join(roots.stateDir, LOG_FILE)
  const url = `http://localhost:${port}/`

  const fd = openSync(logPath, 'a')
  let child
  try {
    child = spawn(process.execPath, [VITE_BIN, '--port', String(port), '--strictPort'], {
      cwd: EDITOR_DIR,
      // Its own process group, for the same reason a run gets one: Vite spawns
      // esbuild, and killing only the pid we hold leaves that behind holding
      // the port we are about to tell someone is free.
      detached: true,
      stdio: ['ignore', fd, fd],
    })
  } catch (error) {
    closeSync(fd)
    say(`could not start the editor: ${error.message}`)
    return EXIT.USAGE
  }
  closeSync(fd)

  const exitedRef = { value: null }
  child.on('exit', (code, signal) => { exitedRef.value = { code, signal } })

  const ready = await waitForReady(url, exitedRef)
  if (!ready.ok) {
    if (ready.exited) {
      say(`the editor exited ${ready.exited.signal ?? ready.exited.code} before it served anything`)
      say(`  port ${port} is the usual reason -- the config sets strictPort, so it will not silently move.`)
    } else {
      say(`the editor did not answer ${url} within ${READY_TIMEOUT_MS / 1000}s -- killing it`)
      try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ }
    }
    const log = await tail(logPath, 40)
    // An install carried from another OS has every file in place and no
    // binding for this one. The message Vite gives for that is a bare
    // MODULE_NOT_FOUND deep in a stack trace, which reads like a bug in the
    // editor rather than a reinstall away from working.
    if (/MODULE_NOT_FOUND|Cannot find module/.test(log)) {
      say(`that stack trace names a missing module, which usually means this node_modules`)
      say(`  was installed on a different OS or architecture -- native bindings do not travel.`)
      say(`  run:  design-ss editor install --force`)
    }
    if (log) process.stderr.write(`${log}\n`)
    say(`full log: ${logPath}`)
    return EXIT.USAGE
  }

  await state.write(roots.stateDir, { pid: child.pid, pgid: child.pid, port, url, editorDir: EDITOR_DIR, workRoot: roots.workRoot, log: logPath }, STATE_FILE)
  child.unref()

  // The editor serves strips relative to itself, not to the work root. Say so
  // now, while it is cheap to notice, instead of letting an empty list read as
  // a project with no strips.
  const served = path.join(EDITOR_DIR, '..', 'strips')
  const count = await fs.readdir(served).then((e) => e.length).catch(() => null)
  say(`editor running (pid ${child.pid}), serving strips from ${path.resolve(served)}`)
  if (count === null || count === 0) {
    say(`  that directory is ${count === null ? 'missing' : 'empty'} -- the editor lists the TOOLKIT's strips, not this project's.`)
    if (path.resolve(served) !== roots.stripsDir) say(`  this project's strips are in ${roots.stripsDir} and will not appear yet.`)
  }
  say(`stop it with: design-ss editor stop        log: ${logPath}`)
  process.stdout.write(`${url}\n`)
  return EXIT.OK
}

export async function stopEditor(roots) {
  const current = await state.read(roots.stateDir, STATE_FILE)
  const file = state.statePath(roots.stateDir, STATE_FILE)
  if (!current) { say(`no editor recorded in ${file}`); return EXIT.OK }
  if (!isEditor(current.pid)) {
    say(`recorded editor (pid ${current.pid}) is already gone`)
    await state.clear(roots.stateDir, STATE_FILE)
    return EXIT.OK
  }

  say(`stopping the editor on port ${current.port} (process group ${current.pgid})`)
  const kill = (sig) => { try { process.kill(-current.pgid, sig) } catch { try { process.kill(current.pid, sig) } catch { /* raced */ } } }
  kill('SIGTERM')

  // Confirm it, do not assume it. A SIGTERM that a hung Vite ignores would
  // otherwise leave the port held and the state file cleared -- the worst of
  // both, because the next start blames the port on something else.
  const deadline = Date.now() + STOP_GRACE_MS
  while (Date.now() < deadline && isEditor(current.pid)) await new Promise((r) => setTimeout(r, 100))
  if (isEditor(current.pid)) {
    say(`still alive after ${STOP_GRACE_MS / 1000}s -- SIGKILL`)
    kill('SIGKILL')
    await new Promise((r) => setTimeout(r, 300))
  }

  await state.clear(roots.stateDir, STATE_FILE)
  const survived = isEditor(current.pid)
  say(survived ? `pid ${current.pid} survived SIGKILL -- kill it by hand` : `stopped`)
  return survived ? EXIT.GATE : EXIT.OK
}

export async function editorStatus(roots) {
  const current = await state.read(roots.stateDir, STATE_FILE)
  if (!current) { say(`no editor recorded in ${state.statePath(roots.stateDir, STATE_FILE)}`); return EXIT.OK }
  if (!isEditor(current.pid)) { say(`recorded editor (pid ${current.pid}) is gone -- run \`design-ss editor\` to start a new one`); return EXIT.OK }
  say(`running since ${current.startedAt} (pid ${current.pid}, port ${current.port})`)
  process.stdout.write(`${current.url}\n`)
  return EXIT.OK
}
