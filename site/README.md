# sodar.io — site

Marketing site for **sodar.io** — Next.js 15 (App Router, TypeScript), Tailwind 4,
next-intl locale routing, GSAP for motion. Deployed on Vercel (project Root
Directory = `site`), Supabase env stubs wired for phase 2.

## Local development

```bash
cd site
npm install
cp .env.example .env.local   # optional until the workspace reads data
npm run dev                   # http://localhost:3000
npm run typecheck
npm test                      # vitest, mocked providers — never consumes credits
```

## Design system — "Mono Scan"

Black page, warm off-white type, **no colour accent**. All tokens live in
`app/globals.css` under `@theme`. The second pass (September 2026) removed every
texture and ornament — grain, vignette, hairline grid, glows, section numbers,
arrow glyphs, the room marquee — and keeps motion to a few fades.

- Display: Instrument Serif (`.display`, `.section-title`)
- Body: Inter · Small labels only: JetBrains Mono (`.section-kicker`, `.mono-label`)
- Forms: `.field` / `.field-input` (contact and privacy forms, partner application)
- The one motif: the scan-line reveal (`components/scan-reveal.tsx`), toned down.
- Logo: `components/logo.tsx` — the official S mark.
- Company details (emails, phone, LinkedIn): `lib/company.ts`.

### Light bands

`.theme-light` (in `globals.css`) re-maps every design token to the cream
palette, so wrapping a group of sections in `<div className="theme-light">`
flips them Zobi-style without touching the components. The homepage alternates
dark hero / light thesis / dark pipeline / light capabilities / dark workspace /
light trust + pricing.

## Motion

Every GSAP effect checks `prefersReducedMotion()` from `lib/motion.ts`, which is
true for the OS setting **or** `?motion=off` in the URL. Use `?motion=off` for
screenshots / visual QA so you see final states instead of frozen tweens.

Pieces: `components/mosaic-grid.tsx` (hero wall, one staggered fade-in),
`components/intro-video.tsx` (the film, with a minimal control bar),
`components/pipeline.tsx` (Capture → Preview → Unlock → Publish as stacked
stages that fade in once), `components/manifesto.tsx` (scroll-lit thesis
lines), `components/stats-band.tsx` (counters).

## Contact forms

`components/contact-form.tsx` renders two audiences: the default posts to
`NEXT_PUBLIC_FORMSPREE_ID` (team@sodar.io) and `audience="privacy"` — used on
`/legal/privacy` only — posts to `NEXT_PUBLIC_FORMSPREE_PRIVACY_ID`
(privacy@sodar.io). Job title, phone (country-code selector in
`lib/dial-codes.ts`), subject and message are mandatory. Without a Formspree
id the form falls back to a pre-filled mailto.

## Scanner (`/scan`)

Every white "Scan a property" button opens `/scan`: a full-screen guided
capture for phones. Two modes — *Quick panorama* (turn on the spot) and *Full
3D scan* (walk a loop of stations; default). Geometry is the Photo Sphere
Android port in `lib/scanner/sphere.ts` plus the station plan in
`lib/scanner/plan.ts`; local quality gates in `lib/scanner/quality.ts`; frames
persist in IndexedDB (`lib/scanner/db.ts`) before they count. Finishing a room
builds an on-device WebGL panorama preview (`lib/scanner/stitch.ts`), offers a
GPT-6 Astra capture review (`/api/astra`), then — after e-mail sign-in —
uploads the immutable originals resumably (`lib/scanner/upload.ts`,
`app/api/scanner/*`) and, after an explicit consent sheet, starts KIRI (faithful
3DGS) and optional Marble (World Labs) reconstruction through
`app/api/reconstruction/*` and `lib/reconstruction/*`. Results, downloads, the
Photo Sphere Viewer walkthrough, doorway confirmation and the gsplat viewer live
under `components/scanner/`. Full design, provider matrix, privacy boundaries,
env names, deployment, tests and runbook:
[`../docs/SCANNER_ARCHITECTURE.md`](../docs/SCANNER_ARCHITECTURE.md).
`/scan?demo=1` stitches the bundled synthetic room without a camera.

## Portfolio (`/portfolio`, `/portfolio/<slug>`)

`lib/portfolio.ts` is the single ordered registry behind the portfolio index,
the homepage portfolio section (`components/portfolio-grid.tsx`) and every
project page. Items carry an explicit `order`; the first client scan
(Kaldapealse tänav 2, Ruslan Gulida · RE/MAX) is `order: 0` and stays first as
projects are added. Sample listing-type tiles follow it. `/demo/<slug>`
redirects permanently to `/portfolio/<slug>` (`next.config.ts`).

A walkthrough item carries either an `embed` (`{ provider: "matterport",
modelId }`) or a local `walkthrough`. With an embed the project page shows the
official Matterport Showcase model (`components/demo/matterport-embed.tsx` —
the same square-cornered stage, poster → Start mounting the frame with
`play=1&title=0`, an opaque Sodar panel top-left over the player's logo, a
fullscreen control on the stage (the frame's own fullscreen is off so the
panel stays), Close, and the poster held over the frame while the player's
loading screen runs; Matterport streams the imagery, nothing is downloaded or
re-processed), the coverage fact is `Portfolio.facts.scopeEmbed`, and the
stills (`gallery` on the item, under `public/media/portfolio/<slug>/<version>/`)
are plain tiles. Kaldapealse tänav 2 has been embedded since 2026-09-12 (model
`98WLexoRstU`); its local reconstruction — curation, generated data, review
page and media t1–t4 — was removed the same day and lives in git history.

A local walkthrough project is a linked 360° tour built from a Matterport
Capture export. Three scripts in `../scripts/` produce everything from the
export:

- `matterport_capture_tour.py` decodes `SweepProcessorData/manifest.mfst`
  (poses, floors, capture order), derives candidate links from sweep
  positions and writes `lib/demo/<slug>.sweeps.json`.
- `matterport_capture_faces.py` renders the **high-resolution** imagery. The
  export's `*_skybox*.jpg` faces are only a 512 px preview level; the real
  detail is in each sweep's `.swl` container: six 4032×3024 camera frames with
  intrinsics and rotations (~27 px/deg) plus Matterport's per-pixel frame
  assignment map. Frames are registered to the skybox frame, the lens
  vignetting is divided out (a shared radial model fitted from the frame
  overlaps, so seams through plain walls carry no brightness step), and each
  direction takes one frame along **optimal seams**: inside every overlap a
  dynamic-programming path minimises the frames' difference plus the local
  gradient, so cuts run through plain wall or foliage and never along a door
  frame, skirting or corner (Matterport's map is the fallback where no path
  exists). A ~1.5° soft edge blends the two frames at the seam. Depth-assisted
  reprojection through the container's depth panorama and per-frame offsets
  was built and measured (`--depth-sigma`): the recorded offsets do not
  predict the residual seam offsets and the reprojection displaces near
  surfaces by degrees and bends recesses, so it is off by default. The polar
  caps (above +34° and below −65°, which the frames never cover) come from the
  512 px preview, exposure-matched to the frames per sweep. One master cube per
  sweep is then cut into every level and preview, so the base faces, all tile
  levels, the previews and the stills share one geometry and one colour
  transform; written as a cubemap tile pyramid under
  `public/media/portfolio/<slug>/<version>/faces/<sweep>/`: `<face>-0.webp`
  (512 px base), `<face>-1-<col>-<row>.webp` (1536 px, 2×2) and
  `<face>-2-<col>-<row>.webp` (3072 px, 4×4), plus previews/thumbnails.
  The `<version>` segment (`t1`, `t2`, …) is what makes the immutable
  one-year `Cache-Control` header in `next.config.ts` safe: regenerate → new
  segment → new URLs.
- `matterport_capture_colour.py` solves one linear-RGB gain per sweep over the
  whole navigation graph (`lib/demo/<slug>.colour.json`, also copied next to
  the media): every linked pair's shared surfaces are found through the depth
  panoramas (a point seen by A is projected into B and must agree with B's own
  depth), the median per-channel ratio in linear light is the pair's
  measurement, glass/occlusion pairs and tiny counts are dropped, exterior ↔
  interior pairs count less, and the least-squares solve is anchored on the
  median-exposure sweep of each level (gains clamped to ±0.7 EV / ±15 %
  chroma). `matterport_capture_faces.py --colour` applies the gains to the
  master; `--measure-only` re-measures a finished version for the QA manifest.
- `matterport_capture_stills.py` renders poster, social image and gallery
  stills from a version's own 3072 px faces (same registration and colour).
- `matterport_capture_qa.py` writes `qa.json` next to the media: base-vs-level
  differences (only sharpness may differ), top/bottom orientation agreement
  across levels, and the neighbour colour differences; `lib/demo/media.test.ts`
  asserts it and the pixel size of every face and tile.
- `matterport_capture_floorplan.py` renders the Matterport-style **plan views**
  under the viewer from the 3600×1801 depth panorama inside every `.swl`
  (standard lat/lon, x mirrored against the colour frame). Every sweep's depth
  becomes a coloured point cloud in the model frame (colour sampled from the
  composited faces); each level is drawn top-down from its own sweeps only,
  with the ceiling cut 1.45 m above the sweep's *own* detected floor (the
  handheld camera sits 0.8–1.7 m above the floor, so a fixed cut would slice
  the walls). Exposure is matched per sweep, holes between samples and the
  blind spot under the camera are closed by a coverage-gated pyramid fill,
  and the result goes to `public/media/portfolio/<slug>/<version>/plan/`
  with `plan.json` (per-level world→pixel transform, copied to
  `lib/demo/<slug>.plan.json`). Input: `lib/demo/<slug>.plan-input.json`
  (sweep id → level, derived from the curation).

The curated part — labels, floor zones, opening viewpoint, checkpoints, link
corrections, exclusions — lives in `lib/demo/properties.ts`;
`lib/demo/walkthrough.ts` merges both into the scanner's `tour.v1` manifest
(world-aligned hotspot yaws, `sphereCorrection` per panorama) and validates it.
`lib/demo/walkthrough.test.ts` is the integrity check (unique ids, valid
floors, symmetric links, reachability of every sweep, checkpoint/floor-entry
references, existence of every base face and tile, floor changes only on the
stairs, exterior→interior only through the entrance); `lib/portfolio.test.ts`
guards the ordering.

UI in `components/demo/`: `virtual-tour.tsx` (Photo Sphere Viewer
cubemap-tiles + virtual-tour + markers: a sharp, never-blurred 512 px base,
tiles for the faces in view with a DPR-aware level choice, Matterport-style
floor rings for tap-to-move, error events). Moving between scenes is atomic:
the destination's six base faces and the tiles that will be visible on
arrival (direction of travel plus the floor) are warmed into the browser
cache first (6 s deadline), then the two complete scenes cross-fade (550 ms,
tone mapping disabled so PSV's fade cannot flash), keeping the current pitch
and facing the direction of travel; a newer request cancels one still
preloading, so rapid clicks end on the last choice. Reduced motion switches
without animation. `property-demo.tsx`
(poster → tour orchestration, history, hash deep links), `checkpoint-rail.tsx`,
`plan-map.tsx` (Matterport-style plan under the viewer: level tabs, the
depth-rendered plan of the current level, every viewpoint as a tappable dot,
a view cone on the current one that follows the panorama's yaw),
`sodar-badge.tsx`. The
viewing surface is square-cornered and full-bleed on phones. These are 360°
walkthroughs from the scan, not hosted Matterport Showcase models.

## Contact

`components/contact-form.tsx` posts to Formspree when
`NEXT_PUBLIC_FORMSPREE_ID` is set (messages land at team@sodar.io) and falls
back to a pre-filled `mailto:` otherwise. The "I am a…" role is required.
Phone: +372 56666760. The form also sits under the privacy policy.

## Media

Generated assets go under `public/media/` — see [`MEDIA_PLAN.md`](MEDIA_PLAN.md)
for the Higgsfield shot list and commands. `public/media/rooms/tile-NN.jpg`
(45 tiles) are currently crops of `public/sodar-apartment-hero.png` as
stand-ins.

## Supabase

- `lib/supabase/env.ts` — reads and validates the two public env vars
- `lib/supabase/server.ts` — bearer authentication + service-role client for API routes
- `lib/supabase/health.ts` — connectivity check (`components/dev-status.tsx`)
- Migrations: `../supabase/migrations/202609040001_capture_backend.sql`, `202609070001_reconstruction.sql`

Never put the `service_role` key in a `NEXT_PUBLIC_` variable.
