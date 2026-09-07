/**
 * The CLI owns its exit codes. Agent CLIs disagree with each other about what
 * a non-zero code means, so nothing from a vendor is ever forwarded -- it is
 * logged and translated into one of these.
 */
export const EXIT = {
  OK: 0,          // designed, schema clean, rendered, no problems
  GATE: 1,        // schema errors, render errors, or problems[] contained an error
  USAGE: 2,       // bad flags
  NO_OUTPUT: 3,   // agent exited cleanly and wrote no strip
  AGENT: 4,       // agent process itself failed
  NEEDS_INPUT: 5, // input/ missing or incomplete -- fix the input repo, not the pipeline
  WARNINGS: 6,    // finished, but problems[] had warnings -- kept distinct from 1 so a
                  // caller can separate "built, but look at it" from "failed"
  TIMEOUT: 124,   // deadline hit (same code GNU timeout uses)
  ABORTED: 143,   // signalled from outside: `design-ss stop`, Ctrl-C, a caller aborting (128+SIGTERM)
}

export const EXIT_NAME = Object.fromEntries(Object.entries(EXIT).map(([k, v]) => [v, k]))
