"""Pose-guided stitcher: geometry invariants and a tiny end-to-end ring."""

from __future__ import annotations

import json
import math
import tempfile
import unittest
from pathlib import Path

try:
    import numpy as np
    from PIL import Image

    from sodar.stitch.posed import Frame, camera_basis, equirect_directions, stitch
except ImportError:  # numpy/pillow are optional for the harness
    np = None  # type: ignore[assignment]


@unittest.skipIf(np is None, "numpy/pillow not installed")
class CameraBasisTest(unittest.TestCase):
    def test_orthonormal_and_forward_direction(self) -> None:
        for yaw, el, roll in [(0, 0, 0), (90, 0, 0), (45, 30, 10), (270, -20, -5)]:
            r, u, f = camera_basis(yaw, el, roll)
            for v in (r, u, f):
                self.assertAlmostEqual(float(np.linalg.norm(v)), 1.0, places=6)
            self.assertAlmostEqual(float(r @ u), 0.0, places=6)
            self.assertAlmostEqual(float(u @ f), 0.0, places=6)
            self.assertAlmostEqual(float(r @ f), 0.0, places=6)
        _, _, north = camera_basis(0, 0, 0)
        self.assertAlmostEqual(float(north[1]), 1.0, places=6)
        _, _, east = camera_basis(90, 0, 0)
        self.assertAlmostEqual(float(east[0]), 1.0, places=6)
        _, _, up = camera_basis(0, 90, 0)
        self.assertAlmostEqual(float(up[2]), 1.0, places=6)

    def test_equirect_directions_are_unit_and_oriented(self) -> None:
        d = equirect_directions(64, 32)
        self.assertEqual(d.shape, (32, 64, 3))
        self.assertTrue(np.allclose(np.linalg.norm(d, axis=-1), 1.0, atol=1e-6))
        self.assertGreater(float(d[0, :, 2].mean()), 0.9)  # top row looks up
        self.assertLess(float(d[-1, :, 2].mean()), -0.9)  # bottom row looks down
        self.assertAlmostEqual(float(d[16, 32, 1]), 1.0, places=1)  # centre column ≈ north


@unittest.skipIf(np is None, "numpy/pillow not installed")
class StitchRingTest(unittest.TestCase):
    def test_ring_of_solid_frames_covers_only_the_equator_band(self) -> None:
        fov = {"horizontal": 60.0, "vertical": 60.0}
        with tempfile.TemporaryDirectory() as tmp:
            frames = []
            for i in range(8):
                p = Path(tmp) / f"f{i}.png"
                colour = (30 * i % 255, 200 - 20 * i, 90)
                Image.new("RGB", (120, 120), colour).save(p)
                frames.append(Frame(path=p, yaw=i * 45.0, elevation=0.0))
            result = stitch(frames, fov, width=256, refine=False, gain=False)
        self.assertEqual(result.panorama.shape, (128, 256, 3))
        cov = result.coverage
        # 60° vertical FOV → roughly ±30° of the 180° range ≈ a third of the height
        self.assertGreater(cov.mean(), 0.28)
        self.assertLess(cov.mean(), 0.42)
        self.assertFalse(cov[0].any())  # zenith untouched
        self.assertFalse(cov[-1].any())  # nadir untouched
        self.assertTrue(cov[64].all())  # equator fully covered by 8 × 60° with overlap

    def test_frames_json_roundtrip(self) -> None:
        from sodar.stitch.posed import load_frames_json

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            Image.new("RGB", (10, 10)).save(root / "a.jpg")
            Image.new("RGB", (10, 10)).save(root / "b.jpg")
            (root / "frames.json").write_text(json.dumps({"fov": {"horizontal": 50, "vertical": 70}, "frames": [{"file": "a.jpg", "yaw": 10, "pitch": 5}, {"file": "b.jpg", "yaw": 40, "elevation": 2, "roll": 1}]}))
            frames, fov = load_frames_json(root / "frames.json")
        self.assertEqual(fov, {"horizontal": 50.0, "vertical": 70.0})
        self.assertEqual(frames[0].elevation, -5.0)  # pitch → elevation sign flip
        self.assertEqual(frames[1].elevation, 2.0)
        self.assertEqual(frames[1].roll, 1.0)


if __name__ == "__main__":
    unittest.main()
