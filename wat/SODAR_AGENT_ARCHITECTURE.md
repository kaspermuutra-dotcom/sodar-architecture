# SODAR — Agent Architecture

How the WAT harness is organised to build SODAR. **Workflows** are instructions
(`workflows/*.md`), **agents** are reasoning/orchestration (a session running a
workflow), **tools** are deterministic execution (`tools/*.py`).

**Prime directive:** the orchestrator never performs a complex deterministic
operation itself when a tool can. Reasoning and sequencing are the agent layer;
stitching, SQL, COLMAP, metrics, deploys are the tool layer.

---

## Hierarchy

```
                    ┌─────────────────────────────┐
                    │   CTO / Orchestrator        │  workflows/cto_orchestrator.md
                    │   - owns phase gates        │
                    │   - delegates, never builds │
                    │   - records the learning loop│
                    └──────────────┬──────────────┘
          ┌────────────────┬───────┼────────┬─────────────────┬───────────────┐
          ▼                ▼       ▼        ▼                 ▼               ▼
┌──────────────────┐ ┌───────────┐ ┌──────────────┐ ┌────────────────┐ ┌──────────────┐
│ Architecture     │ │ ML / CV   │ │ Benchmark /  │ │ Implementation │ │ Verification │
│ Research Agent   │ │ Research  │ │ Evaluation   │ │ Agent          │ │ / QA Agent   │
│ arch_research.md │ │ Agent     │ │ Agent        │ │ implementation │ │ verification │
│                  │ │ mlcv_...  │ │ benchmark_...│ │ _agent.md      │ │ _qa.md       │
└──────────────────┘ └───────────┘ └──────────────┘ └───────┬────────┘ └──────────────┘
                                                            │ calls tools only
                    ┌───────────────────────────────────────┴─────┐
                    │  Data Pipeline Agent   (SCOPE-LOCKED)        │
                    │  workflows/data_pipeline_agent.md            │
                    │  data infrastructure ONLY                    │
                    └─────────────────────────────────────────────┘
```

The Data Pipeline Agent sits under the orchestrator like the others, but is drawn
apart because its scope is hard-bounded and every other agent that needs a schema
change requests it rather than making it.

---

## Roles

### 1. CTO / Orchestrator — `workflows/cto_orchestrator.md`
- **Owns:** the phase model in `SODAR_MVP_BUILD_PLAN.md`; phase entry/exit gates;
  which experiment graduates; the `research → experiment → result → decision →
  implementation → verification → lesson` loop.
- **Does:** read state, decide the next step, delegate to exactly one agent at a
  time (or a defined parallel set), integrate results, update the SODAR_*.md docs,
  escalate to the user at approval gates.
- **Never:** writes SQL, runs stitching/COLMAP/metrics, writes application or tool
  code, provisions infra. If it is tempted to, that is a missing tool or a
  delegation.
- **Escalates to the user:** at every phase approval gate; on any failure
  condition; before any spend on paid APIs / cloud resources; when an experiment
  result contradicts an approved decision.

### 2. Architecture Research Agent — `workflows/arch_research.md`
- System-design trade-offs: adapter boundaries, queue/worker topology, storage
  layout, deployment shape, build-order sequencing, dependency risk.
- Consumes `research/external-apis.md`; produces decision-record drafts for
  `SODAR_TECHNICAL_DECISIONS.md` (candidates / evidence / recommendation /
  confidence / cost / latency / data needs / failure modes / replacement).
- Read-only on the repo; proposes, does not implement.

### 3. ML / CV Research Agent — `workflows/mlcv_research.md`
- Owns the reconstruction problem space: panorama stitching, monocular &
  360 depth, MVS, Gaussian splatting, NeRF-style methods, phone-imagery 3D,
  image enhancement, browser 3D/360 rendering.
- Surveys current *practical* approaches (not SOTA-for-its-own-sake), scoped by:
  fastest prototype, quality, reliability, low complexity, low compute cost,
  replaceability, real-estate suitability.
- Produces model/approach shortlists with evidence and the experiment needed to
  choose. Hands experiment specs to the Benchmark Agent.
- Read-only on the repo.

### 4. Benchmark / Evaluation Agent — `workflows/benchmark_eval.md`
- Runs the experiments in `SODAR_EXPERIMENTS.md` against the representative
  dataset **via tools only** (`stitch_panorama`, `run_colmap`, `train_3dgs`,
  `depth_infer`, `enhance_image`, `eval_repro`).
- Produces metric tables + artifacts in `.tmp/experiments/<id>/`, and a verdict
  against each experiment's pre-registered decision rule.
- Owns the eval metric definitions and the committed regression baselines.
- Does not decide architecture — reports; the orchestrator decides.

### 5. Implementation Agent — `workflows/implementation_agent.md`
- Builds `tools/` scripts and wires the pipeline slice, following an approved
  phase plan. Writes adapters so every H-list dependency stays swappable.
- May run tools; may not make architectural decisions (raises them to the
  orchestrator) and may not touch data infrastructure (requests it from the Data
  Pipeline Agent).
- Every script: deterministic, reads `.env`, writes intermediates to `.tmp/`,
  non-zero exit + real error on failure, `--confirm` for anything live.

### 6. Data Pipeline Agent — `workflows/data_pipeline_agent.md` *(existing, scope-locked)*
- **ONLY** data infrastructure: schema, migrations, RLS, triggers, storage
  buckets/policies, `pgmq` queue objects, data-health & lifecycle-integrity
  monitoring, backfills.
- **Not** reconstruction, tools, viewer, evaluation, orchestration, or product
  logic. Other agents request schema changes; it plans/constructs/fixes/monitors
  them.
- Runs its own PLAN→CONSTRUCT→FIX→MONITOR loop; confirms with the user before any
  live/paid write.

### 7. Verification / QA Agent — `workflows/verification_qa.md`
- Independent check that a phase meets its acceptance criteria. Builds the
  traceability document (`scan_id` → storage → job → asset → viewer). Runs the
  test matrix (unit / integration / regression / viewer smoke / negative).
- Authority to fail a phase. Reports pass/fail with evidence; does not fix.

---

## Delegation rules

1. One workflow per delegation. The orchestrator states objective, inputs,
   expected output shape, and the doc/section to update.
2. Research agents are read-only. Only the Implementation and Data Pipeline
   agents write, and only within their scope.
3. Every deterministic action is a tool call. A research or QA agent that needs a
   number runs a tool (or asks Benchmark to); it does not eyeball it.
4. Schema is a monopoly. All schema/RLS/trigger/storage-policy changes go through
   the Data Pipeline Agent, regardless of who needs them.
5. Decisions are pre-registered. An experiment defines its decision rule *before*
   it runs; the orchestrator applies the rule to the result.
6. Lessons are mandatory. No phase closes without a lesson written to the
   relevant workflow's Lessons section.
7. User gates are hard stops: phase approval, paid-API spend, cloud provisioning,
   contradicting an approved decision.

## Tool inventory (built on first use, per phase)

| Tool | Owner phase | Purpose |
|---|---|---|
| `load_dataset.py` | 1 | pull a representative capture into `.tmp/` |
| `register_scan.py` | 1 | create `scans` + `rooms` rows via Supabase |
| `upload_assets.py` | 1 | push frames to Storage, write `frames` rows |
| `stitch_panorama.py` | 1 | `StitchEngine` (Hugin) — frames → equirectangular |
| `build_tour.py` | 1 | `ViewerBuilder` (PSV) — panoramas + graph → static bundle |
| `eval_repro.py` | 1 | per-scan metrics: stitch success, seam score, coverage, load time, cost, latency |
| `run_colmap.py` | exp | SfM poses + sparse cloud (experiment E3) |
| `train_3dgs.py` | exp | Gaussian-splat training + `.spz` export (E3) |
| `depth_infer.py` | exp | monocular / 360 depth maps (E4) |
| `enhance_image.py` | exp→1? | `EnhanceAdapter` (Replicate / Real-ESRGAN) (E5) |
| `deploy_viewer.py` | 1 | publish the static viewer bundle |

## Interfaces the Implementation Agent must honour

```
ReconstructionAdapter.reconstruct(scan) -> RenderedBundle
    default: PanoramaTourReconstructor(StitchEngine, ViewerBuilder)
    swappable: GaussianSplatReconstructor, DepthParallaxReconstructor, VendorAPIReconstructor

StitchEngine.stitch(frames, hints) -> EquirectangularImage
    default: HuginStitcher    swappable: OpenCVStitcher, PTGuiStitcher

EnhanceAdapter.enhance(image) -> image        default: passthrough
ViewerBuilder.build(panoramas, room_graph) -> StaticBundle
JobQueue.claim()/complete()/fail()            default: Supabase pgmq
AssetStore.put()/url()                        default: Supabase Storage
```
