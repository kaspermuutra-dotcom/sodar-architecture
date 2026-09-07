#!/usr/bin/env python3
"""Claim and execute one SODAR room stitch job. Service-role process only.

Output conventions are shared with the browser stitcher (`site/lib/scanner/stitch.ts`)
and the pose-guided stitcher (`src/sodar/stitch/posed.py`):

  * the panorama is always 2:1 equirectangular, longitude 0 at the image centre,
    latitude +90° at the top row, JPEG quality 90;
  * a coverage mask PNG accompanies it, white where nothing was captured;
  * poses come from the `capture_frames` rows: yaw (compass-like, clockwise from
    north), elevation = -pitch, roll about the optical axis, fov_horizontal /
    fov_vertical of the captured frame.

The primary path is pose-guided projection (`sodar.stitch.posed.stitch`), which
works on blank walls and low-texture rooms. OpenCV's feature stitcher is an
optional *refinement*: it only runs when cv2 is importable and the frames carry
enough texture, and any failure falls back to the pose-based result instead of
failing the job. The heavy dependencies (numpy, pillow, cv2) are imported lazily
so the validation and control flow can be exercised without them.

Never logs credentials, signed URLs, or image bytes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import socket
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from sodar.providers.base import ProviderInput

MIN_FRAMES = 2
MAX_FRAMES = 300
MAX_FRAME_BYTES = 25 * 1024 * 1024
DEFAULT_PANORAMA_WIDTH = 4096
JPEG_QUALITY = 90
PROVIDER_POSED = "posed-stitch"
PROVIDER_REFINED = "opencv-stitch+posed"
FRAMES_BUCKET = "capture-originals"
PANORAMA_BUCKET = "panorama-originals"
# Median ORB keypoints per (downscaled) frame below which cv::Stitcher is not even attempted.
MIN_TEXTURE_KEYPOINTS = 120
# Phase-correlation peak response below which the OpenCV strip cannot be placed confidently.
MIN_REGISTRATION_RESPONSE = 0.04


class WorkerFailure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


# --- frame validation ------------------------------------------------------------


def angular_distance(a: dict[str, Any], b: dict[str, Any]) -> float:
    def vector(frame: dict[str, Any]) -> tuple[float, float, float]:
        yaw, elevation = math.radians(frame["target_yaw"]), math.radians(frame["target_elevation"])
        return math.sin(yaw) * math.cos(elevation), math.cos(yaw) * math.cos(elevation), math.sin(elevation)

    av, bv = vector(a), vector(b)
    return math.degrees(math.acos(max(-1.0, min(1.0, sum(x * y for x, y in zip(av, bv))))))


def same_station(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """`station_index` may be absent (older schema) or NULL; both mean "the one station"."""
    return a.get("station_index") == b.get("station_index")


def validate_frames(frames: list[dict[str, Any]]) -> None:
    if not MIN_FRAMES <= len(frames) <= MAX_FRAMES:
        raise WorkerFailure("FRAME_COUNT_INVALID", f"expected {MIN_FRAMES}–{MAX_FRAMES} frames, got {len(frames)}")
    indexes = [int(frame["checkpoint_index"]) for frame in frames]
    # Gaps are legitimate (skipped targets, retakes); duplicates and disorder are not.
    if any(right <= left for left, right in zip(indexes, indexes[1:])):
        raise WorkerFailure("FRAME_ORDER_INVALID", "capture checkpoints are duplicated or out of order")
    dimensions = {(frame["width"], frame["height"]) for frame in frames}
    if len(dimensions) != 1:
        raise WorkerFailure("FRAME_DIMENSIONS_MISMATCH", "all source frames must have identical dimensions")
    if any(frame["mime_type"] != "image/jpeg" or not frame.get("confirmed_at") or int(frame["byte_size"]) > MAX_FRAME_BYTES for frame in frames):
        raise WorkerFailure("FRAME_METADATA_INVALID", "a source frame is unconfirmed, oversized, or not JPEG")
    for left, right in zip(frames, frames[1:]):
        # Declared overlap is only meaningful between planned neighbours: consecutive
        # checkpoints of the same ring, shot from the same station.
        consecutive = int(right["checkpoint_index"]) - int(left["checkpoint_index"]) == 1
        if consecutive and left["checkpoint_ring"] == right["checkpoint_ring"] and same_station(left, right):
            if angular_distance(left, right) >= float(left["fov_horizontal"]) * 0.8:
                raise WorkerFailure("FRAME_OVERLAP_INSUFFICIENT", "adjacent source frames do not have enough declared overlap")


# --- stitching --------------------------------------------------------------------


@dataclass(frozen=True)
class FramePose:
    """One frame's recorded orientation, in the shared convention (elevation = -pitch)."""

    path: Path
    yaw: float
    elevation: float
    roll: float


@dataclass
class PosedOutput:
    """What the pose-guided pass produced: encoded outputs plus the in-memory result for refinement."""

    panorama_jpeg: bytes
    mask_png: bytes
    coverage: float
    refined_yaws: bool
    notes: list[str]
    width: int
    height: int
    result: Any = None  # sodar.stitch.posed.StitchResult when numpy is available


@dataclass
class StitchOutcome:
    panorama_jpeg: bytes
    mask_png: bytes
    diagnostics: dict[str, Any] = field(default_factory=dict)


def frame_poses(frames: list[dict[str, Any]], root: Path, files: list[str]) -> tuple[list[FramePose], dict[str, float], list[str]]:
    poses = [FramePose(path=root / rel, yaw=float(f["yaw"]), elevation=-float(f["pitch"]), roll=float(f.get("roll") or 0.0)) for f, rel in zip(frames, files)]
    fov = {"horizontal": float(frames[0]["fov_horizontal"]), "vertical": float(frames[0]["fov_vertical"])}
    notes: list[str] = []
    if any((float(f["fov_horizontal"]), float(f["fov_vertical"])) != (fov["horizontal"], fov["vertical"]) for f in frames):
        notes.append("frames declare differing fields of view; the first frame's fov was used for every frame")
    return poses, fov, notes


def run_posed_stitch(poses: list[FramePose], fov: dict[str, float], output_dir: Path, width: int) -> PosedOutput:
    """Pose-guided projection; writes `panorama.jpg` + `panorama-mask.png` exactly like `save_outputs`."""
    from sodar.stitch.posed import Frame, save_outputs, stitch  # noqa: PLC0415 - numpy/pillow are worker-only deps

    frames = [Frame(path=p.path, yaw=p.yaw, elevation=p.elevation, roll=p.roll) for p in poses]
    result = stitch(frames, fov, width=width)
    meta = save_outputs(result, output_dir, stem="panorama")
    height, out_width = result.panorama.shape[:2]
    return PosedOutput(
        panorama_jpeg=(output_dir / meta["panorama"]).read_bytes(),
        mask_png=(output_dir / meta["mask"]).read_bytes(),
        coverage=float(meta["coverage"]),
        refined_yaws=bool(meta["refined"]),
        notes=list(meta["notes"]),
        width=int(out_width),
        height=int(height),
        result=result,
    )


def _enough_texture(cv2: Any, np: Any, paths: list[Path], max_dim: int = 800) -> tuple[bool, str]:
    """cv::Stitcher needs ORB features to match; blank walls give it nothing. Median keypoint count decides."""
    from PIL import Image  # noqa: PLC0415

    orb = cv2.ORB_create(nfeatures=500)
    counts = []
    for path in paths:
        with Image.open(path) as im:
            im = im.convert("L")
            im.thumbnail((max_dim, max_dim))
            gray = np.asarray(im, dtype=np.uint8)
        counts.append(len(orb.detect(gray, None)))
    median = float(np.median(counts)) if counts else 0.0
    return median >= MIN_TEXTURE_KEYPOINTS, f"median ORB keypoints per frame {median:.0f} (threshold {MIN_TEXTURE_KEYPOINTS})"


def cyclic_shift(reference: Any, candidate: Any) -> tuple[int, int, float]:
    """Phase correlation between two equally sized 2-D arrays → (dx, dy, response).

    Positive dx means `candidate` must be rolled right by dx columns to line up with
    `reference` (cyclic in x, which is exactly the equirectangular wrap). Pure numpy so
    the placement logic is testable without cv2.
    """
    import numpy as np  # noqa: PLC0415

    a = reference.astype(np.float64) - float(reference.mean())
    b = candidate.astype(np.float64) - float(candidate.mean())
    fa, fb = np.fft.fft2(a), np.fft.fft2(b)
    cross = fa * np.conj(fb)
    magnitude = np.abs(cross)
    magnitude[magnitude == 0] = 1.0
    corr = np.real(np.fft.ifft2(cross / magnitude))
    peak = int(np.argmax(corr))
    dy, dx = divmod(peak, corr.shape[1])
    if dx > corr.shape[1] // 2:
        dx -= corr.shape[1]
    if dy > corr.shape[0] // 2:
        dy -= corr.shape[0]
    # Fraction of the correlation energy in the peak: ~1 for a clean cyclic shift, ~0 for unrelated images.
    response = float(corr.flat[peak]) / max(1e-9, float(np.abs(corr).sum()))
    return int(dx), int(dy), response


def compose_refined(posed_result: Any, refined_rgb: Any) -> tuple[Any | None, list[str]]:
    """Place OpenCV's feature-stitched strip into the pose-based panorama's frame of reference.

    cv::Stitcher returns a crop of the sphere with an arbitrary longitude origin. The
    pose-based coverage tells us *where* on the 2:1 canvas captured pixels belong (the
    band's bounding box); phase correlation against the pose-based pixels recovers the
    cyclic yaw offset. Anything uncertain returns None so the caller keeps the posed result.
    """
    import numpy as np  # noqa: PLC0415

    notes: list[str] = []
    coverage = posed_result.coverage
    height, width = coverage.shape
    rows = np.nonzero(coverage.any(axis=1))[0]
    cols = np.nonzero(coverage.any(axis=0))[0]
    if rows.size == 0 or cols.size == 0:
        return None, ["pose-based coverage is empty; refinement skipped"]
    r0, r1 = int(rows[0]), int(rows[-1]) + 1
    full_ring = cols.size >= width * 0.98
    c0, c1 = (0, width) if full_ring else (int(cols[0]), int(cols[-1]) + 1)
    box_w, box_h = c1 - c0, r1 - r0
    src_h, src_w = refined_rgb.shape[:2]
    aspect_ratio = (src_w / src_h) / (box_w / box_h)
    if not 0.75 <= aspect_ratio <= 1.33:
        return None, [f"opencv strip aspect {src_w}x{src_h} does not match the pose-based band {box_w}x{box_h}; refinement discarded"]

    from PIL import Image  # noqa: PLC0415

    strip = np.asarray(Image.fromarray(refined_rgb).resize((box_w, box_h), Image.LANCZOS), dtype=np.uint8)
    band = posed_result.panorama[r0:r1, c0:c1]
    # register on downscaled luminance
    scale = max(1, box_w // 512)
    to_gray = lambda rgb: rgb[::scale, ::scale].astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)  # noqa: E731
    dx, dy, response = cyclic_shift(to_gray(band), to_gray(strip))
    dx, dy = dx * scale, dy * scale
    if response < MIN_REGISTRATION_RESPONSE:
        return None, [f"opencv strip could not be registered to the pose-based panorama (response {response:.3f}); refinement discarded"]
    if abs(dy) > box_h * 0.1:
        return None, [f"opencv strip is vertically offset by {dy}px from the pose-based band; refinement discarded"]
    if full_ring:
        strip = np.roll(strip, dx, axis=1)
    elif dx:
        notes.append(f"partial ring: horizontal offset {dx}px ignored")
    out = np.zeros_like(posed_result.panorama)
    out[r0:r1, c0:c1] = strip
    # keep captured pixels only: outside the pose-based coverage stays black, like the browser stitcher
    out[~coverage] = 0
    notes.append(f"opencv strip {src_w}x{src_h} placed at rows {r0}-{r1}, cols {c0}-{c1}, yaw offset {dx}px, response {response:.3f}")
    return out, notes


def run_opencv_refinement(root: Path, files: list[str], posed: PosedOutput, work_dir: Path) -> tuple[bytes | None, list[str]]:
    """Optional feature-based refinement. Returns (jpeg bytes, notes) or (None, notes) — never raises."""
    notes: list[str] = []
    try:
        import cv2  # noqa: PLC0415
        import numpy as np  # noqa: PLC0415
    except Exception:
        return None, ["cv2 unavailable: pose-based result kept"]
    if posed.result is None:
        return None, ["pose-based result unavailable in memory: refinement skipped"]
    try:
        textured, texture_note = _enough_texture(cv2, np, [root / rel for rel in files])
        notes.append(texture_note)
        if not textured:
            notes.append("insufficient texture for feature stitching: pose-based result kept")
            return None, notes
        from sodar.providers.opencv_stitch import PANORAMA_FILE as OPENCV_PANORAMA, OpenCVStitchProvider  # noqa: PLC0415

        provider = OpenCVStitchProvider()
        request = ProviderInput("refine", root, tuple(files))
        validation = provider.validate(request)
        if not validation.ok:
            notes.append("opencv validation failed: " + "; ".join(validation.errors))
            return None, notes
        out_dir = work_dir / "opencv"
        out_dir.mkdir(exist_ok=True)
        result = provider.execute(request, out_dir)
        if not result.success:
            notes.append("opencv stitch failed: " + "; ".join(result.errors))
            return None, notes
        bgr = cv2.imread(str(out_dir / OPENCV_PANORAMA))
        if bgr is None:
            notes.append("opencv panorama unreadable: pose-based result kept")
            return None, notes
        composed, compose_notes = compose_refined(posed.result, cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        notes.extend(compose_notes)
        if composed is None:
            return None, notes
        from PIL import Image  # noqa: PLC0415
        import io  # noqa: PLC0415

        buffer = io.BytesIO()
        Image.fromarray(composed).save(buffer, "JPEG", quality=JPEG_QUALITY, optimize=True)
        return buffer.getvalue(), notes
    except Exception as exc:  # noqa: BLE001 - refinement must never fail the job
        notes.append(f"opencv refinement raised {type(exc).__name__}: pose-based result kept")
        return None, notes


PosedStitchFn = Callable[[list[FramePose], dict[str, float], Path, int], PosedOutput]
RefineFn = Callable[[Path, list[str], PosedOutput, Path], tuple[bytes | None, list[str]]]


def stitch_room(
    frames: list[dict[str, Any]],
    root: Path,
    files: list[str],
    work_dir: Path,
    *,
    width: int = DEFAULT_PANORAMA_WIDTH,
    posed_stitch: PosedStitchFn = run_posed_stitch,
    refine: RefineFn = run_opencv_refinement,
) -> StitchOutcome:
    """Pose-guided panorama first, OpenCV refinement if it can be trusted; always 2:1 + coverage mask."""
    started = time.perf_counter()
    poses, fov, notes = frame_poses(frames, root, files)
    output = work_dir / "posed"
    output.mkdir(parents=True, exist_ok=True)
    try:
        posed = posed_stitch(poses, fov, output, width)
    except Exception as exc:
        raise WorkerFailure("STITCH_FAILED", f"pose-guided stitch failed: {type(exc).__name__}: {exc}") from exc
    if posed.width != posed.height * 2:
        raise WorkerFailure("STITCH_FAILED", f"pose-guided stitch produced a non-2:1 panorama ({posed.width}x{posed.height})")
    notes.extend(posed.notes)
    refined_jpeg, refine_notes = refine(root, files, posed, work_dir)
    notes.extend(refine_notes)
    panorama = refined_jpeg if refined_jpeg is not None else posed.panorama_jpeg
    diagnostics = {
        "provider": PROVIDER_REFINED if refined_jpeg is not None else PROVIDER_POSED,
        "refined": refined_jpeg is not None,
        "coverage": round(posed.coverage, 4),
        "notes": notes,
        "pose_refined_yaws": posed.refined_yaws,
        "width": posed.width,
        "height": posed.height,
        "input_frames": len(frames),
        "duration_ms": int((time.perf_counter() - started) * 1000),
    }
    return StitchOutcome(panorama_jpeg=panorama, mask_png=posed.mask_png, diagnostics=diagnostics)


# --- Supabase ---------------------------------------------------------------------


class SupabaseWorker:
    def __init__(self, url: str, service_key: str, worker_id: str):
        self.url, self.key, self.worker_id = url.rstrip("/"), service_key, worker_id
        self.panorama_width = int(os.getenv("SODAR_PANORAMA_WIDTH", DEFAULT_PANORAMA_WIDTH))

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        return {"apikey": self.key, "Authorization": f"Bearer {self.key}", **(extra or {})}

    def request(self, method: str, path: str, body: Any = None, headers: dict[str, str] | None = None) -> Any:
        data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        request = urllib.request.Request(f"{self.url}{path}", data=data, method=method, headers=self._headers({"Content-Type": "application/json", **(headers or {})}))
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            # The message carries the REST path and the error body only — never headers or keys.
            raise WorkerFailure("SUPABASE_REQUEST_FAILED", f"Supabase {method} {path} returned {exc.code}: {exc.read().decode(errors='replace')[:500]}") from exc

    def claim(self) -> dict[str, Any] | None:
        rows = self.request("POST", "/rest/v1/rpc/claim_stitch_job", {"p_worker_id": self.worker_id, "p_visibility_seconds": 300})
        return rows[0] if rows else None

    def health(self) -> dict[str, Any]:
        jobs = self.request("GET", "/rest/v1/processing_jobs?select=status")
        counts = {status: 0 for status in ("queued", "running", "failed")}
        for job in jobs:
            if job["status"] in counts:
                counts[job["status"]] += 1
        return {"status": "ok", "workerId": self.worker_id, "jobs": counts}

    def patch(self, table: str, query: str, values: dict[str, Any]) -> None:
        self.request("PATCH", f"/rest/v1/{table}?{query}", values, {"Prefer": "return=minimal"})

    def download_frame(self, frame: dict[str, Any]) -> bytes:
        encoded = urllib.parse.quote(frame["object_path"], safe="/")
        req = urllib.request.Request(f"{self.url}/storage/v1/object/authenticated/{FRAMES_BUCKET}/{encoded}", headers=self._headers())
        with urllib.request.urlopen(req, timeout=120) as response:
            return response.read()

    def upload(self, path: str, data: bytes, content_type: str) -> None:
        """Idempotent: objects are immutable, so an existing object (409) is success."""
        encoded = urllib.parse.quote(path, safe="/")
        try:
            self.request("POST", f"/storage/v1/object/{PANORAMA_BUCKET}/{encoded}", data, {"Content-Type": content_type, "x-upsert": "false"})
        except WorkerFailure as exc:
            if "returned 409" not in str(exc):
                raise

    def fail(self, job: dict[str, Any], failure: WorkerFailure) -> None:
        retry = job["attempts"] < job["max_attempts"]
        now = datetime.now(timezone.utc).isoformat()
        self.patch("processing_jobs", f"id=eq.{job['id']}", {"status": "queued" if retry else "failed", "failure_code": failure.code, "failure_message": str(failure), "available_at": now if retry else job["available_at"], "finished_at": None if retry else now, "diagnostics": {"retryable": retry}})
        self.patch("rooms", f"id=eq.{job['room_id']}", {"status": "queued" if retry else "failed", "failure_code": failure.code, "failure_message": str(failure)})
        log("job_failed", job, code=failure.code, retryable=retry)

    def run(self, job: dict[str, Any]) -> None:
        frames = self.request("GET", f"/rest/v1/capture_frames?room_id=eq.{job['room_id']}&select=*&order=checkpoint_index.asc")
        validate_frames(frames)
        with tempfile.TemporaryDirectory(prefix="sodar-stitch-") as tmp:
            root = Path(tmp) / "frames"
            root.mkdir()
            files: list[str] = []
            for frame in frames:
                rel = f"frame-{int(frame['checkpoint_index']):03d}.jpg"
                data = self.download_frame(frame)
                if len(data) != int(frame["byte_size"]):
                    raise WorkerFailure("FRAME_DOWNLOAD_SIZE_MISMATCH", f"frame {frame['id']} size changed")
                (root / rel).write_bytes(data)
                files.append(rel)
            log("frames_downloaded", job, count=len(files))
            outcome = stitch_room(frames, root, files, Path(tmp), width=self.panorama_width)

        prefix = f"{job['owner_id']}/{job['scan_id']}/{job['room_id']}/panoramas"
        original_path, mask_path = f"{prefix}/original.jpg", f"{prefix}/coverage-mask.png"
        self.upload(original_path, outcome.panorama_jpeg, "image/jpeg")
        self.upload(mask_path, outcome.mask_png, "image/png")
        digest = hashlib.sha256(outcome.panorama_jpeg).hexdigest()
        asset = {
            "scan_id": job["scan_id"], "room_id": job["room_id"], "job_id": job["id"], "owner_id": job["owner_id"],
            "kind": "stitched_original", "bucket_id": PANORAMA_BUCKET, "object_path": original_path,
            "width": outcome.diagnostics["width"], "height": outcome.diagnostics["height"],
            "byte_size": len(outcome.panorama_jpeg), "sha256": digest, "immutable": True, "trace_id": job["trace_id"],
        }
        self.request("POST", "/rest/v1/panorama_assets?on_conflict=room_id,kind", asset, {"Prefer": "resolution=ignore-duplicates,return=minimal"})
        diagnostics = {**outcome.diagnostics, "sha256": digest, "coverage_mask": mask_path}
        now = datetime.now(timezone.utc).isoformat()
        self.patch("processing_jobs", f"id=eq.{job['id']}", {"status": "succeeded", "finished_at": now, "diagnostics": diagnostics, "failure_code": None, "failure_message": None})
        self.patch("rooms", f"id=eq.{job['room_id']}", {"status": "ready", "failure_code": None, "failure_message": None})
        ready_rooms = self.request("GET", f"/rest/v1/rooms?scan_id=eq.{job['scan_id']}&status=eq.ready&select=id")
        self.patch("scans", f"id=eq.{job['scan_id']}", {"status": "preview_ready" if len(ready_rooms) >= 2 else "processing", "updated_at": now})
        log("job_succeeded", job, panorama=original_path, provider=diagnostics["provider"], refined=diagnostics["refined"], coverage=diagnostics["coverage"], duration_ms=diagnostics["duration_ms"], input_frames=diagnostics["input_frames"], sha256=digest)


def log(event: str, job: dict[str, Any], **fields: Any) -> None:
    print(json.dumps({"level": "info", "event": event, "traceId": job.get("trace_id"), "scanId": job.get("scan_id"), "roomId": job.get("room_id"), "jobId": job.get("id"), **fields}, sort_keys=True), flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="SODAR capture stitch worker")
    parser.add_argument("command", nargs="?", choices=("run-once", "health", "status"), default="run-once")
    args = parser.parse_args()
    url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required", flush=True)
        return 2
    worker = SupabaseWorker(url, key, os.getenv("SODAR_WORKER_ID", socket.gethostname()))
    if args.command in ("health", "status"):
        print(json.dumps(worker.health(), sort_keys=True), flush=True)
        return 0
    job = worker.claim()
    if not job:
        print(json.dumps({"level": "info", "event": "queue_empty"}), flush=True)
        return 0
    log("job_claimed", job)
    try:
        worker.run(job)
    except WorkerFailure as failure:
        worker.fail(job, failure)
        return 1
    except Exception as exc:  # noqa: BLE001 - always record the failure on the job
        worker.fail(job, WorkerFailure("WORKER_INTERNAL_ERROR", f"{type(exc).__name__}: {exc}"))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
