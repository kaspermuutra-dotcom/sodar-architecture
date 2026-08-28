"""End-to-end: invoke the `sodar` CLI as a user would, via subprocess."""

import json
import shutil
import unittest
from pathlib import Path

from tests._util import REPO_ROOT, run_cli

from sodar import exit_codes


class CliIntegrationTests(unittest.TestCase):
    def _cleanup_run(self, rel_dir: str) -> None:
        # rel_dir looks like "artifacts/evals/<run_id>/output"
        run_dir = (REPO_ROOT / rel_dir).parent
        if run_dir.is_dir() and "artifacts" in run_dir.parts:
            shutil.rmtree(run_dir, ignore_errors=True)

    def test_provider_list_contains_dummy_human(self):
        r = run_cli("provider", "list")
        self.assertEqual(r.returncode, exit_codes.OK, r.stderr)
        self.assertIn("dummy", r.stdout)

    def test_provider_list_json_is_clean(self):
        r = run_cli("provider", "list", "--json")
        self.assertEqual(r.returncode, exit_codes.OK, r.stderr)
        self.assertTrue(r.stdout.lstrip().startswith("{"))
        payload = json.loads(r.stdout)  # raises if prose leaked in
        self.assertIn("dummy", {p["id"] for p in payload["providers"]})

    def test_eval_run_valid_creates_persisted_result(self):
        r = run_cli("eval", "run", "dummy", "valid-basic-001", "--json")
        self.assertEqual(r.returncode, exit_codes.OK, r.stderr)
        payload = json.loads(r.stdout)
        run_dir = payload["run_dir"]
        self.addCleanup(shutil.rmtree, REPO_ROOT / run_dir, True)

        saved = REPO_ROOT / run_dir / "eval-result.json"
        self.assertTrue(saved.is_file())
        result = json.loads(saved.read_text())
        self.assertEqual(result["schema_version"], "eval-result.v1")
        self.assertEqual(result["provider_id"], "dummy")
        self.assertEqual(result["fixture_id"], "valid-basic-001")
        self.assertTrue(result["success"])

    def test_eval_run_trailing_json_flag_supported(self):
        r = run_cli("eval", "run", "dummy", "valid-basic-001", "--json")
        self.assertEqual(r.returncode, exit_codes.OK)
        payload = json.loads(r.stdout)
        self.addCleanup(shutil.rmtree, REPO_ROOT / payload["run_dir"], True)

    def test_invalid_fixture_exits_with_fixture_code(self):
        r = run_cli("eval", "run", "dummy", "invalid-missing-rooms-001")
        self.assertEqual(r.returncode, exit_codes.FIXTURE, r.stdout + r.stderr)

    def test_invalid_fixture_json_error_is_clean_json(self):
        r = run_cli("eval", "run", "dummy", "invalid-missing-rooms-001", "--json")
        self.assertEqual(r.returncode, exit_codes.FIXTURE)
        payload = json.loads(r.stdout)
        self.assertEqual(payload["exit_code"], exit_codes.FIXTURE)
        self.assertIn("error", payload)

    def test_unknown_provider_is_usage_error(self):
        r = run_cli("eval", "run", "nope", "valid-basic-001")
        self.assertEqual(r.returncode, exit_codes.USAGE, r.stdout + r.stderr)

    def test_provider_run_valid_writes_artifact(self):
        r = run_cli("provider", "run", "dummy", "valid-basic-001", "--json")
        self.assertEqual(r.returncode, exit_codes.OK, r.stderr)
        payload = json.loads(r.stdout)
        out = REPO_ROOT / payload["output_dir"]
        self.addCleanup(shutil.rmtree, out.parent, True)
        self.assertTrue((out / "result.json").is_file())


if __name__ == "__main__":
    unittest.main()
