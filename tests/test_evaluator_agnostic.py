"""The evaluator must never branch on a specific provider/vendor name."""

import unittest
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parents[1] / "src" / "sodar" / "eval"

# Names that would indicate vendor-specific logic leaking into the evaluator.
FORBIDDEN = ("dummy", "openai", "anthropic", "claude", "codex", "luma", "polycam", "replicate")


class EvaluatorAgnosticTests(unittest.TestCase):
    def test_no_vendor_identifiers_in_evaluator_sources(self):
        offenders = []
        for py in sorted(EVAL_DIR.glob("*.py")):
            text = py.read_text(encoding="utf-8").lower()
            for token in FORBIDDEN:
                if token in text:
                    offenders.append(f"{py.name}: contains {token!r}")
        self.assertEqual(offenders, [], offenders)

    def test_no_provider_identity_branching_in_evaluator_sources(self):
        offenders = []
        for py in sorted(EVAL_DIR.glob("*.py")):
            text = py.read_text(encoding="utf-8").lower()
            for marker in ("provider_id ==", "provider.id ==", "match provider_id"):
                if marker in text:
                    offenders.append(f"{py.name}: contains {marker!r}")
        self.assertEqual(offenders, [], offenders)


if __name__ == "__main__":
    unittest.main()
