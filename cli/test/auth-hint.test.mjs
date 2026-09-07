/**
 * The authentication hint's pattern.
 *
 * This exists because the first version matched the token "api key", which also
 * matches `"apiKeySource":"none"` inside claude's own init event — so a healthy
 * run that stopped on --max-turns was told it had an authentication problem.
 * The rule the pattern has to hold: match things an agent SAYS when it fails,
 * never words that appear in its metadata or in a strip's copy.
 *
 * Run: node cli/test/auth-hint.test.mjs
 */
import { AUTH_FAILURE } from '../design.mjs'

let failures = 0
const check = (label, text, shouldMatch) => {
  const hit = AUTH_FAILURE.test(text)
  if (hit !== shouldMatch) { failures += 1; console.log(`FAIL  ${label} — expected ${shouldMatch ? 'a match' : 'no match'}`) }
  else console.log(`PASS  ${label}`)
}

// --- things an agent says when it cannot authenticate ----------------------
check('claude: expired OAuth session', 'Failed to authenticate: OAuth session expired and could not be refreshed', true)
check('an invalid key',                'Invalid API key · Please run /login', true)
check('a bare 401',                    'Error: 401 Unauthorized', true)
check('a missing key',                 'ANTHROPIC_API_KEY is not set', true)

// --- things that merely mention the same words -----------------------------
// Every one of these appeared in a real run that was fine.
check('claude init metadata', String.raw`{"type":"system","subtype":"init","apiKeySource":"none","claude_code_version":"2.1.251"}`, false)
check('the max_turns result', String.raw`{"subtype":"error_max_turns","errors":["Reached maximum number of turns (3)"],"terminal_reason":"max_turns"}`, false)
check('the slash-command list', String.raw`"slash_commands":["login","logout","doctor"]`, false)
check('an ordinary crash', 'TypeError: cannot read property x of undefined', false)
check('copy from a banking strip', 'Easily transfer cash between your IBC account and your accounts outside of IBC.', false)

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS')
process.exit(failures ? 1 : 0)
