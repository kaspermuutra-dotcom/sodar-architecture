# Data Pipeline Agent — Plan · Construct · Fix · Monitor

## Objective

Own the Supabase data pipeline for the entire lifetime of the Sodar build. Not a
one-shot task — a **standing loop**. As each build-sequence step (2–9) lands, the
data layer needs new tables, columns, constraints, policies, triggers, and health
checks. This agent keeps the schema correct, the migrations clean, the data
healthy, and the lifecycle enforced — continuously — so no other workflow has to
hand-roll database work.

Scope is **data only**: schema, migrations, RLS, triggers, storage buckets/policies,
data-quality monitoring, backfills. It does not write product application code.

## The loop

Run these four phases in order; repeat whenever a build step changes data needs,
on a schedule, or on a monitor alert.

### 1 · PLAN
- Read the target for the current build step (its workflow file + the README).
- Introspect the live schema (`tools/db_introspect.py` → `.tmp/schema.json`).
- Produce a **change plan** in `.tmp/plan_<step>.md`: tables/columns to add,
  constraints, policies, triggers, data migrations, and the health checks that
  should exist afterward.
- Surface the plan to me before constructing anything that writes to a live
  project.

### 2 · CONSTRUCT
- Generate a forward migration (`tools/gen_migration.py` → `migrations/NNNN_*.sql`).
  One migration per logical change; never edit an applied migration.
- Include, where the step calls for it:
  - `check` / `enum` constraints for controlled vocabularies (`scans.status`,
    `payments.status`, `leads.status`)
  - a **forward-only transition trigger** on `scans.status`
    (`capturing → rendering → ready_for_review → approved → paid`) that rejects
    skips and reversals unless a documented override
  - RLS policies for every new table on the `agent_id` ownership chain
  - `updated_at` triggers, FK indexes, `not null` where the manifest implies it
- Apply only after I confirm (`tools/apply_migrations.py`).
- Commit the migration. Re-introspect; expect zero drift vs. plan.

### 3 · FIX
Triggered by a failed migration, drift, or a monitor alert.
- Read the full error / drift report.
- Root-cause: ordering, lock contention, a manual dashboard edit, a bad
  constraint against existing data, an RLS gap.
- Write a **new** corrective migration — never mutate history.
- Re-run the relevant checks until green.
- Append the cause + fix to this file's Lessons and to the affected step workflow.

### 4 · MONITOR
Run `tools/data_health.py` on a schedule (and after every apply). It checks:
- **Referential health** — orphaned `frames`/`rooms`/`listings`/`payments`/
  `leads`/`analytics_events` with no parent `scan`.
- **Lifecycle integrity** — `scans` in a terminal-ish state missing prerequisites
  (`paid` with no `payments` row; `approved` with no review record;
  `ready_for_review` with zero rendered assets).
- **RLS coverage** — any ownership-chain table without a policy (hard fail).
- **Quality-field sanity** — `frames.quality` present and in-range for scans past
  `capturing`.
- **Drift** — live schema vs. latest migration.
- **Volume/growth** — row counts and daily deltas per table, to `.tmp/health.json`
  and a cloud dashboard I can open.

Alerts go to me with the failing check, affected rows, and a proposed FIX plan.

## Inputs

- `.env` populated (see `.env.example`).
- The current build step and its workflow file.
- For a monitor run: nothing — it reads live state.

## Tools

| Tool | Role | Exists? |
|---|---|---|
| `tools/db_introspect.py` | dump live schema → `.tmp/schema.json` | build on first use |
| `tools/gen_migration.py` | diff target vs. live → `migrations/NNNN_*.sql` | build on first use |
| `tools/apply_migrations.py` | apply pending migrations (confirm first) | build on first use |
| `tools/check_rls.py` | fail on any uncovered ownership-chain table | build on first use |
| `tools/data_health.py` | the MONITOR check battery → `.tmp/health.json` | build on first use |
| `tools/backfill.py` | parametrised data migration / seed runner | build when first needed |

Build each tool minimal, test against `.tmp/`, keep it deterministic, record
quirks in Lessons.

## Outputs

- `wat/migrations/*.sql` — the full ordered history, committed
- Live Supabase schema matching the latest migration, RLS green
- `.tmp/plan_*.md`, `.tmp/schema.json`, `.tmp/health.json` — disposable
- A monitoring dashboard in a cloud service (link recorded here once created)

## Edge cases

- **Paid/live writes** — never apply a migration or backfill to a live project
  without my confirmation.
- **Supabase-managed schemas** (`auth`, `storage`, `realtime`) — reference only,
  never migrate.
- **Constraint fails against existing data** — backfill first in a separate
  migration, then add the constraint.
- **Manual dashboard edits** — treat as drift; fold into a migration, then ask me
  to stop editing the dashboard directly.
- **Parallel work** — build step 7 (reconstruction) can run alongside 1–6; expect
  concurrent schema needs and keep migrations independent where possible.

## Lessons

_(append: migration ordering, RLS pitfalls, trigger behavior, Supabase API limits)_
