# Contributing

The unusual thing about this repo, said first because it changes what is worth
your time: **the most valuable contributions here are not code.**

The designer is an agent. What makes it design well is not the renderer — that
part is fairly ordinary — but the vocabulary it chooses from and the frame packs
it has to work with. Both are plain text and plain SVG, both are short of
material, and neither needs you to understand the TypeScript.

| | Where | Who it suits |
| --- | --- | --- |
| **Design vocabulary** | `skills/strip-design/archetypes.md` | anyone who looks at store pages carefully |
| **Frame packs** | `composer/device-frames/` | anyone who can draw or measure an SVG |
| **The skill** | `skills/strip-design/SKILL.md` | anyone who has run it and watched it fail |
| **Code** | `composer/`, `strip_editor/` | the usual |

## Design vocabulary — start here

`archetypes.md` is the authority on anything visual: eleven axes a design is
assembled from, plus the set rhythms and anti-patterns. It is also, by its own
admission, thin in the places that matter most:

> It is also reliable on conventional moves and thin on unusual ones — the ones
> worth stealing. When you see something on a store page whose move is not in
> here, add it — tagged **OBSERVED**, with the app's name. […] The gaps are
> where the interesting work lives.

**Check the tag system before you write a line.** Every claim in that file
carries one of five tags — RULE, CONVENTION, OPINION, OBSERVED, MEASURED — and
they are ranked by evidence, not by confidence. Read *§ How much to trust each
line* first. The two that need something from you:

- **OBSERVED** — you saw it working on a real store page. **Name the app.** An
  observation without the app it came from is an opinion wearing a better tag.
- **MEASURED** — an A/B result from App Store Product Page Optimization or a
  Play listing experiment. **Give the date and the lift.** This tier is empty
  and it is the one that should grow; *§ Growing MEASURED* says how to run the
  test properly.

OPINION is welcome too — just tag it OPINION rather than dressing it up. The
file is honest about being mostly opinion, and one more honest opinion costs
nothing.

**Do not restate this file anywhere else.** `SKILL.md` points at it and
deliberately does not summarise it: the two disagreed for months once, and the
wrong copy was the one being trusted. The same applies to any new document.

## Frame packs

A pack is a folder, a JSON file and one SVG per pose. `composer/device-frames/README.md`
is the reference; the parts that trip people up:

- **`type` must be the name of a folder under `strips/`** — `iphone`, `ipad`,
  `phone`, `tablet_7`, `tablet_10`. That is how the editor offers the right
  mockups for the strip being edited. Anything else renders fine and never
  matches a strip.
- **Every pose SVG needs a `#screen` path** marking the aperture. The runtime
  clips the screenshot with it and *throws* if it cannot be read — there is
  deliberately no fallback. `NOTES.md` explains why.
- **`corners` warps; `#screen` clips.** They are two facts with two jobs, and
  `corners` must fully contain the aperture.
- **Trust the SVG's `viewBox`, not `frame.json`'s `viewWidth`.** Several packs
  have had stale values. The runtime scales to the viewBox.

Verify with `npm run check`, which checks frame-pack geometry
alongside the strips, and look at the result — `composer/test/pose-test.html`
renders every pose of a pack with a calibration screen, and a bent grid line is
a warp that is wrong.

A single pose is a complete pack. Do not pad one out.

When you submit artwork, **say where it came from** — your own drawing, or the
source and its licence. Frame artwork is the one thing here that tends to arrive
with strings attached.

## The skill

`SKILL.md` is the program the agent runs, and its *§ Rules* section is a list of
things that went wrong once. If you have run a design and watched it do
something stupid, that is a contribution: describe what you asked for, what it
did, and what it should have done. A rule with a real failure behind it is worth
more than a rule that sounds sensible.

`composer/references/history.md` is one line per concept, newest last. The
no-repeat rule reads the last line, so the format matters more than the prose.

## Code

**Read `NOTES.md` first.** It documents the things in this repo that look like
mistakes and are not, each with what breaks if you "fix" it. Most entries exist
because someone changed the thing and had to change it back.

Three standing constraints, all learned from real failures:

- **Never write your own validation.** `composer/check-schema.mjs` and
  `composer/render.mjs` *are* the validation, and they are what the export and
  the editor actually use. A checker you write measures something subtly
  different from what ships. If you want a fact neither tool reports, say so
  rather than scripting around it.
- **No external network assets in a strip.** No web fonts, no remote images —
  the editor and the export would disagree. Faces are self-hosted in
  `composer/fonts/`.
- **Smallest edit that achieves the request.** And do not fix things you were
  not asked to fix; say what you noticed instead.

### Running everything

```bash
npm install                      # at the root; fetches Chromium too
npm test                         # every suite — cli + composer
npm run test:composer            # composer only
npm run check                    # strips + frame-pack geometry

cd strip_editor && npm install   # the editor keeps its own package
cd strip_editor && npm test && npm run typecheck
cd strip_editor && npm run dev   # http://localhost:4714
```

Node 22.x. `render.mjs` writes `strip-data.json` **only on success** — delete
the output before re-running or you will read stale numbers as fresh.

## Pull requests

Say what you changed and why it is right, not what files you touched — the diff
already says that. For a rendering bug, include the strip HTML and its
`strip-data.json`; between them they reproduce almost anything.

Tests and `npm run check` should pass. If something in `NOTES.md` is now wrong
because of your change, update it in the same PR — that file going stale is
worse than it not existing.

Contributions are accepted under the [MIT License](LICENSE).
