/**
 * Composer render CLI: strip HTML → export-size PNGs via headless Chromium.
 *
 * Usage (from repo root or composer/):
 *   node composer/render.mjs --strip strips/hello-world/strip.html
 *
 * Flags:
 *   --strip <path>            strip HTML file (relative to repo root or absolute)  [required]
 *   --out <dir>               output directory (default: <strip folder>/rendered)
 *   --panel-selector <sel>    panel elements to screenshot (default: [data-panel])
 *   --full                    also save the whole strip as strip.png
 *   --scale <n>               deviceScaleFactor (default 1 — panels are authored at export size)
 *   --timeout <ms>            ready-wait timeout (default 30000)
 *   --strips-root <dir>       where strip folders live (default: <toolkit>/strips).
 *                             Served at /strips/; the toolkit is served at /.
 *
 * The page is served over a local static file server rooted at the repo root,
 * so strip HTML can reference /composer/** (device frames, the runtime) and
 * /strips/** (each strip's own images/ and screenshots/).
 * Waits for window.__composerReady (set by device-frames.mjs) when the page
 * uses composer runtime; otherwise waits for load + fonts.
 */
import http from 'node:http'
import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

function parseArgs(argv) {
  const args = { out: null, panelSelector: '[data-panel]', scale: 1, timeout: 30000, full: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--strip') args.strip = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--panel-selector') args.panelSelector = argv[++i]
    else if (a === '--full') args.full = true
    else if (a === '--scale') args.scale = Number(argv[++i])
    else if (a === '--timeout') args.timeout = Number(argv[++i])
    else if (a === '--strips-root') args.stripsRoot = argv[++i]
    else throw new Error(`unknown flag: ${a}`)
  }
  if (!args.strip) throw new Error('--strip <file.html> is required')
  return args
}

/**
 * Two mounts, not one root.
 *
 * A strip references two different trees by root-relative URL: /composer/**
 * (device frames, fonts, the runtime — always the toolkit) and /strips/**
 * (its own images/ and screenshots/ — wherever the work root happens to be).
 * When the toolkit is installed somewhere and pointed at another project those
 * are different directories, so one static root cannot serve both.
 *
 * Strip markup is unchanged by this: /strips/<name>/images/x.png is a server
 * path, not a disk path, and it keeps resolving.
 */
export function startStaticServer({ toolkitRoot, stripsRoot }) {
  const mounts = [
    ['/strips/', stripsRoot],
    ['/', toolkitRoot],
  ]
  const server = http.createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
      // Device frames moved from web_ui/public/ to composer/. Strips authored
      // before the move hardcode `framesRoot: '/web_ui/public'`, so the old
      // prefix is aliased rather than the files being rewritten.
      if (urlPath.startsWith('/web_ui/public/device-frames/')) {
        urlPath = urlPath.replace('/web_ui/public/device-frames/', '/composer/device-frames/')
      }
      const [prefix, root] = mounts.find(([m]) => urlPath.startsWith(m))
      const filePath = path.normalize(path.join(root, urlPath.slice(prefix.length)))
      if (filePath !== root && !filePath.startsWith(root + path.sep)) { res.writeHead(403).end(); return }
      const data = await fs.readFile(filePath)
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream' })
      res.end(data)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

async function main() {
  const args = parseArgs(process.argv)

  // A relative --strip is resolved against the cwd first, then the toolkit, so
  // `node composer/render.mjs --strip strips/x/strip.html` keeps working from
  // the repo root and from composer/.
  let stripAbs = path.isAbsolute(args.strip) ? args.strip : path.resolve(process.cwd(), args.strip)
  if (!existsSync(stripAbs)) stripAbs = path.resolve(REPO_ROOT, args.strip)

  // Where strip folders live. Defaults to the toolkit's own strips/, which is
  // what a repo-local run has always used.
  const stripsRoot = args.stripsRoot
    ? path.resolve(process.cwd(), args.stripsRoot)
    : path.join(REPO_ROOT, 'strips')

  // Serve the strip from whichever mount contains it.
  const relStrips = path.relative(stripsRoot, stripAbs)
  const relToolkit = path.relative(REPO_ROOT, stripAbs)
  let pageUrl
  if (!relStrips.startsWith('..')) pageUrl = `/strips/${relStrips.split(path.sep).join('/')}`
  else if (!relToolkit.startsWith('..')) pageUrl = `/${relToolkit.split(path.sep).join('/')}`
  else throw new Error(`strip must live inside the strips root (${stripsRoot}) or the toolkit (${REPO_ROOT})`)

  // Default the output beside the strip — <strip folder>/rendered/ — so a
  // render belongs to the design that produced it and is deleted with it.
  const out = args.out ?? path.join(path.dirname(stripAbs), 'rendered')
  const outDir = path.isAbsolute(out) ? out : path.resolve(process.cwd(), out)
  await fs.mkdir(outDir, { recursive: true })

  const { server, port } = await startStaticServer({ toolkitRoot: REPO_ROOT, stripsRoot })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: args.scale })
    page.on('console', (msg) => { if (msg.type() === 'error') console.error('[page]', msg.text()) })
    page.on('pageerror', (err) => console.error('[page]', err.message))

    await page.goto(`http://127.0.0.1:${port}${pageUrl}`, { waitUntil: 'load' })

    // Wait for composer runtime (if present) and fonts.
    await page.waitForFunction(
      () => (typeof window.__composerReady === 'undefined' ? document.readyState === 'complete' : window.__composerReady === true),
      undefined,
      { timeout: args.timeout },
    )
    await page.evaluate(() => document.fonts.ready)

    const errors = await page.evaluate(() => window.__composerErrors ?? [])
    if (errors.length) {
      console.error(JSON.stringify({ ok: false, errors }, null, 2))
      process.exitCode = 1
      return
    }

    // Size viewport to full document so nothing is virtualized/clipped.
    const size = await page.evaluate(() => ({
      w: Math.ceil(Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)),
      h: Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)),
    }))
    await page.setViewportSize({ width: Math.min(size.w, 20000), height: Math.min(size.h, 20000) })

    const panels = await page.locator(args.panelSelector).all()
    const results = []
    for (let i = 0; i < panels.length; i++) {
      const el = panels[i]
      const name = (await el.getAttribute('data-panel')) || String(i)
      const file = path.join(outDir, `panel${name}.png`)
      await el.screenshot({ path: file })
      const box = await el.boundingBox()
      results.push({ panel: name, file, width: Math.round(box?.width ?? 0) * args.scale, height: Math.round(box?.height ?? 0) * args.scale })
    }

    let stripFile = null
    if (args.full) {
      stripFile = path.join(outDir, 'strip.png')
      await page.screenshot({ path: stripFile, fullPage: true })
    }

    // Emit strip-data.json: measured layout for every block, plus the problems
    // that only a laid-out page can reveal.
    //
    // Scope is deliberately narrow. Anything the *static* checker can see —
    // dead asset paths, a device given a height, a text block full of markup —
    // belongs in composer/check-schema.mjs, which needs no browser. Anything
    // that makes a device fail to build is already fatal above, at
    // __composerErrors. What is left, and what this is for, is geometry: where
    // blocks actually landed once the browser had its say, and whether any of
    // them fell off the panel.
    //
    // Coordinates are panel-relative and **top-left**, matching the CSS the
    // editor writes and the schema documents — for every kind of block, with no
    // exception, so a number read in the inspector is the number the exporter
    // measured.
    const snapshot = await page.evaluate((panelSelector) => {
      const toHex = (rgb) => {
        const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
        if (!m) return '#000000'
        return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')
      }
      const round = (n) => Math.round(n * 10) / 10
      const problems = []
      const flag = (severity, panel, layer, message) => problems.push({ severity, panel, layer, message })

      const panels = []
      const panelEls = [...document.querySelectorAll(panelSelector)]
      panelEls.forEach((panelEl, pi) => {
        const pr = panelEl.getBoundingClientRect()
        const layers = []
        let n = 0

        for (const el of panelEl.querySelectorAll('[data-layer], [data-device]')) {
          const kind = el.getAttribute('data-layer') ?? (el.hasAttribute('data-device') ? 'device' : 'unknown')
          const r = el.getBoundingClientRect()
          const cs = getComputedStyle(el)
          const zRaw = Number.parseInt(cs.zIndex, 10)
          const z = Number.isFinite(zRaw) ? zRaw : n
          n += 1
          const id = el.dataset.layerId ?? `${kind}_${pi}_${n}`

          // How far the block sits beyond each panel edge. Zero means inside.
          // Overhang is legitimate — cropping a device at a panel edge is the
          // standard pattern — so this is reported as measurement, and only
          // becomes a problem below for the kinds where it means damage.
          const outside = {
            left: round(Math.max(0, pr.left - r.left)),
            top: round(Math.max(0, pr.top - r.top)),
            right: round(Math.max(0, r.right - pr.right)),
            bottom: round(Math.max(0, r.bottom - pr.bottom)),
          }

          const layer = {
            id,
            kind,
            z,
            x: round(r.left - pr.left),
            y: round(r.top - pr.top),
            width: round(r.width),
            height: round(r.height),
            outside,
          }

          // Entirely past an edge: it contributes nothing to the export, and
          // that is almost never deliberate.
          if (r.right <= pr.left || r.left >= pr.right || r.bottom <= pr.top || r.top >= pr.bottom) {
            flag('warning', pi, id, 'lies entirely outside its panel and will not appear in the export')
          }

          if (kind === 'text') {
            const clone = el.cloneNode(true)
            for (const br of clone.querySelectorAll('br')) br.replaceWith('\n')
            const content = (clone.textContent ?? '')
              .split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).join('\n').trim()
            layer.text = content
            layer.role = el.dataset.role ?? null
            layer.font_size = Number.parseFloat(cs.fontSize) || 0
            layer.font_family = cs.fontFamily
            layer.color = toHex(cs.color)
            layer.align = cs.textAlign === 'start' ? 'left' : cs.textAlign === 'end' ? 'right' : cs.textAlign
            layer.weight = String(cs.fontWeight)

            if (!content) flag('warning', pi, id, 'text block is empty')
            // Clipped copy is the one overhang that is nearly always a mistake:
            // a device cropped at the edge reads as design, half a word does not.
            const cut = Object.entries(outside).filter(([, v]) => v > 1)
            if (cut.length) {
              const where = cut.map(([edge, v]) => `${v}px past the ${edge}`).join(', ')
              flag('warning', pi, id, `text is clipped by the panel edge (${where})`)
            }
          } else if (kind === 'device') {
            layer.pack = el.dataset.pack ?? null
            layer.pose = el.dataset.pose ?? null
            layer.screenshot = el.dataset.screenshot ?? null
            layer.fit = el.dataset.fit ?? 'cover'
            layer.screen_fallback = el.dataset.screenFallback ?? null
            // A device that reached here built successfully — a failure would
            // have stopped the render at __composerErrors.
            layer.blank_screen = !el.dataset.screenshot
          } else if (kind === 'image') {
            layer.src = el.getAttribute('src')
            layer.natural_width = el.naturalWidth ?? 0
            layer.natural_height = el.naturalHeight ?? 0
            // Unlike a device screenshot, a plain <img> that 404s fails
            // silently: no runtime is involved, so nothing throws and the
            // export simply has a hole in it.
            if (!layer.natural_width) {
              flag('error', pi, id, `image did not load: ${layer.src ?? '(no src)'}`)
            }
            if ((layer.src ?? '').includes('placeholder.svg')) {
              flag('warning', pi, id, 'image is still the editor placeholder')
            }
          } else if (kind === 'decor' || kind === 'group') {
            layer.children = el.childElementCount
          }

          layers.push(layer)
        }

        layers.sort((a, b) => a.z - b.z)

        // --- emptiness, measured once and reported --------------------------
        // The design skill asks every run for "the union area as a fraction of
        // panel area" and the widest empty band. That is arithmetic on rects
        // this function already holds, so deriving it in a throwaway script per
        // run produced a number whose *definition* drifted between runs and
        // could never be compared. It is reported here instead, computed one
        // way, from the same `layers` records the file publishes.
        //
        // **Union, not sum.** A group and its children are both layers and
        // their boxes overlap; summing would exceed the panel. Every rect is
        // clipped to the panel first, so overhang — the standard device crop —
        // contributes only the part that survives to the export.
        //
        // Quantised to a 10px grid: ±1 cell of slop per edge, and a 1290×2796
        // panel costs 129×280 cells. Deliberately no threshold and no flag —
        // "too empty" depends on whether the panel was *meant* to be dense,
        // which is taste, and this file reports geometry.
        const CELL = 10
        const cols = Math.max(1, Math.ceil(pr.width / CELL))
        const rows = Math.max(1, Math.ceil(pr.height / CELL))
        const grid = new Uint8Array(cols * rows)
        for (const l of layers) {
          const x0 = Math.max(0, Math.floor(l.x / CELL))
          const y0 = Math.max(0, Math.floor(l.y / CELL))
          const x1 = Math.min(cols, Math.ceil((l.x + l.width) / CELL))
          const y1 = Math.min(rows, Math.ceil((l.y + l.height) / CELL))
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) grid[y * cols + x] = 1
          }
        }
        let filled = 0
        for (let i = 0; i < grid.length; i++) filled += grid[i]

        // Longest run of consecutive lines no layer touches at all, in px. A
        // *column* band is invisible to any row-by-row look, which is why both
        // axes are reported.
        const longestRun = (n, empty) => {
          let best = 0
          let run = 0
          for (let i = 0; i < n; i++) {
            if (empty(i)) { run += 1; if (run > best) best = run } else run = 0
          }
          return best * CELL
        }
        const colEmpty = (x) => {
          for (let y = 0; y < rows; y++) if (grid[y * cols + x]) return false
          return true
        }
        const rowEmpty = (y) => {
          for (let x = 0; x < cols; x++) if (grid[y * cols + x]) return false
          return true
        }

        panels.push({
          index: pi,
          width: Math.round(pr.width),
          height: Math.round(pr.height),
          coverage: Math.round((filled / (cols * rows)) * 1000) / 1000,
          longest_empty_col: longestRun(cols, colEmpty),
          longest_empty_row: longestRun(rows, rowEmpty),
          layers,
        })
      })

      const strip = document.querySelector('.strip')
      return {
        version: 1,
        strip: {
          width: Math.ceil(document.documentElement.scrollWidth),
          height: Math.ceil(document.documentElement.scrollHeight),
          gap: strip ? Number.parseFloat(getComputedStyle(strip).columnGap) || 0 : 0,
          panels: panelEls.length,
        },
        panels,
        problems,
      }
    }, args.panelSelector)

    const dataFile = path.join(outDir, 'strip-data.json')
    await fs.writeFile(dataFile, JSON.stringify(snapshot, null, 2))

    // Problems ride in the summary as well as the file. An agent reads stdout;
    // making it open strip-data.json to discover that a panel is broken is one
    // indirection too many, and the one most likely to be skipped.
    console.log(JSON.stringify({
      ok: true,
      panels: results,
      strip: stripFile,
      panelData: dataFile,
      document: size,
      problems: snapshot.problems,
    }, null, 2))
  } finally {
    await browser.close()
    server.close()
  }
}

// Only run when invoked as a command. The static server is exported so it can
// be tested without a browser, and importing this file must not start a render.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: String(err.message ?? err) }))
    process.exit(1)
  })
}
