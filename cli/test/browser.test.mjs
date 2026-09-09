/**
 * Where Chromium comes from. The interesting part is not the download, it is
 * the decision — and the reason the decision moved out of a postinstall.
 *
 * Run: node cli/test/browser.test.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserPreflight, browserAdvice } from '../browser.mjs'

let failures = 0
const check = (label, cond, detail = '') => {
  if (!cond) { failures += 1; console.log(`FAIL  ${label}${detail ? `  — ${detail}` : ''}`) }
  else console.log(`PASS  ${label}`)
}

check('a browser already here lets the render proceed', browserPreflight({ installed: true }).code === null)

// The same rule the editor follows: the command that needs the thing never
// installs it. A render that quietly downloads 150 MB is a render you cannot
// predict, and it spends the time when you were least expecting to.
const missing = browserPreflight({ installed: false })
check('a missing browser stops the render rather than fetching one', missing.code === 2, `got ${missing.code}`)
check('...and names the command that fixes it',
  missing.lines.join(' ').includes('design-ss design install'), missing.lines.join(' | '))
check('...and says what still works without a browser',
  /check.*frames.*retarget --no-render/.test(missing.lines.join(' ')), missing.lines.join(' | '))

// A present executablePath() is not proof the render can launch: playwright
// runs headless through chrome-headless-shell, a second binary in its own
// revision directory. Caught by running it, not by reading the code.
check('a missing headless shell is translated into the fix',
  browserAdvice("browserType.launch: Executable doesn't exist at .../chrome-headless-shell")
    .join(' ').includes('design-ss design install --force'))
check('a real strip failure is left alone',
  browserAdvice('{"ok":false,"problems":[{"level":"error","message":"panel 2 overflows"}]}').length === 0)

// The regression this whole change exists to prevent. `npm install -g <a git
// spec>` symlinks the package into npm's cache and deletes the target, so a
// postinstall runs with no working directory and the install breaks — measured
// on npm 10.9.8 with a seven-line package. Making the script survive does not
// help: npm then reports success and leaves a dangling symlink. The only shape
// that installs cleanly is no postinstall at all.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
check('package.json declares no postinstall',
  !('postinstall' in (pkg.scripts ?? {})),
  `found: ${pkg.scripts?.postinstall}`)
check('...nor any other install hook',
  !['preinstall', 'install', 'prepare'].some((k) => k in (pkg.scripts ?? {})),
  Object.keys(pkg.scripts ?? {}).join(', '))

console.log(failures ? `\n${failures} failure(s)` : '\nall green')
process.exit(failures ? 1 : 0)
