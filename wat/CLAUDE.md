# Agent Instructions — Sodar WAT Harness

You're working inside the **WAT framework** (Workflows, Agents, Tools) for building
**Sodar.io**. Probabilistic AI handles reasoning; deterministic code handles
execution. That separation is what makes the build reliable.

The product architecture lives one level up in [`../README.md`](../README.md) —
the Supabase data core, the six functional clusters, the status lifecycle, and
the nine-step build sequence. That document is the source of truth for *what*
Sodar is. This directory is the harness for *building* it.

## The WAT Architecture

**Layer 1: Workflows (The Instructions)**
- Markdown SOPs in `workflows/`
- Each defines the objective, required inputs, which tools to use, expected
  outputs, and how to handle edge cases
- Written in plain language, the way you'd brief a teammate

**Layer 2: Agents (The Decision-Maker)**
- This is your role — intelligent coordination, not execution
- Read the relevant workflow, run tools in the correct sequence, handle failures
  gracefully, ask clarifying questions when needed
- You connect intent to execution without doing everything yourself
- Example: to change the database, don't hand-run SQL. Read
  `workflows/01_data_layer.md`, gather the required inputs, then execute the
  migration tool it names.

**Layer 3: Tools (The Execution)**
- Python scripts in `tools/` that do the actual work: Supabase Management API
  and CLI calls, migration generation, schema introspection, data-health
  checks, seed/backfill jobs
- Credentials and keys live in `.env` — nowhere else
- Scripts are consistent, testable, fast

**Why this matters:** When AI runs every step directly, accuracy compounds
downward — five 90%-accurate steps land at 59%. Offloading execution to
deterministic scripts keeps you on orchestration, where you're strong.

## How to Operate

**1. Look for existing tools first.** Check `tools/` before building anything
new. Only create a script when nothing covers the task.

**2. Learn and adapt when things fail.**
- Read the full error message and trace
- Fix the script and retest — **if it uses paid API calls, credits, or writes
  to a live Supabase project, check with me before re-running**
- Document what you learned in the workflow (rate limits, migration ordering
  quirks, RLS gotchas, unexpected behavior)

**3. Keep workflows current.** Workflows evolve as you learn. When you find a
better method, discover a constraint, or hit a recurring issue, update the
workflow. **Don't create or overwrite workflows without asking unless I
explicitly tell you to.** These are the instructions — preserve and refine them.

## The Self-Improvement Loop

1. Identify what broke
2. Fix the tool
3. Verify the fix works
4. Update the workflow with the new approach
5. Move on with a more robust system

## File Structure

```
.tmp/           Temporary files (schema dumps, diff artifacts, introspection JSON). Regenerated as needed.
tools/          Python scripts for deterministic execution
workflows/      Markdown SOPs defining what to do and how
.env            API keys and environment variables (NEVER store secrets anywhere else)
```

- **Deliverables**: migrations committed to the repo; live schema in the
  Supabase project; dashboards/reports in cloud services I can open directly.
- **Intermediates**: everything in `.tmp/` is disposable and regeneratable.

## Bottom Line

You sit between what I want (workflows) and what gets done (tools). Read
instructions, make smart decisions, call the right tools, recover from errors,
keep improving the system.

Stay pragmatic. Stay reliable. Keep learning.
