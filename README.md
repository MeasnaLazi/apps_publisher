# design_ss

**Design App Store and Play Store screenshot strips with an AI agent.**

![A five-panel iPhone strip: warm parchment ground, serif headlines, upright devices](docs/strip-iphone-1.jpg)

![The same app on a deep green ground with a bleed of device art behind each panel](docs/strip-iphone.jpg)

![The same app again: a photo band across the top, numbered panels, dark ground](docs/strip-iphone-2.jpg)

Give it your app's description and a folder of screen captures. An agent reads
them, designs the strip, and renders it at the exact size the stores require.

**Three runs, one `input/` folder, three designs.** A template gives every app
the same layout with its content swapped in. Here the concept is composed per
run — palette, typeface, rhythm, how the devices sit, what the panels do
together — so a run you do not like is a run away from one you do.

A strip is **one HTML document**. `strips/<target>/strip.html` is the single
source of truth — the renderer exports that file and the visual editor edits
that file, in the same browser engine. There is no second representation.

```
input/app.md          ┐                  ┌─ strips/<target>/strip.html
input/<target>/*.png  ┴─►  the agent  ─►─┤
                                         └─ strips/<target>/rendered/*.png
                                                    ▲
                                       strip_editor ┘  (optional, by hand)
```

Five targets: `iphone` and `ipad` for the App Store, `phone`, `tablet_7` and
`tablet_10` for Play Store.

| Target | Screenshot | Store |
| --- | --- | --- |
| `iphone` | 1290 × 2796 | App Store |
| `ipad` | 2048 × 2732 | App Store |
| `phone` | 1080 × 1920 | Play Store |
| `tablet_7` | 1200 × 1920 | Play Store |
| `tablet_10` | 1600 × 2560 | Play Store |

One panel is one screenshot at these dimensions; a five-panel iPhone strip is
6450 px wide. The two Apple sizes are specifications — Apple publishes exact
export sizes and rejects anything else. The Play sizes are house choices inside
Google's permitted range (320–3840 px per side, at most 2:1).

## Requirements

| | |
| --- | --- |
| **Node 22.x** | the renderer and the editor |
| **Chromium** | `npx playwright install chromium` — headless export |
| **An agent** | anything that reads `AGENTS.md`: Claude Code, Gemini CLI, Codex, Open Code, Co-Pilot, Cursor...etc |

```bash
git clone https://github.com/MeasnaLazi/design_ss.git
cd design_ss/composer
npm install
npx playwright install chromium
```

That is everything needed to design and render. The visual editor installs
separately and only if you want it.

The agent is the part that designs, so a run costs whatever your agent costs.
Everything else — rendering, checking, editing — is local and offline.

## Running the agent

**The designer is the agent.** 

**1. Put your captures in `input/<target>/`,** named for what they show.
`timeline.png` tells the agent what that screen proves; `IMG_4821.PNG` tells it
nothing. Five or more is comfortable.

**2. Write `input/app.md`.** The whole gate is a name and a summary:

```markdown
# Bio

## Summary

A private journal that turns everyday moments into a story worth keeping.
For people who want to write a little, not a lot.
```

Everything else — tone, palette, device frame, panel count, the headlines
themselves — is optional, and anything you leave out the agent works out and
tells you what it chose.

**3. Start your agent in the repo root** and ask for a strip:

> can you design the screenshot?

> design the iphone strip

`CLAUDE.md` / `GEMINI.md` / `AGENTS.md` all point at the skill. From there the
run is: read the brief → draft any panel copy you did not write, back into
`app.md` → choose a concept and say it → write the HTML → check the schema →
render → look at the PNGs → iterate. Roughly four rounds, then it stops.

Name no target and it designs **every** device folder you have populated, as one
family rather than five cousins. It announces the set before the first write.

It will draft your marketing copy. It will not invent your app: every claim has
to be visible in a capture or supported by your summary.

## `input/` — what you write

```
input/
  app.md              the app: name, summary, request, pinned values, panel copy
  *icon*.png          your app icon — optional
  iphone/             one folder per target; the folder name IS the target
    welcome.png
    timeline.png
```

`app.md` has four sections, three of them optional: `# Name` and `## Summary`
(required), `## Request` for intentions written as prose — *"premium and quiet,
not a productivity app"* — `## About` for pinned values like `theme:` and
`frame:`, and `## Panel N` for copy you want taken verbatim. Panels you skip are
drafted and written back into this file, so the next run starts from copy you
have had a chance to correct.

→ **[`input/README.md`](input/README.md)** is the full format: every key, the
five target sizes, sharing one design across targets with `follows:`, and what
happens when you have more captures than panels.

## `strips/` — what comes out

```
strips/iphone/
  strip.html          the document — the single source of truth
  screenshots/        the captures it used, copied in
  images/             artwork made for it
  rendered/           panel0.png … panel4.png, strip.png, strip-data.json
```

Self-contained: a strip never references anything outside its own folder, so it
can be moved or cloned whole.

**`strips/` is output and is gitignored.** A run replaces the target folder
outright, and a run is not deterministic — the design decisions live in the
agent, not in `app.md`, so re-running the same input gives you a *different*
strip rather than the same one back. Copy a folder somewhere else if a
particular result is worth keeping.

## `design-ss` — the command line

The same run without a conversation: takes flags, writes files, returns an exit
code, and never asks a question — so a script or a pipeline can drive it.

```bash
design-ss design   --target iphone --message "warmer palette, lead with the timeline"
design-ss retarget --target iphone --size 1284x2778   # rescale to another store size
design-ss gate     --target iphone                    # check + render, no agent, no key
design-ss check    --all                              # schema only, no browser
design-ss render   --target iphone                    # strip -> store-size PNGs
design-ss frames   iphone --list                      # device frame packs
design-ss stop                                        # cancel this project's run
```

`--input <dir>` may point anywhere; output always goes to `<work root>/strips/`,
so the toolkit can be installed once and aimed at any project. `--agent stub`
runs the whole path with no model and no cost.

| | | | |
|---|---|---|---|
| `0` | designed, checked, rendered | `4` | the agent process failed |
| `1` | gate failed — schema or render errors | `5` | `NEEDS_INPUT` — the input folder is incomplete |
| `2` | usage, unknown agent, or it would not start | `6` | warnings only |
| `3` | the agent finished and wrote no strip | `124` / `143` | hit its deadline / was stopped |

Full reference, including which store sizes `retarget` can and cannot reach:
[`docs/cli.md`](docs/cli.md).

## `strip_editor` — the parts you want to move yourself

```bash
cd strip_editor
npm install
npm run dev          # http://localhost:4714
```

Opens `strip.html` directly — no import step, nothing converted. Drag and resize
blocks with snapping, edit text in place, swap screenshots and device poses,
tune type and colour, undo anything. Saves are surgical: moving one headline
rewrites one line and leaves the rest of the file byte-for-byte alone.

It watches the file while the agent writes, so you can leave it open during a
run and watch the design appear — the canvas goes read-only and names whoever
holds it, and the lease lapses on its own if the run dies.

→ **[`strip_editor/README.md`](strip_editor/README.md)** for the full editor,
its keyboard map, the server API and the architecture notes.

## Why use this

What the alternatives cost you:

- always the same layout ~ template
- looks like every other app that used it ~ template
- your design fits the tool, not your app ~ template
- a subscription that never ends ~ template
- expensive ~ designer
- days for a round of changes ~ designer
- every new screenshot is another invoice ~ designer
- five device targets is five jobs ~ designer
- an afternoon per target, every time ~ yourself
- export sizes are easy to get wrong ~ yourself
- needs design skill you may not have ~ yourself
- one screen changes and you re-export all five by hand ~ yourself

None of this beats a good designer on your first strip. It beats the
alternatives on your fifth.

## Read more

| | |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | the agent entry point — start an agent here |
| [`skills/strip-design/SKILL.md`](skills/strip-design/SKILL.md) | how a design run works, and the rules learned from real failures |
| [`skills/strip-design/archetypes.md`](skills/strip-design/archetypes.md) | the design vocabulary — the authority on anything visual |
| [`docs/cli.md`](docs/cli.md) | the `design-ss` command line: flags, exit codes, cancelling a run |
| [`composer/README.md`](composer/README.md) | the renderer, the schema checker, and the frame packs |
| [`composer/strip-schema.md`](composer/strip-schema.md) | the markup contract a strip has to satisfy |
| [`NOTES.md`](NOTES.md) | non-obvious logic, and what breaks if you "fix" it |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | what to contribute — the vocabulary and the frame packs come first |

## License

[MIT](LICENSE) © 2026 Measna.

The typefaces bundled in `composer/fonts/` — EB Garamond, Lora, Inter, Poppins,
Space Grotesk and IBM Plex Mono — are licensed under the
[SIL Open Font License 1.1](composer/fonts/OFL.txt), not MIT.
