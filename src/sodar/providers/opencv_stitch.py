"""OpenCV panorama-stitching provider.

Wraps OpenCV's high-level ``cv2.Stitcher`` (the ``stitching`` module, part of
OpenCV's *main* modules — no opencv_contrib needed) behind the neutral
`Provider` contract.

Execution mode: ``local-compute``. Runs entirely on the local machine with no
network access, but the panorama pixels come from an iterative native pipeline
(ORB features, RANSAC homography, bundle adjustment, multi-band blending) whose
output is **not byte-reproducible** across OpenCV versions or platforms. The
adapter therefore sets ``provider_metadata["deterministic"] = False``. Harness
determinism (run isolation, structural integrity metrics) is unaffected.

OpenCV is an **optional** dependency (`pip install sodar-harness[opencv]`, which
pulls ``opencv-python-headless``). It is imported lazily: importing this module,
listing providers, or running any other provider never imports ``cv2``. When the
dependency is absent, `validate()` returns a normalized failure and `execute()`
returns a normalized failure `ProviderResult` — never an ImportError.

Upstream references are recorded in ``docs/HARNESS_NOTES.md``.

Input contract: the fixture's declared inputs are treated as the ordered set of
images to stitch, in manifest order. Supported formats: PNG, JPEG.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from sodar.providers.base import (
    ArtifactRef,
    PathContainmentError,
    Provider,
    ProviderInput,
    ProviderResult,
    ValidationResult,
    artifact_ref,
    contained_path,
    write_json_deterministic,
    write_output_manifest,
)

PANORAMA_FILE = "panorama.png"
METADATA_FILE = "stitch_metadata.json"

ADAPTER_VERSION = "0.1.0"
SUPPORTED_SUFFIXES = (".png", ".jpg", ".jpeg")
MIN_IMAGES = 2

# cv::Stitcher::Status — stable integers across OpenCV 4.x.
_STATUS: dict[int, tuple[str, str]] = {
    0: ("OK", "panorama composed"),
    1: ("ERR_NEED_MORE_IMGS", "not enough images or insufficient overlap between them"),
    2: ("ERR_HOMOGRAPHY_EST_FAIL", "could not estimate homography between images"),
    3: ("ERR_CAMERA_PARAMS_ADJUST_FAIL", "bundle adjustment of camera parameters failed"),
}


class OpenCVUnavailable(Exception):
    """The optional ``opencv-python-headless`` dependency is not importable."""


class _AdapterError(Exception):
    """Internal: an input-reading problem to be normalized into a failure result."""


def _status_name(status_code: int | None) -> str:
    if status_code is None:
        return "NOT_RUN"
    return _STATUS.get(status_code, ("UNKNOWN", ""))[0]


# --- seams (kept tiny so tests can substitute fakes) -------------------------


def _load_cv2() -> Any:
    try:
        import cv2  # noqa: PLC0415 - intentional lazy import
    except ImportError as exc:  # pragma: no cover - exercised via monkeypatch
        raise OpenCVUnavailable(
            "opencv-python-headless is not installed; "
            "install the optional extra: pip install 'sodar-harness[opencv]'"
        ) from exc
    return cv2


def _decode_image(cv2: Any, data: bytes) -> Any | None:
    import numpy as np  # noqa: PLC0415 - lazy; numpy ships with opencv-python-headless

    buffer = np.frombuffer(data, dtype=np.uint8)
    return cv2.imdecode(buffer, cv2.IMREAD_COLOR)


def _stitch(cv2: Any, images: list[Any]) -> tuple[int, Any | None]:
    stitcher = cv2.Stitcher_create(cv2.Stitcher_PANORAMA)
    status, pano = stitcher.stitch(images)
    return int(status), pano


def _encode_png(cv2: Any, image: Any) -> bytes:
    ok, buffer = cv2.imencode(".png", image)
    if not ok:
        raise RuntimeError("cv2.imencode failed to encode the panorama as PNG")
    return bytes(buffer.tobytes())


# --- provider ---------------------------------------------------------------


class OpenCVStitchProvider(Provider):
    id = "opencv-stitch"
    description = "OpenCV panorama stitching (optional dependency: opencv-python-headless)"

    # -- validation ---------------------------------------------------------

    def validate(self, request: ProviderInput) -> ValidationResult:
        errors: list[str] = []

        ordered = list(request.declared_inputs)
        if len(ordered) < MIN_IMAGES:
            errors.append(
                f"need at least {MIN_IMAGES} declared image inputs, got {len(ordered)}"
            )

        for rel in ordered:
            try:
                resolved = contained_path(request.fixture_root, rel)
            except PathContainmentError as exc:
                errors.append(str(exc))
                continue
            if not resolved.is_file():
                errors.append(f"input image does not exist: {rel!r}")
                continue
            if resolved.suffix.lower() not in SUPPORTED_SUFFIXES:
                errors.append(
                    f"unsupported image format {resolved.suffix!r} for {rel!r}; "
                    f"supported: {', '.join(SUPPORTED_SUFFIXES)}"
                )

        if errors:
            return ValidationResult.failed(*errors)

        try:
            _load_cv2()
        except OpenCVUnavailable as exc:
            return ValidationResult.failed(str(exc))

        return ValidationResult.passed()

    # -- execution --------------------------------------------------------

    def execute(self, request: ProviderInput, output_dir: Path) -> ProviderResult:
        started = time.perf_counter()
        ordered = list(request.declared_inputs)

        try:
            cv2 = _load_cv2()
        except OpenCVUnavailable as exc:
            return self._failure(output_dir, ordered, None, [str(exc)], started)

        try:
            images, total_bytes = self._read_images(cv2, request, ordered)
        except _AdapterError as exc:
            return self._failure(output_dir, ordered, cv2, [str(exc)], started)

        try:
            status_code, pano = _stitch(cv2, images)
        except Exception as exc:  # noqa: BLE001 - normalize any native error
            return self._failure(
                output_dir, ordered, cv2, [f"opencv stitch raised: {type(exc).__name__}: {exc}"],
                started,
            )

        name, meaning = _STATUS.get(status_code, ("UNKNOWN", "unrecognized stitcher status code"))
        if status_code != 0 or pano is None:
            return self._failure(
                output_dir, ordered, cv2,
                [f"opencv stitch failed: {name} (code {status_code}): {meaning}"],
                started, status_code=status_code, total_input_bytes=total_bytes,
            )

        try:
            png_bytes = _encode_png(cv2, pano)
        except Exception as exc:  # noqa: BLE001
            return self._failure(
                output_dir, ordered, cv2, [f"panorama encode failed: {exc}"], started,
                status_code=status_code, total_input_bytes=total_bytes,
            )

        (output_dir / PANORAMA_FILE).write_bytes(png_bytes)
        height, width = int(pano.shape[0]), int(pano.shape[1])

        meta = self._metadata(
            cv2, ordered, status_code=status_code,
            output={"filename": PANORAMA_FILE, "width": width, "height": height},
        )
        write_json_deterministic(output_dir / METADATA_FILE, meta)

        artifacts: list[ArtifactRef] = [
            artifact_ref(output_dir, PANORAMA_FILE),
            artifact_ref(output_dir, METADATA_FILE),
        ]
        write_output_manifest(output_dir, artifacts)

        return ProviderResult(
            provider_id=self.id,
            success=True,
            artifacts=tuple(artifacts),
            duration_ms=int((time.perf_counter() - started) * 1000),
            estimated_cost=self._estimated_cost(len(images), total_bytes),
            provider_metadata=self._provider_metadata(
                cv2, ordered, status_code=status_code,
                panorama={"filename": PANORAMA_FILE, "width": width, "height": height},
            ),
        )

    # -- helpers ---------------------------------------------------------

    def _read_images(
        self, cv2: Any, request: ProviderInput, ordered: list[str]
    ) -> tuple[list[Any], int]:
        images: list[Any] = []
        total_bytes = 0
        for rel in ordered:
            try:
                resolved = contained_path(request.fixture_root, rel)
            except PathContainmentError as exc:
                raise _AdapterError(str(exc)) from exc
            if not resolved.is_file():
                raise _AdapterError(f"input image does not exist: {rel!r}")
            data = resolved.read_bytes()
            total_bytes += len(data)
            decoded = _decode_image(cv2, data)
            if decoded is None:
                raise _AdapterError(f"unreadable image (cv2.imdecode returned None): {rel!r}")
            images.append(decoded)
        return images, total_bytes

    def _failure(
        self,
        output_dir: Path,
        ordered: list[str],
        cv2: Any | None,
        errors: list[str],
        started: float,
        *,
        status_code: int | None = None,
        total_input_bytes: int = 0,
    ) -> ProviderResult:
        meta = self._metadata(cv2, ordered, status_code=status_code, output=None)
        write_json_deterministic(output_dir / METADATA_FILE, meta)
        artifacts = [artifact_ref(output_dir, METADATA_FILE)]
        write_output_manifest(output_dir, artifacts)
        return ProviderResult(
            provider_id=self.id,
            success=False,
            artifacts=tuple(artifacts),
            duration_ms=int((time.perf_counter() - started) * 1000),
            estimated_cost=self._estimated_cost(len(ordered), total_input_bytes),
            provider_metadata=self._provider_metadata(
                cv2, ordered, status_code=status_code, panorama=None
            ),
            errors=tuple(errors),
        )

    def _metadata(
        self, cv2: Any | None, ordered: list[str], *, status_code: int | None, output: Any
    ) -> dict[str, Any]:
        return {
            "adapter": self.id,
            "adapter_version": ADAPTER_VERSION,
            "opencv_version": getattr(cv2, "__version__", None),
            "mode": "PANORAMA",
            "ordered_inputs": list(ordered),
            "status": _status_name(status_code),
            "status_code": status_code,
            "output": output,
        }

    def _provider_metadata(
        self, cv2: Any | None, ordered: list[str], *, status_code: int | None, panorama: Any
    ) -> dict[str, Any]:
        return {
            "adapter": self.id,
            "adapter_version": ADAPTER_VERSION,
            "execution_mode": "local-compute",
            "deterministic": False,
            "opencv_version": getattr(cv2, "__version__", None),
            "stitch_mode": "PANORAMA",
            "stitch_status": _status_name(status_code),
            "stitch_status_code": status_code,
            "image_count": len(ordered),
            "ordered_inputs": list(ordered),
            "panorama": panorama,
            "notes": (
                "OpenCV stitching output is not byte-reproducible across library "
                "versions or platforms; estimated_cost is a synthetic local-compute "
                "estimate, not a price."
            ),
        }

    @staticmethod
    def _estimated_cost(image_count: int, total_input_bytes: int) -> float:
        """Synthetic local-compute estimate: per-image plus a per-megabyte term."""
        return round(0.02 * image_count + 0.05 * (total_input_bytes / 1_000_000), 6)
