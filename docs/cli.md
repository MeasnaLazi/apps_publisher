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
design-ss editor install       # the visual editor: once
design-ss editor start         # ...in the background
design-ss editor stop
design-ss stop
```

## Where things live

**Read from anywhere; write where you are.**

| | |
|---|---|
| **toolkit root** | Where `design-ss` is installed: `composer/`, fonts, frame packs, the skill. Read-only as far as a run is concerned |
| **work root** | The project being worked on. Everything a run writes lands here — `strips/` and `.design-ss/` — and nowhere else |
| **input** | The one thing that may live outside both, because it is the only thing a run reads and never writes |

**The toolkit ships no config file.** `design-ss.config.json` in this document
always means an *optional* file in **your project**, never one in the toolkit —
the toolkit's defaults are code, in `cli/defaults.mjs`.

The work root is found the way git finds a repository: walk up from the cwd for
a `design-ss.config.json` or an `input/`, else the cwd itself. Run from a subfolder
and the output still goes to the project root rather than scattering a `strips/`
directory wherever you were standing.

Input resolves in this order:

```
--input <dir>  >  DESIGN_SS_INPUT  >  paths.input in your project's config  >  <work root>/input
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
your project's config, not code. That is possible only because the verdict
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

## Chromium

```
design-ss design install [--force]   fetch the renderer's browser (~150 MB, once)
```

`design`, `gate`, `render` and `retarget` need a browser and none of them will
fetch one for you:

```
$ design-ss gate --target iphone
design-ss: schema clean
design-ss: the renderer needs Chromium and this machine has none
design-ss:   run:  design-ss design install      (~150 MB, once)
design-ss:   check, frames, retarget --no-render and editor work without it.
```

Same rule as the editor, for the same reason: a command that downloads 150 MB
because you asked it to render a strip is a command you cannot predict, and it
spends the time at the moment you were least expecting to. `install` is
idempotent; `--force` refetches. `PLAYWRIGHT_BROWSERS_PATH` still decides where
it lands, and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` makes `install` refuse rather
than reach the network.

**A present browser is not proof it can launch.** Playwright runs headless
through a *second* binary — `chrome-headless-shell`, in its own revision
directory — while `chromium.executablePath()` names the headed one.
`design install` fetches both, so they disagree only when an install is partial;
when they do, playwright's message reads like a bug in the strip, so the render
path translates it into `design-ss design install --force`. That one was found
by running it, not by reading the code.

### Why not a postinstall

Because a postinstall makes `npm install -g <a git spec>` impossible. npm
symlinks such a package into its own cache and then deletes the target, so the
script runs with a working directory that no longer exists: `node
scripts/postinstall.mjs` cannot resolve its own relative path and node dies in
`run_main` before the first line. Measured on npm 10.9.8, reproduced with a
seven-line package that has nothing but a bin and a postinstall.

Making the script survive that is a trap, and this was tested too:

| postinstall | npm reports | does the installed bin run? |
|---|---|---|
| `node scripts/postinstall.mjs` | error, code 1 | no |
| `node -e "…"` (survives a dead cwd) | **added 1 package** | no — dangling symlink |
| none | added 1 package | **yes** |

A script that survives turns a loud failure into a silent one: npm reports
success and leaves the package pointing at a directory it has deleted. Only
having no install hook at all produces a working install, which is why
`cli/test/browser.test.mjs` asserts that `package.json` declares none.

Registry and tarball installs were never affected either way.

## The strip editor

```
design-ss editor install         fetch its dependencies (~200 MB, once; --force reinstalls)
design-ss editor start [--port]  spawn it in the background; prints the URL
design-ss editor status          is it running, since when, on which port
design-ss editor stop            SIGTERM its process group and forget it
```

Three verbs, each doing one thing:

```
$ design-ss editor start
design-ss: the editor is not installed yet
design-ss:   run:  design-ss editor install      (~200 MB, once, into /usr/local/lib/node_modules/@measnalazi/design-ss/strip_editor)

$ design-ss editor install
design-ss: installing the editor in .../strip_editor (~200 MB, once)
...
design-ss: installed. Start it with: design-ss editor start

$ design-ss editor start
design-ss: editor running (pid 4812), serving strips from .../strips
design-ss: stop it with: design-ss editor stop        log: .design-ss/editor.log
http://localhost:4714/
```

The URL goes to stdout and everything else to stderr, so
`open $(design-ss editor start)` works.

**`start` never installs.** The editor is a Vite dev server that lives **in the
toolkit**, not in your project: `strip_editor/` ships inside the package, its
`node_modules` do not — the `files` allowlist excludes them, and they are
~200 MB. So `start` checks, names the missing step, and exits `2`.

`install` is idempotent — run it twice and the second says so and exits `0`. If
the toolkit directory is not writable (a global install under a root-owned
prefix) it says that instead of half-installing, and prints the `sudo npm
--prefix ...` line that would work.

**Background by default**, because a dev server you have to keep a terminal open
for is not something `stop` can help with. The mechanism is the one `design-ss
stop` already uses: the pid and process group go in
`<work root>/.design-ss/editor.json`, output goes to `editor.log`, and `editor
stop` reads the file and signals the group. Two files, deliberately: `design-ss
stop` kills a design run and never the editor.

**Ready means it answered.** `editor start` polls the URL until the server responds
before it records anything or prints success. A detached child that dies on
startup — a port held by something else, a broken install — is reported as a
failure with the tail of its log, not as a start whose URL 404s.

**A pid is not an identity.** Pids are reused, so `editor stop` confirms the
recorded pid is still a `vite` process before signalling it. Without that check
a stale `editor.json` will eventually point at something else's process.

`--port` defaults to 4714. The dev server sets `strictPort`, so a busy port is
an error and never a silent move to another one — the editor's iframe loads
strip HTML from its own origin, and a server that quietly moved would be a
second one, not the one you were told about.

### An install is not portable

`node_modules` is not a folder you can carry between machines. Vite pulls a
native binding chosen by platform and architecture —
`@rolldown/binding-darwin-arm64`, `@tailwindcss/oxide-linux-x64-gnu` — and npm
fetches only the one matching the machine doing the installing. Move that tree
to another OS and every file is present, `vite` resolves, and the server dies
on a bare `MODULE_NOT_FOUND` deep in a stack trace that reads like a bug in the
editor.

So `install` stamps what it installed for, in
`strip_editor/node_modules/.design-ss-install.json`, where a reinstall wipes it
along with everything else. `start` compares that stamp to the machine it is on:

```
$ design-ss editor start
design-ss: the editor is installed, but not for this machine -- installed for linux-x64, this machine is darwin-arm64
design-ss:   node_modules carries native binaries chosen at install time; they do not travel.
design-ss:   run:  design-ss editor install --force
```

`--force` exists for exactly this: without it `install` sees a populated
`node_modules` and exits early.

An install made by plain `npm install` carries no stamp. Unknown is not a
mismatch, so `start` proceeds — and if it fails on a missing module anyway, the
failure path recognises that shape and prints the same advice.

This check exists because the bug happened. An `npm ci` run against a shared
folder from a Linux container replaced a macOS tree, and the check in place at
the time — *does `vite/package.json` exist* — answered yes on both sides of it.

**`npm ci` deletes `node_modules` before it installs.** That is what makes it
the right command for replacing a cross-platform tree, and what makes an
interrupted run leave you worse off than you started. `install` says so before
it begins.

### Why dev, and not a built bundle

`editor start` runs `vite` (the dev server), and today that is the only thing that
works — but not because the editor needs HMR to notice a strip changing. It
does not. Measured, on a `vite preview` of a production build with no dev
server anywhere:

```
SSE connected: 200 text/event-stream
>> appended to strips/iphone/strip.html on disk
<< event: change  data: {"mtime":"...:36:10.909Z","size":15535}
```

Two reasons it works there. The API plugin mounts the *same* middleware in both
places — `configureServer` and `configurePreviewServer` — so the whole
`/__api/strip-editor/*` surface and the `/strips/**` mount exist in preview
too. And the watch is plain `nodeFs.watch` on the strip's parent directory
(parent, not the file: the editor saves by tmp+rename, which replaces the
inode and would go deaf on a file-bound watch). Neither depends on Vite's
watcher or on HMR. HMR only reloads the editor's own React source, which
matters when you are developing the editor, not when you are using it.

What actually forces dev is that `strip_editor/dist/` is gitignored and
excluded from the package, so an installed toolkit has no bundle to preview.

This is worth knowing for the shipping decision, because it removes the
objection to shape B. A prebuilt editor would keep live file detection. The
cost is not "lose the watcher", it is: build at publish time, and re-home the
middleware — already a standalone `(req, res, next)` mounted in two places —
onto a plain `node:http` server, so nothing but Node is needed at runtime.
`vite preview` alone would not buy much: it still loads `vite.config.ts`, which
imports the React and Tailwind plugins, so the install stays.

### What it serves, and the gap

The editor still resolves strips relative to **itself** (`REPO_ROOT` in
`strip_editor/vite-plugin-editor-api.ts`), so it lists the *toolkit's*
`strips/`, not the work root's. Inside a checkout those are the same directory
and it works; from anywhere else it does not. `editor start` prints the directory it is
serving and warns when that directory is empty, so an installed editor with an
empty file list reads as the known gap rather than as a project with no strips.

The fix is the two-root split `render.mjs` and `check-schema.mjs` already went
through — `/composer/**` from the toolkit, `/strips/**` from the work root, and
`--strips-root` passed to the checker and renderer the plugin spawns. It is a
separate piece of work; this command deliberately does not pretend to have done
it.

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

**There is no config file in the toolkit** — the defaults live in
`cli/defaults.mjs`, so the CLI works with nothing configured at all, and there is
nothing in the repo to edit.

The only `design-ss.config.json` that exists is one **you** create at your
project's work root, and it is entirely optional. It overrides the built-in
defaults, merged one level deep across `defaults`, `agents` and `paths` — override one agent row or one
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
variable — declare it in your project's config and it is checked
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
| **Input** | flags, environment, and the project's optional `design-ss.config.json` |
| **Output** | `<work root>/strips/<target>/`, and `rendered/` inside it |
| **stdout** | data (the renderer's JSON) |
| **stderr** | progress and errors |
| **Exit code** | the answer — see the table above |
| **Interaction** | none, ever. A run that cannot proceed exits rather than asking |
| **Cancellation** | `SIGTERM` to the process, or `design-ss stop` |
| **Logs** | `<work root>/.design-ss/agent.log`, `render.json` |
