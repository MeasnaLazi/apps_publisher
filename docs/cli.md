# `design-ss` — the command line

Three good tools already lived in `composer/`. This is the front door over them,
plus the one thing they could not do on their own: run the designer and decide
whether what it produced is acceptable.

```
design-ss design --target iphone --message "warmer palette, lead with the timeline"
design-ss gate   --target iphone
design-ss retarget --target iphone --size 1284x2778
design-ss check  --all
design-ss render --target iphone
design-ss frames iphone --list
design-ss stop
```

## Where things live

**Read from anywhere; write where you are.**

| | |
|---|---|
| **toolkit root** | Where `design-ss` is installed: `composer/`, fonts, frame packs, the skill. Read-only as far as a run is concerned |
| **work root** | The project being worked on. Everything a run writes lands here — `strips/` and `.design-ss/` — and nowhere else |
| **input** | The one thing that may live outside both, because it is the only thing a run reads and never writes |

The work root is found the way git finds a repository: walk up from the cwd for
`design-ss.config.json` or `input/`, else the cwd itself. Run from a subfolder
and the output still goes to the project root rather than scattering a `strips/`
directory wherever you were standing.

Input resolves in this order:

```
--input <dir>  >  DESIGN_SS_INPUT  >  paths.input in design-ss.config.json  >  <work root>/input
```

A `--input` path is relative to where you typed it; a configured one is relative
to the work root.

**There is no `--output`. `cd` is the `--output` flag.** Output is something a
run produces, and a tool that scatters output across the filesystem on request
is a tool you go looking for afterwards. Input is the one that genuinely moves —
a pinned clone, a read-only mount, a folder a build step just fetched — so it is the
one that gets a flag.

That asymmetry buys something concrete: `check-schema.mjs` infers the expected
frame-pack type from `strips/<target>/` in the path it is handed, and *silently
stops checking* when the path does not match. Pinning output to
`<work root>/strips/<target>/` keeps that convention true by construction. A
second flag would have let someone break it without ever seeing an error.

Running against another project:

```
cd ~/apps/bio
design-ss design --target iphone --message "..." --input ~/store-assets/bio
#   reads  ~/store-assets/bio/app.md and ~/store-assets/bio/iphone/
#   writes ~/apps/bio/strips/iphone/
```

## The idea in one picture

```
design-ss design
  ├─ 1. usage      unknown agent / missing credential           -> 2
  ├─ 2. preflight  <input>/app.md and <input>/<target>/ present? -> 5
  ├─ 3. clean      rm <work>/strips/<target>/  (before, never after)
  ├─ 4. agent      spawn, deadline, own process group           -> 4 / 124
  ├─ 5. output     did it write strip.html at all?              -> 3
  ├─ 6. check      composer/check-schema.mjs                    -> 1
  ├─ 7. render     composer/render.mjs                          -> 1
  └─ 8. verdict    problems[]: error -> 1 · warning -> 6 · none -> 0
```

Steps 1–3 and 5–8 are identical whichever agent runs. **Step 4 is the only
vendor-specific line in the whole flow**, and it is a table in
`design-ss.config.json`, not code. That is possible only because the verdict
comes from the deterministic tools — an adapter never has to parse vendor
output, so adding an agent is a config entry.

## Exit codes

The CLI owns these. An agent's own exit code is logged and then translated,
never forwarded: vendors do not agree on what non-zero means.

| Code | Meaning | What to do |
|---|---|---|
| `0` | Designed, schema clean, rendered, no problems | Publish for review |
| `1` | Gate failed — schema errors, render errors, or an error in `problems[]` | Look at `.design-ss/render.json` |
| `2` | Usage error, unknown agent, or the agent command could not be started | The message names what is missing |
| `3` | Agent exited cleanly and wrote no strip | Read `.design-ss/agent.log`; usually it asked a question |
| `4` | The agent process itself failed | `.design-ss/agent.log` |
| `5` | `NEEDS_INPUT` — `input/` is missing or incomplete | Fix the input repo, not the pipeline |
| `6` | Finished, warnings only | Kept distinct from `1` so a caller can separate "built, but look at it" from "failed" |
| `124` | Deadline hit; the process group was killed | Same code GNU `timeout` uses |
| `143` | Stopped from outside — `design-ss stop`, Ctrl-C, a caller's abort | 128+SIGTERM; not a failure, an abort |

## Cancelling a run

There is no daemon, and `stop` is not a scheduler.

- **A deadline you set.** `--timeout` (default 1800s) sends `SIGTERM` to the
  agent's process group, then `SIGKILL` after `killGraceSeconds`. Exit `124`.
- **Ctrl-C, or a caller aborting.** The runner forwards `SIGINT`/`SIGTERM` to the
  group. The child is spawned `detached` so it *has* a group of its own to kill —
  which also means a terminal's Ctrl-C no longer reaches it directly, hence the
  explicit forwarding.
- **`design-ss stop`.** The foreground run records its pid and process group in
  `.design-ss/run.json`; `stop` reads that and signals the group. It works from
  another terminal, or from a caller's cleanup hook. It cannot reach
  a run on a different machine — that would need a real job registry, which is
  the thing this design is avoiding.

`.design-ss/` lives under the work root, so `stop` finds the run from any
subfolder of the project — the same rule that decided where the output went.

Why the *group* and not the pid: the agent spawns `node`, which spawns
Playwright's Chromium. Kill only the process you hold and Chromium is orphaned,
holding a few hundred MB and a lock on a workspace the next build will reuse.

## The `stub` agent

`--agent stub` fakes a designer: no model, no API key, no cost. It copies the
tracked fixture `composer/test/bio-strip.html` into `strips/<target>/`, swapping
the frame pack for one whose type matches the target. Its only asset reference
is the tracked `composer/test/screen.svg`, so it renders in a fresh clone with
no `input/` at all.

`STUB_MODE` drives it into each failure path, which is how every exit code above
was verified:

| `STUB_MODE` | Behaviour | Exercises |
|---|---|---|
| `ok` (default) | writes a valid strip | `0` |
| `broken` | writes an invalid strip | `1` |
| `noop` | writes nothing, exits 0 | `3` |
| `fail` | exits 7 | `4` |
| `needs-input` | prints `NEEDS_INPUT:` | `5` |
| `hang` | sleeps forever | `124`, and `143` when stopped |

```
STUB_MODE=noop design-ss design --target iphone --message x --agent stub; echo $?   # 3
```

## Configuration

**There is no config file in the toolkit.** The defaults live in
`cli/defaults.mjs`, so the CLI works with nothing configured at all. A
`design-ss.config.json` at the **work root** overrides them, merged one level
deep across `defaults`, `agents` and `paths` — override one agent row or one
default without restating the rest.

```jsonc
// bio-store-assets/design-ss.config.json
{ "defaults": { "agent": "claude", "timeoutSeconds": 2400 },
  "agents":   { "claude": { "requireEnv": [] } } }   // this machine signs in interactively
```

### Credentials are not the toolkit's business

**The built-in `claude` row declares no `requireEnv`.** How an agent
authenticates is not something the toolkit can know — a keychain session, an API
key, a token helper, a third-party provider — and guessing one turns a working
setup into a refusal. If the agent is not authenticated it says so itself, in
seconds, in its own words, and those words go to your console and to
`.design-ss/agent.log`.

What the CLI does instead is report what actually went wrong:

```
cannot start agent "claude": command "claude" not found on PATH — is claude installed?   (exit 2)
agent exited 1 after 2s — its output is above, and in .design-ss/agent.log               (exit 4)
```

`requireEnv` stays available for a project that *does* know its agent needs a
variable — declare it in your own `design-ss.config.json` and it is checked
before anything is spawned.

### When the agent cannot authenticate

There is no fallback to try, and that is not a gap. The child inherits this
process's entire environment, so if `ANTHROPIC_API_KEY` were set the agent would
already have used it on the first attempt — a second attempt with the same
environment would fail identically. What the CLI can add is a readable message,
so the built-in `claude` row lists the variables it is known to read:

```
design-ss: agent exited 1 after 1s — its output is above, and in .design-ss/agent.log
design-ss: that reads like an authentication failure.
design-ss:   claude reads these from the environment, which this process passes through unchanged:
design-ss:     ANTHROPIC_API_KEY        not set
design-ss:     CLAUDE_CODE_OAUTH_TOKEN  not set
design-ss:   set one of those, or authenticate the CLI itself — for claude: run `claude` and /login, or `claude setup-token`.
design-ss:   verify with: claude -p "say OK"   (design-ss adds nothing to how it authenticates)
```

`credentialEnv` is declared in `cli/defaults.mjs`, needs no config file, and is
never enforced — an agent authenticating some other way is not second-guessed.
The hint is a hint only: the exit code stays `4`, because a pattern match on
free text is not solid enough to route a pipeline on.

### Adding an agent

An adapter is a command and an argv. `{prompt}`, `{target}`, `{maxTurns}` and
`{toolkitRoot}` are substituted; `requireEnv` is checked before anything is
spawned; `credentialEnv` is never checked and only makes an auth failure
readable; `requiresInput: false` skips the input preflight.

```jsonc
{ "agents": { "myagent": {
    "command": "myagent",
    "args": ["run", "--non-interactive", "{prompt}"],
    "requireEnv": ["MYAGENT_TOKEN"]
} } }
```

That is the whole surface. The runner spawns it, applies the deadline, and reads
the exit code — it never parses vendor output, because the verdict comes from
`check-schema` and `render`. Which is why adding an agent is a config entry and
not a code change.

**Two adapters ship, and both are verified: `claude` and `stub`.** Nothing else,
deliberately — an unverified row failing on flags nobody checked reads as a
broken tool rather than as a config gap.

Each flag in the `claude` row is there for a reason:

- **`stream-json`, not `json`.** A killed run writes *nothing* with
  `--output-format json` — no envelope, no session id, no record of the fourteen
  minutes it spent. Streaming keeps the transcript up to the moment it died, and
  gives a caller something to show instead of a silent wait.
- **`--setting-sources user,project`** loads the project's
  `.claude/settings.json` (which already allows `render.mjs`,
  `check-schema.mjs`, `pick-frame.mjs`, `npm test`) plus the user's own, and
  excludes only `settings.local.json` — the ad-hoc overrides a run should not
  inherit. Excluding `user` as well, which an earlier version did, also throws
  away things like an `apiKeyHelper`, and a run should not be harder to
  authenticate than the same agent typed by hand.
- **`--add-dir {toolkitRoot}`**, and absolute paths in the prompt. When the
  toolkit is installed elsewhere, its `CLAUDE.md → AGENTS.md → SKILL.md` chain is
  not in the agent's working directory and will not be auto-discovered.
- **No `--bare`.** It skips `CLAUDE.md` discovery entirely, which is that same
  chain.
- **stdin is never inherited.** `claude -p` otherwise waits ~3s for it
  (*"no stdin data received in 3s"*).

## Retargeting to another store size

```
design-ss retarget --target iphone --size 1284x2778
```

A strip is authored at one size, and the store wants another — a 6.9" set
(1290×2796) rejected by a 6.5" slot that takes 1284×2778.

The tempting fix is `sed 's/1290px/1284px/'`. It is **subtly wrong**: it resizes
the canvas and leaves everything positioned inside it exactly where it was. A
horizon line at `top: 2398px` is 85.8% of a 2796px panel and 86.3% of a 2778px
one. Six pixels of drift, invisible in a diff, visible in the render where a
device no longer sits on its line.

`retarget` scales **every length by one factor**, so the composition moves as a
single piece — positions, sizes, type, radii, offsets. It touches px values
inside `<style>` blocks and `style=""` attributes only, so a caption that
happens to read "1290px" is left alone.

```
strips/iphone/strip.html                the source, never modified
strips/iphone/strip-1284x2778.html      written beside it
strips/iphone/rendered-1284x2778/       its PNGs
```

A sibling document rather than a new folder, so the two sizes share
`screenshots/` and `images/` and the folder name still matches the frame pack's
type — which is what `check-schema`'s target rule reads.

**The residual.** One factor cannot hit both dimensions when the aspect ratios
differ slightly (1290×2796 is 0.46137; 1284×2778 is 0.46220). Scaling is done by
**width**, so full-bleed elements still span the panel exactly — a seam at the
edge is visible, a few pixels off the bottom is not — and the panel box is then
snapped to the exact target height. The difference is printed rather than
hidden:

```
design-ss: 1290x2796 -> 1284x2778  (every length x0.995349)
design-ss:   the shapes differ slightly: 5.0px trimmed from the panel height — look at the bottom edge
```

**Same shape only.** A target whose aspect ratio differs from the source by more
than 1% is refused: *"a retarget rescales a composition; it cannot re-lay-out
one. Design this size instead."* Measured drift from a 1290×2796 source:

```
OK      iPhone 6.9  1320x2868    0.24%      REFUSE  iPhone 5.5  1242x2208   21.92%
OK      iPhone 6.5  1284x2778    0.18%      REFUSE  iPhone 4.7   750x1334   21.86%
OK      iPhone 6.5  1242x2688    0.15%      REFUSE  iPad 13    2064x2752    62.56%
OK      iPhone 6.3  1179x2556    0.02%      REFUSE  iPad 12.9  2048x2732    62.48%
OK      iPhone 6.1  1170x2532    0.15%
```

The threshold sits in a wide gap: the worst same-family pair is 0.24%, the best
cross-family pair is 21.86%. **So one design at 1290×2796 covers every iPhone
slot Apple currently offers.** iPad is a separate design run — not because the
arithmetic is hard, but because the shape, the frame pack's device type, the
captures in `input/<target>/`, and the composition itself are all different.

**Other guards.**
And after rendering, every panel's measured size is compared against what you
asked for — an exact size is the point of the command, so it is proven, not
assumed.

**What it can't check** is whether the design still *reads*. Hand-forced `<br>`
breaks are exactly what a rescale disturbs, so the command finishes by telling
you to look at the PNGs.

## The renderer serves two mounts

Once the work root and the toolkit root can differ, one static root cannot serve
a strip's page. `render.mjs` mounts them separately:

```
/strips/**  ->  <strips root>     the design, its images/ and screenshots/
/**         ->  <toolkit root>    device frames, fonts, the composer runtime
```

`--strips-root <dir>` sets the first; it defaults to `<toolkit>/strips`, which is
what a repo-local run has always used. **No strip markup changes**:
`/strips/<name>/images/hero.png` is a server path, not a disk path, and it keeps
resolving. A strip that lives under the toolkit instead — the test fixtures — is
still served from `/`, so those keep rendering too.

`check-schema.mjs` takes the same `--strips-root` and makes the same split when
it resolves assets on disk, for the same reason: without it, a strip designed
outside the toolkit has every one of its own screenshots reported as missing.
The gate passes the flag to both.

## What this deliberately does not do

- **It is not a pipeline.** There is no CI configuration here, and there is not
  meant to be. This is the tool a pipeline calls: it takes flags, it writes
  files, it returns an exit code, and it never asks a question. What schedules
  it, where credentials come from, what happens to the PNGs afterwards — those
  belong to whatever project is doing the integrating.
- **It does not decide that a strip is good.** It decides that a strip is
  *valid*: schema-conformant and renderable without errors. Design quality is a
  human review step, and there is no automating past it.
- **It does not publish.** Runs are non-deterministic by design — the same input
  gives a different strip each time. Anything that renders straight into a
  release path ships different marketing assets every run.

## The integration contract

Everything a caller needs, and nothing about any particular caller:

| | |
|---|---|
| **Input** | flags, environment, and the project's `design-ss.config.json` |
| **Output** | `<work root>/strips/<target>/`, and `rendered/` inside it |
| **stdout** | data (the renderer's JSON) |
| **stderr** | progress and errors |
| **Exit code** | the answer — see the table above |
| **Interaction** | none, ever. A run that cannot proceed exits rather than asking |
| **Cancellation** | `SIGTERM` to the process, or `design-ss stop` |
| **Logs** | `<work root>/.design-ss/agent.log`, `render.json` |
