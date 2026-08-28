# Reconstruction integration — parallax view interpolation

**Status:** design + vendored deps. Pipeline not yet built — blocked on a GPU
environment (see `third_party/README.md`). This is experiment **E4** / decision
**TD-008** in [`../wat/SODAR_EXPERIMENTS.md`](../wat/SODAR_EXPERIMENTS.md).

## The problem this solves

A real-estate agent captures a room from **two or more standing positions**,
rotating the phone by hand at each. Two failure modes result:

1. **Within one position** — the phone pivots around the wrist, not the lens, so
   overlapping frames have parallax. Naive stitching doubles edges and bends
   straight lines.
2. **Between positions** — moving to the next capture point reveals surfaces that
   were hidden (disocclusion). A flat panorama tour just hard-cuts between nodes;
   there is no motion through the gap.

The three vendored repos address these directly.

## Pipeline

```
per-room capture: panorama_A, panorama_B  (equirectangular, from the owned stitcher)
        │
        ▼
 ┌─────────────────────┐   RAFT: dense optical flow A↔B
 │ 1. FLOW  (RAFT)      │   → per-pixel correspondence; corrects wrist-pivot
 │                     │     parallax so alignment is not a single homography
 └─────────┬───────────┘
           ▼
 ┌─────────────────────┐   Depth-Anything-V2: monocular depth of A (and B)
 │ 2. DEPTH (DA-V2)    │   → coarse per-pixel geometry; flow + depth give a
 │                     │     scene proxy to *warp* along, not a 2D morph
 └─────────┬───────────┘
           ▼
 ┌─────────────────────┐   forward-warp A toward an intermediate viewpoint
 │ 3. WARP  (SODAR)    │   using depth-scaled flow; accumulate a disocclusion
 │                     │     mask where no source pixel lands
 └─────────┬───────────┘
           ▼
 ┌─────────────────────┐   LaMa: inpaint ONLY the disocclusion mask
 │ 4. INPAINT (LaMa)  │   → fills revealed regions; Fourier convs handle the
 │                     │     large, irregular holes a warp produces
 └─────────┬───────────┘
           ▼
  intermediate view(s) → short parallax sweep between A and B
  packaged for the browser viewer (Photo Sphere Viewer / a light custom WebGL)
```

Step 3 (the warp + mask accumulation) is the only genuinely new SODAR code; steps
1, 2, 4 are inference calls into the vendored models.

## Where it plugs into the harness

Per [`../wat/SODAR_AGENT_ARCHITECTURE.md`](../wat/SODAR_AGENT_ARCHITECTURE.md),
reconstruction lives behind `ReconstructionAdapter`. This pipeline is the
`DepthParallaxReconstructor` implementation:

```
ReconstructionAdapter.reconstruct(scan) -> RenderedBundle
  PanoramaTourReconstructor   (default, shipped — owned stitcher + PSV)
  DepthParallaxReconstructor  (this doc)              <-- new
  GaussianSplatReconstructor  (E3, separate)
  VendorAPIReconstructor      (Luma / Polycam)
```

Internal seams (each a small module under `src/sodar/reconstruction/`, not yet
written), following the `opencv_stitch` provider pattern — heavy deps lazily
imported, absence → normalized failure, never an import crash:

| Seam | Wraps | Entry point in the submodule |
|---|---|---|
| `flow.estimate(img_a, img_b) -> flow_field` | `third_party/RAFT` | `RAFT/core/raft.py` + `demo.py` load path; weights `raft-things.pth` |
| `depth.infer(img) -> depth_map` | `third_party/Depth-Anything-V2` | `Depth-Anything-V2/depth_anything_v2/dpt.py`; checkpoint `depth_anything_v2_vits.pth` (Small = Apache-2.0) |
| `inpaint.fill(img, mask) -> img` | `third_party/lama` | `lama/bin/predict.py` (Hydra config `big-lama`) |
| `warp.forward(img, depth, flow, t) -> (img, hole_mask)` | SODAR | new |

## Dependency isolation

The three models have **mutually incompatible** pins (RAFT → torch 1.6; LaMa →
`pytorch-lightning==1.2.9` + Hydra; DA-V2 → recent torch). Do **not** try to make
one virtualenv satisfy all three.

**Chosen approach (simplest, reversible):** run each model as a **subprocess**
against its own environment (a per-model `venv/` or container), exchanging
PNG/NPZ files on disk under the run's `output_dir`. The SODAR seam builds the
command, invokes it, reads the result, and normalizes failures — identical in
spirit to how `opencv-stitch` shells out conceptually. A later optimization is to
port just the inference forward-pass of each model onto one modern torch, but
that is not required to run E4.

`pyproject.toml` gets an optional extra `[reconstruction]` for the SODAR-side
glue (numpy, imageio, opencv-python-headless); the model envs are provisioned
separately by `scripts/fetch_reconstruction_weights.sh` + per-model setup.

## Inputs / outputs

- **In:** two equirectangular panoramas per room (from the owned stitcher), plus
  the room graph. Optionally the phone IMU trace to seed the A→B baseline.
- **Out:** a small set of intermediate views + a viewer bundle giving a clamped
  parallax sweep between adjacent nodes. Written under
  `artifacts/evals/<run_id>/output/` with an `output_manifest.json`, so the
  existing evaluator scores it unchanged (`artifact_count`,
  `expected_artifacts_present`, `output_manifest_valid`).

## E4 decision rule (unchanged, from SODAR_EXPERIMENTS.md)

- Preference ≥ 70 % for the parallax version **and** artifact score ≤ 2 → adopt
  `DepthParallaxReconstructor` as a Phase-2 upgrade.
- Positive but artifacts 2–3 → keep researching (better hole handling, layout
  priors; consult the 360-depth survey).
- No preference or artifacts > 3 → drop depth parallax.

## Next implementation steps (need a GPU box)

1. Provision three model envs; run `scripts/fetch_reconstruction_weights.sh`.
2. Smoke-test each model's demo on one captured room pair; record VRAM + seconds
   (feeds cost model **E6**).
3. Write `src/sodar/reconstruction/{flow,depth,inpaint,warp}.py` seams +
   `pipeline.py` composing them, behind `DepthParallaxReconstructor`.
4. Build 2–3 intermediate views for the E2 sample property; run the E4 A/B.
5. If artifacts cluster on equirectangular distortion at poles, switch the depth
   stage to a 360-native model (survey repo) and re-measure.
