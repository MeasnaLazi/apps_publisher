/**
 * Detecting the agent's NEEDS_INPUT marker.
 *
 * From a real run: the agent said exactly what was wrong — the brief was
 * outside its allowed directories — and the CLI reported exit 3, "wrote
 * nothing", because with --output-format stream-json the marker is inside a
 * JSON string and its newline is an escaped \n, not a real one.
 *
 * Run: node cli/test/needs-input.test.mjs
 */
import { findNeedsInput } from '../design.mjs'

let failures = 0
const check = (label, got, want) => {
  const ok = want === null ? got === null : got === want
  if (!ok) { failures += 1; console.log(`FAIL  ${label}\n        got:  ${got}\n        want: ${want}`) }
  else console.log(`PASS  ${label}`)
}

// The actual shape from .design-ss/agent.log, escaped newline and all.
const STREAM = String.raw`{"result":"The brief folder the operator named is outside this session's allowed working directories.\n\nNEEDS_INPUT: cannot read the brief at /Users/x/input — path is outside the session's allowed working directories","type":"result"}`
check('stream-json, escaped newline', findNeedsInput(STREAM),
  'NEEDS_INPUT: cannot read the brief at /Users/x/input — path is outside the session\'s allowed working directories')

// Plain text output (an adapter that does not stream JSON).
check('plain text, real newline',
  findNeedsInput('thinking...\nNEEDS_INPUT: app.md is missing\n'),
  'NEEDS_INPUT: app.md is missing')

check('nothing to find', findNeedsInput('rendered 5 panels, 0 problems'), null)
check('empty output', findNeedsInput(''), null)

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS')
process.exit(failures ? 1 : 0)
