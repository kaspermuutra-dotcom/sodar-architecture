"""The dummy provider.

Implements the real `Provider` contract exactly, with zero external calls and
fully deterministic output. It exists so the evaluator and CLI can be exercised
end to end before any real vendor adapter is written.

Input contract (the valid fixture supplies this):
  * ``input/scene.json`` — JSON object with a non-empty ``rooms`` array; each
    room has a string ``name`` and an integer ``frames``.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from sodar.providers.base import (
    ArtifactRef,
    Provider,
    ProviderInput,
    ProviderResult,
    ValidationResult,
    artifact_ref,
    sha256_file,
    write_json_deterministic,
    write_output_manifest,
)

_SCENE_FILE = "input/scene.json"

RESULT_FILE = "result.json"
SUMMARY_FILE = "summary.txt"


class DummyProvider(Provider):
    id = "dummy"
    description = "Deterministic local test provider (no external calls)"

    engine_version = "1.0.0"

    # -- validation ------------------------------------------------------------

    def validate(self, request: ProviderInput) -> ValidationResult:
        errors: list[str] = []

        for rel in request.declared_inputs:
            if not request.path(rel).is_file():
                errors.append(f"declared input {rel!r} does not exist")

        scene_path = request.path(_SCENE_FILE)
        if not scene_path.is_file():
            errors.append(f"{_SCENE_FILE}: required input file is missing")
            return ValidationResult.failed(*errors)

        try:
            scene = json.loads(scene_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"{_SCENE_FILE}: invalid JSON: {exc.msg}")
            return ValidationResult.failed(*errors)

        rooms = scene.get("rooms")
        if rooms is None:
            errors.append(f"{_SCENE_FILE}: missing required field 'rooms'")
        elif not isinstance(rooms, list) or not rooms:
            errors.append(f"{_SCENE_FILE}: 'rooms' must be a non-empty array")
        else:
            for i, room in enumerate(rooms):
                if not isinstance(room, dict) or not isinstance(room.get("name"), str):
                    errors.append(f"{_SCENE_FILE}: rooms[{i}] missing string 'name'")
                if not isinstance(room.get("frames"), int) or isinstance(room.get("frames"), bool):
                    errors.append(f"{_SCENE_FILE}: rooms[{i}] missing integer 'frames'")

        return ValidationResult.passed() if not errors else ValidationResult.failed(*errors)

    # -- execution -----------------------------------------------------------

    def execute(self, request: ProviderInput, output_dir: Path) -> ProviderResult:
        started = time.perf_counter()

        scene_path = request.path(_SCENE_FILE)
        scene_bytes = scene_path.read_bytes()
        scene: dict[str, Any] = json.loads(scene_bytes)
        rooms: list[dict[str, Any]] = scene["rooms"]

        room_names = [str(r["name"]) for r in rooms]
        total_frames = sum(int(r["frames"]) for r in rooms)
        input_sha = sha256_file(scene_path)

        result_body = {
            "provider": self.id,
            "fixture_id": request.fixture_id,
            "scene": scene.get("scene"),
            "room_count": len(rooms),
            "rooms": room_names,
            "total_frames": total_frames,
            "input_sha256": input_sha,
        }
        write_json_deterministic(output_dir / RESULT_FILE, result_body)

        summary = (
            f"dummy: processed {len(rooms)} room(s), {total_frames} frame(s) "
            f"from fixture '{request.fixture_id}'\n"
        )
        (output_dir / SUMMARY_FILE).write_text(summary, encoding="utf-8")

        artifacts: list[ArtifactRef] = [
            artifact_ref(output_dir, RESULT_FILE),
            artifact_ref(output_dir, SUMMARY_FILE),
        ]
        write_output_manifest(output_dir, artifacts)

        duration_ms = int((time.perf_counter() - started) * 1000)

        return ProviderResult(
            provider_id=self.id,
            success=True,
            artifacts=tuple(artifacts),
            duration_ms=duration_ms,
            estimated_cost=self._estimated_cost(len(rooms), len(scene_bytes)),
            provider_metadata={
                "engine": self.id,
                "engine_version": self.engine_version,
                "deterministic": True,
                "seeded": True,
                "input_bytes": len(scene_bytes),
                "room_count": len(rooms),
                "total_frames": total_frames,
                "notes": "artifacts derived purely from fixture input; no external calls",
            },
        )

    @staticmethod
    def _estimated_cost(room_count: int, input_bytes: int) -> float:
        """Deterministic fake cost: a flat per-room charge plus a byte charge."""
        return round(0.01 * room_count + 0.000001 * input_bytes, 6)
