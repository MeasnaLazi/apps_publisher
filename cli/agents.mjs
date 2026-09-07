import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULTS } from './defaults.mjs'

/**
 * The prompt names absolute paths rather than assuming the agent is standing
 * in the toolkit. When design-ss is installed and pointed at another project,
 * the toolkit's AGENTS.md is not in the agent's working directory and will not
 * be auto-discovered -- so the prompt says where it is, and the claude adapter
 * passes --add-dir {toolkitRoot} to make it readable.
 */
const DEFAULT_PROMPT = `Design the screenshot strip for target "{target}".

Read {toolkitRoot}/AGENTS.md first, then
{toolkitRoot}/skills/strip-design/SKILL.md, and follow it.

  brief and captures   {inputDir}          (app.md, and {target}/ for the captures)
  write the strip to   {outputDir}/{target}/
  the toolkit          {toolkitRoot}

Verify it yourself before you finish:

  node {toolkitRoot}/composer/check-schema.mjs strips/{target}/strip.html
  node {toolkitRoot}/composer/render.mjs --strip {outputDir}/{target}/strip.html --strips-root {outputDir}

Operator request:
{message}

This is an unattended pipeline run. Nobody can answer a question, and anything
you ask will be read by a machine that only looks at the exit code. Never ask
for clarification. If the input folder is missing or incomplete, stop
immediately and print exactly:

  NEEDS_INPUT: <what is missing>

Do not commit, push, or otherwise change git state. Leave that to the pipeline.`

/**
 * Config belongs to the PROJECT. The toolkit ships built-in defaults in code —
 * not a config file, which would be a second source of truth for the same
 * values — and a `design-ss.config.json` at the work root overrides them.
 * That is also what findWorkRoot has always meant by using the file as a marker.
 *
 * Merged one level deep, so a project can say `{"defaults": {"agent": "x"}}`
 * without restating the adapter table, or add one agent row without losing the
 * others.
 */
export async function loadConfig(workRoot) {
  let project = null
  try { project = JSON.parse(await fs.readFile(path.join(workRoot, 'design-ss.config.json'), 'utf8')) }
  catch { return DEFAULTS }
  return {
    ...DEFAULTS,
    ...project,
    defaults: { ...DEFAULTS.defaults, ...project.defaults },
    agents: { ...DEFAULTS.agents, ...project.agents },
    paths: { ...DEFAULTS.paths, ...project.paths },
  }
}

export function composePrompt(config, vars) {
  return fill(config.promptTemplate || DEFAULT_PROMPT, vars)
}

const fill = (s, vars) => Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), s)

/** Resolve one adapter row into a concrete argv. Vendor knowledge stops here. */
export function resolveAgent(config, name, vars) {
  const spec = config.agents?.[name]
  if (!spec || typeof spec !== 'object' || !spec.command) {
    const known = Object.keys(config.agents || {}).filter((k) => !k.startsWith('//'))
    throw new Error(`unknown agent "${name}" -- configured: ${known.join(', ')}`)
  }
  return {
    command: spec.command,
    args: (spec.args || []).map((a) => fill(a, vars)),
    missingEnv: (spec.requireEnv || []).filter((k) => !process.env[k]),
    credentialEnv: spec.credentialEnv || [],
    requiresInput: spec.requiresInput !== false,
  }
}
