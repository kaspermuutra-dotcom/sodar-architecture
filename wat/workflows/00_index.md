# Workflow Index

WAT harness for building SODAR. **Workflows** = instructions · **Agents** =
reasoning/orchestration · **Tools** = deterministic execution.

Start here: [`../SODAR_MVP_BUILD_PLAN.md`](../SODAR_MVP_BUILD_PLAN.md) ·
[`../SODAR_AGENT_ARCHITECTURE.md`](../SODAR_AGENT_ARCHITECTURE.md) ·
[`../SODAR_TECHNICAL_DECISIONS.md`](../SODAR_TECHNICAL_DECISIONS.md) ·
[`../SODAR_EXPERIMENTS.md`](../SODAR_EXPERIMENTS.md)

## Agent workflows

| Workflow | Agent | Scope |
|---|---|---|
| [`cto_orchestrator.md`](cto_orchestrator.md) | CTO / Orchestrator | Phase gates, delegation, the research→…→lesson loop. Never builds. |
| [`arch_research.md`](arch_research.md) | Architecture Research | System-design trade-offs, dependency risk, decision-record drafts. Read-only. |
| [`mlcv_research.md`](mlcv_research.md) | ML / CV Research | Reconstruction problem space; turns unknowns into experiment specs. Read-only. |
| [`benchmark_eval.md`](benchmark_eval.md) | Benchmark / Evaluation | Runs experiments via tools; reports metrics + verdict vs pre-registered rule. |
| [`implementation_agent.md`](implementation_agent.md) | Implementation | Builds `tools/` + pipeline glue from an approved phase plan. No schema, no decisions. |
| [`data_pipeline_agent.md`](data_pipeline_agent.md) | Data Pipeline *(scope-locked)* | **Data infrastructure only** — schema, migrations, RLS, triggers, storage policies, `pgmq`, data health. |
| [`verification_qa.md`](verification_qa.md) | Verification / QA | Independent acceptance check + traceability doc + test matrix. Can fail a phase. |

## MVP build sequence (reordered)

The README's [9-step sequence](../../README.md#build-sequence) is the *product*
order. The *MVP* order front-loads the unproven thesis — reconstruction — and
defers the SaaS surfaces until it produces useful output.

| Phase | Workflow | Purpose | Status |
|---|---|---|---|
| 0 | *(orchestrator + research agents)* | Frame the slice, lock decisions, run E1/E2 | drafting |
| 1 | [`01_data_layer.md`](01_data_layer.md) → then `p1_*` items | Reconstruction vertical slice: capture → store → job → panorama tour → viewer → approve | not started |
| 2+ | TBD after Phase 1 lesson | Graduate one experiment (enhance / depth / 3DGS), then resume deferred surfaces | not started |

### Deferred (build only after Phase 1 proves reconstruction)

Payment · embed/iframe · analytics + control panel · multi-tenant RLS · capture
app · Capture AI · Embed AI · infra split · marketing site. Each becomes its own
phase with the full template (objective · inputs · outputs · acceptance criteria
· tests · failure conditions · rollback · dependencies).

## Research

| Doc | Purpose |
|---|---|
| [`../research/external-apis.md`](../research/external-apis.md) | Options survey for every external node in the system map, with a working recommendation per boundary. |

## Conventions

- One workflow per file. Sequenced work `NN_slug.md`; agents/cross-cutting `slug.md`.
- Every workflow: **Objective · Inputs · Tools · Steps · Outputs · Edge cases · Lessons**.
- **Lessons** grows over time — append, don't rewrite.
- No workflow is created or overwritten without the user's say-so (per
  [`../CLAUDE.md`](../CLAUDE.md)).
