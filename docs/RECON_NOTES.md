# Kaldapealse tänav 2 — multi-view reconstruction notes (r1)

Working notes for the rebuild of the walkthrough panoramas as a joint multi-view reconstruction
(`scripts/recon/`, artifacts under `artifacts/recon/kaldapealse-tanav-2/r1/`, git-ignored). Every convention
below was *measured* on the export; the earlier pipeline's assumptions are listed where they were wrong.

## Source (Phase 0)

* Export: `~/Downloads/Kaldapealse tänav 2/4AA4BCAE-…/` (iOS Capture 5.69.0, container 4.1.2500, iPhone15,4 =
  iPhone 15 Plus, ultra-wide camera). 2 423 files, 1.7 GB, SHA-256 list in `r1/provenance/source.sha256`.
  Read-only; nothing in the pipeline writes into it.
* Rejected media: `t3` (in tree, blob list in `r1/provenance/rejected-t3-blobs.txt`), `t1`/`t2` in history
  (commits `e25feca`, `f0e76e4`, `1e7cd60`). Withdrawn from the public portfolio in `fea94e7`.
* 41 active sweeps (35 `success`, 6 `low_overlap`), 36 removed, 10 failed, 5 cancelled; two floors.

## What the export contains (Phase 2, `scripts/recon/capture.py`)

Per sweep: six 4032×3024 JPEG frames (no EXIF), intrinsics (fx = fy = 1499.76, cx = 2015.5, cy = 1511.5,
distortion fields zero), six rotations (frames stored rotated — portrait capture on a landscape sensor), six
tracked camera offsets (field 31.6), Matterport's frame-assignment map (960×480), a **packed** LiDAR depth image
(3600×1801), an 8-bit intensity/confidence image, a 512 px preview cubemap, a 26 k-point cloud with normals,
9 000 binary keypoints with 3-D positions, and a 6-chunk low-poly mesh with cube-face UVs.

### Frames and coordinate frames

| frame | handedness | definition | how it was verified |
|---|---|---|---|
| sweep S | right (physical) | z up; cloud, mesh and depth live here; manifest quaternion maps S → world | cloud points fall on the depth image (100 % < 2 %), neighbouring sweeps' clouds overlap in world with R as given (not Rᵀ) |
| depth base | right | y up, lon 0 = +z: `SWEEP_TO_BASE = [[0,−1,0],[0,0,1],[−1,0,0]]` | same test |
| skybox base | **left (mirror of depth base, z flipped)** | frame the 512 px cube / assignment map are drawn in | mesh chunk k is textured by skybox face k; UVs match to 0.005 only with `[[0,−1,0],[0,0,1],[+1,0,0]]` |
| F | left | frame rotations are F → camera; `MX` maps skybox base → F | assignment map: 100 % of directions labelled k project inside frame k |
| camera | – | looks along −z; `col = cx − fx·x/(−z)`, `row = cy − fy·y/(−z)` | Matterport's own keypoints reproject to 4e-7 with this formula |

The previous pipeline's "AX = diag(−1,1,1) mirror" was this skybox/depth mirror expressed differently.

### The packed depth image (new)

Row r is latitude 90° − 0.1°·r. Each row holds a full 360° of longitude packed **left-aligned into
3600·cos(lat) pixels**: `col = ((lon + π) mod 2π) / 2π · 3600·cos(lat)`. Reading it as a plain equirect (what the
old pipeline did) is only right near lon = −180° and is off by up to 180° elsewhere. `Sweep.depth_lookup` and
`Sweep.depth_equirect` decode it; the cloud agrees with it exactly, so the cloud is a sample of this map.

### Rotations, offsets and intrinsics (Phase 3a findings)

* The six container rotations are **nominal**: adjacent optical axes are always 57.6–58.4° apart. Real frames
  deviate by 5–16° (far-scene feature pairs disagree by a tight 4–8° per pair; a free relative rotation brings
  that to 0.2–0.6°). Matterport's stored keypoint coordinates are consistent with the nominal rotations, so they
  are parallax/rotation-corrected, not raw pixel positions.
* Focal length 1499.76 px is confirmed by free-focal fits on far-scene pairs; radial distortion is small.
  A joint COLMAP bundle adjustment over the 96 exterior frames (`scripts/recon/colmap_run.py`) is the
  authoritative calibration — see `r1/colmap/exterior/summary.json`.
* The tracked offsets (field 31.6) lie on a 12–31 cm circle co-rotating with the view axis. The solved frame
  centres correlate with them with the opposite sign (cosine ≈ −0.7, scale ≈ −1), i.e. they are physical but
  stored as sweep-centre-relative-to-camera. Handheld capture: the camera really does move 10–30 cm between
  frames, which is the root cause of the doubled edges the single-centre composite produced.

## Tooling

`.venv-recon/` (Python 3.12: numpy, scipy, opencv, torch-mps, kornia DISK+LightGlue, pycolmap, tifffile,
zstandard, trimesh) and Homebrew COLMAP 4.0.3 (CPU). The whole export decodes in 17 s; a per-sweep
LightGlue solve takes ~90 s on the M4.

## Rendering (Phase 4/5, `scripts/recon/render.py`, `candidate_b.py`, `compare.py`, `review_page.py`)

Candidate C per sweep: every output direction (skybox base) is lifted with the unpacked LiDAR depth (nearest
sample near depth edges), reprojected into each frame with the solved rotation and centre, tested against a
per-frame z-buffer (4-px cells from the frame's own centre, 3×3 max-dilated so depth-edge slivers are not
"occluded"), and labelled by view angle; DP seams in each adjacent-frame overlap band avoid colour differences,
strong edges and depth edges. Compositing is a two-band blend: seams 0.35° for detail, 4° for low frequencies.
Radiometry: per-frame per-channel gains *and a smooth gain field* in linear light, both anchored to Matterport's
preview cube (its exposure is consistent across the sweep) — the old ring-of-overlaps chaining left 1.8× gain
spreads and grey patches shaped like frames. Caps outside the frames (above ≈+37°, below ≈−60°) come from the
preview through a 1.5° blend on a closed/eroded coverage mask.

Bugs that produced black curves and NaN gains, now fixed: projections tens of thousands of pixels outside a frame
overflowed the vignetting term (inf·0 = NaN); cubic resampling overshoot went negative before the gamma maths.

Observed on the three difficult scenes (hallway 6075ef93, kitchen f4e36aa6, stairs 453f34b1 + f4c34f0d):
* C keeps door frames, the round kitchen window, the oven edge and the stair panelling straight where t3 doubled
  or split them; residual calibration error (8–15 px median at 3072-px faces) still shows as small steps where a
  seam crosses a long edge (ceiling line, wall corner).
* B (dense flow to the preview, ±3° bound) looks smooth at a glance but bends skirting boards and stair edges —
  the failure the brief forbids. Kept as a comparison point only.
* Depth discontinuities: serrated edges appeared where a near panel meets a far window (occlusion slivers filled
  from alternating frames); the dilated z-test and a seam-weight-ordered fallback address this (verify at 100 %).

## Findings of the first full render pass (2026-09-11, hallway 2)

* **Depth silhouettes and offset frames.** With frame centres 10–30 cm from the sweep centre, a silhouette
  error δ in the depth map becomes a band of width δ whose texture is displaced by b·(1/d_near − 1/d_far)
  (≈4–5° for a 1.2 m wall in front of a 3.5 m wall). The LiDAR silhouette is a few 0.1° cells off, so the first
  renders showed serrated/ghosted edges at every near/far boundary. Mitigations in `render.py`: near-object
  dilation of the sweep depth (0.9° erode) so an error errs towards the near object (a displaced piece of the far
  wall is far less visible than a displaced piece of the near object), per-frame z-buffers refined by a joint
  bilateral filter guided by the frame image *only where the image has an edge* (elsewhere the filter would just
  blur), and an inverse mapping that iterates the point along its own direction to the depth the frame reports.
  Residual: small ghosts at white-on-grey wall tops and thin near objects (brass panel).
* **Cap fill (`capfill.py`).** Neighbour sweeps see this sweep's floor from above at several times the preview's
  detail; all five hallway neighbours reproduce the nadir tiles correctly through manifest poses + per-sweep
  calibrations. Range: per-cell mean splat of the neighbours' depth images bounded to 0.7–2.5× the floor plane
  (fitted from the sweep's cloud normals). Ceiling fill was tried and rejected (oblique, at the top edge of the
  neighbours' frames — worse than the preview). Sampling must not iterate along the neighbour's rays and must not
  apply its occlusion test (no LiDAR data in its own caps). Only true caps (confidence < 0.5) are filled.
* **Joint SfM (`sfm.py`, DISK+LightGlue matches → COLMAP pose_prior_mapper)** on 13 interior sweeps: only
  187/1534 pairs verified on the plain walls; 55/78 images registered with implausible within-sweep centre spreads
  (up to 1.6 m). Not usable for interiors as configured; the exterior run gave the intrinsics. Negative result kept.
* **Tooling bug found late:** `geom.view_dirs` had pitch inverted (positive = down); every "pitch −60" panel in
  earlier comparison sheets was looking up. Fixed; sheets regenerated.
