# design_ss — agent entry point

This repo designs App Store / Play Store screenshot strips. A strip is one HTML
document: `strips/<target>/strip.html` is the single source of truth. The
renderer exports it and the visual editor edits it, in the same browser engine,
from the same file. There is no second representation.

## Start here

Designing, editing or re-running a strip? **Read
[`skills/strip-design/SKILL.md`](skills/strip-design/SKILL.md) first.** It covers
the three run modes, the design loop, and the rules learned from real failures.

This file is a pointer, not the brief. Do not work from it alone.

| Path | What it is |
|------|------------|
| `skills/strip-design/SKILL.md` | The one agent entry point. Read before any strip work. |
| `skills/strip-design/archetypes.md` | The design vocabulary — axes, panel archetypes, set rhythms. The authority on anything visual. |
| `composer/references/history.md` | One line per concept, newest last. The no-repeat rule reads the last line. |
| `composer/strip-schema.md` | The markup contract: panel structure, the five `data-layer` kinds, device attributes, z-order. |
| `input/README.md` | The brief format for `input/app.md`. |
| `NOTES.md` | Non-obvious logic across the repo and why. Read it before "fixing" anything that looks wrong. |

Five targets — `iphone`, `ipad`, `phone`, `tablet_7`, `tablet_10`. The `strips/`
and `input/` folder name is the only thing that says which target a run is for.

## Standing constraints

- **Never write your own validation.** `composer/check-schema.mjs` and
  `composer/render.mjs` *are* the validation. If you want a fact neither reports,
  say so rather than scripting around it.
- **No external network assets in a strip.** No web fonts, no remote images —
  the editor and the export would disagree. All faces are self-hosted in
  `composer/fonts/`. (`mask_analysis` is the sole exception, for OpenCV.js.)
- **Smallest edit that achieves the request.**
- **Do not fix things you were not asked to fix.** Say what you noticed and let
  the user decide.
- **Do not edit** `composer/*.mjs`, `strip_editor/src/**` or the frame packs
  during a design run.
- **`archetypes.md` is the authority on anything visual.** `SKILL.md` points at
  it and must not restate it — the two disagreed for months once, and the wrong
  copy was the one being trusted.

## Commands

```
npm test                                         # every suite — cli + composer
npm run check                                    # strips + frame-pack geometry
cd strip_editor && npm test && npm run typecheck
```

`render.mjs` writes `strip-data.json` **only on success** — delete the output
before re-running or you will read stale numbers as fresh.
