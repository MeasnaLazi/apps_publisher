/**
 * Chromium, on install.
 *
 * `npm install` gives you playwright the library; the browser it drives is a
 * separate ~150MB download. Without it `design` and `render` fail at the point
 * of launching a page — late, and with an error about a missing executable
 * rather than a missing install step. So we fetch it here.
 *
 * It must not be fatal. A locked-down network, an offline machine or a CI image
 * that already has a browser are all normal, and none of them should make
 * `npm install` fail — `check`, `frames` and `retarget --no-render` work
 * perfectly without a browser. So a failure warns and exits 0, saying exactly
 * what to run later.
 *
 * PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 skips it entirely (playwright's own
 * convention), and PLAYWRIGHT_BROWSERS_PATH still decides where it lands.
 */
import { spawnSync } from 'node:child_process'

const skip = process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
if (skip && skip !== '0') {
  console.log('design-ss: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set — skipping the Chromium download.')
  process.exit(0)
}

console.log('design-ss: fetching Chromium for the renderer (~150MB, once)…')
const r = spawnSync('npx', ['--no-install', 'playwright', 'install', 'chromium'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (r.status === 0) {
  console.log('design-ss: Chromium ready.')
  process.exit(0)
}

console.warn('')
console.warn('design-ss: could not download Chromium — install is otherwise complete.')
console.warn('  check, frames and retarget --no-render work without it; design and render do not.')
console.warn('  when you have network, run:  npx playwright install chromium')
console.warn('')
process.exit(0)   // never fail an install over a browser
