import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Two roots, and the rule between them is: READ FROM ANYWHERE, WRITE WHERE YOU ARE.
 *
 *   toolkitRoot  where design-ss is installed: composer/, fonts, frame packs,
 *                the skill. Read-only as far as a run is concerned.
 *   workRoot     the project being worked on. Everything a run writes lands
 *                here -- strips/ and .design-ss/ -- and nowhere else.
 *
 * Input is the one thing that may live outside both, because it is the only
 * thing a run reads and never writes: a pinned clone of another repo, a
 * read-only mount, a folder a build step just fetched. Hence --input and no
 * --output. `cd` is the --output flag.
 */
export const TOOLKIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const MARKERS = ['design-ss.config.json', 'input']

/**
 * Found the way git finds a repository -- walk up for a marker -- so running
 * from a subfolder writes to the project root instead of scattering a strips/
 * directory wherever you happened to be standing.
 */
export function findWorkRoot(from = process.cwd()) {
  let dir = path.resolve(from)
  for (;;) {
    if (MARKERS.some((m) => existsSync(path.join(dir, m)))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return path.resolve(from)
    dir = parent
  }
}

/** --input > DESIGN_SS_INPUT > config paths.input > <workRoot>/input */
export function resolveRoots({ cwd = process.cwd(), workRoot = null, inputFlag = null, config = null } = {}) {
  workRoot = workRoot ?? findWorkRoot(cwd)
  const flag = inputFlag || process.env.DESIGN_SS_INPUT || null
  const configured = config?.paths?.input || null
  const inputDir = flag
    ? path.resolve(cwd, flag)                       // a flag is relative to where you typed it
    : configured
      ? path.resolve(workRoot, configured)          // config is relative to the project
      : path.join(workRoot, 'input')
  return {
    toolkitRoot: TOOLKIT_ROOT,
    workRoot,
    inputDir,
    stripsDir: path.join(workRoot, 'strips'),
    stateDir: path.join(workRoot, '.design-ss'),
  }
}

/** Where a target's strip lives, and the label the checker infers the target from. */
export const stripPath = (roots, target) => path.join(roots.stripsDir, target, 'strip.html')
export const stripLabel = (target) => path.join('strips', target, 'strip.html')
