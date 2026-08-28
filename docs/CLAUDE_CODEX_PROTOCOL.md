# Claude / Codex Task Protocol

How the two agents divide work on the SODAR harness.

## Roles

- **Claude** — primary architect and integrator. Owns the contracts
  (`providers/base.py`, `schemas/*.json`), the evaluator, wiring, and the final
  merge. Decides scope.
- **Codex** — bounded execution. Used for: a single well-specified
  implementation task, adversarial review of Claude's code, test generation, or
  a second independent implementation to compare against.

## Hard rule

**Claude and Codex must never modify the same files concurrently.** Every task
names an exclusive `FILES_ALLOWED_TO_MODIFY` set. If two open tasks would touch
the same file, one waits. Review tasks are read-only and modify nothing.

## Task contract

Every delegated task is specified with exactly these fields:

```
TASK_ID                 short unique slug, e.g. codex-2026-08-28-metrics-review
OBJECTIVE               one sentence: what done looks like
FILES_ALLOWED_TO_MODIFY explicit list; empty for review-only tasks
FILES_READ_ONLY         context the agent may read but must not change
ACCEPTANCE_CRITERIA     bullet list, each independently checkable
TEST_COMMANDS           exact commands the agent must run and pass
EXPECTED_OUTPUT         what the agent returns (patch, findings list, new files)
REVIEWER                who checks the result before merge (usually the other agent)
```

## Flow

1. Claude writes the task contract.
2. The assigned agent works only within `FILES_ALLOWED_TO_MODIFY`.
3. The agent runs `TEST_COMMANDS` and reports pass/fail with output.
4. `REVIEWER` checks `ACCEPTANCE_CRITERIA` against the result.
5. Claude merges. Only Claude merges.

## Example task

```
TASK_ID                 codex-2026-08-28-evaluator-adversarial
OBJECTIVE               Find any way the evaluator produces a non-deterministic
                        metric or a schema-invalid eval-result.
FILES_ALLOWED_TO_MODIFY (none - review only)
FILES_READ_ONLY         src/sodar/**, schemas/**, tests/**
ACCEPTANCE_CRITERIA     - report lists each risk with a concrete repro or "none found"
                        - no file modified
TEST_COMMANDS           python -m unittest discover -s tests -v
EXPECTED_OUTPUT         findings list, severity-ranked
REVIEWER                Claude
```
