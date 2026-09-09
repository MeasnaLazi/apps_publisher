import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * <workRoot>/.design-ss/*.json is what makes `design-ss stop` and
 * `design-ss edit stop` possible without a daemon: the process records its own
 * process group, and stop reads it. It cannot reach a run on another machine --
 * that would need a real registry. It lives under the work root, so stop finds
 * it from any subfolder of the project, the same way the run found where to
 * write.
 *
 * Two files use this, and they are deliberately separate: run.json is a design
 * run (foreground, one at a time, dies on its own), editor.json is the strip
 * editor (background, long-lived, dies only when told). Sharing one file would
 * make `design-ss stop` kill the editor, which is not what it says.
 */
const RUN = 'run.json'
const file = (stateDir, name) => path.join(stateDir, name)

export const statePath = (stateDir, name = RUN) => file(stateDir, name)

export async function write(stateDir, state, name = RUN) {
  await fs.mkdir(stateDir, { recursive: true })
  await fs.writeFile(file(stateDir, name), JSON.stringify({ ...state, startedAt: new Date().toISOString() }, null, 2))
}

export async function read(stateDir, name = RUN) {
  try { return JSON.parse(await fs.readFile(file(stateDir, name), 'utf8')) } catch { return null }
}

export async function clear(stateDir, name = RUN) {
  try { await fs.rm(file(stateDir, name)) } catch { /* nothing to clear */ }
}

export function alive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}
