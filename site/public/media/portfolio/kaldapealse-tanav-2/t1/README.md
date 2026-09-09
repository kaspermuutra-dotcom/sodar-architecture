# Kaldapealse tänav 2 — walkthrough media (version t1)

Everything here is derived from the on-site Matterport Capture scan
(iPhone LiDAR, 8 September 2026) by `scripts/matterport_capture_tour.py` and
`scripts/matterport_capture_faces.py`. Nothing is generated: the six 4032×3024
camera frames inside each sweep container are registered to the sweep's frame
and composited along Matterport's own seams into six 3072 px cube faces.

- `faces/<sweep>/<face>-0.webp` — 512 px base face (first paint)
- `faces/<sweep>/<face>-1-<col>-<row>.webp` — 1536 px level, 2×2 tiles
- `faces/<sweep>/<face>-2-<col>-<row>.webp` — 3072 px level, 4×4 tiles
- `faces/registration.json` — per-sweep registration score, tilt, exposure gains
- `pano/<sweep>.preview.webp` — 512×256 preview behind the canvas while tiles stream
- `thumb/<sweep>.webp` — 320×160 thumbnail for the checkpoint rail
- `stills/<sweep>.webp` — rectilinear crops for the gallery
- `poster.webp`, `og.jpg` — the opening view (front garden facing the entrance)

The directory name `t1` is a cache version: these URLs are served with a
one-year immutable `Cache-Control`, so a regenerated set must go to `t2`.
Sweep ids are the first 8 hex characters of the Capture sweep ids; poses,
floors and the link graph live in `site/lib/demo/kaldapealse-tanav-2.sweeps.json`
(generated) and `site/lib/demo/properties.ts` (curated). The raw export is
not committed.
