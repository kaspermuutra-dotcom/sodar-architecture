# Kaldapealse tänav 2 — walkthrough media (version t4)

Version t4 (September 2026) is a multi-view reconstruction of the same on-site Matterport Capture scan
(`scripts/recon/`, see `docs/RECON_NOTES.md`). Each sweep's six 4032×3024 frames are placed at their solved
camera centres (10–30 cm apart) and rotations, the LiDAR depth image (decoded from its packed layout) lifts every
output direction to a 3-D point, and each frame is sampled where that point really is in it — so walls, door
frames, windows and stairs no longer double or split at the seams. Seams are dynamic-programming paths through the
frame overlaps; colour is anchored per frame to Matterport's preview and then normalised across the tour
(`colour.json`). The floor below each sweep, which its own frames never see, is filled from neighbouring sweeps
that see it from above; the ceiling cap above ≈+37° still comes from the 512 px preview. Nothing is generated.

Where the depth-based render fails the scene keeps its t3 seam-composite master (LiDAR depth through glazing bends
window frames; thin near objects — door leaves, basins, a wall corner — tear or ghost; sunlit facades blotch). Those
scenes carry a `source_t3.json` next to their render; the tour-wide colour solve and the tiles treat both sources alike.

- `faces/<sweep>/<face>-0.webp` — 512 px base face
- `faces/<sweep>/<face>-1-<col>-<row>.webp` — 1536 px level, 2×2 tiles
- `faces/<sweep>/<face>-2-<col>-<row>.webp` — 3072 px level, 4×4 tiles
- `colour.json` — tour-wide gains and the neighbour differences after the solve
- `qa.json` — base-vs-level consistency, top/bottom orientation, neighbour colour differences (asserted by `lib/demo/media.test.ts`)
- `pano/<sweep>.preview.webp`, `thumb/<sweep>.webp` — loading preview and checkpoint thumbnail from the same master
- `stills/`, `poster.webp`, `og.jpg` — rectilinear crops from these faces
- `plan/` — the plan map (unchanged from t3; same sweep positions)
