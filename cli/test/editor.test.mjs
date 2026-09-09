/**
 * The parts of `design-ss editor` that decide whether a signal gets sent, and to
 * what. Spawning a real Vite is a different kind of test; these are the checks
 * that must hold before we kill anything.
 *
 * Run: node cli/test/editor.test.mjs
 */
import path from 'node:path'
import os from 'node:os'
import { promises as fs, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { parsePort, depsInstalled, isEditor, startPreflight, installMismatch, DEFAULT_PORT, STATE_FILE } from '../editor.mjs'
import * as state from '../run-state.mjs'

let failures = 0
const check = (label, cond, detail = '') => {
  if (!cond) { failures += 1; console.log(`FAIL  ${label}${detail ? `  — ${detail}` : ''}`) }
  else console.log(`PASS  ${label}`)
}

// --- --port ----------------------------------------------------------------
check('no --port means the default', parsePort(undefined).port === DEFAULT_PORT)
check('a bare --port means the default', parsePort(true).port === DEFAULT_PORT, 'the arg parser yields true for a valueless flag')
check('--port 5173 is honoured', parsePort('5173').port === 5173)
check('--port abc is refused here, not by Vite', !!parsePort('abc').error, JSON.stringify(parsePort('abc')))
check('--port 0 is refused', !!parsePort('0').error)
check('--port 70000 is refused', !!parsePort('70000').error)
check('--port 4714.5 is refused', !!parsePort('4714.5').error)

// --- "is it installed?" ----------------------------------------------------
const tmp = mkdtempSync(path.join(os.tmpdir(), 'design-ss-editor-'))
check('an empty directory is not installed', !depsInstalled(tmp))

// The case that made the check specific: an interrupted install leaves the
// directory behind. Present-but-empty must not read as installed.
mkdirSync(path.join(tmp, 'node_modules'), { recursive: true })
check('a bare node_modules/ is not installed', !depsInstalled(tmp), 'an interrupted install must not pass')

mkdirSync(path.join(tmp, 'node_modules', 'vite'), { recursive: true })
writeFileSync(path.join(tmp, 'node_modules', 'vite', 'package.json'), '{"name":"vite"}')
check('vite on disk is installed', depsInstalled(tmp))

// --- start never installs -------------------------------------------------
// The whole point of the install/start split: start is a command you can
// predict. It must refuse and say what to run, not quietly fetch 200 MB while
// someone waits for a window.
const missing = startPreflight({ hasEditor: true, installed: false })
check('start refuses when the editor is not installed', missing.code === 2, `got ${missing.code}`)
check('...and names the command that fixes it', missing.lines.join(' ').includes('design-ss editor install'), missing.lines.join(' | '))

const noEditor = startPreflight({ hasEditor: false, installed: false })
check('start refuses when strip_editor/ is not there at all', noEditor.code === 2)
check('...and does not tell you to install into a directory that does not exist',
  !noEditor.lines.join(' ').includes('design-ss editor install'), noEditor.lines.join(' | '))

check('start proceeds when it is installed', startPreflight({ hasEditor: true, installed: true }).code === null)

// --- an install is not portable -------------------------------------------
// Every file present, vite resolves, and the native binding for THIS machine
// was never fetched. The old check (does vite/package.json exist) said yes on
// both sides of that, which is how a Linux tree reached a Mac and died on a
// MODULE_NOT_FOUND deep in a stack trace.
const wrongBox = startPreflight({ hasEditor: true, installed: true, mismatch: 'installed for linux-x64, this machine is darwin-arm64' })
check('start refuses an install made on another platform', wrongBox.code === 2, `got ${wrongBox.code}`)
check('...and names --force, since plain install would short-circuit',
  wrongBox.lines.join(' ').includes('design-ss editor install --force'), wrongBox.lines.join(' | '))

const stamped = path.join(tmp, 'stamped')
mkdirSync(path.join(stamped, 'node_modules'), { recursive: true })
check('no stamp is not a mismatch — an install npm made itself is unknown, not wrong',
  installMismatch(stamped, { platform: 'darwin', arch: 'arm64' }) === null)

writeFileSync(path.join(stamped, 'node_modules', '.design-ss-install.json'), JSON.stringify({ platform: 'linux', arch: 'x64' }))
check('a stamp from another platform is a mismatch',
  /linux-x64.*darwin-arm64/.test(installMismatch(stamped, { platform: 'darwin', arch: 'arm64' }) ?? ''),
  String(installMismatch(stamped, { platform: 'darwin', arch: 'arm64' })))
check('a stamp from this platform is not',
  installMismatch(stamped, { platform: 'linux', arch: 'x64' }) === null)

// --- a pid is not an identity ---------------------------------------------
// This test process is alive and is not the editor. If isEditor only asked
// "does this pid exist", it would say yes -- and stop would signal it.
check('a live non-editor pid is not the editor', !isEditor(process.pid), `pid ${process.pid} is this test`)
check('an impossible pid is not the editor', !isEditor(2 ** 30))
check('pid 0 is not the editor', !isEditor(0), 'kill(-0) is the whole process group')

// --- run.json and editor.json are separate --------------------------------
// `design-ss stop` must not reach the editor, and `design-ss editor stop` must
// not reach a design run. One shared file would make both true.
const stateDir = path.join(tmp, '.design-ss')
await state.write(stateDir, { pid: 111, target: 'iphone' })
await state.write(stateDir, { pid: 222, port: 4714 }, STATE_FILE)
const run = await state.read(stateDir)
const editor = await state.read(stateDir, STATE_FILE)
check('a run and an editor are recorded separately', run.pid === 111 && editor.pid === 222, JSON.stringify({ run: run.pid, editor: editor.pid }))
check('the editor file is editor.json', state.statePath(stateDir, STATE_FILE).endsWith('editor.json'))
check('the run file is still run.json by default', state.statePath(stateDir).endsWith('run.json'))

await state.clear(stateDir, STATE_FILE)
check('clearing the editor leaves the run alone', (await state.read(stateDir))?.pid === 111 && (await state.read(stateDir, STATE_FILE)) === null)

await fs.rm(tmp, { recursive: true, force: true })
console.log(failures ? `\n${failures} failure(s)` : '\nall green')
process.exit(failures ? 1 : 0)
