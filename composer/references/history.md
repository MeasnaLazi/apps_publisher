# Run history

One line per concept, appended at the end of the run that chose it. The point is
the **last** line: a run reads it and must not repeat that concept.

Per *concept*, not per run: a follow-run (`follows:` in `app.md`) repeats a
concept rather than choosing one, and appends nothing. Otherwise porting one
design to four other targets would write four more lines saying the same thing,
and bury the concept the next run is supposed to vary from.

This lives here rather than in the strip folder because a run *replaces*
`strips/<device>/` wholesale — anything recorded inside it is gone the moment
you re-run, which is exactly when the previous concept needs to be known.

Format — the same slots, in the same order, as the concept line the run states
before writing any markup. One source of truth; do not reorder one and not the
other.

```
<date> · <target> · <set rhythm> · <panel archetype> · <device treatment> · <type placement> · <background/palette> · <typeface> · <decor family, and what> · <register>
```

Example:

```
2026-08-09 · iphone · hero-plus-support · type-over-device · framed/bottom-crop · above · radial dark + gold · EB Garamond 400 + Inter · abstract (thin brass rule) · register: dark heritage
```

`<typeface>` is the title face and the body face, from `composer/fonts/` — see
`archetypes.md` § Axis 11. Recording it is what makes the no-repeat rule able to
see it; a run that omits the slot has almost certainly inherited the blank
template's Georgia without deciding anything.

`<register>` is the gestalt in one or two words — *literary editorial*,
*dark tech* — and it counts as a structural axis for the no-repeat rule; see
`archetypes.md` § How to use this. Older lines predate the slot and do not
carry it — when varying from one of those, read the register out of the rest
of the line and say that you inferred it.

Reading it back later also tells you what you have already tried for an app, and
what you have never once reached for.

**An empty log means the next run is a first run** — no previous concept to
avoid, choose freely. It does not mean the repo has no habits: check
`strips/<device>/strip.html` for what the last surviving strip actually did.

---


