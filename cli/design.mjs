import path from 'node:path'
import { promises as fs } from 'node:fs'
import { EXIT } from './exit-codes.mjs'
import { run } from './proc.mjs'
import * as state from './run-state.mjs'
import { composePrompt, resolveAgent } from './agents.mjs'
import { checkSchema, render, verdict, cleanOutput, exists } from './gate.mjs'
import { stripPath } from './roots.mjs'

const say = (msg) => process.stderr.write(`design-ss: ${msg}\n`)

/**
 * Find the agent's NEEDS_INPUT line.
 *
 * The marker is emitted at the start of a line, but with --output-format
 * stream-json it arrives inside a JSON string, where that newline is the two
 * characters \\ and n. A /^NEEDS_INPUT:/m anchor never matches it, so a run
 * that told us exactly what was wrong was reported as "wrote nothing" instead.
 * Unescape first, then anchor.
 */
export function findNeedsInput(output) {
  const flat = String(output ?? '').replace(/\\n/g, '\n')
  const m = flat.match(/^NEEDS_INPUT:.*$/m)
  // Stop at the JSON string terminator, or the operator reads our diagnostic
  // with `","type":"result"}` stuck on the end of it.
  return m ? m[0].split('"')[0].trim() : null
}

/**
 * Phrases, not words. The first version of this matched the token "api key",
 * which also matches `"apiKeySource":"none"` in claude's own init event -- so a
 * perfectly healthy run that stopped on --max-turns was told it had an
 * authentication problem. Anything here must be a thing an agent SAYS when it
 * fails, not a word that appears in its metadata.
 */
export const AUTH_FAILURE = new RegExp([
  'failed to authenticate',
  'authentication (failed|error|required)',
  '(not|un)authenticated',
  'unauthorized',
  'invalid api[ _-]?key',
  'missing api[ _-]?key',
  'api[ _-]?key (is )?(not set|missing|invalid|expired)',
  'oauth[^"\\n]{0,40}(expired|failed|invalid)',
  'please run /login',
  'credentials? (are |is )?(missing|invalid|expired)',
  'session (has )?expired',
].join('|'), 'i')

export async function design(roots, opts) {
  const { config, target, message, agentName, timeoutMs, killGraceMs, maxTurns, skipRender } = opts

  // 1. Usage errors first -- an unknown agent or a missing credential is the
  //    operator's mistake and should not be reported as a data problem.
  const prompt = composePrompt(config, {
    target, message,
    inputDir: roots.inputDir,
    outputDir: roots.stripsDir,
    toolkitRoot: roots.toolkitRoot,
  })
  let agent
  try { agent = resolveAgent(config, agentName, { prompt, target, maxTurns, toolkitRoot: roots.toolkitRoot, inputDir: roots.inputDir, outputDir: roots.stripsDir }) }
  catch (err) { say(err.message); return EXIT.USAGE }
  if (agent.missingEnv.length) {
    say(`agent "${agentName}" needs ${agent.missingEnv.join(', ')} in the environment`)
    return EXIT.USAGE
  }

  // 2. Preflight. Catching missing input here costs nothing; catching it after
  //    the agent has run costs fifteen minutes and a model bill.
  if (agent.requiresInput) {
    const brief = path.join(roots.inputDir, 'app.md')
    const captures = path.join(roots.inputDir, target)
    if (!await exists(brief)) { say(`NEEDS_INPUT: ${brief} is missing`); return EXIT.NEEDS_INPUT }
    if (!await exists(captures)) { say(`NEEDS_INPUT: ${captures} is missing`); return EXIT.NEEDS_INPUT }
  }

  // 3. Clean before, never after. A filesystem that refuses is an environment
  //    problem, and it should say so rather than surface as a stack trace.
  try {
    await cleanOutput(roots, target)
  } catch (err) {
    say(`cannot clean ${path.join(roots.stripsDir, target)}: ${err.message}`)
    return EXIT.USAGE
  }
  await fs.mkdir(roots.stateDir, { recursive: true })

  // 4. Run the agent, in the work root: what it writes lands in the project.
  say(`agent=${agentName} target=${target} timeout=${Math.round(timeoutMs / 1000)}s`)
  say(`input=${roots.inputDir}`)
  say(`output=${roots.stripsDir}`)
  const started = Date.now()
  const result = await run(agent.command, agent.args, {
    cwd: roots.workRoot,
    timeoutMs,
    killGraceMs,
    logPath: path.join(roots.stateDir, 'agent.log'),
    env: {
      ...process.env,
      DESIGN_SS_TOOLKIT_ROOT: roots.toolkitRoot,
      DESIGN_SS_WORK_ROOT: roots.workRoot,
      DESIGN_SS_INPUT: roots.inputDir,
      DESIGN_SS_OUTPUT: roots.stripsDir,
      DESIGN_SS_TARGET: target,
    },
    onSpawn: ({ pid, pgid }) => state.write(roots.stateDir, { pid, pgid, target, agent: agentName, workRoot: roots.workRoot, timeoutMs }),
  })
  const elapsed = Math.round((Date.now() - started) / 1000)
  await state.clear(roots.stateDir)

  // Could not even be started: not installed, not executable, bad path. That is
  // the operator's environment, and it deserves the name of the thing missing
  // rather than a generic "agent failed".
  if (result.error) {
    const why = result.error.code === 'ENOENT'
      ? `command "${agent.command}" not found on PATH — is ${agentName} installed?`
      : result.error.code === 'EACCES'
        ? `command "${agent.command}" is not executable`
        : result.error.message
    say(`cannot start agent "${agentName}": ${why}`)
    return EXIT.USAGE
  }
  if (result.timedOut) { say(`agent hit the ${Math.round(timeoutMs / 1000)}s deadline after ${elapsed}s`); return EXIT.TIMEOUT }
  const needsInput = findNeedsInput(result.output)
  if (needsInput) { say(`agent reported ${needsInput}`); return EXIT.NEEDS_INPUT }
  if (result.signal) { say(`agent was stopped by ${result.signal} after ${elapsed}s`); return EXIT.ABORTED }
  if (result.code !== 0) {
    say(`agent exited ${result.code} after ${elapsed}s — its output is above, and in ${path.join(roots.stateDir, 'agent.log')}`)
    // An authentication failure is the one agent error an operator can act on
    // without reading the log, so say what the machine offers. This only ever
    // adds a hint: the exit code stays EXIT.AGENT, because a pattern match on
    // free text is not solid enough to route a pipeline on.
    if (AUTH_FAILURE.test(result.output)) {
      const known = agent.credentialEnv
      say(`that reads like an authentication failure.`)
      if (known.length) {
        say(`  ${agentName} reads these from the environment, which this process passes through unchanged:`)
        for (const k of known) say(`    ${k.padEnd(24)} ${process.env[k] ? 'set (the agent rejected it)' : 'not set'}`)
      }
      say(`  set one of those, or authenticate the CLI itself — for claude: run \`claude\` and /login, or \`claude setup-token\`.`)
      say(`  verify with: ${agent.command} -p "say OK"   (design-ss adds nothing to how it authenticates)`)
    }
    return EXIT.AGENT
  }
  say(`agent finished in ${elapsed}s`)

  // 5. Did it actually write anything? Exit 0 from an agent is not evidence.
  if (!await exists(stripPath(roots, target))) { say(`agent wrote no ${stripPath(roots, target)}`); return EXIT.NO_OUTPUT }

  return gateOnly(roots, { target, skipRender })
}

/** The half of the pipeline that needs no agent and no API key. */
export async function gateOnly(roots, { target, skipRender }) {
  if (!await exists(stripPath(roots, target))) { say(`no ${stripPath(roots, target)} to gate`); return EXIT.NO_OUTPUT }

  const checked = await checkSchema(roots, target)
  if (checked.code !== 0) { say(`check-schema exited ${checked.code}`); return EXIT.GATE }
  say('schema clean')

  if (skipRender) { say('render skipped (--no-render)'); return EXIT.OK }

  const rendered = await render(roots, target)
  if (rendered.code !== 0) {
    // render's stdout is data and is captured, not echoed. On failure that is
    // exactly backwards: the reason is in there, and swallowing it leaves a
    // bare exit code to debug from.
    say(`render exited ${rendered.code}`)
    if (rendered.output.trim()) process.stderr.write(`${rendered.output.trim()}\n`)
    return EXIT.GATE
  }
  const { errors, warnings } = verdict(rendered.data)
  say(`rendered ${rendered.data?.panels?.length ?? 0} panel(s), ${errors.length} error(s), ${warnings.length} warning(s)`)
  await fs.mkdir(roots.stateDir, { recursive: true })
  await fs.writeFile(path.join(roots.stateDir, 'render.json'), JSON.stringify(rendered.data, null, 2))

  if (errors.length) return EXIT.GATE
  if (warnings.length) return EXIT.WARNINGS
  return EXIT.OK
}

export async function stop(roots) {
  const current = await state.read(roots.stateDir)
  if (!current) { say(`no run recorded in ${path.join(roots.stateDir, 'run.json')}`); return EXIT.OK }
  if (!state.alive(current.pid)) { say(`recorded run (pid ${current.pid}) is already gone`); await state.clear(roots.stateDir); return EXIT.OK }
  say(`stopping ${current.agent} on target ${current.target} (process group ${current.pgid})`)
  try { process.kill(-current.pgid, 'SIGTERM') } catch { try { process.kill(current.pid, 'SIGTERM') } catch { /* raced */ } }
  return EXIT.OK
}
