"""The deterministic evaluation runner.

Flow: resolve provider -> resolve fixture -> validate -> execute -> inspect
artifacts -> compute metrics -> build eval-result.v1 -> persist -> return.

Provider-agnostic throughout: it calls the `Provider` contract and the generic
metrics module, and never inspects which provider it was handed.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sodar import ids, paths, schema
from sodar.eval.metrics import inspect_integrity
from sodar.fixtures import Fixture
from sodar.providers.base import Provider, ProviderInput

EVALUATOR_VERSION = "0.1.0"
SCHEMA_VERSION = "eval-result.v1"


class EvalError(Exception):
    """Raised for harness-internal faults (persistence, schema mismatch)."""


class ProviderValidationError(Exception):
    """The provider rejected the fixture input."""

    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors) or "provider validation failed")
        self.errors = errors


@dataclass(frozen=True)
class EvalOutcome:
    result: dict[str, Any]
    run_dir: Path

    @property
    def success(self) -> bool:
        return bool(self.result["success"])


def _new_run_dir(base: Path) -> tuple[str, Path]:
    base.mkdir(parents=True, exist_ok=True)
    run_id = ids.new_run_id()
    candidate = base / run_id
    suffix = 0
    while candidate.exists():
        suffix += 1
        run_id = f"{run_id}-{suffix}"
        candidate = base / run_id
    candidate.mkdir()  # exist_ok=False: never reuse a directory
    return run_id, candidate


def run_eval(provider: Provider, fixture: Fixture, evals_dir: Path | None = None) -> EvalOutcome:
    evals_dir = evals_dir or paths.EVALS_DIR

    request = ProviderInput(
        fixture_id=fixture.fixture_id,
        fixture_root=fixture.root,
        declared_inputs=fixture.inputs,
    )

    validation = provider.validate(request)
    if not validation.ok:
        raise ProviderValidationError(list(validation.errors))

    run_id, run_dir = _new_run_dir(evals_dir)
    output_dir = run_dir / "output"
    output_dir.mkdir()

    started_at = ids.utc_now_iso()
    t0 = time.perf_counter()
    try:
        provider_result = provider.execute(request, output_dir)
    except Exception as exc:  # noqa: BLE001 - normalized into a failure result
        provider_result = _failure_result(provider, exc)
    duration_ms = int((time.perf_counter() - t0) * 1000)
    completed_at = ids.utc_now_iso()

    integrity = inspect_integrity(output_dir, list(fixture.expected_artifacts))
    final_success = bool(provider_result.success) and integrity.success
    normalized_errors = list(provider_result.errors)
    normalized_errors.extend(f"integrity: {error}" for error in integrity.errors)

    result: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "provider_id": provider.id,
        "fixture_id": fixture.fixture_id,
        "success": final_success,
        "started_at": started_at,
        "completed_at": completed_at,
        "duration_ms": duration_ms,
        "estimated_cost": float(provider_result.estimated_cost),
        "artifacts": [a.as_dict() for a in provider_result.artifacts],
        "metrics": integrity.metrics,
        "errors": normalized_errors,
        "provider_metadata": dict(provider_result.provider_metadata),
        "evaluator_version": EVALUATOR_VERSION,
    }

    errors = schema.validate(result, schema.load_schema(paths.EVAL_RESULT_SCHEMA))
    if errors:
        raise EvalError(
            f"produced eval result does not match {paths.EVAL_RESULT_SCHEMA.name}: "
            + "; ".join(errors)
        )

    _persist(run_dir, result)
    return EvalOutcome(result=result, run_dir=run_dir)


def _failure_result(provider: Provider, exc: Exception):
    from sodar.providers.base import ProviderResult

    return ProviderResult(
        provider_id=provider.id,
        success=False,
        errors=(f"{type(exc).__name__}: {exc}",),
    )


def _persist(run_dir: Path, result: dict[str, Any]) -> None:
    from sodar.providers.base import write_json_deterministic

    try:
        write_json_deterministic(run_dir / "eval-result.json", result)
    except OSError as exc:
        raise EvalError(f"could not persist run to {run_dir}: {exc}") from exc
