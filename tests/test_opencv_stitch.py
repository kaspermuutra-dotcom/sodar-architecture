"""Tests for the opencv-stitch provider.

None of these require ``opencv-python-headless`` to be installed. The OpenCV
interaction lives behind four tiny seam functions in
``sodar.providers.opencv_stitch`` (`_load_cv2`, `_decode_image`, `_stitch`,
`_encode_png`); the tests substitute fakes for those. One test that genuinely
needs a real ``cv2`` is marked and skips when it is absent.
"""

from __future__ import annotations

import sys
import tempfile
import types
import unittest
from pathlib import Path

from sodar.eval.metrics import inspect_integrity
from sodar.eval.runner import run_eval
from sodar.fixtures import resolve_fixture
from sodar.providers import opencv_stitch as mod
from sodar.providers.base import ProviderInput
from sodar.providers.opencv_stitch import OpenCVStitchProvider, OpenCVUnavailable
from sodar.providers.registry import get_provider, list_providers

FIXTURE_ID = "panorama-stitch-001"


def _fake_cv2() -> types.SimpleNamespace:
    return types.SimpleNamespace(__version__="fake-4.x")


def _request(declared_inputs: tuple[str, ...], root: Path | None = None) -> ProviderInput:
    fx = resolve_fixture(FIXTURE_ID)
    assert fx is not None
    return ProviderInput(
        fixture_id=fx.fixture_id,
        fixture_root=root or fx.root,
        declared_inputs=declared_inputs,
    )


def _good_request() -> ProviderInput:
    fx = resolve_fixture(FIXTURE_ID)
    assert fx is not None
    return ProviderInput(fx.fixture_id, fx.root, fx.inputs)


class RegistryTests(unittest.TestCase):
    def test_registry_contains_dummy_and_opencv_stitch(self):
        ids = {p.id for p in list_providers()}
        self.assertIn("dummy", ids)
        self.assertIn("opencv-stitch", ids)

    def test_listing_providers_does_not_import_cv2(self):
        list_providers()
        get_provider("opencv-stitch")
        self.assertIsNone(sys.modules.get("cv2"), "cv2 must not be imported by the registry")


class ValidationPathTests(unittest.TestCase):
    """Path containment is enforced before the optional dependency is consulted."""

    def setUp(self):
        self.provider = OpenCVStitchProvider()

    def test_absolute_path_is_rejected(self):
        result = self.provider.validate(_request(("/etc/hosts", "input/view_02.png")))
        self.assertFalse(result.ok)
        self.assertTrue(any("absolute path" in e for e in result.errors), result.errors)

    def test_parent_traversal_is_rejected(self):
        result = self.provider.validate(_request(("../view_01.png", "input/view_02.png")))
        self.assertFalse(result.ok)
        self.assertTrue(any("parent traversal" in e for e in result.errors), result.errors)

    def test_symlink_escape_is_rejected_without_reading_target(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "fixture"
            (root / "input").mkdir(parents=True)
            secret = Path(d) / "secret.png"
            secret.write_bytes(b"MUST-NOT-BE-READ")
            link = root / "input" / "escape.png"
            link.symlink_to(secret)

            result = self.provider.validate(_request(("input/escape.png", "input/x.png"), root=root))
            self.assertFalse(result.ok)
            self.assertTrue(any("escapes its root" in e for e in result.errors), result.errors)

    def test_missing_image_is_rejected(self):
        result = self.provider.validate(_request(("input/does-not-exist.png", "input/view_02.png")))
        self.assertFalse(result.ok)
        self.assertTrue(any("does not exist" in e for e in result.errors), result.errors)

    def test_unsupported_format_is_rejected(self):
        fx = resolve_fixture(FIXTURE_ID)
        result = self.provider.validate(
            _request(("input/view_01.png",) + fx.inputs[1:] + ("make_inputs.py",))
        )
        self.assertFalse(result.ok)
        self.assertTrue(any("unsupported image format" in e for e in result.errors), result.errors)

    def test_too_few_inputs_is_rejected(self):
        result = self.provider.validate(_request(("input/view_01.png",)))
        self.assertFalse(result.ok)
        self.assertTrue(any("at least" in e for e in result.errors), result.errors)


class MissingDependencyTests(unittest.TestCase):
    def setUp(self):
        self.provider = OpenCVStitchProvider()
        self._orig = mod._load_cv2
        mod._load_cv2 = self._raise
        self.addCleanup(setattr, mod, "_load_cv2", self._orig)

    @staticmethod
    def _raise():
        raise OpenCVUnavailable("opencv-python-headless is not installed; install extra")

    def test_validate_fails_cleanly_when_cv2_missing(self):
        result = self.provider.validate(_good_request())
        self.assertFalse(result.ok)
        self.assertTrue(any("opencv-python-headless" in e for e in result.errors), result.errors)

    def test_execute_returns_normalized_failure_when_cv2_missing(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            result = self.provider.execute(_good_request(), out)
        from sodar.providers.base import ProviderResult

        self.assertIsInstance(result, ProviderResult)  # normalized, not an exception
        self.assertFalse(result.success)
        self.assertEqual(result.provider_id, "opencv-stitch")
        self.assertTrue(any("opencv-python-headless" in e for e in result.errors), result.errors)


class MockedExecuteTests(unittest.TestCase):
    def setUp(self):
        self.provider = OpenCVStitchProvider()
        self._patches = {
            "_load_cv2": mod._load_cv2,
            "_decode_image": mod._decode_image,
            "_stitch": mod._stitch,
            "_encode_png": mod._encode_png,
        }
        mod._load_cv2 = _fake_cv2
        mod._decode_image = lambda cv2, data: object()
        self.addCleanup(self._restore)

    def _restore(self):
        for name, fn in self._patches.items():
            setattr(mod, name, fn)

    def test_successful_stitch_produces_normalized_artifacts_and_valid_manifest(self):
        mod._stitch = lambda cv2, images: (0, types.SimpleNamespace(shape=(24, 48, 3)))
        mod._encode_png = lambda cv2, image: b"\x89PNG\r\n\x1a\nFAKE-PANORAMA-BYTES"

        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            result = self.provider.execute(_good_request(), out)

            self.assertTrue(result.success, result.errors)
            self.assertTrue((out / "panorama.png").is_file())
            self.assertTrue((out / "stitch_metadata.json").is_file())
            self.assertTrue((out / "output_manifest.json").is_file())

            integrity = inspect_integrity(out, ["panorama.png", "stitch_metadata.json"])
            self.assertTrue(integrity.success, integrity.errors)
            self.assertTrue(integrity.metrics["output_manifest_valid"])
            self.assertEqual(integrity.metrics["artifact_count"], 2)

            self.assertEqual(result.provider_metadata["execution_mode"], "local-compute")
            self.assertIs(result.provider_metadata["deterministic"], False)
            self.assertEqual(result.provider_metadata["panorama"], {
                "filename": "panorama.png", "width": 48, "height": 24,
            })
            self.assertEqual([a.relpath for a in result.artifacts],
                             ["panorama.png", "stitch_metadata.json"])

    def test_non_success_status_produces_normalized_failure(self):
        mod._stitch = lambda cv2, images: (1, None)

        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            result = self.provider.execute(_good_request(), out)

            self.assertFalse(result.success)
            self.assertFalse((out / "panorama.png").exists())
            self.assertTrue((out / "stitch_metadata.json").is_file())
        self.assertTrue(any("ERR_NEED_MORE_IMGS" in e for e in result.errors), result.errors)
        self.assertEqual(result.provider_metadata["stitch_status"], "ERR_NEED_MORE_IMGS")

    def test_unreadable_image_produces_normalized_failure(self):
        mod._decode_image = lambda cv2, data: None
        mod._stitch = lambda cv2, images: (0, types.SimpleNamespace(shape=(1, 1, 3)))

        with tempfile.TemporaryDirectory() as d:
            result = self.provider.execute(_good_request(), Path(d))

        self.assertFalse(result.success)
        self.assertTrue(any("unreadable image" in e for e in result.errors), result.errors)

    def test_run_eval_integration_with_mocked_stitch(self):
        mod._stitch = lambda cv2, images: (0, types.SimpleNamespace(shape=(16, 32, 3)))
        mod._encode_png = lambda cv2, image: b"\x89PNG\r\n\x1a\nX"

        fx = resolve_fixture(FIXTURE_ID)
        with tempfile.TemporaryDirectory() as d:
            outcome = run_eval(self.provider, fx, evals_dir=Path(d))

            self.assertTrue(outcome.success, outcome.result["errors"])
            self.assertEqual(outcome.result["provider_id"], "opencv-stitch")
            self.assertEqual(outcome.result["schema_version"], "eval-result.v1")
            self.assertFalse(outcome.result["provider_metadata"]["deterministic"])
            self.assertTrue((outcome.run_dir / "eval-result.json").is_file())


class EvaluatorStaysAgnosticTests(unittest.TestCase):
    def test_evaluator_sources_mention_no_opencv(self):
        eval_dir = Path(__file__).resolve().parents[1] / "src" / "sodar" / "eval"
        for py in eval_dir.glob("*.py"):
            text = py.read_text(encoding="utf-8").lower()
            for token in ("opencv", "cv2", "stitch", "panorama"):
                self.assertNotIn(token, text, f"{py.name} leaks {token!r}")


def _has_real_cv2() -> bool:
    try:
        import cv2  # noqa: F401,PLC0415
    except ImportError:
        return False
    return True


@unittest.skipUnless(_has_real_cv2(), "opencv-python-headless not installed")
class RealOpenCVTests(unittest.TestCase):
    """Runs the actual native pipeline. Asserts it never crashes and always
    yields a schema-valid, normalized result — success OR normalized failure,
    since a synthetic fixture may not stitch on every OpenCV build."""

    def test_real_run_is_always_normalized_and_schema_valid(self):
        provider = OpenCVStitchProvider()
        fx = resolve_fixture(FIXTURE_ID)
        with tempfile.TemporaryDirectory() as d:
            outcome = run_eval(provider, fx, evals_dir=Path(d))
        result = outcome.result
        self.assertEqual(result["provider_id"], "opencv-stitch")
        self.assertIn(result["success"], (True, False))
        self.assertFalse(result["provider_metadata"]["deterministic"])
        if result["success"]:
            self.assertTrue((outcome.run_dir / "output" / "panorama.png").is_file())
        else:
            self.assertTrue(result["errors"])


if __name__ == "__main__":
    unittest.main()
