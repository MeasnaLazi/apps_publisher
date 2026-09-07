// Structural conformance check for strip HTML, against composer/strip-schema.md.
//
// This checks *structure*, never taste. It answers "will the renderer and the
// editor both understand this file", not "is this a good design" — the style
// heuristics that used to live in the toolkit were removed deliberately and
// must not creep back in here. Every rule below maps to a line in the schema
// that, when broken, makes a block unexportable or uneditable.
//
// Usage:
//   node composer/check-schema.mjs <file.html> [more.html ...]
//   node composer/check-schema.mjs --all        # every strip in the repo, and the frame packs
//   node composer/check-schema.mjs --packs      # just the frame-pack geometry
//   node composer/check-schema.mjs --skeleton   # the example inside strip-schema.md
//
// Exit 0 when clean, 1 when any file has an error. Warnings never fail.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { screenOutline, containmentReport, enclosingQuad, isIdentityAffine } from './screen-geometry.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEXT_ROLES = new Set(['title', 'subtitle', 'caption'])
const LAYER_KINDS = new Set(['text', 'device', 'image', 'decor', 'group'])

/** Opening tags with their raw attribute text, in source order. */
function* tags(html) {
  const re = /<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
  let m
  while ((m = re.exec(html))) {
    yield { name: m[1].toLowerCase(), attrs: m[2], index: m.index, raw: m[0] }
  }
}

function attr(attrText, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i')
  const m = attrText.match(re)
  if (m) return m[2] ?? m[3] ?? ''
  // Valueless attribute, e.g. `data-device`
  return new RegExp(`\\b${name}\\b`, 'i').test(attrText) ? '' : null
}

function styleProp(styleText, prop) {
  if (!styleText) return null
  const m = styleText.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'))
  return m ? m[1].trim() : null
}

/** Inner HTML of the element whose opening tag ends at `from`, by tag balance. */
function innerHtml(html, tagName, from) {
  const open = new RegExp(`<${tagName}\\b`, 'gi')
  const close = new RegExp(`</${tagName}\\s*>`, 'gi')
  let depth = 1
  let i = from
  while (depth > 0) {
    open.lastIndex = i
    close.lastIndex = i
    const o = open.exec(html)
    const c = close.exec(html)
    if (!c) return html.slice(from)
    if (o && o.index < c.index) {
      depth += 1
      i = o.index + o[0].length
    } else {
      depth -= 1
      if (depth === 0) return html.slice(from, c.index)
      i = c.index + c[0].length
    }
  }
  return ''
}

const VOID_ELEMENTS = new Set([
  'img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area',
  'base', 'col', 'embed', 'param', 'track', 'wbr',
])
/** Elements inside a panel that draw nothing and so need no layer kind. */
const NON_VISUAL = new Set(['style', 'script', 'template'])

/**
 * Direct element children of every panel, with the panel index.
 *
 * Depth matters: a shape nested *inside* a decor block is that block's business
 * — decor is free HTML/CSS — but an element sitting directly in the panel is a
 * layer, and if it is not labelled as one the editor cannot see it at all.
 *
 * A **group** is the one nesting that is not opaque: its children are layers
 * too, so the same rule applies one level down. That is the whole difference
 * between the two container kinds — decor hides what is inside it, a group
 * exposes it.
 */
function* panelChildren(html) {
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
  const panelRe = /<section((?:[^>"']|"[^"]*"|'[^']*')*?)>/g
  let open
  while ((open = panelRe.exec(html))) {
    const index = attr(open[1], 'data-panel')
    if (index === null) continue

    let depth = 0
    tagRe.lastIndex = open.index + open[0].length
    let t
    while ((t = tagRe.exec(html))) {
      const [, closing, rawName, attrs, selfClose] = t
      const name = rawName.toLowerCase()
      if (closing) {
        if (name === 'section' && depth === 0) break // end of this panel
        depth -= 1
        continue
      }
      if (depth === 0 && !NON_VISUAL.has(name)) yield { panel: index, name, attrs }
      if (!selfClose && !VOID_ELEMENTS.has(name)) depth += 1
    }
  }
}

/**
 * Direct element children of every `data-layer="group"` block, with the panel
 * index of the group they belong to.
 *
 * Reuses the same balance-tracking approach as {@link panelChildren}: walk from
 * the group's opening tag, count depth, and yield only what sits at depth 0.
 */
function* groupChildren(html) {
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
  const groupRe = /<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)>/g
  let open
  while ((open = groupRe.exec(html))) {
    if (attr(open[2], 'data-layer') !== 'group') continue
    const name = open[1].toLowerCase()
    if (VOID_ELEMENTS.has(name)) continue
    // Which panel is this group in? The last panel opened before it.
    let panel = '?'
    const panelRe = /<section((?:[^>"']|"[^"]*"|'[^']*')*?)>/g
    let ps
    while ((ps = panelRe.exec(html)) && ps.index < open.index) {
      const idx = attr(ps[1], 'data-panel')
      if (idx !== null) panel = idx
    }

    let depth = 0
    tagRe.lastIndex = open.index + open[0].length
    let t
    while ((t = tagRe.exec(html))) {
      const [, closing, rawName, attrs, selfClose] = t
      const child = rawName.toLowerCase()
      if (closing) {
        if (child === name && depth === 0) break // end of this group
        depth -= 1
        continue
      }
      if (depth === 0 && !NON_VISUAL.has(child)) yield { panel, name: child, attrs, index: t.index }
      if (!selfClose && !VOID_ELEMENTS.has(child)) depth += 1
    }
  }
}

/**
 * Root-relative URLs resolve against two different trees, the same two the
 * renderer serves: /strips/** is the strip's own images/ and screenshots/,
 * which live wherever the project is, and everything else is the toolkit's.
 * With no stripsRoot both fall back to the toolkit, which is what a repo-local
 * run has always done.
 *
 * Without this split, a strip designed outside the toolkit reports every one of
 * its own screenshots as missing — a wall of errors about correct markup.
 */
async function exists(rootRelUrl, stripsRoot = null) {
  const clean = rootRelUrl.split('?')[0].split('#')[0].replace(/^\/+/, '')
  const abs = stripsRoot && clean.startsWith('strips/')
    ? path.join(stripsRoot, clean.slice('strips/'.length))
    : path.join(REPO_ROOT, clean)
  try {
    await fs.access(abs)
    return true
  } catch {
    return false
  }
}

export async function checkStrip(html, label, { stripsRoot = null } = {}) {
  // Sets, not arrays: one missing screenshot referenced by five panels is one
  // problem to fix, not five lines of noise.
  const errors = new Set()
  const warnings = new Set()
  const E = (m) => errors.add(m)
  const W = (m) => warnings.add(m)

  // --- document shape -----------------------------------------------------
  const stripCount = [...html.matchAll(/class\s*=\s*"[^"]*\bstrip\b[^"]*"/g)].length
  if (stripCount === 0) {
    // Not a strip document. composer/test/ also holds fixtures like
    // pose-test.html — a grid of every pose, which is not and should not be a
    // panel strip. Checking it against this contract produces only noise.
    return { label, errors: [], warnings: [], isStrip: false }
  }
  if (stripCount > 1) E(`${stripCount} elements carry class "strip"; there must be exactly one`)

  const panelIndexes = [...html.matchAll(/\bdata-panel\s*=\s*"(\d+)"/g)].map((m) => Number(m[1]))
  if (panelIndexes.length === 0) E('no `<section data-panel="N">` panels found')
  panelIndexes.forEach((n, i) => {
    if (n !== i) E(`panel indexes must be 0-based and sequential; found ${n} at position ${i}`)
  })

  // --- boilerplate --------------------------------------------------------
  const usesDevices = /\bdata-device\b/.test(html)
  const hasRuntime = /src\s*=\s*"[^"]*\/composer\/device-frames\.mjs"/.test(html)
  if (usesDevices && !hasRuntime) {
    E('device blocks present but /composer/device-frames.mjs is not loaded — they will never build')
  }
  const framesRoot = html.match(/framesRoot\s*:\s*'([^']*)'|framesRoot\s*:\s*"([^"]*)"/)
  if (framesRoot) {
    const value = framesRoot[1] ?? framesRoot[2]
    if (value.includes('web_ui')) {
      W(`sets framesRoot to "${value}" — the legacy path. New strips omit framesRoot and inherit /composer`)
    } else {
      W(`sets framesRoot to "${value}"; the default /composer is normally correct`)
    }
  }

  // --- blocks -------------------------------------------------------------
  // Source offsets of every block that a group lays out. Those are exempt from
  // the absolute-positioning rule: a flex or block child *should* be static, and
  // the group is what places it. The rule exists for blocks sitting directly in
  // a panel, where static means the editor cannot move them at all.
  const groupChildOffsets = new Set([...groupChildren(html)].map((c) => c.index))

  let blocks = 0
  for (const t of tags(html)) {
    const kind = attr(t.attrs, 'data-layer')
    const isDevice = attr(t.attrs, 'data-device') !== null
    if (kind === null && !isDevice) continue
    blocks += 1

    const where = `<${t.name} data-layer="${kind ?? '(none)'}">`
    if (kind !== null && !LAYER_KINDS.has(kind)) {
      E(`${where} unknown data-layer kind "${kind}"; expected one of ${[...LAYER_KINDS].join(', ')}`)
    }

    const style = attr(t.attrs, 'style') ?? ''
    const position = styleProp(style, 'position')
    const laidOutByGroup = groupChildOffsets.has(t.index)
    if (position !== 'absolute' && position !== 'fixed' && !laidOutByGroup) {
      E(`${where} is not absolutely positioned — it cannot be moved by writing left/top, so the editor cannot place it`)
    }

    if (kind === 'text') {
      const role = attr(t.attrs, 'data-role')
      if (role === null) E(`${where} has no data-role`)
      else if (!TEXT_ROLES.has(role)) E(`${where} data-role="${role}" is not one of ${[...TEXT_ROLES].join(', ')}`)

      const inner = innerHtml(html, t.name, t.index + t.raw.length)
      const stray = inner.replace(/<br\s*\/?>/gi, '').match(/<([a-zA-Z][\w-]*)/)
      if (stray) {
        E(`${where} contains <${stray[1]}>; a text block may hold text and <br> only — the editor discards anything else on first edit`)
      }
    }

    if (isDevice) {
      for (const required of ['data-pack', 'data-pose']) {
        if (!attr(t.attrs, required)) E(`${where} missing ${required}`)
      }
      if (!styleProp(style, 'width')) E(`${where} has no CSS width; width is what sets a device's scale`)
      const h = styleProp(style, 'height')
      if (h) E(`${where} sets height:${h} — never set a device height; it follows the pose viewBox aspect`)
      const fit = attr(t.attrs, 'data-fit')
      if (fit !== null && fit !== 'cover' && fit !== 'stretch') {
        W(`${where} data-fit="${fit}" is not cover or stretch; anything but cover behaves as stretch`)
      }
    }

    if (kind === 'image') {
      const src = attr(t.attrs, 'src')
      if (!src) E(`${where} has no src; an <img> with no source lays out at zero height and is invisible`)
      else if (src.includes('placeholder.svg')) W(`${where} still shows the editor placeholder`)
    }

    // An <img> labelled decor exports perfectly and is *almost* editable — the
    // editor selects and moves it, then offers the decor inspector: background
    // and border, no src field, no library picker, no object-fit. So the one
    // thing you actually want to change about a picture is the one thing you
    // cannot. A warning rather than an error, because decor is by definition
    // free HTML and an <img> is legal inside one.
    if (t.name === 'img' && kind === 'decor') {
      W(
        `${where} is an <img> labelled decor — the editor will offer background and border but no src, ` +
          `library picker or object-fit. Use data-layer="image" unless this is deliberate`,
      )
    }
  }
  if (blocks === 0) W('no layer blocks found')

  // --- unlabelled elements -------------------------------------------------
  // The failure this catches is quiet and nasty: the element renders correctly
  // in the export, so nothing looks wrong, but the editor's registry only knows
  // `[data-layer], [data-device]` — so the block cannot be clicked, dragged,
  // deleted or found in the layer tree. The design ships fine and is
  // uneditable, which is the worst combination to discover late.
  for (const child of panelChildren(html)) {
    if (attr(child.attrs, 'data-layer') !== null || attr(child.attrs, 'data-device') !== null) continue
    const hint = attr(child.attrs, 'class')
    const what = `<${child.name}${hint ? ` class="${hint}"` : ''}>`
    E(
      `panel ${child.panel}: ${what} has no data-layer — it renders but the editor cannot select it. ` +
        `Decorative shapes need data-layer="decor"`,
    )
  }

  // Same rule, one level in. A group announces that its children are layers, so
  // an unlabelled one inside it is the same quiet failure: it renders, and the
  // editor cannot select it. Wrap loose text in a text block, or use decor if
  // the contents were never meant to be edited separately.
  for (const child of groupChildren(html)) {
    if (attr(child.attrs, 'data-layer') !== null || attr(child.attrs, 'data-device') !== null) continue
    const hint = attr(child.attrs, 'class')
    const what = `<${child.name}${hint ? ` class="${hint}"` : ''}>`
    E(
      `panel ${child.panel}: ${what} inside a group has no data-layer — a group's children are ` +
        `layers, so the editor cannot select it. Label it, or make the container data-layer="decor" ` +
        `if its parts are not meant to be edited`,
    )
  }

  // --- frame packs --------------------------------------------------------
  // Three things about `data-pack` that only the catalogue can answer. They
  // matter more now that a run *chooses* the pack rather than copying whichever
  // id it saw in an example: a wrong choice used to be impossible because a
  // human picked from a dropdown the editor had already filtered by type.
  //
  // The type check is the load-bearing one. `device-frames/README.md` records
  // what it costs to get wrong: screen quads differ by aspect, `data-fit="cover"`
  // crops the capture to fit, and an iPad screenshot at 0.750 dropped into an
  // iPhone frame "silently loses 38% of its width". Silently — it renders, it
  // exports, and nothing says a word.
  const packs = [...html.matchAll(/\bdata-pack\s*=\s*"([^"]*)"/g)].map((m) => m[1])
  if (packs.length > 0) {
    let catalogue = null
    try {
      const raw = await fs.readFile(path.join(REPO_ROOT, 'composer/device-frames/index.json'), 'utf8')
      catalogue = (JSON.parse(raw).devices ?? [])
        .map((d) => ({ id: String(d.path ?? '').split('/').filter(Boolean)[1], type: d.type ?? '' }))
        .filter((d) => Boolean(d.id))
    } catch {
      W('composer/device-frames/index.json is unreadable; frame packs were not checked')
    }
    if (catalogue) {
      const known = new Map(catalogue.map((p) => [p.id, p.type]))
      for (const id of new Set(packs)) {
        if (!known.has(id)) {
          E(`unknown frame pack "${id}" — the catalogue has: ${[...known.keys()].join(', ')}`)
        }
      }
      // One body per strip. Two different phones across panels of one set reads
      // as a mistake rather than as rhythm, and the run picks once.
      const distinct = [...new Set(packs)]
      if (distinct.length > 1) {
        E(`a strip uses one frame pack; found ${distinct.length}: ${distinct.join(', ')}`)
      }
      // A pose must exist in the pack that names it. The catalogue answers
      // "is this pack real"; only the pack's own frame.json answers "does it
      // have this view". Getting it wrong is not silent — device-frames.mjs
      // throws `pose "x" not found in pack "y"` and the export fails — but it
      // fails *after* a browser launch and a page load, which in a pipeline is
      // minutes rather than the millisecond a file read costs here.
      for (const id of distinct) {
        if (!known.has(id)) continue          // already reported as unknown
        let available = null
        try {
          const raw = await fs.readFile(path.join(REPO_ROOT, 'composer/device-frames', id, 'frame.json'), 'utf8')
          available = (JSON.parse(raw).frames ?? []).map((f) => f.name).filter(Boolean)
        } catch {
          W(`composer/device-frames/${id}/frame.json is unreadable; poses were not checked`)
        }
        if (available?.length) {
          const poses = new Set([...html.matchAll(/\bdata-pose\s*=\s*"([^"]*)"/g)].map((m) => m[1]))
          for (const pose of poses) {
            if (!available.includes(pose)) {
              E(`pose "${pose}" is not in pack "${id}" — it has: ${available.join(', ')}`)
            }
          }
        }
      }
      // A pack's type must equal the strips/ folder the document lives in. Only
      // checkable when the label is that path — the templates are checked by
      // name, and guessing a target for them would invent an error.
      const folder = /(?:^|[\\/])strips[\\/]([^\\/]+)[\\/]/.exec(label ?? '')?.[1]
      if (folder) {
        for (const id of distinct) {
          const type = known.get(id)
          if (type !== undefined && type !== folder) {
            E(
              `frame pack "${id}" is type "${type}" but this strip is in strips/${folder}/ — ` +
                `the capture is cropped to the frame's screen quad, so a mismatched pack silently loses part of it`,
            )
          }
        }
      }
    }
  }

  // --- assets -------------------------------------------------------------
  // A document names a file in two places: an attribute, and CSS `url()`. Both
  // are scanned, because `@font-face` lives only in the second one — the
  // no-external-assets rule used to be enforced against `<link href>`, the form
  // nobody writes, and not against `src: url(https://fonts.gstatic.com/…)`, the
  // form a web font actually arrives in. The on-disk half matters as much: a
  // mistyped local font path renders as the fallback face, and neither
  // `document.fonts.ready` nor `window.__composerErrors` says a word about it,
  // so the export succeeds and the wrong typeface ships.
  const asset = async (url, where) => {
    if (/^(https?:)?\/\//i.test(url)) {
      E(`external network asset "${url}"${where} — everything must resolve from the repo`)
      return
    }
    if (!url.startsWith('/')) return
    if (!(await exists(url, stripsRoot))) E(`asset not found on disk: ${url}${where}`)
  }
  for (const m of html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) await asset(m[1], '')
  for (const m of html.matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)/g)) {
    await asset(m[1] ?? m[2] ?? m[3] ?? '', ' in CSS url()')
  }
  for (const m of html.matchAll(/\bdata-screenshot\s*=\s*"([^"]+)"/g)) {
    if (!(await exists(m[1], stripsRoot))) E(`data-screenshot not found on disk: ${m[1]}`)
  }

  return { label, errors: [...errors], warnings: [...warnings], isStrip: stripCount > 0 }
}

/**
 * Frame-pack geometry: does each pose still satisfy the contract?
 *
 * Separate from {@link checkStrip} because it checks a *pack*, not a document —
 * a broken pack is broken for every strip that uses it, and reporting it once
 * per strip would bury it. `--all` runs this first so `npm run check` covers it.
 *
 * The contract, restated:
 *
 *   `frame.json.corners` is a warp target in viewBox space that must fully
 *   contain the `#screen` aperture. The clip is always derived from the SVG.
 *
 * Only the first half needs checking — the second half is now structural, since
 * `device-frames.mjs` has no way to clip with anything but the aperture. What it
 * cannot check for itself is whether the numbers a human transcribed out of
 * `mask_analysis` still describe the SVG sitting next to them. That is what
 * drifts, and nothing used to notice.
 */
export async function checkPacks() {
  const errors = []
  const warnings = []
  const rows = []
  const E = (m) => errors.push(m)
  const W = (m) => warnings.push(m)

  const framesDir = path.join(REPO_ROOT, 'composer/device-frames')
  let catalogue
  try {
    catalogue = JSON.parse(await fs.readFile(path.join(framesDir, 'index.json'), 'utf8')).devices ?? []
  } catch (err) {
    return { errors: [`composer/device-frames/index.json is unreadable: ${err.message}`], warnings, rows }
  }

  for (const dev of catalogue) {
    const id = String(dev.path ?? '').split('/').filter(Boolean)[1]
    if (!id) continue
    let pack
    try {
      pack = JSON.parse(await fs.readFile(path.join(framesDir, id, 'frame.json'), 'utf8'))
    } catch (err) {
      E(`${id}: frame.json is unreadable: ${err.message}`)
      continue
    }
    for (const frame of pack.frames ?? []) {
      const where = `${id}/${frame.name}`
      const rel = String(frame.framePath ?? '').replace(/^\/device-frames\//, '')
      let svgText
      try {
        svgText = await fs.readFile(path.join(framesDir, rel), 'utf8')
      } catch (err) {
        E(`${where}: framePath does not resolve: ${frame.framePath}`)
        continue
      }

      const geo = screenOutline(svgText)
      if (!geo.points) {
        // The old runtime answered this by inventing a rounded quad from the
        // corners. Now it throws, so the check has to be an error too.
        E(`${where}: ${geo.problems.join('; ')}`)
        continue
      }
      const vb = geo.viewBox
      if (vb.x !== 0 || vb.y !== 0) {
        E(`${where}: viewBox starts at (${vb.x}, ${vb.y}); poses must be exported from the origin`)
      }
      if (!isIdentityAffine(geo.worldMatrix)) {
        W(`${where}: #screen sits under a transform, so the clip ships as a sampled polygon rather than curves`)
      }

      // The stage size comes from the viewBox. A frame.json that disagrees is
      // inert today and misleading tomorrow: it is the first number a person
      // reads when they come to measure the next pack.
      if (frame.viewWidth != null && Math.abs(frame.viewWidth - vb.width) > 0.5) {
        E(`${where}: viewWidth ${frame.viewWidth} but the SVG viewBox is ${vb.width} wide (the viewBox wins)`)
      }
      if (frame.viewHeight != null && Math.abs(frame.viewHeight - vb.height) > 0.5) {
        E(`${where}: viewHeight ${frame.viewHeight} but the SVG viewBox is ${vb.height} tall (the viewBox wins)`)
      }

      for (const dead of ['clipCornerRadiusPx', 'clipCornerRadiiPx']) {
        if (frame[dead] != null) {
          W(`${where}: "${dead}" is read by nothing since the clip comes from the aperture — safe to delete`)
        }
      }

      const c = frame.corners
      if (!c?.TL || !c?.TR || !c?.BR || !c?.BL) {
        E(`${where}: frame.json needs corners TL, TR, BR, BL`)
        continue
      }
      const quad = [c.TL, c.TR, c.BR, c.BL]
      const report = containmentReport(quad, geo.points)
      if (!report.convex) {
        E(`${where}: corners do not form a convex quad, so the warp is undefined`)
      } else if (report.outsideCount > 0) {
        const suggestion = enclosingQuad(geo.points, { outset: 1 })
          .map((p) => `[${p.map((v) => Math.round(v * 100) / 100).join(', ')}]`)
          .join(' ')
        E(
          `${where}: the #screen aperture escapes the corners quad by ${report.maxOutside.toFixed(2)} viewBox units ` +
            `at ${report.outsideCount}/${geo.points.length} sampled points (worst near ` +
            `${report.worstPoint.map((v) => Math.round(v * 10) / 10).join(', ')}). The screenshot is warped onto the ` +
            `quad and clipped to the aperture, so the uncovered strip renders as panel background. ` +
            `A quad that encloses it: ${suggestion}`,
        )
      }
      rows.push({
        where,
        tag: geo.tag,
        points: geo.points.length,
        margin: -report.maxOutside,
        ok: report.ok && errors.length === 0,
      })
    }
  }
  return { errors, warnings, rows }
}

/** The example inside strip-schema.md — the doc must not teach markup it forbids. */
async function skeletonFromSchema() {
  const doc = await fs.readFile(path.join(REPO_ROOT, 'composer/strip-schema.md'), 'utf8')
  const blocks = [...doc.matchAll(/```html\n([\s\S]*?)```/g)].map((m) => m[1])
  const skeleton = blocks.find((b) => b.includes('<!doctype html>'))
  if (!skeleton) throw new Error('no full-document example found in composer/strip-schema.md')
  // The example names a screenshot inside a strip folder that does not exist —
  // it is documentation, not a strip. Drop the attribute rather than pointing it
  // at some real file elsewhere: a device with no `data-screenshot` renders a
  // blank screen, which the schema calls a legitimate design choice, so the
  // structural check runs clean instead of reporting a missing asset every time.
  return skeleton.replace(/\s*data-screenshot="[^"]*"/g, '')
}

/**
 * Every strip in the repo: `strips/<name>/strip.html` (one folder per strip,
 * with its images and renders beside it) plus the flat fixtures in
 * `composer/test/`. One level of nesting, deliberately — a strip folder holds a
 * strip, not a tree of them.
 */
async function findStrips() {
  const out = []
  for (const dir of ['strips', 'composer/test']) {
    const abs = path.join(REPO_ROOT, dir)
    let entries = []
    try {
      entries = await fs.readdir(abs, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.html')) {
        out.push(path.join(abs, e.name))
      } else if (e.isDirectory()) {
        let inner = []
        try {
          inner = await fs.readdir(path.join(abs, e.name))
        } catch {
          continue
        }
        for (const n of inner) {
          if (n.toLowerCase().endsWith('.html')) out.push(path.join(abs, e.name, n))
        }
      }
    }
  }
  return out
}

// Only run the CLI when invoked directly. `checkStrip` is imported by
// strip_editor's contract test, which must not trigger a process.exit.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2)

  // --strips-root is pulled out before anything else reads args[0] as a mode.
  // It names where strip folders live, so that /strips/** in a document resolves
  // there rather than under the toolkit — the same split render.mjs makes.
  let stripsRoot = null
  const args = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--strips-root') { stripsRoot = path.resolve(argv[++i] ?? ''); continue }
    args.push(argv[i])
  }

  if (args.length === 0) {
    console.error('usage: node composer/check-schema.mjs [--strips-root <dir>] <file.html> [...] | --all | --packs | --skeleton')
    process.exit(2)
  }
  
  let failed = 0
  const report = ({ label, errors, warnings, isStrip }, { explicit }) => {
    if (!isStrip) {
      // Asked about this file by name: say why nothing was checked, rather than
      // reporting a clean bill of health for a file that was never examined.
      console.log(`SKIP  ${label}  (no .strip root — not a strip document)`)
      if (explicit) failed += 0
      return
    }
    if (errors.length) failed += 1
    console.log(`${errors.length ? 'FAIL' : warnings.length ? 'WARN' : 'OK  '}  ${label}`)
    for (const e of errors) console.log(`        error: ${e}`)
    for (const w of warnings) console.log(`        warn:  ${w}`)
  }
  
  // Pack geometry is a property of the catalogue, not of any one strip, so it
  // runs once — before the documents, because a strip that looks clean on top of
  // a pack whose corners have drifted is a misleading kind of clean.
  if (args[0] === '--all' || args[0] === '--packs') {
    const { errors, warnings, rows } = await checkPacks()
    for (const r of rows) {
      console.log(
        `${'PACK'}  ${r.where.padEnd(28)} <${r.tag}>  ${String(r.points).padStart(4)} pts  ` +
          `margin ${r.margin >= 0 ? '+' : ''}${r.margin.toFixed(2)}u`,
      )
    }
    for (const e of errors) console.log(`        error: ${e}`)
    for (const w of warnings) console.log(`        warn:  ${w}`)
    if (errors.length) failed += 1
    if (args[0] === '--packs') process.exit(failed ? 1 : 0)
  }

  if (args[0] === '--skeleton') {
    const html = await skeletonFromSchema()
    report(await checkStrip(html, 'composer/strip-schema.md § Skeleton', { stripsRoot }), { explicit: true })
  } else {
    const files = args[0] === '--all' ? await findStrips() : args.map((a) => path.resolve(a))
    for (const file of files) {
      const html = await fs.readFile(file, 'utf8')
      // Files outside the repo (a scratch copy, say) relativise to a stack
      // of `../` that tells the reader nothing; show those as given.
      const rel = file.startsWith(REPO_ROOT + path.sep) ? path.relative(REPO_ROOT, file) : file
      report(await checkStrip(html, rel, { stripsRoot }), { explicit: args[0] !== '--all' })
    }
  }
  process.exit(failed ? 1 : 0)
}
