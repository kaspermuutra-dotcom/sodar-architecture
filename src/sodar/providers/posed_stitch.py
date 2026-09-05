"""Pose-guided stitching provider (Photo Sphere's method).

Wraps `sodar.stitch.posed` behind the `Provider` contract. Input contract:
``input/frames.json`` (the scanner's export manifest — flat or multi-room) plus
every frame image it references, all declared as fixture inputs.

Execution mode: ``local-compute``. Pure numpy projection is deterministic; the
optional ORB yaw refinement (only when ``cv2`` is importable) is not
byte-reproducible across OpenCV versions, so ``deterministic`` is reported as
``False`` whenever refinement actually ran.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

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

FRAMES_FILE = "input/frames.json"
PANORAMA_FILE = "panorama.jpg"
MASK_FILE = "panorama-mask.png"
METADATA_FILE = "stitch_metadata.json"
ADAPTER_VERSION = "0.1.0"


class PosedStitchProvider(Provider):
    id = "posed-stitch"
    description = "Pose-guided equirectangular stitching from scanner frames + orientations (numpy; ORB refine if OpenCV present)"

    def validate(self, request: ProviderInput) -> ValidationResult:
        try:
            import numpy  # noqa: F401, PLC0415
            from PIL import Image  # noqa: F401, PLC0415
        except Exception:
            return ValidationResult.failed("numpy and pillow are required: pip install numpy pillow")
        if FRAMES_FILE not in request.declared_inputs:
            return ValidationResult.failed(f"fixture must declare {FRAMES_FILE}")
        try:
            manifest = contained_path(request.fixture_root, FRAMES_FILE)
            data = json.loads(manifest.read_text())
            room = data["rooms"][0] if "rooms" in data else data
            frames = room.get("frames", [])
            if len(frames) < 2:
                return ValidationResult.failed("frames.json must list at least two frames")
            for f in frames:
                rel = f["file"]
                if rel not in request.declared_inputs:
                    return ValidationResult.failed(f"frame {rel!r} is not a declared input")
                contained_path(request.fixture_root, rel)
        except (PathContainmentError, KeyError, ValueError, OSError) as exc:
            return ValidationResult.failed(f"invalid frames.json: {exc}")
        return ValidationResult.passed()

    def execute(self, request: ProviderInput, output_dir: Path) -> ProviderResult:
        from sodar.stitch.posed import load_frames_json, save_outputs, stitch  # noqa: PLC0415

        started = time.perf_counter()
        output_dir.mkdir(parents=True, exist_ok=True)
        try:
            frames, fov = load_frames_json(contained_path(request.fixture_root, FRAMES_FILE), root=request.fixture_root)
            result = stitch(frames, fov, width=2048)
            meta = save_outputs(result, output_dir, stem="panorama")
        except Exception as exc:  # normalized failure, never a traceback
            return ProviderResult(provider_id=self.id, success=False, errors=(f"stitch failed: {exc}",), provider_metadata={"execution_mode": "local-compute", "adapter_version": ADAPTER_VERSION})
        metadata = {"adapter_version": ADAPTER_VERSION, "frames": len(frames), "fov": fov, **meta}
        write_json_deterministic(output_dir / METADATA_FILE, metadata)
        artifacts = [artifact_ref(output_dir, PANORAMA_FILE), artifact_ref(output_dir, MASK_FILE), artifact_ref(output_dir, METADATA_FILE)]
        artifacts.append(write_output_manifest(output_dir, artifacts))
        return ProviderResult(
            provider_id=self.id,
            success=True,
            artifacts=tuple(artifacts),
            duration_ms=int((time.perf_counter() - started) * 1000),
            estimated_cost=0.0,
            provider_metadata={"execution_mode": "local-compute", "deterministic": not result.refined, "adapter_version": ADAPTER_VERSION, "coverage": meta["coverage"], "refined": result.refined},
        )
