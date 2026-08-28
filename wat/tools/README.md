# Tools

Deterministic Python scripts. Each does one job: an API call, a transform, a
check. No reasoning, no prompts — just execution the agent can rely on.

## Conventions

- One script per task, named by verb: `db_introspect.py`, `gen_migration.py`.
- Read config from `.env` (via `python-dotenv`); never hardcode secrets.
- Write intermediates to `../.tmp/`; never to the repo tree.
- Exit non-zero on failure with the real error on stderr.
- Idempotent where possible. Anything that writes to a live Supabase project
  prints what it will do and requires `--confirm` (the agent passes it only after
  the user approves).
- Keep a one-line usage docstring at the top.

## Planned (build on first use — see the workflows that name them)

| Script | Purpose | Named by |
|---|---|---|
| `db_introspect.py` | dump live schema → `.tmp/schema.json` | `01_data_layer.md`, `data_pipeline_agent.md` |
| `gen_migration.py` | diff target vs. live → `migrations/NNNN_*.sql` | same |
| `apply_migrations.py` | apply pending migrations (`--confirm`) | same |
| `check_rls.py` | fail on uncovered ownership-chain tables | same |
| `data_health.py` | referential / lifecycle / drift / volume checks | `data_pipeline_agent.md` |
| `backfill.py` | parametrised data migration + seed runner | `data_pipeline_agent.md` |
