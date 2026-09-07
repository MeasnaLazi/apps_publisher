/**
 * render.mjs's static server — the routing, which is the part that decides
 * whether a strip can live outside the toolkit at all.
 *
 * A strip references two trees by root-relative URL: /composer/** (frames,
 * fonts, the runtime — always the toolkit) and /strips/** (its own images/ and
 * screenshots/ — wherever the project is). Once those are different
 * directories, a single static root serves one of them and 404s the other, and
 * the failure looks like a strip that renders with missing artwork rather than
 * like a misconfiguration. Hence two mounts, and hence this test: it needs no
 * browser, so it runs everywhere the rest of the suite does.
 *
 * Run: node composer/test/render-server.test.mjs
 */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startStaticServer } from '../render.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOOLKIT = path.join(HERE, '..', '..')

let failures = 0
const check = (label, cond, detail = '') => {
  if (!cond) { failures += 1; console.log(`FAIL  ${label}${detail ? `  — ${detail}` : ''}`) }
  else console.log(`PASS  ${label}`)
}

// A strips root that is deliberately nowhere near the toolkit.
const stripsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-ss-strips-'))
await fs.mkdir(path.join(stripsRoot, 'iphone', 'images'), { recursive: true })
await fs.writeFile(path.join(stripsRoot, 'iphone', 'strip.html'), '<div class="strip"></div>')
await fs.writeFile(path.join(stripsRoot, 'iphone', 'images', 'hero.svg'), '<svg/>')

const { server, port } = await startStaticServer({ toolkitRoot: TOOLKIT, stripsRoot })
const get = async (urlPath) => {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`)
  return { status: res.status, body: res.status === 200 ? await res.text() : '' }
}

try {
  // --- the strips mount, outside the toolkit --------------------------------
  const strip = await get('/strips/iphone/strip.html')
  check('a strip outside the toolkit is served from /strips/', strip.status === 200, `status ${strip.status}`)
  check('its own assets resolve too', (await get('/strips/iphone/images/hero.svg')).status === 200)

  // --- the toolkit mount ----------------------------------------------------
  // Both trees at once is the whole point; one root could not do this.
  check('/composer/** still comes from the toolkit', (await get('/composer/device-frames/index.json')).status === 200)

  // --- the legacy alias -----------------------------------------------------
  // Strips authored before device frames moved hardcode /web_ui/public.
  check('the /web_ui/public alias still resolves',
    (await get('/web_ui/public/device-frames/index.json')).status === 200)

  // --- traversal ------------------------------------------------------------
  // Each mount guards its own root; escaping one must not land in the other.
  check('.. cannot escape the strips mount', (await get('/strips/../../etc/passwd')).status !== 200)
  check('a missing file is 404, not 500', (await get('/strips/iphone/nope.png')).status === 404)
} finally {
  server.close()
  await fs.rm(stripsRoot, { recursive: true, force: true })
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS')
process.exit(failures ? 1 : 0)
