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
| U8 | Does a heavier engine (PlayCanvas) beat Photo Sphere Viewer on a real mid-range phone by enough to overturn TD-003? | TD-003, `build_tour.py` | E-VIEW |

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

- **Vendored deps + pipeline design:**
  [`docs/RECONSTRUCTION_INTEGRATION.md`](../../docs/RECONSTRUCTION_INTEGRATION.md)
  — RAFT (flow) + Depth-Anything-V2 (depth) + LaMa (disocclusion inpaint) are in
  `third_party/` as pinned submodules. Not yet runnable here (no GPU/torch).
- **Hypothesis:** Panorama + estimated depth gives enough head parallax to feel
  more immersive than a flat panorama, without artifacts that read as "broken".
- **Method:** For 3–4 panoramas from E1: run Depth Anything V2 (tiled
  perspective) and one 360-native depth model via `depth_infer.py`; displace a
  sphere mesh / point cloud, or warp between two capture points with
  flow+depth and inpaint the holes; load in PSV with clamped parallax. A/B
  against the flat panorama.
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

## E-VIEW — Browser viewer: PlayCanvas vs Photo Sphere Viewer (TD-003 bake-off)

- **Unknown (U8):** TD-003 picked Photo Sphere Viewer on reasoning. A parallel
  session then built a working bespoke viewer on the pinned PlayCanvas engine
  (`viewer/`) as a measured challenge. The harness rule forbids settling this on
  reasoning alone.
- **Hypothesis:** PlayCanvas does *not* beat PSV by enough on a real mid-range
  phone to justify a ~2× engine payload and a bespoke viewer to maintain.
- **Method:** both spikes, same phone, same two 6K panoramas
  (`viewer/panoramas/make_demo_panoramas.py` and `scripts/psv_tour_spike.py`
  regenerate byte-identical `living-room.jpg`), same throttle (Fast 3G / 4× CPU).
  Serve: `viewer/serve.sh` (:8777) and
  `python3 scripts/psv_tour_spike.py && (cd artifacts/tours/psv-spike && python3 -m http.server 8080)`.
- **Decision rule — registered before any phone run.** Bytes-to-first-frame and
  maintenance LOC are computable now from artifact sizes and are recorded below;
  FPS, room-change smoothness, throttled TTI, and gyro feel need the phone and do
  not yet exist.
  - **Gate 1 (bytes):** PlayCanvas overturns TD-003 only if its transferred bytes
    to first interactive frame are within **+10%** of PSV's. R7 (portal visitors
    on mid-range phones / mobile data) is the named risk; a large fixed payload
    penalty is disqualifying on its own.
  - **Gate 2 (phone perf):** *and* PlayCanvas must **clearly win** ≥ 2 of
    {sustained drag FPS, frame drops on room change, gyro feel on real sensors},
    losing none.
  - Fail either gate → **TD-003 stands**, PSV is the `ViewerBuilder`, `viewer/`
    becomes the **E3 splat-viewer reference** (per TD-007).
  - Maintenance LOC is a tiebreaker only, applied if Gates 1–2 are ambiguous.
- **Results:**
  - **Bytes to first interactive frame** (gzip; one panorama; shell + JS/CSS +
    `tour.json` + first `.jpg`):
    - PSV: three.js 258 KB + PSV core 45 KB + virtual-tour 11 KB + CSS 4 KB +
      shell ~1 KB + pano 535 KB ≈ **≈ 854 KB**
    - PlayCanvas: engine 595 KB + shell ~4 KB + pano 535 KB ≈ **≈ 1,134 KB**
    - PlayCanvas is **+33%** (+280 KB), driven entirely by the engine (595 KB gz
      vs PSV's 318 KB of libs). **Gate 1: FAIL.**
    - Fairness notes: PSV's 318 KB is 5 requests to jsDelivr (third-party origin,
      CSP + supply-chain concern) — the shipped bundle must self-host these to be
      "self-contained" (TD-003), which with brotli lands ~270 KB, still well under
      PlayCanvas. PlayCanvas's 595 KB is one repo-pinned file (better CSP posture,
      ~2× the bytes). At 6K, the 535 KB panorama dominates both and blows the
      TD-003 "< ~2 s" target on 3G regardless of viewer → **6–8K panoramas need
      tiling / progressive load, a viewer-agnostic task.**
  - **Maintenance LOC:** PlayCanvas viewer `viewer/index.html` = **385 lines** of
    bespoke inverted-sphere render + hand-rolled hotspot projection + gyro math
    (its README: "the math is provisional"). PSV spike shell = **~48 lines** on
    the maintained `VirtualTourPlugin`. **~8× in PSV's favour.**
  - **FPS / room-change drops / throttled TTI / gyro feel:** *PENDING — needs the
    phone.* Note: PlayCanvas's engine is ~2× the parse/compile CPU on a
    4×-throttled device (hurts TTI); the workload (one textured sphere + a few
    DOM markers) is trivially GPU-bound so a large FPS gap either way is unlikely;
    PSV's `GyroscopePlugin` is maintained where PlayCanvas's gyro is self-flagged
    provisional.
- **Verdict:** **PlayCanvas fails Gate 1 (+33% bytes vs a +10% ceiling).** Under
  the registered rule the phone-perf metrics cannot overturn this, so **TD-003
  stands: Photo Sphere Viewer is the `ViewerBuilder`.** `viewer/` is retained as
  the **E3 splat-viewer reference** (TD-007 — PlayCanvas/SuperSplat is the splat
  playback path). The phone run is still worth doing to confirm PSV clears
  R7 / AC-4 on a real device (the original E2-adjacent question), but it is no
  longer a viewer *selection* question.
- **Contract:** `schemas/tour.v0.json` is now the canonical `ViewerBuilder.build()`
  output — the `viewer/README.md` shape (snake_case, `start_node` / `hotspots` /
  `to` / degrees-as-numbers, consistent with `rooms`). `scripts/psv_tour_spike.py`
  consumes it and adapts to PSV in-browser. **Follow-up for the psv_viewer.py
  owner:** its input/output currently uses `startNodeId` / `links` / `nodeId` —
  converge to `tour.v0`.
- **Status:** DECIDED on bytes + LOC (2026-09-03). Phone perf PENDING (cannot
  change the verdict; run only to confirm PSV clears R7 / AC-4 on a device).
  Runbook — one mid-range phone on the LAN, DevTools remote-inspect with Fast 3G
  + 4× CPU throttle:
  1. `python3 scripts/psv_tour_spike.py`
  2. terminal A: `cd artifacts/tours/psv-spike && python3 -m http.server 8080`
  3. terminal B: `viewer/serve.sh` (:8777)
  4. phone → `http://<mac-LAN-ip>:8080` and `:8777`; record from the Network +
     Performance panels: transferred bytes to first frame, TTI, 10 s drag-FPS
     trace, frame count on a room switch, and gyro drift/lag by hand.
  5. paste the five numbers per viewer into the E-VIEW results table.

---

## Result log

| Date | Exp | Result summary | Decision taken | Lesson → |
|---|---|---|---|---|
| 2026-09-03 | E-VIEW | PlayCanvas engine 595 KB gz vs PSV libs 318 KB → +33% bytes to first frame (gate: +10%); PlayCanvas viewer 385 LOC vs PSV 48. Phone FPS/gyro pending, non-overturning. | **TD-003 stands — Photo Sphere Viewer.** `viewer/` → E3 splat reference. `schemas/tour.v0.json` canonical. | 6–8K panoramas need tiling regardless of viewer; decide payload-sensitive UI choices on transferred bytes first. |
