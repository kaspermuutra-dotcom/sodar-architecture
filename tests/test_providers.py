import json
import tempfile
import unittest
from pathlib import Path

from sodar.fixtures import resolve_fixture
from sodar.providers.base import ProviderInput
from sodar.providers.registry import get_provider, list_providers


def _request(fixture_id: str) -> ProviderInput:
    fx = resolve_fixture(fixture_id)
    assert fx is not None
    return ProviderInput(
        fixture_id=fx.fixture_id, fixture_root=fx.root, declared_inputs=fx.inputs
    )


class ProviderRegistryTests(unittest.TestCase):
    def test_registry_contains_dummy(self):
        ids = {p.id for p in list_providers()}
        self.assertIn("dummy", ids)

    def test_get_unknown_provider_returns_none(self):
        self.assertIsNone(get_provider("no-such-provider"))


class DummyProviderTests(unittest.TestCase):
    def setUp(self):
        self.provider = get_provider("dummy")
        self.assertIsNotNone(self.provider)
        self._tmp = tempfile.TemporaryDirectory()
        self.out = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_valid_fixture_passes_validation(self):
        result = self.provider.validate(_request("valid-basic-001"))
        self.assertTrue(result.ok, result.errors)
        self.assertEqual(result.errors, ())

    def test_invalid_fixture_fails_validation_predictably(self):
        result = self.provider.validate(_request("invalid-missing-rooms-001"))
        self.assertFalse(result.ok)
        self.assertTrue(
            any("missing required field 'rooms'" in e for e in result.errors),
            result.errors,
        )

    def test_execute_produces_expected_artifacts(self):
        self.provider.execute(_request("valid-basic-001"), self.out)
        result_json = self.out / "result.json"
        summary_txt = self.out / "summary.txt"
        manifest = self.out / "output_manifest.json"
        self.assertTrue(result_json.is_file())
        self.assertTrue(summary_txt.is_file())
        self.assertTrue(manifest.is_file())

        body = json.loads(result_json.read_text())
        self.assertEqual(body["room_count"], 3)
        self.assertEqual(body["rooms"], ["living_room", "kitchen", "bedroom"])
        self.assertEqual(body["total_frames"], 31)

    def test_execute_is_deterministic(self):
        with tempfile.TemporaryDirectory() as da, tempfile.TemporaryDirectory() as db:
            ra = self.provider.execute(_request("valid-basic-001"), Path(da))
            rb = self.provider.execute(_request("valid-basic-001"), Path(db))
            for name in ("result.json", "summary.txt", "output_manifest.json"):
                self.assertEqual(
                    (Path(da) / name).read_bytes(),
                    (Path(db) / name).read_bytes(),
                    f"{name} differs between runs",
                )
            self.assertEqual(ra.estimated_cost, rb.estimated_cost)
            self.assertEqual(ra.provider_metadata, rb.provider_metadata)
            self.assertEqual(
                [x.as_dict() for x in ra.artifacts],
                [x.as_dict() for x in rb.artifacts],
            )


if __name__ == "__main__":
    unittest.main()
