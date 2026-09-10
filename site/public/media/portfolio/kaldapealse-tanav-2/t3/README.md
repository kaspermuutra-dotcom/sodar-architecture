# Kaldapealse tänav 2 — walkthrough media (version t3)

Everything here is derived from the on-site Matterport Capture scan
(iPhone LiDAR, 8 September 2026) by `scripts/matterport_capture_tour.py`,
`scripts/matterport_capture_faces.py`, `scripts/matterport_capture_colour.py`,
`scripts/matterport_capture_floorplan.py` and `scripts/matterport_capture_stills.py`.
Nothing is generated: the six 4032×3024 camera frames inside each sweep
container are registered to the sweep's frame, the lens vignetting is divided
out, and each direction takes one frame along seams chosen to run through
plain areas (dynamic-programming paths inside the frame overlaps, Matterport's
assignment map as the fallback). One master cube per sweep is cut into every
level below, so the base faces, the tiles, the previews and the stills share
one geometry and one colour transform.

Version t3 (2026-09-10) replaces t1 with: optimal seams instead of the
assignment map's cuts along architectural edges, vignetting correction, a
tour-wide colour normalisation (one linear-RGB gain per sweep, solved over the
navigation graph on surfaces that neighbouring sweeps both see — `colour.json`)
preview polar caps exposure-matched to the frames, and a depth-aware seam blend (≈1.5° on far surfaces, ≈0.6° on surfaces within reach so residual parallax never doubles an edge).

- `faces/<sweep>/<face>-0.webp` — 512 px base face (first paint, never blurred)
- `faces/<sweep>/<face>-1-<col>-<row>.webp` — 1536 px level, 2×2 tiles
- `faces/<sweep>/<face>-2-<col>-<row>.webp` — 3072 px level, 4×4 tiles
- `faces/registration.json` — per-sweep registration score, tilt, frame gains, seam mode, cap and colour gains
- `colour.json` — the tour-wide colour solve and the neighbour differences before/after
- `qa.json` — base-vs-level consistency, top/bottom orientation, neighbour colour differences (asserted by `lib/demo/media.test.ts`)
- `pano/<sweep>.preview.webp` — 512×256 preview behind the canvas while tiles stream
- `thumb/<sweep>.webp` — 320×160 thumbnail for the checkpoint rail
- `stills/<sweep>.webp` — rectilinear crops for the gallery, from these faces
- `poster.webp`, `og.jpg` — the opening view (front garden facing the entrance)
- `plan/{outside,ground,upper}.webp`, `plan/plan.json` — Matterport-style plan
  views rendered top-down from the depth panorama inside every sweep container
  (each level from its own sweeps, ceilings cut above each sweep's detected floor,
  coloured from these faces); `plan.json` holds the per-level world→pixel transform

The directory name `t3` is a cache version: these URLs are served with a
one-year immutable `Cache-Control`, so a regenerated set must go to `t4`.
Sweep ids are the first 8 hex characters of the Capture sweep ids; poses,
floors and the link graph live in `site/lib/demo/kaldapealse-tanav-2.sweeps.json`
(generated) and `site/lib/demo/properties.ts` (curated). The raw export is
not committed. The polar caps above +34° and below −65° elevation come from
the export's 512 px preview because the camera frames (pointing 15° down)
never cover them.
