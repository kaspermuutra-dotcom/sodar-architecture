import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from sodar import paths, schema
from sodar.fixtures import resolve_fixture
from sodar.eval.runner import ProviderValidationError, run_eval
from sodar.providers.base import (
    Provider,
    ProviderInput,
    ProviderResult,
    ValidationResult,
    artifact_ref,
    sha256_file,
    write_json_deterministic,
)
from sodar.providers.registry import get_provider


class IntegrityProbeProvider(Provider):
    id = "integrity-probe"
    description = "Test-only provider for evaluator integrity cases"

    def __init__(self, mode: str):
        self.mode = mode

    def validate(self, request: ProviderInput) -> ValidationResult:
        return ValidationResult.passed()

    def execute(self, request: ProviderInput, output_dir: Path) -> ProviderResult:
        nested = output_dir / "nested" / "artifact.txt"
        nested.parent.mkdir()
        nested.write_text("trusted payload\n", encoding="utf-8")
        ref = artifact_ref(output_dir, "nested/artifact.txt")

        if self.mode == "missing-manifest":
            pass
        elif self.mode == "malformed-manifest":
            (output_dir / "output_manifest.json").write_text("{broken", encoding="utf-8")
        else:
            entry = ref.as_dict()
            if self.mode == "nonexistent":
                entry["relpath"] = "nested/missing.txt"
            elif self.mode == "checksum-mismatch":
                entry["sha256"] = "0" * 64
            elif self.mode == "parent-traversal":
                outside = output_dir.parent / "outside-file"
                outside.write_text("must not be read\n", encoding="utf-8")
                entry = {
                    "relpath": "../outside-file",
                    "bytes": outside.stat().st_size,
                    "sha256": sha256_file(outside),
                }
            elif self.mode == "absolute-path":
                entry["relpath"] = str(nested.resolve())
            write_json_deterministic(
                output_dir / "output_manifest.json",
                {"manifest_version": "output-manifest.v1", "artifacts": [entry]},
            )

        return ProviderResult(provider_id=self.id, success=True, artifacts=(ref,))


class EvalRunnerTests(unittest.TestCase):
    def setUp(self):
        self.provider = get_provider("dummy")
        self.valid = resolve_fixture("valid-basic-001")
        self.invalid = resolve_fixture("invalid-missing-rooms-001")
        self._tmp = tempfile.TemporaryDirectory()
        self.evals_dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_run_persists_valid_eval_result(self):
        outcome = run_eval(self.provider, self.valid, evals_dir=self.evals_dir)
        saved = outcome.run_dir / "eval-result.json"
        self.assertTrue(saved.is_file())
        on_disk = json.loads(saved.read_text())
        self.assertEqual(on_disk, outcome.result)
        self.assertEqual(on_disk["schema_version"], "eval-result.v1")
        self.assertTrue(on_disk["success"])

    def test_generated_result_matches_schema(self):
        outcome = run_eval(self.provider, self.valid, evals_dir=self.evals_dir)
        errors = schema.validate(
            outcome.result, schema.load_schema(paths.EVAL_RESULT_SCHEMA)
        )
        self.assertEqual(errors, [])

    def test_metrics_are_deterministic_across_runs(self):
        a = run_eval(self.provider, self.valid, evals_dir=self.evals_dir)
        b = run_eval(self.provider, self.valid, evals_dir=self.evals_dir)
        self.assertEqual(a.result["metrics"], b.result["metrics"])
        self.assertEqual(a.result["estimated_cost"], b.result["estimated_cost"])
        self.assertEqual(a.result["artifacts"], b.result["artifacts"])
        self.assertEqual(a.result["provider_metadata"], b.result["provider_metadata"])

    def test_v1_metric_keys_present(self):
        outcome = run_eval(self.provider, self.valid, evals_dir=self.evals_dir)
        metrics = outcome.result["metrics"]
        self.assertEqual(
            set(metrics),
            {"artifact_count", "total_output_bytes",
             "expected_artifacts_present", "output_manifest_valid"},
        )
        self.assertEqual(metrics["artifact_count"], 2)
        self.assertTrue(metrics["expected_artifacts_present"])
        self.assertTrue(metrics["output_manifest_valid"])

    def test_runs_are_never_overwritten(self):
        a = run_eval(self.provider, self.valid, evals_dir=self.evals_dir)
        b = run_eval(self.provider, self.valid, evals_dir=self.evals_dir)
        self.assertNotEqual(a.run_dir, b.run_dir)
        run_dirs = sorted(p for p in self.evals_dir.iterdir() if p.is_dir())
        self.assertEqual(len(run_dirs), 2)
        for d in run_dirs:
            self.assertTrue((d / "eval-result.json").is_file())

    def test_invalid_fixture_raises_validation_error_and_persists_nothing(self):
        with self.assertRaises(ProviderValidationError) as ctx:
            run_eval(self.provider, self.invalid, evals_dir=self.evals_dir)
        self.assertTrue(any("rooms" in e for e in ctx.exception.errors))
        self.assertEqual(list(self.evals_dir.iterdir()), [])

    def _run_probe(self, mode: str, expected: tuple[str, ...] = ()):
        fixture = replace(self.valid, expected_artifacts=expected)
        return run_eval(IntegrityProbeProvider(mode), fixture, evals_dir=self.evals_dir)

    def test_missing_expected_artifact_fails_integrity(self):
        fixture = replace(self.valid, expected_artifacts=("absent.txt",))
        outcome = run_eval(self.provider, fixture, evals_dir=self.evals_dir)
        self.assertFalse(outcome.success)
        self.assertFalse(outcome.result["metrics"]["expected_artifacts_present"])
        self.assertTrue(any("missing expected artifact" in e for e in outcome.result["errors"]))

    def test_missing_output_manifest_fails_integrity(self):
        outcome = self._run_probe("missing-manifest", ("nested/artifact.txt",))
        self.assertFalse(outcome.success)
        self.assertFalse(outcome.result["metrics"]["output_manifest_valid"])
        self.assertTrue(any("missing output_manifest.json" in e for e in outcome.result["errors"]))

    def test_malformed_manifest_fails_integrity(self):
        outcome = self._run_probe("malformed-manifest")
        self.assertFalse(outcome.success)
        self.assertTrue(any("invalid output_manifest.json" in e for e in outcome.result["errors"]))

    def test_manifest_nonexistent_artifact_fails_integrity(self):
        outcome = self._run_probe("nonexistent")
        self.assertFalse(outcome.success)
        self.assertTrue(any("does not exist" in e for e in outcome.result["errors"]))

    def test_manifest_checksum_mismatch_fails_integrity(self):
        outcome = self._run_probe("checksum-mismatch")
        self.assertFalse(outcome.success)
        self.assertTrue(any("checksum mismatch" in e for e in outcome.result["errors"]))

    def test_manifest_parent_traversal_is_rejected(self):
        outcome = self._run_probe("parent-traversal")
        self.assertFalse(outcome.success)
        self.assertTrue(any("parent traversal" in e for e in outcome.result["errors"]))

    def test_manifest_absolute_path_is_rejected(self):
        outcome = self._run_probe("absolute-path")
        self.assertFalse(outcome.success)
        self.assertTrue(any("absolute artifact path" in e for e in outcome.result["errors"]))

    def test_valid_nested_artifact_path_is_accepted(self):
        outcome = self._run_probe("valid", ("nested/artifact.txt",))
        self.assertTrue(outcome.success, outcome.result["errors"])
        self.assertTrue(outcome.result["metrics"]["output_manifest_valid"])


if __name__ == "__main__":
    unittest.main()
