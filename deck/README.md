# Sodar — pitch deck

Static, single-page HTML deck (13 slides, 1920×1080 stage scaled to the window) in the
site's "Mono Scan" design system. No build step.

## Run it

```bash
python3 -m http.server 4173 -d deck
```

then open <http://localhost:4173/>. In the Claude desktop app the same server is the
`deck` entry in `.claude/launch.json`.

Keys: `←` `→` / space to move, `F` fullscreen, `R` replays the film, `P` (or click) pauses it.
`?motion=off` disables transitions (screenshots, reduced motion). Any slide can be linked
as `#<n>`.

## Slides

1. Cover — logo, headline, walkthrough loop behind
2. Problem
3. **Solution film** (`#film`, ≈52 s in the deck, ≈42 s web cut): kinetic title → sped-up
   scanning clips and two Higgsfield walking shots (Kling 3.0) → twelve kitchen tiles assemble
   into a panorama → free preview → desk → an Estonian replica of the kv.ee flow (results list
   → the agent's listing → edit form, virtual-tour link typed → saved → tour live) → [deck
   only: "Scan once. Pay once." and the CRM workspace] → end card
4. How it works
5. Traction — Re/Max, Pindi, Ober-Haus, 1Partner pilot talks
6. Roadmap — pilots → Slush (18–19 Nov 2026) → partners → scale
7. Market & business model
8. Competition — colour-coded strategy canvas (Matterport blue, Giraffe360 amber, CubiCasa/iGUIDE pink, Sodar white); the "blue whale" is the right half of the chart
9. Why now / technical roadmap (API keys, data backers)
10. Team & onboarding
11. Investors & the ask
12. Trust
13. Close / contact

## Exporting the film for the website

The film is a pure function of time (`renderAt(t)` in `deck.js`), so it can be rendered
frame by frame with headless Chrome:

```bash
python3 -m http.server 4173 -d deck          # in one terminal
node deck/export/render.mjs --url "http://localhost:4173/?export=1&motion=off&cut=web#3"
                                             # writes site/public/media/intro.mp4 (1280×720, 30 fps)
```

`?cut=web` drops the `deckonly` scenes (pricing, CRM). `--fps`, `--width`, `--out`, `--chrome` override the defaults; `deck/export` has its own
`package.json` with `puppeteer-core`. The poster is a frame from the same file:
`ffmpeg -ss 8 -i site/public/media/intro.mp4 -frames:v 1 site/public/media/intro-poster.jpg`.

## Editing

- Copy lives in `index.html`; every slide is a `<section class="slide">`.
- The film's scene timings are `data-dur` attributes; the cursor/keyboard choreography is
  the `update()` function in `deck.js` (scene 7 = the kv.ee portal).
- The strategy canvas data (values, colours, one-line notes) is the `series` array at the bottom of `deck.js`.
- Media: `media/` — `scan-start.mp4` is the site's `capture-person.mp4`; `scan-turn`,
  `scan-nextroom`, `scan-kitchen-pov`, `desk-laptop` were generated 2026-09-06 with
  Higgsfield Kling 3.0 (10 credits each).
- The kv.ee page is a mock-up built in HTML for the demo, not a real integration.
