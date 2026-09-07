/**
 * A fake designer. No model, no API key, no cost.
 *
 * It copies the tracked fixture composer/test/bio-strip.html into
 * strips/<target>/ -- schema-valid, and its only asset reference is the
 * tracked composer/test/screen.svg, so it renders in a fresh clone with no
 * input/ at all. That makes the whole pipeline smoke-testable in CI.
 *
 *   STUB_MODE=ok           write a strip and exit 0        (default)
 *   STUB_MODE=noop         write nothing and exit 0        -> exercises exit 3
 *   STUB_MODE=fail         exit 7                          -> exercises exit 4
 *   STUB_MODE=hang         sleep forever                   -> exercises exit 124
 *   STUB_MODE=needs-input  print NEEDS_INPUT and exit 0    -> exercises exit 5
 *   STUB_MODE=broken       write an invalid strip          -> exercises exit 1
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

const target = process.argv[2]
const mode = process.env.STUB_MODE || 'ok'
const toolkitRoot = process.env.DESIGN_SS_TOOLKIT_ROOT || process.cwd()
const stripsDir = process.env.DESIGN_SS_OUTPUT || path.join(process.cwd(), 'strips')
const out = path.join(stripsDir, target)

console.error(`stub-agent: mode=${mode} target=${target}`)

if (mode === 'fail') process.exit(7)
if (mode === 'needs-input') { console.log('NEEDS_INPUT: input/app.md has no panel copy'); process.exit(0) }
if (mode === 'hang') { setInterval(() => {}, 1000); console.error('stub-agent: hanging on purpose'); }
else if (mode === 'noop') { console.error('stub-agent: deliberately wrote nothing'); process.exit(0) }
else {
  await fs.mkdir(out, { recursive: true })
  if (mode === 'broken') {
    await fs.writeFile(path.join(out, 'strip.html'), '<!doctype html><div class="strip"><section data-panel></section></div>')
  } else {
    // The fixture is a *schema* fixture, and two things about it have to be
    // fixed before it is a *renderable* strip:
    //
    //   1. check-schema requires the frame pack's type to equal the
    //      strips/<folder> name, so swap in a pack of the right type when
    //      smoke-testing a target other than iphone.
    //   2. it references poses (isometric-right, angled-left, tilted-right,
    //      isometric-left) that the shipped packs do not contain -- the packs
    //      here ship `front` only. check-schema does not validate data-pose
    //      against the pack, so the fixture passes the checker and then fails
    //      at render with `pose "..." not found in pack`. Normalise every pose
    //      to one the pack actually has.
    let html = await fs.readFile(path.join(toolkitRoot, 'composer/test/bio-strip.html'), 'utf8')
    let packId = 'iphone_12_pro'
    try {
      const catalogue = JSON.parse(await fs.readFile(path.join(toolkitRoot, 'composer/device-frames/index.json'), 'utf8'))
      const match = catalogue.find((p) => p.type === target)
      if (match) { html = html.replaceAll(packId, match.id); packId = match.id }
    } catch { /* leave the pack alone */ }
    try {
      const pack = JSON.parse(await fs.readFile(path.join(toolkitRoot, 'composer/device-frames', packId, 'frame.json'), 'utf8'))
      const poses = (pack.frames || []).map((f) => f.name)
      if (poses.length) {
        html = html.replace(/data-pose="([^"]*)"/g, (whole, pose) => poses.includes(pose) ? whole : `data-pose="${poses[0]}"`)
      }
    } catch { /* leave the poses alone */ }
    await fs.writeFile(path.join(out, 'strip.html'), html)
  }
  console.error(`stub-agent: wrote ${path.join(out, 'strip.html')}`)
  process.exit(0)
}
