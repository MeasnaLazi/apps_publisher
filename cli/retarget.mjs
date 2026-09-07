import path from 'node:path'
import { promises as fs } from 'node:fs'
import { EXIT } from './exit-codes.mjs'
import { checkSchemaFile, renderFile, verdict, exists } from './gate.mjs'

/**
 * Retarget a strip to a different store size.
 *
 * The naive version of this is `sed 's/1290px/1284px/'`, and it is subtly
 * wrong: it changes the canvas and leaves everything positioned inside it where
 * it was. A horizon line at `top: 2398px` — 85.8% of a 2796px panel — silently
 * becomes 86.3% of a 2778px one. Six pixels of drift nobody notices until the
 * device no longer sits on the line.
 *
 * The correct operation is to scale EVERY length by the same factor, so the
 * composition moves as one piece. That is what this does, to px values inside
 * <style> blocks and style="" attributes — not to arbitrary text, so a caption
 * that happens to say "1290px" is left alone.
 *
 * The residual: a single factor cannot hit both dimensions when the aspect
 * ratios differ slightly (1290×2796 is 0.46137, 1284×2778 is 0.46220). We scale
 * by WIDTH, so full-bleed elements still span the panel exactly — a horizontal
 * seam at the edge is visible, a few pixels off the bottom is not — and then
 * snap the panel box to the exact target height. The difference is reported in
 * pixels rather than hidden.
 */

const trim = (v) => String(Math.round(v * 100) / 100)
const escapeNum = (n) => String(n).replace(/\./g, '\\.')
const scaleLengths = (css, k) => css.replace(/(-?\d*\.?\d+)px/g, (_, n) => `${trim(+n * k)}px`)

/** First `width: Npx; height: Mpx` pair — in a strip, the panel box. */
export function detectPanelSize(html) {
  const m = html.match(/width:\s*(\d+(?:\.\d+)?)px;\s*height:\s*(\d+(?:\.\d+)?)px/)
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null
}

export function retargetHtml(html, { fromW, fromH, toW, toH }) {
  const k = toW / fromW

  // Only inside style contexts. Copy text is not geometry.
  let out = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, open, css, close) => open + scaleLengths(css, k) + close)
  out = out.replace(/\bstyle\s*=\s*"([^"]*)"/gi, (_, css) => `style="${scaleLengths(css, k)}"`)

  // Snap the panel box: scaling by width leaves the height a few px out.
  const scaledH = trim(fromH * k)
  const pattern = new RegExp(`width:(\\s*)${escapeNum(trim(toW))}px;(\\s*)height:(\\s*)${escapeNum(scaledH)}px`, 'g')
  const snapped = pattern.test(out)
  out = out.replace(pattern, `width:$1${toW}px;$2height:$3${toH}px`)

  return { html: out, k, scaledH: Number(scaledH), residual: Number((fromH * k - toH).toFixed(2)), snapped }
}

/** A retarget preserves the composition. A different shape is a redesign. */
export function aspectDrift({ fromW, fromH, toW, toH }) {
  const a = fromW / fromH
  const b = toW / toH
  return Math.abs(b - a) / a
}

const say = (msg) => process.stderr.write(`design-ss: ${msg}\n`)

/**
 * Orchestration. Writes a sibling document rather than overwriting the source:
 * one strip folder can hold several store sizes, sharing screenshots/ and
 * images/, and the folder name still matches the frame pack's type so the
 * checker's target rule keeps working.
 *
 *   strips/iphone/strip.html                 the source
 *   strips/iphone/strip-1284x2778.html       this
 *   strips/iphone/rendered-1284x2778/        its PNGs
 */
export async function retarget(roots, { target, size, fromSize, skipRender }) {
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(String(size).trim())
  if (!m) { say(`--size must look like 1284x2778, got "${size}"`); return EXIT.USAGE }
  const toW = Number(m[1]); const toH = Number(m[2])

  const srcRel = path.join('strips', target, 'strip.html')
  const srcAbs = path.join(roots.stripsDir, target, 'strip.html')
  if (!await exists(srcAbs)) { say(`no ${srcAbs} to retarget`); return EXIT.NO_OUTPUT }
  const html = await fs.readFile(srcAbs, 'utf8')

  let from = null
  if (fromSize) {
    const f = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(String(fromSize).trim())
    if (!f) { say(`--from-size must look like 1290x2796`); return EXIT.USAGE }
    from = { w: Number(f[1]), h: Number(f[2]) }
  } else {
    from = detectPanelSize(html)
    if (!from) { say(`could not find the panel size in ${srcRel}; pass --from-size <WxH>`); return EXIT.USAGE }
  }
  if (from.w === toW && from.h === toH) { say(`already ${toW}x${toH}; nothing to do`); return EXIT.OK }

  const drift = aspectDrift({ fromW: from.w, fromH: from.h, toW, toH })
  if (drift > 0.01) {
    say(`${from.w}x${from.h} and ${toW}x${toH} differ in shape by ${(drift * 100).toFixed(1)}%`)
    say(`  a retarget rescales a composition; it cannot re-lay-out one. Design this size instead.`)
    return EXIT.USAGE
  }

  const out = retargetHtml(html, { fromW: from.w, fromH: from.h, toW, toH })
  const variantRel = path.join('strips', target, `strip-${toW}x${toH}.html`)
  await fs.writeFile(path.join(roots.stripsDir, target, `strip-${toW}x${toH}.html`), out.html)

  say(`${from.w}x${from.h} -> ${toW}x${toH}  (every length x${out.k.toFixed(6)})`)
  if (!out.snapped) say(`  note: the panel box was not found to snap; the render check below will catch it`)
  if (Math.abs(out.residual) >= 1) {
    say(`  the shapes differ slightly: ${Math.abs(out.residual).toFixed(1)}px ${out.residual > 0 ? 'trimmed from' : 'added to'} the panel height — look at the bottom edge`)
  }
  say(`  wrote ${variantRel}`)

  const checked = await checkSchemaFile(roots, variantRel)
  if (checked.code !== 0) { say(`check-schema exited ${checked.code}`); return EXIT.GATE }
  say('schema clean')
  if (skipRender) { say('render skipped (--no-render)'); return EXIT.OK }

  const outRel = path.join('strips', target, `rendered-${toW}x${toH}`)
  const rendered = await renderFile(roots, variantRel, outRel)
  if (rendered.code !== 0) {
    say(`render exited ${rendered.code}`)
    if (rendered.output.trim()) process.stderr.write(`${rendered.output.trim()}\n`)
    return EXIT.GATE
  }

  // The point of the command is an exact size. Prove it rather than assume it.
  const panels = rendered.data?.panels ?? []
  const wrong = panels.filter((p) => p.width !== toW || p.height !== toH)
  if (!panels.length || wrong.length) {
    say(`rendered ${panels.length} panel(s), ${wrong.length} at the wrong size:`)
    for (const p of wrong.slice(0, 5)) say(`    panel ${p.panel}: ${p.width}x${p.height}, wanted ${toW}x${toH}`)
    return EXIT.GATE
  }

  const { errors, warnings } = verdict(rendered.data)
  say(`rendered ${panels.length} panel(s) at ${toW}x${toH}, ${errors.length} error(s), ${warnings.length} warning(s)`)
  say(`  ${outRel}/ — look at them before you ship; forced line breaks are what a rescale disturbs`)
  if (errors.length) return EXIT.GATE
  if (warnings.length) return EXIT.WARNINGS
  return EXIT.OK
}
