import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'

/**
 * Spawn a child in its OWN process group, with a hard deadline, and kill the
 * whole group on timeout or on a signal to us.
 *
 * Why the group: the agent spawns node, which spawns Playwright's Chromium.
 * Killing only the pid we hold leaves Chromium orphaned, holding a few hundred
 * MB and a lock on a workspace the next build will reuse.
 *
 * Why forward signals: `detached: true` puts the child in a new group, so a
 * Ctrl-C at a terminal (which signals the *foreground* group) no longer
 * reaches it. We re-send it deliberately. A caller that kills by process tree
 * rather than by group reaps everything either way.
 */
export function run(command, args, opts = {}) {
  const {
    cwd, env = process.env,
    timeoutMs = 0, killGraceMs = 30_000,
    logPath = null, echo = true, onSpawn = null,
  } = opts

  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, {
        cwd, env, detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],   // never inherit stdin: `claude -p` waits ~3s for it
      })
    } catch (error) {
      return resolve({ code: 127, signal: null, timedOut: false, error, output: '' })
    }

    const pgid = child.pid
    const log = logPath ? createWriteStream(logPath) : null
    let output = ''
    let timedOut = false
    let deadline = null
    let grace = null

    const killGroup = (sig) => {
      try { process.kill(-pgid, sig) } catch { try { child.kill(sig) } catch { /* already gone */ } }
    }

    const tap = (stream, sink) => {
      stream.on('data', (buf) => {
        const s = buf.toString()
        output += s
        if (log) log.write(s)
        if (echo) sink.write(s)
      })
    }
    tap(child.stdout, process.stdout)
    tap(child.stderr, process.stderr)

    if (onSpawn) onSpawn({ pid: child.pid, pgid })

    if (timeoutMs > 0) {
      deadline = setTimeout(() => {
        timedOut = true
        process.stderr.write(`\ndesign-ss: deadline of ${Math.round(timeoutMs / 1000)}s reached -- SIGTERM to process group ${pgid}\n`)
        killGroup('SIGTERM')
        grace = setTimeout(() => {
          process.stderr.write(`design-ss: still alive after ${Math.round(killGraceMs / 1000)}s -- SIGKILL\n`)
          killGroup('SIGKILL')
        }, killGraceMs)
      }, timeoutMs)
    }

    const forward = () => killGroup('SIGTERM')
    process.on('SIGINT', forward)
    process.on('SIGTERM', forward)

    const finish = (result) => {
      clearTimeout(deadline); clearTimeout(grace)
      process.off('SIGINT', forward); process.off('SIGTERM', forward)
      if (log) log.end()
      resolve({ ...result, output })
    }

    child.on('error', (error) => finish({ code: 127, signal: null, timedOut, error }))
    child.on('exit', (code, signal) => finish({ code, signal, timedOut }))
  })
}
