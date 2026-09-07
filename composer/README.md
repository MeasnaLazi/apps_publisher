# composer/

HTML/CSS strip composer.

Strips are authored as plain HTML (contract: [`strip-schema.md`](strip-schema.md)),
rendered to export-size PNGs by headless Chromium.

| File | Role |
| --- | --- |
| `render.mjs` | CLI: strip HTML → per-panel PNGs + `strip-data.json` (measured geometry + `problems`) (`--strip`, `--out`, `--full`, `--strips-root`). Serves two mounts locally: the toolkit at `/` so pages can use `/composer/**`, and the strips root at `/strips/` so a strip's own `images/` and `screenshots/` resolve wherever the project lives. |
| `check-schema.mjs` | Structural conformance against `strip-schema.md`, from the source text alone — no browser. `--all`, `--skeleton`, or a file. Takes `--strips-root <dir>` so a strip living outside the toolkit has its `/strips/**` assets resolved where they actually are. |
| `device-frames.mjs` | Browser runtime: builds `[data-device]` blocks — matrix3d homography warp from `frame.json` `corners`, clip via the pose SVG's `#screen` path, frame artwork on top. |
| `pick-frame.mjs` | CLI: `node composer/pick-frame.mjs <target> [--list]` — one frame pack id for that target, chosen at random from `device-frames/index.json`. Exists because an agent asked to pick at random returns the same one every time. |
| `homography.mjs` | Shared math (Node + browser): the screen-quad warp used by both the renderer and the editor. |
| `strip-schema.md` | Layer contract for strip documents (keeps HTML importable to display JSON later). |
| `test/homography.test.mjs` | `node composer/test/homography.test.mjs` — corner round-trip < 1e-6 px for every pose of every pack. |
| `test/pose-test.html` | All 8 iphone_12_pro poses with a real screenshot — visual fit acceptance. |
| `test/bio-strip.html` | Hand-written 5-panel Bio strip (1290×2796) — pipeline acceptance. |

## Setup

```bash
cd composer
npm install
npx playwright install chromium
```

## Render

```bash
# from repo root
node composer/render.mjs --strip composer/test/pose-test.html --out output/temp/pose-test
node composer/render.mjs --strip strips/hello-world/strip.html --full
```

Output: `panel<N>.png` per `[data-panel]` element (+ `strip.png` with `--full`),
JSON summary on stdout, exit non-zero on page errors.
