/**
 * The retarget transform — the part that has to be right, because the failure
 * mode is silent: a strip that renders at the correct size with its geometry
 * a few pixels out of true.
 *
 * Run: node cli/test/retarget.test.mjs
 */
import { retargetHtml, detectPanelSize, aspectDrift } from '../retarget.mjs'

let failures = 0
const check = (label, cond, detail = '') => {
  if (!cond) { failures += 1; console.log(`FAIL  ${label}${detail ? `  — ${detail}` : ''}`) }
  else console.log(`PASS  ${label}`)
}

// The real case: the 6.9" strip that had to become 6.5".
const SRC = `<!doctype html><html><head><style>
  .panel { position: relative; width: 1290px; height: 2796px; }
  .hair { border-bottom: 1px solid #000; }
</style></head><body><div class="strip">
  <section class="panel" data-panel="0">
    <div data-layer="decor" style="position:absolute; left:0px; top:2398px; width:1290px; height:2px;"></div>
    <div data-layer="text" style="position:absolute; left:96px; top:180px; font-size:96px;">Only 1290px wide</div>
  </section>
</div></body></html>`

const size = detectPanelSize(SRC)
check('the panel box is detected', size && size.w === 1290 && size.h === 2796, JSON.stringify(size))

const r = retargetHtml(SRC, { fromW: 1290, fromH: 2796, toW: 1284, toH: 2778 })

check('the panel box is exactly the requested size',
  /width:\s*1284px;\s*height:\s*2778px/.test(r.html), 'panel rule not snapped')

// This is the bug the command exists for. sed leaves top:2398px alone; the
// horizon then sits at 86.3% of the panel instead of 85.8%.
check('positions move with the canvas, not against it',
  r.html.includes('top:2387px'), 'expected round(2398 × 1284/1290) = 2387')

check('full-bleed widths still span the panel exactly',
  r.html.includes('width:1284px'), 'a decor spanning 1290 must become exactly 1284')

check('type scales too, so line breaks hold', r.html.includes('font-size:96px'))

check('hairlines survive', /border-bottom:\s*1px solid/.test(r.html) || r.html.includes('0.99px'))

// Copy text is not geometry.
check('text that merely says "1290px" is untouched', r.html.includes('Only 1290px wide'))

// The invariant behind the rounding: fractional lengths put panels on
// fractional boundaries, the screenshot clip rounds outward, and a panel
// measured at 1284px exports as a 1285px PNG the store rejects.
check('no fractional pixels survive the rescale',
  !/[0-9]\.[0-9]+px/.test(r.html), (r.html.match(/[0-9]\.[0-9]+px/g) || []).slice(0, 3).join(', '))

check('the height residual is reported, not hidden',
  Math.abs(r.residual - 5.02) < 0.05, `residual=${r.residual}`)

// Guard: a genuinely different shape is a redesign, not a rescale.
check('6.9 -> 6.5 is within tolerance',
  aspectDrift({ fromW: 1290, fromH: 2796, toW: 1284, toH: 2778 }) < 0.01)
check('portrait -> landscape is not',
  aspectDrift({ fromW: 1290, fromH: 2796, toW: 2778, toH: 1284 }) > 0.01)

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS')
process.exit(failures ? 1 : 0)
