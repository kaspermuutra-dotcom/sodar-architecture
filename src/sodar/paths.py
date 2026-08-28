"""Filesystem layout of the harness.

The repo root is found by walking up from this file until a directory contains
both ``schemas/`` and ``fixtures/``. This keeps the CLI working from any CWD
and from an editable install.
"""

from __future__ import annotations

from pathlib import Path


def repo_root() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "schemas").is_dir() and (parent / "fixtures").is_dir():
            return parent
    raise RuntimeError("could not locate repo root (no schemas/ + fixtures/ ancestor)")


ROOT = repo_root()
SCHEMAS_DIR = ROOT / "schemas"
FIXTURES_DIR = ROOT / "fixtures"
ARTIFACTS_DIR = ROOT / "artifacts"
EVALS_DIR = ARTIFACTS_DIR / "evals"
PROVIDER_RUNS_DIR = ARTIFACTS_DIR / "provider-runs"

EVAL_RESULT_SCHEMA = SCHEMAS_DIR / "eval-result.v1.json"
FIXTURE_SCHEMA = SCHEMAS_DIR / "fixture.v1.json"
