/**
 * Verify the published artifact, locally, end to end.
 *
 *   npm run verify:pack            full — installs, renders, measures, uninstalls
 *   npm run verify:pack -- --no-render    skip the browser steps
 *
 * Why this exists rather than `npm link`: link symlinks your working tree, so
 * every packaging mistake stays invisible — a missing file, a bad `files` list,
 * something that only exists because you happen to be standing in the repo.
 * This packs the real tarball, installs it globally, and drives it from a
 * scratch directory that has never seen the project.
 *
 * And it measures the PNGs' own bytes rather than reading the CLI's summary.
 * Those two disagreed once: every panel reported 1284x2778 while four of the
 * five files were 1285 wide, which the App Store would have rejected.
 *
 * Always uninstalls, even when a step fails.
 */
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'))
const skipRender = process.argv.includes('--no-render')

let failures = 0
const pass = (m) => console.log(`  PASS  ${m}`)
const fail = (m, d = '') => { failures += 1; console.log(`  FAIL  ${m}${d ? `\n          ${d}` : ''}`) }
const step = (m) => console.log(`\n${m}`)

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: 'utf8', ...opts })

/** Width and height from a PNG's IHDR — the bytes a store validates. */
async function pngSize(file) {
  const fh = await fs.open(file)
  try {
    const b = Buffer.alloc(24)
    await fh.read(b, 0, 24, 0)
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  } finally { await fh.close() }
}

// A pre-existing global install would mask everything below.
const already = run('npm', ['ls', '-g', '--depth', '0', '--json'])
if (already.stdout?.includes(`"${pkg.name}"`)) {
  console.error(`${pkg.name} is already installed globally — this test would be checking that copy, not the tarball.`)
  console.error(`Run:  npm uninstall -g ${pkg.name}`)
  process.exit(2)
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'design-ss-verify-'))
const proj = path.join(tmp, 'project')
let installed = false

try {
  // --- pack -----------------------------------------------------------------
  step('1. pack')
  const packed = run('npm', ['pack', '--pack-destination', tmp, '--json'], { cwd: ROOT })
  if (packed.status !== 0) { fail('npm pack', packed.stderr?.trim()); throw new Error('pack failed') }
  const meta = JSON.parse(packed.stdout)[0]
  const tarball = path.join(tmp, meta.filename)
  pass(`${meta.filename} — ${(meta.size / 1024 / 1024).toFixed(2)} MB, ${meta.entryCount} files`)

  // --- what is inside -------------------------------------------------------
  step('2. tarball contents')
  const listed = run('tar', ['tzf', tarball]).stdout.split('\n').filter(Boolean)
  const leaks = listed.filter((f) =>
    /\/node_modules\//.test(f) || /\/strips\//.test(f) ||
    (/\/input\//.test(f) && !/\/input\/README\.md$/.test(f)) ||
    /\/composer\/references\/[^/]+\//.test(f))
  if (leaks.length) fail(`${leaks.length} file(s) that should not ship`, leaks.slice(0, 5).join('\n          '))
  else pass('no input captures, strips, node_modules or reference galleries')

  // --- install the real bytes ----------------------------------------------
  step('3. global install')
  const inst = run('npm', ['install', '-g', tarball], { encoding: 'utf8' })
  if (inst.status !== 0) {
    const why = [inst.stderr, inst.stdout].map((x) => (x || '').trim()).filter(Boolean).join('\n').split('\n').slice(-6).join('\n          ')
    fail('npm install -g', why || `exit ${inst.status} with no output`)
    throw new Error('install failed')
  }
  installed = true
  const version = run('design-ss', ['--version']).stdout?.trim()
  version === pkg.version ? pass(`design-ss --version → ${version}`) : fail('version mismatch', `${version} != ${pkg.version}`)

  // --- drive it from somewhere it has never been ---------------------------
  step('4. a project that has never seen the toolkit')
  await fs.mkdir(path.join(proj, 'input', 'iphone'), { recursive: true })
  await fs.writeFile(path.join(proj, 'input', 'app.md'), '')
  const dss = (args, env = {}) => run('design-ss', args, { cwd: proj, env: { ...process.env, ...env } })

  const checks = [
    ['check --packs', ['check', '--packs'], 0],
    ['frames iphone', ['frames', 'iphone'], 0],
    ['stop with nothing running', ['stop'], 0],
  ]
  for (const [label, args, want] of checks) {
    const r = dss(args)
    r.status === want ? pass(`${label} → ${r.status}`) : fail(label, `exit ${r.status}, wanted ${want}`)
  }

  const design = dss(['design', '--target', 'iphone', '--message', 'verify', '--agent', 'stub',
    ...(skipRender ? ['--no-render'] : [])], { STUB_MODE: 'ok' })
  design.status === 0 ? pass(`design --agent stub → 0`) : fail('design --agent stub', `exit ${design.status}\n${design.stderr?.trim().split('\n').slice(-3).join('\n')}`)

  // --- the sizes, from the files -------------------------------------------
  if (!skipRender) {
    step('5. exported PNG sizes, read from the files')
    const sets = [['rendered', 1290, 2796]]
    for (const [w, h] of [[1284, 2778], [1242, 2688]]) {
      const r = dss(['retarget', '--target', 'iphone', '--size', `${w}x${h}`])
      r.status === 0 ? pass(`retarget ${w}x${h} → 0`) : fail(`retarget ${w}x${h}`, `exit ${r.status}\n${r.stderr?.trim().split('\n').slice(-3).join('\n')}`)
      sets.push([`rendered-${w}x${h}`, w, h])
    }
    for (const [dir, w, h] of sets) {
      const at = path.join(proj, 'strips', 'iphone', dir)
      let files = []
      try { files = (await fs.readdir(at)).filter((f) => /^panel.*\.png$/.test(f)) } catch { /* missing */ }
      if (!files.length) { fail(`${dir}: no panels written`); continue }
      const wrong = []
      for (const f of files) {
        const s = await pngSize(path.join(at, f))
        if (s.w !== w || s.h !== h) wrong.push(`${f} ${s.w}x${s.h}`)
      }
      wrong.length ? fail(`${dir}: ${wrong.length}/${files.length} wrong`, wrong.slice(0, 5).join(', '))
                   : pass(`${dir}: ${files.length} panels, all exactly ${w}x${h}`)
    }

    step('6. guards')
    const shape = dss(['retarget', '--target', 'iphone', '--size', '2064x2752'])
    shape.status === 2 ? pass('a shape change is refused → 2') : fail('shape guard', `exit ${shape.status}, wanted 2`)
  }
} catch {
  // the failing step has already reported itself
} finally {
  console.log('\ncleanup')
  if (installed) {
    const un = run('npm', ['uninstall', '-g', pkg.name])
    console.log(un.status === 0 ? `  uninstalled ${pkg.name}` : `  WARNING: could not uninstall ${pkg.name} — run: npm uninstall -g ${pkg.name}`)
  }
  await fs.rm(tmp, { recursive: true, force: true })
  console.log('  removed the scratch project and tarball')
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS — the tarball is what you think it is')
process.exit(failures ? 1 : 0)
