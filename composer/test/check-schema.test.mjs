/**
 * check-schema.mjs, against markup designed to break it.
 *
 * The rule under most scrutiny here is the unlabelled-child check. It has to
 * fire on a bare `<div>` sitting in a panel — an element that renders perfectly
 * and is invisible to the editor — while staying silent about the shapes nested
 * *inside* a decor block, which are that block's own business. A checker that
 * cried wolf about nested markup would be turned off within a day, so the
 * negative cases below matter more than the positive one.
 *
 * Run: node composer/test/check-schema.test.mjs
 */
import assert from 'node:assert/strict'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkStrip } from '../check-schema.mjs'

const wrap = (panelBody, extra = '') => `<!doctype html><html><head>
<script type="module" src="/composer/device-frames.mjs"></script>
</head><body>
<div class="strip">
  <section class="panel" data-panel="0">
${panelBody}
  </section>
${extra}
</div>
</body></html>`

const TEXT = '<div data-layer="text" data-role="title" style="position:absolute; left:10px; top:10px;">Hi</div>'

let failures = 0
async function check(label, html, { errors = [], noErrors = [] }, opts = {}) {
  const res = await checkStrip(html, label, opts)
  const joined = res.errors.join(' | ')
  const missing = errors.filter((e) => !joined.includes(e))
  const spurious = noErrors.filter((e) => joined.includes(e))
  if (missing.length || spurious.length) {
    failures += 1
    console.log(`FAIL  ${label}`)
    for (const m of missing) console.log(`        expected an error containing: ${m}`)
    for (const s of spurious) console.log(`        should NOT have errored on: ${s}`)
    console.log(`        actual: ${joined || '(none)'}`)
  } else {
    console.log(`PASS  ${label}`)
  }
}

// --- the bug this rule exists for ------------------------------------------
await check('bare div in a panel is caught', wrap(`${TEXT}\n<div class="badge"></div>`), {
  errors: ['class="badge"', 'no data-layer'],
})

await check('inline <svg> in a panel is caught', wrap(`${TEXT}\n<svg viewBox="0 0 10 10"><circle r="5"/></svg>`), {
  errors: ['<svg>', 'no data-layer'],
})

await check('bare <img> in a panel is caught', wrap(`${TEXT}\n<img src="/strips/iphone/images/x.png">`), {
  errors: ['<img>', 'no data-layer'],
})

// --- the negatives that decide whether anyone keeps it on -------------------
await check(
  'shapes NESTED inside a decor block are left alone',
  wrap(`${TEXT}
<div data-layer="decor" class="card" style="position:absolute; left:0; top:0;">
  <div class="ring"></div>
  <div class="ring2"><span class="dot"></span></div>
  <svg viewBox="0 0 10 10"><circle r="5"/></svg>
</div>`),
  { noErrors: ['class="ring"', 'class="ring2"', 'class="dot"', '<svg>'] },
)

await check(
  'a void element inside decor does not break depth tracking',
  wrap(`${TEXT}
<div data-layer="decor" style="position:absolute; left:0; top:0;">
  <img src="/composer/placeholder.svg"><br><hr>
</div>
<div class="after"></div>`),
  { errors: ['class="after"'], noErrors: ['<img>', '<br>', '<hr>'] },
)

await check(
  'a self-closed element inside decor does not break depth tracking',
  wrap(`${TEXT}
<div data-layer="decor" style="position:absolute; left:0; top:0;">
  <svg viewBox="0 0 4 4"><rect width="4" height="4"/></svg>
</div>
<div class="after"></div>`),
  { errors: ['class="after"'], noErrors: ['<rect>'] },
)

await check('a device block is not reported as unlabelled', wrap(`${TEXT}
<div data-layer="device" data-device data-pack="iphone_12_pro" data-pose="front"
     style="position:absolute; left:0; top:0; width:900px;"></div>`), {
  noErrors: ['no data-layer'],
})

await check('a <style> block inside a panel is not a layer', wrap(`${TEXT}\n<style>.x{color:red}</style>`), {
  noErrors: ['no data-layer'],
})

// --- img mislabelled as decor ----------------------------------------------
// Warning, not error: it exports correctly and decor is free HTML, so the file
// is legal. But the editor gives it the decor inspector — background and border,
// no src field — so the picture is the one thing you cannot change about it.
async function warns(label, html, { warnings = [], noWarnings = [], noErrors = [] }) {
  const res = await checkStrip(html, label)
  const w = res.warnings.join(' | ')
  const e = res.errors.join(' | ')
  const missing = warnings.filter((x) => !w.includes(x))
  const spurious = [...noWarnings.filter((x) => w.includes(x)), ...noErrors.filter((x) => e.includes(x))]
  if (missing.length || spurious.length) {
    failures += 1
    console.log(`FAIL  ${label}`)
    for (const m of missing) console.log(`        expected a warning containing: ${m}`)
    for (const s of spurious) console.log(`        should not have reported: ${s}`)
    console.log(`        warnings: ${w || '(none)'}\n        errors: ${e || '(none)'}`)
  } else {
    console.log(`PASS  ${label}`)
  }
}

const IMG_DECOR = '<img data-layer="decor" src="/composer/placeholder.svg" style="position:absolute; left:0; top:0;">'
const IMG_IMAGE = '<img data-layer="image" src="/composer/placeholder.svg" style="position:absolute; left:0; top:0;">'

await warns('an <img> labelled decor is warned about', wrap(`${TEXT}\n${IMG_DECOR}`), {
  warnings: ['labelled decor'],
  noErrors: ['no data-layer'],
})

await warns('an <img> labelled image is left alone', wrap(`${TEXT}\n${IMG_IMAGE}`), {
  noWarnings: ['labelled decor'],
})

await warns(
  'a <div> decor block is not confused with an image',
  wrap(`${TEXT}\n<div data-layer="decor" style="position:absolute; left:0; top:0; width:40px; height:40px;"></div>`),
  { noWarnings: ['labelled decor'] },
)

await warns(
  'an <img> nested inside a decor block is that block’s business',
  wrap(`${TEXT}
<div data-layer="decor" style="position:absolute; left:0; top:0;">
  <img src="/composer/placeholder.svg">
</div>`),
  { noWarnings: ['labelled decor'], noErrors: ['no data-layer'] },
)

// --- groups -----------------------------------------------------------------
// A group is the one container whose children are layers. Everything here is
// about the boundary between it and decor: decor hides its innards, a group
// exposes them, and the rules follow from that one difference.
const GROUP = (children) =>
  `<div data-layer="group" style="position:absolute; left:10px; top:10px;">${children}</div>`

await check(
  'an unlabelled child of a group is caught',
  wrap(`${TEXT}\n${GROUP('<span>hi</span>')}`),
  { errors: ['<span>', 'inside a group has no data-layer'] },
)

await check(
  'a labelled child of a group is fine',
  wrap(`${TEXT}\n${GROUP('<div data-layer="text" data-role="caption">hi</div>')}`),
  { noErrors: ['no data-layer', 'not absolutely positioned'] },
)

await check(
  'a group child need not be absolutely positioned — the group lays it out',
  wrap(`${TEXT}\n${GROUP('<img data-layer="image" src="/composer/placeholder.svg" style="width:40px;">')}`),
  { noErrors: ['not absolutely positioned'] },
)

await check(
  'a block sitting directly in a panel still must be absolutely positioned',
  wrap(`${TEXT}\n<div data-layer="decor" style="width:40px; height:40px;"></div>`),
  { errors: ['not absolutely positioned'] },
)

await check(
  'an unlabelled child of a DECOR block is still that block’s business',
  wrap(`${TEXT}\n<div data-layer="decor" style="position:absolute; left:0; top:0;"><span>hi</span></div>`),
  { noErrors: ['no data-layer', 'inside a group'] },
)

await check('group is a valid data-layer kind', wrap(`${TEXT}\n${GROUP('')}`), {
  noErrors: ['unknown data-layer kind'],
})

// --- assets named from CSS, not from an attribute ---------------------------
// `@font-face` is the reason this exists: a font is named in `src: url(…)` and
// nowhere else, so the src=/href= scan never saw it. An external font URL used
// to pass the no-network rule, and a mistyped local one used to pass the
// on-disk check — both of which ship as a silent fallback to the system serif.
const styled = (css) => `<!doctype html><html><head>
<style>${css}</style>
<script type="module" src="/composer/device-frames.mjs"></script>
</head><body><div class="strip">
  <section class="panel" data-panel="0">${TEXT}</section>
</div></body></html>`

await check(
  'a web font in @font-face is an external asset',
  styled("@font-face { font-family: 'X'; src: url('https://fonts.gstatic.com/s/x.woff2') format('woff2'); }"),
  { errors: ['external network asset', 'in CSS url()'] },
)

await check(
  'a protocol-relative CSS url is external too',
  styled('.panel { background-image: url(//cdn.example.com/bg.png); }'),
  { errors: ['external network asset'] },
)

await check(
  'a local font path that is not on disk is an error',
  styled("@font-face { font-family: 'X'; src: url('/composer/fonts/inter/Inter-Nope.woff2'); }"),
  { errors: ['asset not found on disk', 'in CSS url()'] },
)

await check(
  'a local font path that IS on disk passes',
  styled("@font-face { font-family: 'Inter'; src: url('/composer/fonts/inter/Inter-Regular.woff2') format('woff2'); }"),
  { noErrors: ['Inter-Regular.woff2', 'external network asset'] },
)

await check(
  'an SVG fragment reference is not an asset path',
  styled('.panel { fill: url(#gradient); }'),
  { noErrors: ['#gradient', 'external network asset'] },
)

await check(
  'a data: URL in CSS is not an external asset',
  styled(".panel { background-image: url('data:image/svg+xml;base64,PHN2Zy8+'); }"),
  { noErrors: ['external network asset', 'data:image'] },
)

// --- frame packs against the catalogue --------------------------------------
// These only became reachable when the run started *choosing* a pack. While a
// human picked from the editor's type-filtered dropdown, none of them could
// happen; now a wrong choice would render, export, and say nothing.
const withDevice = (pack, extra = '') => `<!doctype html><html><head>
<script type="module" src="/composer/device-frames.mjs"></script>
</head><body><div class="strip">
  <section class="panel" data-panel="0">
    ${TEXT}
    <div data-layer="device" data-device data-pack="${pack}" data-pose="front"
         style="position:absolute; left:0; top:0; width:900px;"></div>${extra}
  </section>
</div></body></html>`

await check(
  'a pack that is not in the catalogue is caught',
  withDevice('iphone_99_pro'),
  { errors: ['unknown frame pack "iphone_99_pro"'] },
)

await check(
  'a real pack passes',
  withDevice('iphone_12_pro'),
  { noErrors: ['unknown frame pack'] },
)

// The catalogue says a pack exists; only the pack's own frame.json says which
// views it has. A pose the pack lacks passed the checker and then killed the
// export with `pose "x" not found in pack "y"` — after a browser launch.
await check(
  'a pose the pack does not have is caught',
  withDevice('iphone_12_pro', `
    <div data-layer="device" data-device data-pack="iphone_12_pro" data-pose="isometric-left"
         style="position:absolute; left:0; top:900px; width:900px;"></div>`),
  { errors: ['pose "isometric-left" is not in pack "iphone_12_pro"'] },
)

await check(
  'a pose the pack does have passes',
  withDevice('iphone_12_pro'),
  { noErrors: ['is not in pack'] },
)

await check(
  'two different packs in one strip is an error',
  withDevice('iphone_12_pro', `
    <div data-layer="device" data-device data-pack="iphone_15_pro" data-pose="front"
         style="position:absolute; left:0; top:900px; width:900px;"></div>`),
  { errors: ['a strip uses one frame pack'] },
)

await check(
  'the same pack twice is fine',
  withDevice('iphone_12_pro', `
    <div data-layer="device" data-device data-pack="iphone_12_pro" data-pose="front"
         style="position:absolute; left:0; top:900px; width:900px;"></div>`),
  { noErrors: ['a strip uses one frame pack'] },
)

// The type check keys off the strips/<folder>/ path in the label, so it needs
// checkStrip directly — check() passes the test's name as the label.
{
  const res = await checkStrip(withDevice('ipad_13_pro'), 'strips/iphone/strip.html')
  const joined = res.errors.join(' | ')
  if (!joined.includes('is type "ipad" but this strip is in strips/iphone/')) {
    failures += 1
    console.log('FAIL  the type mismatch is reported when the label is a strips/ path')
    console.log(`        actual: ${joined || '(none)'}`)
  } else console.log('PASS  the type mismatch is reported when the label is a strips/ path')
}
{
  const res = await checkStrip(withDevice('ipad_13_pro'), 'blankStripTemplate')
  if (res.errors.some((e) => e.includes('but this strip is in'))) {
    failures += 1
    console.log('FAIL  a non-path label must not have a target guessed for it')
  } else console.log('PASS  a non-path label has no target guessed for it')
}

// --- multiple panels are attributed correctly -------------------------------
const twoPanels = `<!doctype html><html><head>
<script type="module" src="/composer/device-frames.mjs"></script>
</head><body><div class="strip">
  <section class="panel" data-panel="0">${TEXT}</section>
  <section class="panel" data-panel="1">${TEXT}<div class="stray"></div></section>
</div></body></html>`
const res = await checkStrip(twoPanels, 'two panels')
assert.ok(
  res.errors.some((e) => e.includes('panel 1') && e.includes('class="stray"')),
  `expected the stray to be attributed to panel 1, got: ${res.errors.join(' | ')}`,
)
assert.ok(!res.errors.some((e) => e.includes('panel 0:')), 'panel 0 is clean and must not be blamed')
console.log('PASS  the offending panel is named correctly')

// --- /strips/** resolves against the strips root ----------------------------
// A strip designed outside the toolkit keeps root-relative asset URLs, because
// they are server paths, not disk paths. Resolving them against the toolkit
// reported all five screenshots of a real run as missing — correct markup, a
// wall of errors. render.mjs already splits these two trees; so must this.
{
  const stripsRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'dss-check-'))
  const shot = path.join(stripsRoot, 'iphone', 'screenshots', 'shot.svg')
  await fsp.mkdir(path.dirname(shot), { recursive: true })
  await fsp.writeFile(shot, '<svg/>')

  const html = withDevice('iphone_12_pro').replace(
    'data-pack="iphone_12_pro"',
    'data-screenshot="/strips/iphone/screenshots/shot.svg" data-fit="cover" data-pack="iphone_12_pro"',
  )

  await check('a screenshot under the strips root is found', html,
    { noErrors: ['not found on disk'] }, { stripsRoot })

  await check('without a strips root it resolves against the toolkit, as before', html,
    { errors: ['not found on disk'] })

  await fsp.rm(shot)
  await check('a genuinely missing screenshot is still an error', html,
    { errors: ['not found on disk'] }, { stripsRoot })

  await fsp.rm(stripsRoot, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures ? 1 : 0)
