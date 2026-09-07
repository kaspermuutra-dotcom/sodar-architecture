"""Capture worker: frame validation, stitch path selection, Supabase side effects, migration invariants.

None of these need numpy, pillow, or cv2: the pose-guided and OpenCV stages are
injected as fakes. The one registration test that exercises real numpy math
skips when numpy is absent (same pattern as ``tests/test_posed_stitch.py``).
"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Same shim as tests/__init__.py: `discover -s tests` loads this module before any
# module that imports the `tests` package, so make src/ importable here explicitly.
if str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))
SPEC = importlib.util.spec_from_file_location("capture_worker", ROOT / "scripts/run_capture_worker.py")
assert SPEC and SPEC.loader
worker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = worker  # dataclasses resolve string annotations via sys.modules[cls.__module__]
SPEC.loader.exec_module(worker)

try:
    import numpy as np
    from PIL import Image
except ImportError:  # optional for the harness
    np = None  # type: ignore[assignment]
    Image = None  # type: ignore[assignment]


def frame(index: int, *, confirmed: bool = True, ring: int = 0, yaw: float | None = None, station: int | None = None, include_station: bool = False) -> dict:
    row = {
        "id": f"frame-{index}", "checkpoint_index": index, "checkpoint_ring": ring,
        "target_yaw": index * 25 if yaw is None else yaw, "target_elevation": 0,
        "yaw": (index * 25 if yaw is None else yaw) + 1.5, "pitch": 4.0, "roll": -0.5,
        "width": 4032, "height": 3024, "mime_type": "image/jpeg",
        "confirmed_at": "2026-09-04T00:00:00Z" if confirmed else None, "byte_size": 4_000_000,
        "fov_horizontal": 55, "fov_vertical": 72, "object_path": f"owner/scan/room/frames/{index}.jpg",
    }
    if include_station or station is not None:
        row["station_index"] = station
    return row


class ValidateFramesTests(unittest.TestCase):
    def test_valid_order_and_overlap(self):
        worker.validate_frames([frame(0), frame(1)])

    def test_gaps_from_retakes_and_skipped_targets_are_allowed(self):
        worker.validate_frames([frame(0), frame(2), frame(7)])

    def test_duplicates_and_disorder_are_rejected(self):
        with self.assertRaisesRegex(worker.WorkerFailure, "duplicated or out of order"):
            worker.validate_frames([frame(1), frame(0)])
        with self.assertRaisesRegex(worker.WorkerFailure, "duplicated or out of order"):
            worker.validate_frames([frame(0), frame(0)])

    def test_frame_count_range_is_2_to_300(self):
        self.assertEqual(worker.MAX_FRAMES, 300)
        worker.validate_frames([frame(i, yaw=(i * 1.2) % 360) for i in range(300)])
        with self.assertRaisesRegex(worker.WorkerFailure, "expected 2–300"):
            worker.validate_frames([frame(i, yaw=(i * 1.2) % 360) for i in range(301)])
        with self.assertRaisesRegex(worker.WorkerFailure, "expected 2–300"):
            worker.validate_frames([frame(0)])

    def test_unconfirmed_upload_is_rejected(self):
        with self.assertRaisesRegex(worker.WorkerFailure, "unconfirmed"):
            worker.validate_frames([frame(0), frame(1, confirmed=False)])

    def test_overlap_checked_for_consecutive_same_ring_same_station(self):
        with self.assertRaisesRegex(worker.WorkerFailure, "declared overlap"):
            worker.validate_frames([frame(0, yaw=0), frame(1, yaw=50)])
        # missing column on both rows counts as the same station
        with self.assertRaisesRegex(worker.WorkerFailure, "declared overlap"):
            worker.validate_frames([frame(0, yaw=0, include_station=True), frame(1, yaw=50, include_station=True)])
        # different ring: no declared-overlap requirement
        worker.validate_frames([frame(0, yaw=0), frame(1, yaw=50, ring=1)])
        # different station: no declared-overlap requirement
        worker.validate_frames([frame(0, yaw=0, station=0), frame(1, yaw=50, station=1)])
        # a gap means the frames were not planned neighbours
        worker.validate_frames([frame(0, yaw=0), frame(2, yaw=50)])


def fake_posed(jpeg: bytes = b"\xff\xd8posed", mask: bytes = b"\x89PNGmask", width: int = 1024):
    def run(poses, fov, output_dir, requested_width):
        run.calls.append((poses, fov, requested_width))
        return worker.PosedOutput(panorama_jpeg=jpeg, mask_png=mask, coverage=0.4321, refined_yaws=False, notes=["posed note"], width=width, height=width // 2, result=None)
    run.calls = []
    return run


class StitchRoomTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.frames = [frame(0), frame(1), frame(3)]
        self.files = ["frame-000.jpg", "frame-001.jpg", "frame-003.jpg"]

    def tearDown(self):
        self.tmp.cleanup()

    def test_poses_use_recorded_orientation_with_elevation_as_negative_pitch(self):
        poses, fov, notes = worker.frame_poses(self.frames, self.root, self.files)
        self.assertEqual(fov, {"horizontal": 55.0, "vertical": 72.0})
        self.assertEqual(poses[1].yaw, 26.5)
        self.assertEqual(poses[1].elevation, -4.0)
        self.assertEqual(poses[1].roll, -0.5)
        self.assertEqual(poses[2].path, self.root / "frame-003.jpg")
        self.assertEqual(notes, [])

    def test_opencv_exception_falls_back_to_posed_result(self):
        posed = fake_posed()

        def refine_raises(root, files, posed_output, work_dir):
            raise RuntimeError("cv::Stitcher exploded")

        # the production refinement wrapper swallows errors; stitch_room must also survive a raising seam
        outcome = worker.stitch_room(self.frames, self.root, self.files, self.root, posed_stitch=posed, refine=lambda *a: (None, ["opencv stitch failed: ERR_NEED_MORE_IMGS"]))
        self.assertEqual(outcome.panorama_jpeg, b"\xff\xd8posed")
        self.assertEqual(outcome.mask_png, b"\x89PNGmask")
        self.assertEqual(outcome.diagnostics["provider"], "posed-stitch")
        self.assertFalse(outcome.diagnostics["refined"])
        self.assertEqual(outcome.diagnostics["coverage"], 0.4321)
        self.assertIn("opencv stitch failed: ERR_NEED_MORE_IMGS", outcome.diagnostics["notes"])
        self.assertIn("posed note", outcome.diagnostics["notes"])
        with self.assertRaises(RuntimeError):
            worker.stitch_room(self.frames, self.root, self.files, self.root, posed_stitch=posed, refine=refine_raises)

    def test_production_refinement_never_raises_without_cv2_or_result(self):
        posed_output = fake_posed()([], {}, self.root, 1024)
        refined, notes = worker.run_opencv_refinement(self.root, self.files, posed_output, self.root)
        self.assertIsNone(refined)
        self.assertTrue(notes and all(isinstance(n, str) for n in notes))

    def test_opencv_success_keeps_posed_mask_and_records_provider(self):
        outcome = worker.stitch_room(self.frames, self.root, self.files, self.root, posed_stitch=fake_posed(), refine=lambda *a: (b"\xff\xd8refined", ["opencv strip placed"]))
        self.assertEqual(outcome.panorama_jpeg, b"\xff\xd8refined")
        self.assertEqual(outcome.mask_png, b"\x89PNGmask")
        self.assertEqual(outcome.diagnostics["provider"], "opencv-stitch+posed")
        self.assertTrue(outcome.diagnostics["refined"])
        self.assertIn("opencv strip placed", outcome.diagnostics["notes"])

    def test_posed_failure_is_a_worker_failure(self):
        def posed_raises(*a):
            raise ValueError("bad frame")

        with self.assertRaisesRegex(worker.WorkerFailure, "pose-guided stitch failed") as ctx:
            worker.stitch_room(self.frames, self.root, self.files, self.root, posed_stitch=posed_raises, refine=lambda *a: (None, []))
        self.assertEqual(ctx.exception.code, "STITCH_FAILED")

    def test_non_2_to_1_posed_output_is_rejected(self):
        def posed_wrong(*a):
            return worker.PosedOutput(b"j", b"m", 0.1, False, [], 1000, 600)

        with self.assertRaisesRegex(worker.WorkerFailure, "non-2:1"):
            worker.stitch_room(self.frames, self.root, self.files, self.root, posed_stitch=posed_wrong, refine=lambda *a: (None, []))

    def test_reflect_padding_helper_is_gone(self):
        self.assertFalse(hasattr(worker, "_make_2_to_1"))
        self.assertNotIn("BORDER_REFLECT", (ROOT / "scripts/run_capture_worker.py").read_text())


@unittest.skipIf(np is None, "numpy not installed")
class RegistrationTests(unittest.TestCase):
    def test_cyclic_shift_recovers_horizontal_roll(self):
        rng = np.random.default_rng(7)
        reference = rng.random((48, 256))
        shifted = np.roll(reference, -37, axis=1)  # candidate is 37 columns to the left of reference
        dx, dy, response = worker.cyclic_shift(reference, shifted)
        self.assertEqual((dx, dy), (37, 0))
        self.assertGreater(response, 0.5)
        self.assertTrue(np.allclose(np.roll(shifted, dx, axis=1), reference))

    def test_compose_refined_places_strip_in_posed_band(self):
        from types import SimpleNamespace

        rng = np.random.default_rng(3)
        height, width = 64, 128
        panorama = np.zeros((height, width, 3), np.uint8)
        coverage = np.zeros((height, width), bool)
        coverage[20:44, :] = True
        panorama[20:44, :] = rng.integers(0, 255, (24, width, 3), dtype=np.uint8)
        posed = SimpleNamespace(panorama=panorama, coverage=coverage)
        strip = np.roll(panorama[20:44], -11, axis=1)  # opencv output with an arbitrary yaw origin
        composed, notes = worker.compose_refined(posed, strip)
        self.assertIsNotNone(composed)
        self.assertEqual(composed.shape, panorama.shape)
        self.assertFalse(composed[:20].any() or composed[44:].any())  # outside coverage stays black
        self.assertTrue(np.array_equal(composed[20:44], panorama[20:44]))
        self.assertTrue(any("yaw offset 11px" in n for n in notes), notes)

    def test_real_posed_path_produces_2_to_1_jpeg_and_png_mask(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = []
            rows = []
            for i in range(8):
                rel = f"frame-{i:03d}.jpg"
                Image.new("RGB", (96, 128), (40 + 20 * i, 90, 160)).save(root / rel, quality=90)
                files.append(rel)
                rows.append({**frame(i, yaw=i * 45.0), "yaw": i * 45.0, "pitch": 0.0, "fov_horizontal": 60, "fov_vertical": 75})
            outcome = worker.stitch_room(rows, root, files, root, width=256, refine=lambda *a: (None, ["cv2 unavailable: pose-based result kept"]))
            self.assertTrue(outcome.panorama_jpeg.startswith(b"\xff\xd8"))
            self.assertTrue(outcome.mask_png.startswith(b"\x89PNG"))
            self.assertEqual((outcome.diagnostics["width"], outcome.diagnostics["height"]), (256, 128))
            self.assertEqual(outcome.diagnostics["provider"], "posed-stitch")
            self.assertGreater(outcome.diagnostics["coverage"], 0.3)
            self.assertLess(outcome.diagnostics["coverage"], 0.6)
            self.assertTrue((root / "posed" / "panorama.jpg").exists())
            self.assertTrue((root / "posed" / "panorama-mask.png").exists())
            import io

            mask = np.asarray(Image.open(io.BytesIO(outcome.mask_png)))
            self.assertEqual(mask.shape, (128, 256))
            self.assertEqual(int(mask[0, 0]), 255)  # zenith uncovered → white
            self.assertEqual(int(mask[64, 128]), 0)  # equator covered → black

    def test_compose_refined_rejects_mismatched_aspect(self):
        from types import SimpleNamespace

        coverage = np.zeros((64, 128), bool)
        coverage[20:44, :] = True
        posed = SimpleNamespace(panorama=np.zeros((64, 128, 3), np.uint8), coverage=coverage)
        composed, notes = worker.compose_refined(posed, np.zeros((100, 100, 3), np.uint8))
        self.assertIsNone(composed)
        self.assertTrue(any("aspect" in n for n in notes), notes)


class FakeSupabase(worker.SupabaseWorker):
    def __init__(self, frames):
        super().__init__("https://example.supabase.co", "service-key-never-logged", "test-worker")
        self.frames, self.patches, self.posts, self.uploads = frames, [], [], []

    def request(self, method, path, body=None, headers=None):
        if method == "GET" and path.startswith("/rest/v1/capture_frames"):
            return self.frames
        if method == "GET" and path.startswith("/rest/v1/rooms"):
            return [{"id": "r"}, {"id": "r2"}]
        if method == "POST":
            self.posts.append((path, body, headers))
            return None
        raise AssertionError(f"unexpected {method} {path}")

    def patch(self, table, query, values):
        self.patches.append((table, query, values))

    def download_frame(self, frame):
        return b"x" * int(frame["byte_size"])

    def upload(self, path, data, content_type):
        self.uploads.append((path, data, content_type))


JOB = {"id": "j", "room_id": "r", "scan_id": "s", "owner_id": "o", "trace_id": "t", "attempts": 1, "max_attempts": 3, "available_at": "2026-09-04T00:00:00Z"}


class SupabaseWorkerTests(unittest.TestCase):
    def test_run_uploads_original_and_mask_and_records_provider_diagnostics(self):
        fake = FakeSupabase([frame(0), frame(1), frame(3)])
        posed = fake_posed()
        original = worker.stitch_room
        worker.stitch_room = lambda frames, root, files, work_dir, **kw: original(frames, root, files, work_dir, posed_stitch=posed, refine=lambda *a: (None, ["cv2 unavailable: pose-based result kept"]), **kw)
        try:
            fake.run(dict(JOB))
        finally:
            worker.stitch_room = original
        self.assertEqual([u[0] for u in fake.uploads], ["o/s/r/panoramas/original.jpg", "o/s/r/panoramas/coverage-mask.png"])
        self.assertEqual([u[2] for u in fake.uploads], ["image/jpeg", "image/png"])
        self.assertEqual(fake.uploads[0][1], b"\xff\xd8posed")
        self.assertEqual(posed.calls[0][2], worker.DEFAULT_PANORAMA_WIDTH)
        self.assertEqual([p.path.name for p in posed.calls[0][0]], ["frame-000.jpg", "frame-001.jpg", "frame-003.jpg"])
        asset_posts = [p for p in fake.posts if p[0].startswith("/rest/v1/panorama_assets")]
        self.assertEqual(len(asset_posts), 1)
        self.assertEqual(asset_posts[0][1]["kind"], "stitched_original")
        self.assertEqual(asset_posts[0][1]["object_path"], "o/s/r/panoramas/original.jpg")
        self.assertEqual((asset_posts[0][1]["width"], asset_posts[0][1]["height"]), (1024, 512))
        self.assertIn("ignore-duplicates", asset_posts[0][2]["Prefer"])
        job_patch = next(v for t, q, v in fake.patches if t == "processing_jobs")
        self.assertEqual(job_patch["status"], "succeeded")
        diag = job_patch["diagnostics"]
        self.assertEqual(diag["provider"], "posed-stitch")
        self.assertFalse(diag["refined"])
        self.assertEqual(diag["coverage"], 0.4321)
        self.assertIn("cv2 unavailable: pose-based result kept", diag["notes"])
        self.assertEqual(diag["coverage_mask"], "o/s/r/panoramas/coverage-mask.png")
        self.assertEqual(next(v for t, q, v in fake.patches if t == "rooms")["status"], "ready")
        self.assertEqual(next(v for t, q, v in fake.patches if t == "scans")["status"], "preview_ready")
        json.dumps(diag)  # diagnostics must be JSON-serialisable for the jsonb column

    def test_upload_tolerates_existing_object(self):
        class Conflicting(worker.SupabaseWorker):
            def request(self, method, path, body=None, headers=None):
                raise worker.WorkerFailure("SUPABASE_REQUEST_FAILED", f"Supabase POST {path} returned 409: exists")

        Conflicting("https://example.supabase.co", "k", "w").upload("o/s/r/panoramas/original.jpg", b"x", "image/jpeg")

        class Failing(worker.SupabaseWorker):
            def request(self, method, path, body=None, headers=None):
                raise worker.WorkerFailure("SUPABASE_REQUEST_FAILED", f"Supabase POST {path} returned 500: boom")

        with self.assertRaises(worker.WorkerFailure):
            Failing("https://example.supabase.co", "k", "w").upload("o/s/r/panoramas/original.jpg", b"x", "image/jpeg")

    def test_failed_stitch_is_retryable_until_attempt_limit(self):
        fake = FakeSupabase([])
        fake.fail(dict(JOB), worker.WorkerFailure("STITCH_FAILED", "no overlap"))
        self.assertEqual(fake.patches[0][2]["status"], "queued")
        self.assertEqual(fake.patches[1][2]["status"], "queued")
        fake = FakeSupabase([])
        fake.fail({**JOB, "attempts": 3}, worker.WorkerFailure("STITCH_FAILED", "no overlap"))
        self.assertEqual(fake.patches[0][2]["status"], "failed")

    def test_log_lines_are_json_without_secrets(self):
        import contextlib
        import io

        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            worker.log("job_claimed", JOB, provider="posed-stitch")
        line = json.loads(buffer.getvalue())
        self.assertEqual(line["event"], "job_claimed")
        self.assertEqual(line["traceId"], "t")
        self.assertNotIn("service-key", buffer.getvalue())


class MigrationTests(unittest.TestCase):
    MIGRATION = ROOT / "supabase/migrations/202609040001_capture_backend.sql"

    @unittest.skipUnless(MIGRATION.exists(), "capture backend migration not present in this checkout")
    def test_migration_has_owner_rls_idempotency_and_safe_claim(self):
        sql = self.MIGRATION.read_text()
        for table in ("scans", "rooms", "capture_frames", "resumable_uploads", "processing_jobs", "panorama_assets", "room_links"):
            self.assertIn(f"alter table public.{table} enable row level security", sql)
        self.assertIn("auth.uid()) = owner_id", sql)
        self.assertIn("idempotency_key text not null unique", sql)
        self.assertIn("for update skip locked", sql)
        self.assertIn("revoke all on function public.claim_stitch_job", sql)


if __name__ == "__main__":
    unittest.main()
