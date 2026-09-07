/**
 * Built-in configuration. The CLI works with no config file anywhere; a
 * `design-ss.config.json` at the work root overrides any of this, merged one
 * level deep.
 *
 * Only two adapters ship, and both are verified. An unverified row is worse
 * than no row: `--agent gemini` failing on flags nobody checked reads as a
 * broken tool rather than as a config gap. docs/cli.md documents the shape so
 * a project can add its own.
 */
export const DEFAULTS = {
  defaults: {
    agent: 'claude',
    timeoutSeconds: 1800,
    killGraceSeconds: 30,
    maxTurns: 60,
  },

  agents: {
    // Every flag here earns its place; see docs/cli.md for why.
    claude: {
      command: 'claude',
      args: [
        '-p', '{prompt}',
        '--output-format', 'stream-json',
        '--include-partial-messages',
        '--verbose',
        '--setting-sources', 'user,project',
        '--permission-mode', 'acceptEdits',
        '--max-turns', '{maxTurns}',
        '--add-dir', '{toolkitRoot}',
        // ...and the input folder. The agent runs with the work root as its
        // cwd and can only read there; --input pointing anywhere else is
        // unreadable to it unless it is named. The CLI's own preflight uses
        // plain fs and is not sandboxed, so it happily passes while the agent
        // is blocked -- which is how this hid.
        '--add-dir', '{inputDir}',
      ],
      // No requireEnv. How an agent authenticates is not the toolkit's to
      // assume -- claude may hold a keychain session, an API key, a token
      // helper, or a third-party provider's credentials. Guessing one of those
      // turns a working setup into a refusal. If the agent is not authenticated
      // it says so itself, in seconds, in its own words.
      //
      // credentialEnv is the opposite of requireEnv: nothing is checked before
      // the run, and nothing is required. These are the variables this agent is
      // KNOWN to read, listed so that an authentication failure can say which of
      // them the machine actually has. The child inherits this process's whole
      // environment, so if one of these were set the agent would already have
      // used it -- there is no second attempt to make, only a better message.
      credentialEnv: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'],
    },

    // No model, no key, no cost. Writes a real, renderable strip so the whole
    // path can be smoke-tested; STUB_MODE drives it into each failure.
    stub: {
      command: 'node',
      args: ['{toolkitRoot}/cli/stub-agent.mjs', '{target}'],
      requireEnv: [],
      requiresInput: false,
    },
  },
}
