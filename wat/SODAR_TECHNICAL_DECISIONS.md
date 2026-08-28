# SODAR — Technical Decisions

Decision records for every major technical choice. Each record carries:
**candidates · evidence · recommendation · confidence · cost · latency · data
requirements · major failure modes · replacement strategy.**

Confidence scale: **high** (evidence + our own experiment) · **medium** (external
evidence, no local test yet) · **low** (reasoned bet, must be tested).

Status: all records are **PROPOSED** pending plan approval and the experiments
named in [`SODAR_EXPERIMENTS.md`](SODAR_EXPERIMENTS.md).

---

## TD-001 — MVP reconstruction approach

**Decision:** For the MVP, "reconstruction" = **a connected set of
equirectangular panoramas** (one or more per room) linked by navigation hotspots,
viewed in the browser. No mesh, no dollhouse, no free walk. The
"AI-reconstructed / walkable" experience is a later, experiment-gated upgrade.

- **Candidates:**
  1. Connected panorama tour (Pannellum / Photo Sphere Viewer).
  2. Panorama + monocular 360 depth → limited-parallax "3D photo".
  3. 3D Gaussian splatting from a phone walkthrough → web splat viewer.
  4. NeRF-style reconstruction.
  5. Vendor API (Luma / Polycam) does the reconstruction.
- **Evidence:**
  - Zillow 3D Home — the only mass-market *phone-only* real-estate product — is
    exactly candidate 1: "a connected sequence of panoramas — no Dollhouse view,
    no mesh reconstruction, no measurement tools." It sells at scale. Proof that
    the simplest option clears the market bar.
  - Indoor 3DGS/NeRF depends on SfM (COLMAP), which "fails or produces degenerate
    camera pose estimates" on "blank white walls" and "panorama-style motion" —
    the exact conditions of a real-estate capture. 2025–26 papers (NopeRoomGS,
    LighthouseGS) exist *because* the naive path breaks.
  - No hosted panorama-stitching REST API worth using; stitching (Hugin/PTGui/
    OpenCV) is a solved, deterministic, CPU-only problem.
  - Luma and Polycam gate API access behind enterprise sales with no public
    pricing → not integrable on prototype timeline.
- **Recommendation:** Candidate 1 for Phase 1. Candidates 2 and 3 become
  experiment tracks (E4, E3) that can graduate to a premium tier later.
- **Confidence:** medium→high (pending E1/E2).
- **Cost:** stitching is CPU-seconds per room (fractions of a cent). Viewer
  hosting is static files.
- **Latency:** ~10–60 s per room to stitch; tour assembly seconds. Whole
  property in minutes, comfortably async.
- **Data requirements:** overlapping frames per room (≥ ~40% overlap, ~12–20 for
  a full rotation); optional IMU/heading; room adjacency graph.
- **Failure modes:** handheld parallax → stitch ghosting (E1); panorama-only UX
  judged not worth paying for (E2, R2); rooms too small / too cluttered for a
  clean single-nodal-point rotation.
- **Replacement strategy:** `ReconstructionAdapter` — swap
  `PanoramaTourReconstructor` for `DepthParallaxReconstructor`,
  `GaussianSplatReconstructor`, or `VendorAPIReconstructor` without touching
  ingest, queue, storage, or the review flow.

---

## TD-002 — Panorama stitching engine

**Decision:** `HuginStitcher` (Hugin CLI: `cpfind` → `autooptimiser` →
`nona` → `enblend`) as the default `StitchEngine`, with `OpenCVStitcher` as an
in-process fallback and `PTGuiStitcher` evaluated if quality demands it.

- **Candidates:** Hugin CLI · OpenCV `Stitcher` / `stitching` (py) · PTGui
  (paid, has CLI/automation) · full platforms (Kuula/CloudPano — not APIs).
- **Evidence:** Hugin and PTGui share the Panotools engine; Hugin gives
  "the same (and sometimes superior) mathematical accuracy for free" with full
  CLI control. OpenCV's stitcher is trivial to embed but weaker on exposure
  blending and control-point robustness. No REST API alternative exists.
- **Recommendation:** Hugin CLI, parameters tuned by experiment **E1**.
- **Confidence:** medium (Hugin is proven for panoramas generally; not yet
  tested on *our* captures).
- **Cost:** free; CPU only.
- **Latency:** seconds to ~1 min per panorama depending on frame count / output
  resolution.
- **Data requirements:** as TD-001; EXIF focal length helps; consistent exposure
  helps blending.
- **Failure modes:** too few control points on textureless walls → misalignment;
  parallax from off-nodal handheld motion → ghosting; moving elements (curtains,
  people) → artifacts; rolling-shutter warp on fast pans.
- **Replacement strategy:** `StitchEngine` interface; swap implementation per
  scan or globally. Engine choice is a config value, not a code change.

---

## TD-003 — Browser 360 viewer

**Decision:** **Photo Sphere Viewer** (Three.js-based, MIT) as the default
`ViewerBuilder`, using its virtual-tour + markers plugins. **Pannellum** kept as
the ultra-light fallback.

- **Candidates:** Photo Sphere Viewer · Pannellum · Marzipano (Google) ·
  build direct on Three.js.
- **Evidence:** all three support equirectangular panoramas, hotspots, and
  multi-scene tours under permissive licences. PSV has "the most advanced marker
  system with HTML content support"; Pannellum is "21KB gzipped … zero
  dependencies"; Marzipano ships a tour builder but is less actively maintained.
- **Recommendation:** PSV for feature headroom (markers, transitions, plugin
  API), Pannellum if bundle size / simplicity wins in testing.
- **Confidence:** high (mature, widely deployed libraries).
- **Cost:** $0; static hosting.
- **Latency:** first panorama interactive in < ~2 s on broadband for a
  ~6–8 K equirectangular JPEG; use tiled/multiresolution output if load time
  fails AC.
- **Data requirements:** equirectangular images; a scene graph (JSON) with
  hotspot positions.
- **Failure modes:** large panoramas slow on mid-range phones (portal visitors,
  R7) → mitigate with cube-map tiles / progressive loading; hotspot placement
  needs per-tour authoring unless derived from the room graph + headings.
- **Replacement strategy:** `ViewerBuilder` interface emits a self-contained
  static bundle; the library behind it can change without touching the pipeline.

---

## TD-004 — Image enhancement

**Decision:** **Not in the Phase 1 pipeline.** `EnhanceAdapter` ships as a no-op
passthrough. Enhancement is added only if experiment **E5** shows a real
perceived-quality gain with an acceptable hallucination rate.

- **Candidates:** Replicate (Topaz `image-upscale`) · self-hosted Real-ESRGAN ·
  Let's Enhance / Claid.ai · Freepik/Magnific (rejected — reinterprets detail).
- **Evidence:** Topaz scores ~35–38 dB PSNR on real-photo benchmarks
  (restoration, not invention). Creative upscalers "reinterpret detail" — a
  misrepresentation risk for listing imagery (R4). Real-ESRGAN is free, local,
  predictable.
- **Recommendation:** if E5 passes → Replicate + Topaz model for launch,
  migrate to self-hosted Real-ESRGAN at volume. Fidelity-first models only.
- **Confidence:** medium.
- **Cost:** Replicate per-GPU-second (cents/image); self-hosted = GPU hours.
- **Latency:** seconds/image on Replicate; adds a pipeline step.
- **Data requirements:** rendered panorama tiles.
- **Failure modes:** hallucinated fixtures/detail → compliance blocker; over-
  smoothing kills realism; cost scales with tile count.
- **Replacement strategy:** `EnhanceAdapter` — passthrough ↔ any provider,
  toggled per scan.

---

## TD-005 — Async job queue

**Decision:** **Supabase Queues (`pgmq`)** + a worker process, behind a
`JobQueue` interface. Queue objects and policies owned by the Data Pipeline
Agent.

- **Candidates:** `pgmq` · Inngest · Trigger.dev · Temporal · Upstash QStash ·
  a bare `scans.status` poll loop.
- **Evidence:** the README mandates "one data core"; `pgmq` keeps job state
  transactionally consistent with `scans.status` in the DB we already run, with
  zero new vendor. Inngest/Trigger.dev add step-retry + observability but are a
  second system. Temporal is 2–3 days to stand up — overkill for one job type.
- **Recommendation:** `pgmq` for Phase 1; revisit Inngest when we have > ~2
  chained steps needing independent retries and a run-history UI.
- **Confidence:** high for the MVP scope.
- **Cost:** included in Supabase.
- **Latency:** sub-second dispatch; irrelevant against minute-scale jobs.
- **Data requirements:** a jobs table / `pgmq` queue; idempotency key per scan.
- **Failure modes:** we hand-build retry/backoff/visibility-timeout logic and can
  get it wrong; no built-in run dashboard; long jobs need a heartbeat to avoid
  re-delivery.
- **Replacement strategy:** `JobQueue` interface (`claim` / `complete` / `fail` /
  `heartbeat`); swap to Inngest/Trigger.dev by reimplementing the interface and
  moving the worker entrypoint.

---

## TD-006 — Object storage

**Decision:** **Supabase Storage** for raw frames and rendered assets, behind an
`AssetStore` interface. Buckets and RLS/policies owned by the Data Pipeline
Agent.

- **Candidates:** Supabase Storage · Cloudflare R2 · S3.
- **Evidence:** Supabase Storage is S3-compatible, RLS-aware, shares the auth
  model, supports resumable (TUS) uploads for large frame bursts. R2's advantage
  (no egress fees) only matters at public-delivery scale, which the MVP does not
  reach.
- **Recommendation:** Supabase Storage now; plan R2 + CDN for the *published*
  paid tour bundle when portal-visitor traffic is material.
- **Confidence:** high.
- **Cost:** included + GB overage.
- **Latency:** fine for upload/processing; CDN considerations are post-MVP.
- **Data requirements:** bucket layout `raw/<scan_id>/…`, `rendered/<scan_id>/…`.
- **Failure modes:** egress cost if the public tour is served straight from
  Storage at scale (R7-adjacent); large-object upload reliability on poor mobile
  connections.
- **Replacement strategy:** `AssetStore` (`put` / `get` / `signed_url`); R2 is a
  drop-in S3 target.

---

## TD-007 — "AI-reconstructed / walkable" premium path (3DGS)

**Decision:** **Experiment track only** (E3). Not in Phase 1. Graduates to a
premium tier only if E3 shows reliable, artifact-acceptable rooms from a capture
protocol a real agent will actually follow.

- **Candidates:** COLMAP/glomap + Nerfstudio `splatfacto` · Brush (cross-
  platform, no-CUDA) · pose-free methods (NopeRoomGS, InstantSplat-style) ·
  vendor API (Luma).
- **Evidence:** strong visual results in the field, but "panorama-style motion
  usually fails to correctly perform COLMAP" and textureless indoor surfaces
  cause "camera-near floaters" and degenerate poses. Browser playback is solved
  (SuperSplat/PlayCanvas, Spark + `.spz`, 5–10× smaller than PLY).
- **Recommendation:** run E3 on a GS-friendly capture; if it needs a protocol
  too strict for agents (R3), shelve as R&D and cap the product at panoramas +
  depth parallax.
- **Confidence:** low (feasibility genuinely unknown for our inputs).
- **Cost:** GPU training minutes–hours per property; the real cost driver.
- **Latency:** tens of minutes to hours per property with COLMAP + training.
- **Data requirements:** dense overlapping coverage, video walkthrough, good
  lighting, a deliberate capture path; possibly known intrinsics.
- **Failure modes:** SfM failure on plain walls; floaters; long compute; cost per
  scan exceeds the fee (R5); capture protocol too demanding (R3).
- **Replacement strategy:** it *is* the replacement candidate — slots into
  `ReconstructionAdapter` as `GaussianSplatReconstructor` alongside, not instead
  of, the panorama path (tiered product).

---

## TD-008 — Monocular / 360 depth for parallax

**Decision:** **Experiment track only** (E4). A panorama + depth "3D photo" with
limited head parallax is the middle rung between flat panoramas and 3DGS.

- **Candidates:** Depth Anything V2 (relative, fast) · Metric3D v2 (metric) ·
  360-specific (BiFuse / OmniDepth / 360MonoDepth) · layout-based (LED2-Net,
  HorizonNet) for a coarse room box.
- **Evidence:** Depth Anything V2 is "over 10× faster" than diffusion depth with
  "higher depth accuracy" but relative-only; Metric3D v2 leads on metric depth.
  Dedicated 360 depth work is mostly 2018–2022 and less turnkey — perspective
  slices through a strong perspective model may beat native 360 models.
- **Recommendation:** E4 — panorama → depth (tiled perspective inference or a
  360 model) → mesh/point displacement → 3-DoF-limited parallax in PSV. Ship only
  if artifacts stay below the decision threshold.
- **Confidence:** low–medium.
- **Cost:** one GPU inference per panorama (cheap vs 3DGS); Depth Anything runs
  near-real-time.
- **Latency:** seconds per panorama.
- **Data requirements:** just the equirectangular panorama.
- **Failure modes:** depth discontinuities at wall/floor edges → stretched
  texture "goo"; relative depth needs scale/serialisation heuristics; large
  parallax reveals disocclusion holes.
- **Replacement strategy:** `DepthParallaxReconstructor` in `ReconstructionAdapter`;
  depth model swappable behind a `DepthEstimator` interface.

---

## TD-009 — Capture input for the prototype

**Decision:** **No mobile app in Phase 0/1.** Input is the representative dataset
plus a thin authenticated upload page (or direct tool upload). A written
**capture protocol v0** stands in for app guidance.

- **Candidates:** build the capture app now · web upload page · manual dataset
  only · fork an existing 360 capture app.
- **Evidence:** the reconstruction thesis is testable with *any* conforming
  frames; the app is weeks of iOS/Android work that proves nothing new at this
  stage (AS-5).
- **Recommendation:** dataset + upload page; build the app only after Phase 1
  proves reconstruction and E1/E5 define the exact capture requirements the app
  must enforce.
- **Confidence:** high.
- **Cost:** negligible.
- **Latency:** n/a.
- **Data requirements:** the capture protocol v0 doc.
- **Failure modes:** without on-device guidance, captures vary wildly → E1 must
  quantify how much discipline the pipeline needs (feeds the app spec later).
- **Replacement strategy:** the app, when built, produces the same upload
  contract; nothing downstream changes.

---

## TD-010 — MVP schema subset & lifecycle

**Decision:** Phase 1 uses **`scans`, `frames`, `rooms`, `assets`** only, with
`status` truncated to **`capturing → rendering → ready_for_review → approved`**
plus an explicit `error` state. `agents`/`listings`/`payments`/`leads`/
`analytics_events` and multi-tenant RLS are deferred. Owned by the Data Pipeline
Agent.

- **Candidates:** full 8-table schema now · MVP subset now, extend per phase.
- **Evidence:** payments/leads/analytics tables serve deferred surfaces (AS-3);
  building them now is speculative infra the plan forbids.
- **Recommendation:** subset now; the Data Pipeline Agent's normal
  PLAN→CONSTRUCT loop extends it when each later phase opens.
- **Confidence:** high.
- **Cost:** none.
- **Latency:** n/a.
- **Data requirements:** README schema as the eventual target.
- **Failure modes:** an early column choice needs a later migration — acceptable,
  and exactly what the Data Pipeline Agent exists to handle; "architectural
  mistakes are cheap to correct" right now.
- **Replacement strategy:** forward migrations; `assets` generalises to rendered
  outputs of any reconstruction type so TD-001's alternatives don't need a schema
  change.

---

## Decision index

| ID | Topic | Rec (short) | Confidence | In MVP? |
|---|---|---|---|---|
| TD-001 | Reconstruction approach | Connected panorama tour | med→high | ✅ |
| TD-002 | Stitching engine | Hugin CLI (+ OpenCV fallback) | med | ✅ |
| TD-003 | Browser viewer | Photo Sphere Viewer (+ Pannellum) | high | ✅ |
| TD-004 | Image enhancement | Deferred; passthrough adapter | med | ❌ (E5) |
| TD-005 | Job queue | Supabase `pgmq` | high | ✅ |
| TD-006 | Object storage | Supabase Storage | high | ✅ |
| TD-007 | 3DGS premium path | Experiment only | low | ❌ (E3) |
| TD-008 | Depth parallax | Experiment only | low–med | ❌ (E4) |
| TD-009 | Capture input | Dataset + upload page, no app | high | ✅ |
| TD-010 | Schema subset & lifecycle | 4 tables, truncated status | high | ✅ |
