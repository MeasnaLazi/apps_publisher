import { existsSync } from 'node:fs'
import path from 'node:path'
import { EXIT } from './exit-codes.mjs'
import { run } from './proc.mjs'
import { TOOLKIT_ROOT } from './roots.mjs'

/**
 * Chromium, as an explicit step -- `design-ss design install`.
 *
 * Two reasons it is not a postinstall, and the second is why it is not an
 * automatic fetch either.
 *
 * It cannot be a postinstall. `npm install -g <a git spec>` symlinks the
 * package into npm's cache and then deletes the target, so the script runs with
 * a working directory that no longer exists: `node scripts/postinstall.mjs`
 * cannot resolve its own relative path and node dies before its first line.
 * Measured on npm 10.9.8 with a seven-line package that has nothing but a bin
 * and a postinstall. Making the script survive is worse, not better -- npm then
 * reports success and leaves the package a dangling symlink.
 *
 * And it is not fetched behind your back. A command that downloads 150 MB
 * because you asked it to render a strip is a command you cannot predict, and
 * it spends the time at the moment you were least expecting to. So the browser
 * follows the same rule as the editor: install is its own step, the commands
 * that need it check and name the missing step, and nothing downloads unasked.
 */

const say = (msg) => process.stderr.write(`design-ss: ${msg}\n`)

const PLAYWRIGHT_CLI = path.join(TOOLKIT_ROOT, 'node_modules', 'playwright', 'cli.js')

/** Where playwright expects the browser, or null if playwright itself is unreachable. */
export async function chromiumPath() {
  try {
    const { chromium } = await import('playwright')
    return chromium.executablePath()
  } catch { return null }
}

export async function hasChromium() {
  const p = await chromiumPath()
  return Boolean(p) && existsSync(p)
}

/**
 * What `design`, `gate`, `render` and `retarget` decide before launching a
 * browser, as a function of one fact, so it can be tested without one.
 */
export function browserPreflight({ installed }) {
  if (installed) return { code: null, lines: [] }
  return {
    code: EXIT.USAGE,
    lines: [
      `the renderer needs Chromium and this machine has none`,
      `  run:  design-ss design install      (~150 MB, once)`,
      `  check, frames, retarget --no-render and editor work without it.`,
    ],
  }
}

/**
 * A present executablePath() is not proof the render can launch. Playwright
 * runs headless through a *second* binary -- chrome-headless-shell, in its own
 * revision directory -- and `chromium.executablePath()` names the headed one.
 * `playwright install chromium` fetches both, so the two disagree only when an
 * install is partial or hand-made; when they do, playwright says so in a way
 * that reads like a bug rather than a missing step. Translate it.
 */
export function browserAdvice(output) {
  if (!/Executable doesn't exist|playwright install/i.test(String(output ?? ''))) return []
  return [
    `that is a missing browser binary, not a problem with the strip.`,
    `  run:  design-ss design install --force`,
  ]
}

/** Used by the render paths: true to proceed, false after saying what to run. */
export async function requireChromium() {
  const pre = browserPreflight({ installed: await hasChromium() })
  if (pre.code === null) return true
  for (const l of pre.lines) say(l)
  return false
}

/** `design-ss design install` -- the one command in this pipeline allowed to be slow. */
export async function installBrowser({ force = false } = {}) {
  if (await hasChromium() && !force) {
    say(`Chromium is already installed at ${await chromiumPath()}`)
    say(`reinstall it with: design-ss design install --force`)
    return EXIT.OK
  }

  const skip = process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
  if (skip && skip !== '0') {
    say(`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set — not fetching anything.`)
    say(`  unset it, or install the browser yourself: npx playwright install chromium`)
    return EXIT.USAGE
  }

  if (!existsSync(PLAYWRIGHT_CLI)) {
    say(`playwright is not installed in ${TOOLKIT_ROOT} — reinstall design-ss`)
    return EXIT.USAGE
  }

  say(`fetching Chromium (~150 MB, once)`)
  // playwright's own CLI, by path rather than through npx: this runs with the
  // work root as its cwd, where `playwright` does not resolve.
  const r = await run(process.execPath, [PLAYWRIGHT_CLI, 'install', 'chromium'], { cwd: TOOLKIT_ROOT })

  // The exit code is playwright's self-report; the file on disk is the fact.
  if (r.code !== 0 || !await hasChromium()) {
    say(`could not fetch Chromium${r.code === 0 ? ' (it reported success and installed nothing)' : ` (exited ${r.code})`}`)
    say(`  PLAYWRIGHT_BROWSERS_PATH decides where it lands, if this machine keeps browsers elsewhere.`)
    return EXIT.USAGE
  }
  say(`Chromium ready at ${await chromiumPath()}`)
  return EXIT.OK
}
