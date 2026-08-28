# SODAR — MVP Build Plan

**Owner:** CTO / Orchestrator workflow
**Status:** DRAFT — awaiting approval. No implementation until approved.
**Companion docs:** [`SODAR_AGENT_ARCHITECTURE.md`](SODAR_AGENT_ARCHITECTURE.md) ·
[`SODAR_TECHNICAL_DECISIONS.md`](SODAR_TECHNICAL_DECISIONS.md) ·
[`SODAR_EXPERIMENTS.md`](SODAR_EXPERIMENTS.md) ·
[`research/external-apis.md`](research/external-apis.md)

---

## 0. Repository audit

### A. What already exists

| Area | State |
|---|---|
| Domain / branding | `sodar.io` registered; logo + brand complete (not in this repo) |
| Architecture docs | [`../README.md`](../README.md) — system map, 6 clusters, data schema, 9-step build sequence, infra notes, open questions |
| WAT harness | [`wat/CLAUDE.md`](CLAUDE.md), [`wat/workflows/`](workflows/), [`wat/tools/`](tools/) (empty), [`wat/.tmp/`](.tmp/), `.env.example`, `.gitignore` |
| Data-pipeline design | [`wat/workflows/data_pipeline_agent.md`](workflows/data_pipeline_agent.md) — PLAN→CONSTRUCT→FIX→MONITOR loop; owns schema, migrations, RLS, triggers, storage policies, data health, lifecycle integrity |
| Data-layer SOP | [`wat/workflows/01_data_layer.md`](workflows/01_data_layer.md) — first migration from README schema |
| Vendor research | [`wat/research/external-apis.md`](research/external-apis.md) — options per external boundary |

### B. What is missing

- No Supabase project provisioned; no migrations; no `.env` populated.
- No `tools/` scripts — the deterministic execution layer is entirely unbuilt.
- **No reconstruction pipeline of any kind** — the core technical thesis is unproven.
- No representative capture dataset. We cannot test anything without one.
- No browser viewer, no rendered-asset format defined.
- No orchestrator / research / QA / benchmark workflows (only the data-pipeline agent).
- No capture path (mobile app or upload page).
- No evaluation harness or metrics definitions.

### C. Unsafe assumptions in the current architecture

| # | Assumption (implicit in README) | Why it is unsafe | Handling |
|---|---|---|---|
| AS-1 | Handheld phone photos reconstruct into a "usable 360/property experience" | Unproven for *this* capture style. Indoor SfM fails on textureless walls; handheld stitching ghosts on parallax. This is the whole thesis and it is untested. | Experiments E1–E3 before any pipeline commitment |
| AS-2 | "Reconstruction" implies mesh / walkable 3D | The only proven phone-only real-estate product (Zillow 3D Home) is *connected panoramas, no mesh*. Assuming more raises cost and risk with no evidence it is needed to sell. | TD-001: MVP = connected panoramas; 3DGS is experiment-gated |
| AS-3 | `status: capturing → rendering → ready_for_review → approved → paid` is the right lifecycle | `paid` and `approved` are downstream of proving value. Building the full lifecycle now is speculative infra. | MVP lifecycle truncated to `capturing → rendering → ready_for_review → approved` |
| AS-4 | Stitching is "owned", enhancement is "external" | Fine as a target, but there is **no hosted panorama-stitching REST API** worth using — stitching must be a self-hosted tool from day one, not a later concern. | TD-002 |
| AS-5 | Capture App is a near-term component | A mobile capture app is weeks of work that isn't needed to test reconstruction. A dataset + upload page tests the same thing. | Explicitly NOT built in Phase 0/1 |
| AS-6 | One-time fee "sized to the listing" covers unit economics | Per-scan compute cost (esp. GPU for 3DGS/depth) is unknown and could exceed the fee. | Experiment E6 (cost/latency model) |
| AS-7 | External reconstruction APIs (Luma, Polycam) are available to integrate | Neither publishes API pricing/terms; both gate API access behind enterprise sales. | Treat as unavailable until confirmed; design the adapter so they can slot in later |
| AS-8 | Enhancement is purely additive | Upscalers can hallucinate detail — a legal/misrepresentation risk in real-estate marketing. | Enhancement is opt-in, experiment-gated (E5), fidelity-first models only |

### D. What to build first

The **reconstruction vertical slice** (Phase 1 below) plus the *minimum* data layer
and ingest needed to support it — nothing more. Reconstruction is the unproven
thesis; everything else is known engineering.

### E. What explicitly NOT to build yet

Payments / Stripe · embeddable iframe + embed security · analytics events + control
panel · multi-tenant auth and full RLS (single dev user for the slice) · the mobile
capture app · Capture AI live frame scoring · Embed AI assistant · the marketing
website · infra split / independent worker scaling · the full 8-table schema ·
CI/CD · anything in build-sequence steps 4, 5, 6, 8, 9.

### F. Technical unknowns that must be experimentally tested

Tracked in [`SODAR_EXPERIMENTS.md`](SODAR_EXPERIMENTS.md): U1 handheld stitch
reliability · U2 is a panorama tour "worth paying for" · U3 3DGS feasibility from
phone captures · U4 monocular-depth parallax value · U5 minimum capture protocol ·
U6 enhancement value vs hallucination risk · U7 per-scan cost & latency per path.

### G. External dependencies worth using (now)

| Dependency | Use | Why now |
|---|---|---|
| Supabase (Postgres · Auth · Storage) | Data layer + object storage + `pgmq` queue | Already chosen; one system covers three needs |
| Hugin (CLI) | Panorama stitching tool | Mature, free, scriptable, deterministic; no viable hosted API exists |
| Photo Sphere Viewer *(or Pannellum)* | Browser 360 tour viewer | MIT, mature, hotspots + multi-scene tours out of the box |
| Replicate | Image enhancement (when E5 says yes) | One API, swappable models, zero infra |
| COLMAP / glomap + Nerfstudio *or* Brush | 3DGS **experiment track only** | Standard toolchain to answer U3 |
| Depth Anything V2 | Monocular depth **experiment track only** | Fast, strong relative depth, answers U4 |

### H. Dependencies that must stay replaceable behind adapters

| Boundary | Adapter | Default impl | Alternatives it must be able to swap to |
|---|---|---|---|
| Reconstruction | `ReconstructionAdapter` | `PanoramaTourReconstructor` (Hugin + PSV) | 3DGS reconstructor, depth-parallax reconstructor, Luma/Polycam API |
| Stitching | `StitchEngine` | `HuginStitcher` | `OpenCVStitcher`, `PTGuiStitcher` |
| Image enhancement | `EnhanceAdapter` | no-op passthrough | Replicate/Topaz, self-hosted Real-ESRGAN |
| Viewer bundle | `ViewerBuilder` | `PhotoSphereViewerBuilder` | Pannellum, Marzipano, a splat viewer |
| Job queue | `JobQueue` | Supabase `pgmq` | Inngest, Trigger.dev |
| Object storage | `AssetStore` | Supabase Storage | Cloudflare R2 |

---

## 1. Phase model

Every phase carries: **objective · inputs · outputs · acceptance criteria ·
tests · failure conditions · rollback strategy · dependencies.**
The orchestrator does not open a phase until the previous phase's acceptance
criteria are met and a **lesson** is recorded.

---

## PHASE 0 — Frame the slice (research & decision, no build)

> **Question Phase 0 must answer:** *What is the minimum end-to-end pipeline we
> can build that proves SODAR's core technical thesis?*
>
> **Answer (proposed):** A single-property vertical slice that ingests a
> representative phone capture, stores it in Supabase, runs one async job that
> **stitches each room into an equirectangular panorama and assembles a
> connected multi-panorama tour**, writes the rendered bundle back to storage,
> and serves a browser URL a human opens and approves — with every hop traceable
> by `scan_id`. This is "Zillow 3D Home minus the app": the only phone-only
> real-estate reconstruction approach with proven commercial demand, at near-zero
> compute cost, with every component replaceable behind an adapter. The
> "AI-reconstructed / walkable" upgrade (3DGS, depth parallax) runs as a parallel
> **experiment track** measured against the same dataset and does **not** gate
> Phase 1.

| Field | Detail |
|---|---|
| **Objective** | Lock the Phase 1 slice scope, the reconstruction approach (TD-001), the eval metrics, and the capture protocol — backed by evidence, not popularity. |
| **Inputs** | This repo; [`research/external-apis.md`](research/external-apis.md); the CV/architecture research findings; one **representative capture dataset** (see below). |
| **Outputs** | Approved versions of the four SODAR_*.md docs; `SODAR_EXPERIMENTS.md` with E1–E6 defined; a written capture protocol v0; a go/no-go on the panorama-tour slice. |
| **Acceptance criteria** | (a) A representative dataset exists in `.tmp/` and is documented. (b) TD-001…TD-010 each have a recommendation + confidence. (c) E1 (stitch reliability) and E2 (viewer UX bar) have run and reported. (d) The user has approved this plan. |
| **Tests** | Docs lint (all decision records have every required field); E1/E2 result files exist with metrics; dataset manifest validates. |
| **Failure conditions** | No representative dataset obtainable; E1 shows handheld stitching fundamentally unreliable across all engines/protocols; E2 shows a panorama tour is categorically not sellable. |
| **Rollback strategy** | Phase 0 produces only documents and throwaway experiment artifacts in `.tmp/`. "Rollback" = revise the docs; nothing to unwind. If E1/E2 fail, escalate to the user with the 3DGS/parallax path re-scoped as the primary thesis (higher cost/complexity). |
| **Dependencies** | A representative capture dataset. ML/CV + Architecture research agents. |

### Representative capture dataset (blocking input)

- 1–2 real properties, 4–8 rooms each.
- For each room: a burst of overlapping phone photos (target ≥ 40% overlap,
  ~12–20 frames for a full rotation) **and**, where available, the device IMU /
  `DeviceOrientation` trace and a short walkthrough video.
- Captured in 2–3 styles (careful tripod-like rotation; casual handheld; fast
  handheld) so E1 can measure sensitivity to capture discipline.
- Stored under `wat/.tmp/datasets/<property>/<room>/` with a `manifest.json`
  (frame list, headings if known, capture style, lighting notes).
- **Action for the user:** provide this, or approve the orchestrator
  commissioning a capture against protocol v0.

---

## PHASE 1 — Build the reconstruction vertical slice

| Field | Detail |
|---|---|
| **Objective** | A working, traceable pipeline: **representative capture → stored assets → processing job → reconstruction (connected panorama tour) → rendered output → browser viewer → human approval.** Prove the core loop end to end for one property. |
| **Inputs** | Approved Phase 0 plan; representative dataset; Supabase project (provisioned by the Data Pipeline Agent per `01_data_layer.md`, **MVP subset only**); capture protocol v0. |
| **Outputs** | (1) Supabase MVP schema subset live. (2) `tools/` scripts: `load_dataset`, `register_scan`, `upload_assets`, `stitch_panorama`, `build_tour`, `eval_repro`. (3) A queue-driven worker that runs the reconstruction job. (4) A deployed viewer URL for the sample property. (5) A trace document showing every hop keyed by `scan_id`. (6) E1/E2 results folded into `SODAR_TECHNICAL_DECISIONS.md`. |
| **Acceptance criteria** | **AC-1** Upload a room's frames → a `scans` row (`status=capturing`) + `frames` rows + files in Storage, all linked. **AC-2** Job transitions `capturing→rendering→ready_for_review` automatically; failure sets an error state, never a silent hang. **AC-3** Each room produces a valid equirectangular panorama (no full-frame black wedges; horizon within ±2°). **AC-4** The tour bundle loads in a browser, shows all rooms, and room-to-room hotspots navigate correctly. **AC-5** A reviewer opens the viewer URL from a `ready_for_review` scan and sets `approved`. **AC-6** `eval_repro` emits per-scan metrics (stitch success rate, seam score, coverage %, viewer load time, $ and minutes per scan). **AC-7** The trace doc links raw upload → Storage path → `job_id` → asset path → viewer URL with no manual guesswork. |
| **Tests** | Unit: each tool on a fixture room in `.tmp/`. Integration: full pipeline on the sample property via the queue. Regression: re-run on a frozen dataset, diff metrics against a committed baseline. Viewer: headless-browser smoke test (tour loads, N scenes present, hotspots resolve). Negative: corrupt/insufficient frames → clean error state + actionable message. |
| **Failure conditions** | Stitching success rate < 80% on protocol-compliant captures; panoramas require manual repair to be viewable; job orchestration deadlocks or loses jobs; per-scan cost or latency lands outside the envelope from E6; reviewers rate output "not usable" for a listing. |
| **Rollback strategy** | All Phase 1 schema changes are forward migrations owned by the Data Pipeline Agent — roll back = a down migration + drop the Storage bucket; no other system depends on it yet. Tools are new files — delete. Viewer deploy is a static bundle — unpublish. No production traffic, no data to preserve. Keep the dataset and the eval baseline. |
| **Dependencies** | Phase 0 approved · representative dataset · Supabase project · Hugin available to the worker · a container host for the worker (local Docker is fine for Phase 1) · Photo Sphere Viewer. |

### Phase 1 work breakdown (build order)

1. **Data Pipeline Agent** → MVP schema subset (`scans`, `frames`, `rooms`,
   `assets`) + truncated `status` enum + forward-only transition trigger +
   Storage buckets/policies + `pgmq` queue. Migration `0001`. *(Per its own SOP;
   the orchestrator does not write SQL.)*
2. **Implementation Agent** → `load_dataset.py`, `register_scan.py`,
   `upload_assets.py` (ingest path; AC-1).
3. **Implementation Agent** → `stitch_panorama.py` wrapping `HuginStitcher`
   behind `StitchEngine` (AC-3), tuned using **E1** results.
4. **Implementation Agent** → `build_tour.py` → `PhotoSphereViewerBuilder`
   behind `ViewerBuilder` (AC-4).
5. **Implementation Agent** → the queue worker: claim job → stitch rooms →
   build tour → write assets → advance status (AC-2).
6. **Implementation Agent** → minimal review page: list `ready_for_review`
   scans, open viewer, `Approve` button (AC-5).
7. **Benchmark/Eval Agent** → `eval_repro.py` + committed baseline (AC-6).
8. **Verification/QA Agent** → the trace document + full acceptance sweep (AC-7).
9. **CTO/Orchestrator** → record the phase lesson; decide Phase 2 (which
   experiment graduates: enhancement, depth parallax, or 3DGS premium tier).

### Explicitly deferred past Phase 1

Payments, iframe embed, analytics, control panel, multi-tenant RLS, capture app,
Capture/Embed AI, infra split, marketing site. Revisited only after Phase 1
demonstrates useful reconstruction output and E2 confirms willingness to pay.

---

## PHASE 2 — (provisional, not yet planned in detail)

Graduates whichever experiment track cleared its decision rule in Phase 1:
enhancement in-pipeline (E5), depth parallax (E4), or a 3DGS premium tier (E3).
Then, and only then, resume the deferred SaaS surfaces in build-sequence order
(payment → embed gating → control panel), each as its own phase with the full
template.

---

## Cadence / learning loop

The orchestrator runs every unknown through:
`research → experiment → result → decision → implementation → verification → lesson`
and records each step in the matching doc (research → `research/`, experiment →
`SODAR_EXPERIMENTS.md`, decision → `SODAR_TECHNICAL_DECISIONS.md`, lesson → the
relevant workflow's Lessons section). No major architectural decision is taken
because an approach is popular — when uncertainty materially affects SODAR, an
experiment is created and measured.
