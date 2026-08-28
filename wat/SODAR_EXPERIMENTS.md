# SODAR — Experiments

The system learns by:
`research → experiment → result → decision → implementation → verification → lesson`.

No major architectural decision is made because an approach is popular. When
uncertainty materially affects SODAR, it becomes an experiment here, with a
**decision rule registered before the experiment runs**.

Run by the **Benchmark / Evaluation Agent** via `tools/` only. Artifacts go to
`wat/.tmp/experiments/<id>/`. Results feed
[`SODAR_TECHNICAL_DECISIONS.md`](SODAR_TECHNICAL_DECISIONS.md).

---

## Technical unknowns

| ID | Unknown | Blocks | Experiment |
|---|---|---|---|
| U1 | Do handheld phone photos stitch reliably into clean equirectangular panoramas without a tripod? | TD-001, TD-002, Phase 1 | E1 |
| U2 | Is a connected-panorama tour "good enough to pay for", or is parallax/walkability required for v1? | TD-001, whole product shape | E2 |
| U3 | Can 3DGS produce usable indoor rooms from a realistic phone capture, given COLMAP's textureless-wall failure? | TD-007, premium tier | E3 |
| U4 | Does monocular / 360 depth add worthwhile parallax without unacceptable artifacts? | TD-008 | E4 |
| U5 | What is the minimum capture protocol an agent can follow that still yields processable input? | TD-009, capture app spec | E1 (styles), E3 |
| U6 | Does image enhancement measurably improve perceived quality without hallucinating detail? | TD-004 | E5 |
| U7 | What is the per-scan compute cost and latency for each reconstruction path at target quality? | unit economics, R5 | E6 |

---

## E1 — Handheld panorama stitch reliability

- **Hypothesis:** Hugin can turn casually-handheld phone photo bursts into
  viewable equirectangular panoramas at ≥ 80% success on protocol-compliant
  captures, and we can identify the capture discipline that gets there.
- **Method:** For each room in the dataset, stitch with `stitch_panorama.py`
  using Hugin, OpenCV, and (if licensed) PTGui. Repeat across the 3 capture
  styles (tripod-like / casual handheld / fast handheld).
- **Dataset:** representative dataset, all rooms, all styles.
- **Metrics:** stitch success rate (produces a complete 360×180 with no black
  wedge); seam/ghost score (SSIM in overlap bands + manual 1–5); horizon error
  (degrees); control-point count; runtime.
- **Decision rule:**
  - ≥ 80% success on ≥ 1 capture style with mean ghost score ≤ 2 → **adopt
    Hugin, adopt that style as capture protocol v1** (confirms TD-001/TD-002).
  - 50–80% → adopt with a manual-repair fallback in review; flag R1 partially
    realised.
  - < 50% on every style/engine → **escalate**: handheld stitching is not
    viable without an app or hardware; re-scope (R1).
- **Status:** NOT STARTED — needs dataset.

## E2 — Is a panorama tour worth paying for?

- **Hypothesis:** Real-estate agents see enough value in a connected-panorama
  tour (Zillow-3D-Home-like) to pay a one-time fee, without walkable 3D.
- **Method:** Build a PSV tour from the best E1 output. Show it to 3–5 practising
  agents alongside a reference (a Zillow 3D Home tour and a Matterport tour).
  Structured questions: would you use this, would you pay, what's missing, price
  point.
- **Dataset:** one fully-processed sample property.
- **Metrics:** willingness-to-pay (yes/no + €); "usable for a real listing"
  (yes/no); top-3 missing features; parallax/walkability explicitly requested?
  (count).
- **Decision rule:**
  - ≥ 3/5 would pay and rate it listing-usable → **panorama tour is the MVP
    product**; 3DGS/depth become upsells (E3/E4 continue at low priority).
  - Mixed, with parallax the dominant ask → prioritise E4; keep panorama as the
    base tier.
  - Clear "not worth paying for without walkable 3D" → **thesis shifts**:
    E3 becomes critical-path, cost/complexity rises (R2), escalate to user.
- **Status:** NOT STARTED — needs E1 output + agent access.

## E3 — 3DGS feasibility from a phone capture

- **Hypothesis:** With a deliberate (but agent-followable) capture protocol,
  COLMAP/glomap + Gaussian splatting yields indoor rooms with acceptable artifact
  levels.
- **Method:** Capture one property to a GS-friendly protocol (dense overlap,
  video walkthrough, lights on, slow continuous path). `run_colmap.py` →
  `train_3dgs.py` (Nerfstudio `splatfacto` and Brush) → view in SuperSplat.
  Also try one pose-free method (NopeRoomGS-class).
- **Dataset:** a dedicated GS-protocol capture (not the E1 dataset).
- **Metrics:** SfM registration rate (% frames posed); reconstruction completion
  (yes/partial/fail) per room; visual quality 1–5; wall/ceiling floater count;
  total wall-clock; GPU-minutes; output size (`.spz`).
- **Decision rule:**
  - Registration ≥ 90%, visual ≥ 3.5, floaters manageable, protocol judged
    agent-followable → **greenlight a 3DGS premium tier** (own Phase-2 plan).
  - Works only with an unrealistic protocol → **shelve as R&D** (R3); product
    ceiling = panorama + depth.
  - Fails broadly → 3DGS off the roadmap until pose-free methods mature; revisit
    in 2 quarters.
- **Status:** NOT STARTED.

## E4 — Monocular / 360 depth parallax

- **Hypothesis:** Panorama + estimated depth gives enough head parallax to feel
  more immersive than a flat panorama, without artifacts that read as "broken".
- **Method:** For 3–4 panoramas from E1: run Depth Anything V2 (tiled
  perspective) and one 360-native depth model via `depth_infer.py`; displace a
  sphere mesh / point cloud; load in PSV with clamped parallax. A/B against the
  flat panorama.
- **Dataset:** E1 panoramas.
- **Metrics:** artifact rate (edge stretching, disocclusion holes) 1–5;
  perceived-realism delta vs flat (blind A/B preference); inference time.
- **Decision rule:**
  - Preference ≥ 70% for the parallax version **and** artifact score ≤ 2 →
    **add `DepthParallaxReconstructor` as a Phase-2 upgrade**.
  - Preference positive but artifacts 2–3 → keep researching (better edge
    handling / layout priors); not shippable yet.
  - No preference or artifacts > 3 → **drop depth parallax**; it's the wrong
    middle rung.
- **Status:** NOT STARTED — needs E1 output.

## E5 — Image enhancement value vs hallucination risk

- **Hypothesis:** A fidelity-first upscaler/denoiser improves perceived panorama
  quality enough to matter, without inventing architectural detail.
- **Method:** Take rendered tiles from the E1 tour; process via `enhance_image.py`
  with Topaz (Replicate) and Real-ESRGAN. Blind A/B (original vs enhanced) with
  5+ raters; a reviewer specifically hunts for invented/altered features against
  the source photos.
- **Dataset:** E1 rendered tiles.
- **Metrics:** preference rate; hallucination incidents (count of
  invented/materially-altered features — **any** is serious); added latency;
  cost/image.
- **Decision rule:**
  - Preference ≥ 70% **and** zero hallucination incidents across the set →
    **add enhancement to the pipeline** (TD-004 flips to Replicate/Topaz).
  - Preference positive but ≥ 1 hallucination → **do not ship**; misrepresentation
    risk (R4) outweighs polish.
  - No preference → leave `EnhanceAdapter` as passthrough.
- **Status:** NOT STARTED.

## E6 — Per-scan cost & latency model

- **Hypothesis:** The panorama path costs < €X and < Y minutes per property; the
  3DGS/depth paths are quantifiably more.
- **Method:** Instrument E1/E3/E4/E5 tool runs (`eval_repro.py` aggregates):
  CPU/GPU seconds, external API spend, wall-clock, per stage, per path.
- **Dataset:** all of the above runs.
- **Metrics:** €/property and minutes/property for: panorama-only, panorama+
  enhance, panorama+depth, 3DGS.
- **Decision rule:** feeds unit economics, not a binary. If panorama-only
  €/property is not comfortably below the expected one-time fee at target margin
  → **escalate** (R5); if 3DGS €/property exceeds a plausible premium price →
  3DGS stays experimental regardless of E3 quality.
- **Status:** NOT STARTED.

---

## Result log

| Date | Exp | Result summary | Decision taken | Lesson → |
|---|---|---|---|---|
| — | — | (none yet) | — | — |
