import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * <workRoot>/.design-ss/run.json is what makes `design-ss stop` possible
 * without a daemon: the foreground run records its own process group, and stop
 * reads it. It cannot reach a run on another machine -- that would need a real
 * registry. It lives under the work root, so stop finds it from any subfolder
 * of the project, the same way the run found where to write.
 */
const file = (stateDir) => path.join(stateDir, 'run.json')

export async function write(stateDir, state) {
  await fs.mkdir(stateDir, { recursive: true })
  await fs.writeFile(file(stateDir), JSON.stringify({ ...state, startedAt: new Date().toISOString() }, null, 2))
}

export async function read(stateDir) {
  try { return JSON.parse(await fs.readFile(file(stateDir), 'utf8')) } catch { return null }
}

export async function clear(stateDir) {
  try { await fs.rm(file(stateDir)) } catch { /* nothing to clear */ }
}

export function alive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}
