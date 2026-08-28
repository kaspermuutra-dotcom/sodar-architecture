# 01 · Data Layer — Supabase Auth + Schema

## Objective

Stand up the Supabase project that replaces the current flat
`manifest.json` + JSONL-per-scan approach with one Postgres schema. Deliver:

1. A Supabase project (auth enabled, storage enabled).
2. The initial schema from [`../../README.md`](../../README.md#data-layer),
   as versioned SQL migrations in `migrations/`.
3. Row-level security so `agent_id` ownership is enforced, not just modelled.
4. The `status` lifecycle as a constrained, enforceable column.

This workflow produces the **first migration**. From here on, all schema change
flows through [`data_pipeline_agent.md`](data_pipeline_agent.md).

## Inputs

- `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_URL` in `.env`
  (see `.env.example`). If no project exists yet, ask me to create one in the
  dashboard, or confirm before the tool creates it via the Management API.
- Target schema — the table list in the README's Data layer section.

## Tables (from README)

```
agents            id, email, org, created_at
scans             id, agent_id, status, created_at
frames            scan_id, filename, heading, quality*
rooms             scan_id, name, start_frame, end_frame
listings          scan_id, title, address, price_quote
payments          scan_id, stripe_session_id, status
leads             scan_id, name, email, phone, status
analytics_events  scan_id, event_type, ts, referrer
```

- `scans.status` ∈ `capturing → rendering → ready_for_review → approved → paid`
  — enforce with a Postgres `enum` or `check` constraint; forward-only
  transitions are validated by a trigger (see `data_pipeline_agent.md`).
- `frames.quality` is a JSON/composite of: `blur`, `exposure_score`,
  `rotation_rate`, `delta_yaw`.
- `agents.id` maps to `auth.users.id` (Supabase Auth is the identity source).

## Tools

| Task | Tool | Notes |
|---|---|---|
| Inspect live schema | `tools/db_introspect.py` | dumps tables/columns/policies to `.tmp/schema.json` |
| Generate a migration from a target spec | `tools/gen_migration.py` | diffs target vs. live, writes `migrations/NNNN_*.sql` — **review before apply** |
| Apply migrations | `tools/apply_migrations.py` | runs pending migrations against `SUPABASE_DB_URL`; **confirm with me first** |
| Verify RLS coverage | `tools/check_rls.py` | fails if any table with `agent_id` lineage lacks a policy |

*(Tools are built on first use — none exist yet. Build them minimal, test against
`.tmp/`, and record quirks in Lessons below.)*

## Steps

1. Confirm `.env` is populated and the project is reachable — run `db_introspect.py`.
2. Write the target schema spec (`.tmp/target_schema.sql` or a structured file
   the generator reads). Keep it derived from the README, not invented.
3. Generate migration `0001_init.sql`. Read every line.
4. Show me the migration. Do not apply without confirmation.
5. Apply. Re-run `db_introspect.py` and diff against target — expect zero drift.
6. Run `check_rls.py`. Add policies until it passes.
7. Commit `migrations/0001_init.sql` to the repo.
8. Update `00_index.md` step 1 status to `done`, and hand ongoing schema
   evolution to `data_pipeline_agent.md`.

## Outputs

- `wat/migrations/0001_init.sql` (committed)
- Live schema matching it, RLS green
- `.tmp/schema.json` snapshot (disposable)

## Edge cases

- **No project yet** — stop and ask; don't auto-provision paid infra.
- **Drift after apply** — a manual dashboard edit happened; introspect, fold the
  delta into a new migration, never edit `0001` after it's applied.
- **Auth schema** — never migrate Supabase-managed schemas (`auth`, `storage`).
  Reference `auth.users` by FK only.

## Lessons

_(append as you learn — rate limits, ordering quirks, RLS surprises)_
