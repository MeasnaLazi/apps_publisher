import { promises as fs } from 'node:fs'
import path from 'node:path'
import { run } from './proc.mjs'
import { stripPath, stripLabel } from './roots.mjs'

/**
 * The gate. An agent's exit code says it stopped talking, not that it designed
 * anything -- so the verdict comes from the deterministic tools instead.
 *
 * Both are spawned with cwd = workRoot and a relative strips/<target>/ label.
 * That matters for more than tidiness: check-schema infers the expected frame
 * pack type from `strips/<folder>/` in the path it is given. Hand it an
 * absolute path from somewhere else and the check does not fail -- it silently
 * stops running.
 */

export async function checkSchema(roots, target) {
  return run('node', [
    path.join(roots.toolkitRoot, 'composer/check-schema.mjs'),
    '--strips-root', roots.stripsDir,
    stripLabel(target),
  ], { cwd: roots.workRoot })
}

/**
 * render.mjs prints one JSON object to stdout and exits 1 on failure (also when
 * the page reported __composerErrors). We capture stdout rather than reading
 * strips/<t>/rendered/strip-data.json, because that file is written only on
 * success -- a stale one from a previous build outlives a crash.
 */
export async function render(roots, target, extraArgs = []) {
  const result = await run('node', [
    path.join(roots.toolkitRoot, 'composer/render.mjs'),
    '--strip', stripPath(roots, target),
    '--strips-root', roots.stripsDir,
    ...extraArgs,
  ], { cwd: roots.workRoot, echo: false })   // stdout is data; keep it off the console

  let data = null
  try { data = JSON.parse(result.output.slice(result.output.indexOf('{'))) } catch { /* not JSON */ }
  return { ...result, data }
}

export function verdict(data) {
  const problems = (data && Array.isArray(data.problems)) ? data.problems : []
  return {
    errors: problems.filter((p) => p.level === 'error' || p.severity === 'error'),
    warnings: problems.filter((p) => p.level === 'warning' || p.severity === 'warning'),
    problems,
  }
}

/** Clean before, never after: see the stale strip-data.json note in NOTES.md. */
export async function cleanOutput(roots, target) {
  await fs.rm(path.join(roots.stripsDir, target), { recursive: true, force: true })
}

export async function exists(p) {
  try { await fs.access(p); return true } catch { return false }
}
