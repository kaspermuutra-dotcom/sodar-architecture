"""Deterministic, provider-agnostic harness metrics for eval-result.v1.

These say nothing about reconstruction or image quality — only about what the
provider wrote to disk and whether it matches its own manifest and the
fixture's declared expectations. Real reconstruction metrics come later, in a
separate layer.

Nothing here branches on provider identity.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sodar.providers.base import OUTPUT_MANIFEST_NAME, OUTPUT_MANIFEST_VERSION


@dataclass(frozen=True)
class IntegrityResult:
    metrics: dict[str, Any]
    errors: tuple[str, ...]

    @property
    def success(self) -> bool:
        return not self.errors


def _safe_path(root: Path, relpath: str) -> tuple[Path | None, str | None]:
    candidate = Path(relpath)
    if candidate.is_absolute():
        return None, f"absolute artifact path is not allowed: {relpath!r}"
    if ".." in candidate.parts:
        return None, f"parent traversal is not allowed: {relpath!r}"

    resolved_root = root.resolve()
    resolved = (root / candidate).resolve(strict=False)
    if not resolved.is_relative_to(resolved_root):
        return None, f"artifact path escapes output directory: {relpath!r}"
    return resolved, None


def _iter_files(root: Path) -> list[Path]:
    files: list[Path] = []
    resolved_root = root.resolve()
    for path in root.rglob("*"):
        resolved = path.resolve(strict=False)
        if resolved.is_relative_to(resolved_root) and resolved.is_file():
            files.append(resolved)
    return sorted(files)


def _sha256(path: Path) -> str:
    import hashlib

    return hashlib.sha256(path.read_bytes()).hexdigest()


def _inspect_output_manifest(output_dir: Path) -> list[str]:
    errors: list[str] = []
    manifest_path, path_error = _safe_path(output_dir, OUTPUT_MANIFEST_NAME)
    if path_error:
        return [path_error]
    assert manifest_path is not None
    if not manifest_path.is_file():
        return [f"missing {OUTPUT_MANIFEST_NAME}"]
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"invalid {OUTPUT_MANIFEST_NAME}: {exc}"]
    if not isinstance(manifest, dict):
        return [f"invalid {OUTPUT_MANIFEST_NAME}: root must be an object"]
    if manifest.get("manifest_version") != OUTPUT_MANIFEST_VERSION:
        errors.append(
            f"invalid {OUTPUT_MANIFEST_NAME}: manifest_version must be "
            f"{OUTPUT_MANIFEST_VERSION!r}"
        )
    entries = manifest.get("artifacts")
    if not isinstance(entries, list):
        errors.append(f"invalid {OUTPUT_MANIFEST_NAME}: artifacts must be an array")
        return errors
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            errors.append(f"invalid manifest artifact {index}: entry must be an object")
            continue
        relpath = entry.get("relpath")
        if not isinstance(relpath, str) or not relpath:
            errors.append(f"invalid manifest artifact {index}: relpath must be a non-empty string")
            continue
        target, path_error = _safe_path(output_dir, relpath)
        if path_error:
            errors.append(path_error)
            continue
        assert target is not None
        if not target.is_file():
            errors.append(f"declared artifact does not exist: {relpath!r}")
            continue
        if "bytes" in entry:
            byte_count = entry["bytes"]
            if not isinstance(byte_count, int) or isinstance(byte_count, bool) or byte_count < 0:
                errors.append(f"invalid byte count for artifact: {relpath!r}")
            elif byte_count != target.stat().st_size:
                errors.append(f"byte count mismatch for artifact: {relpath!r}")
        if "sha256" in entry:
            checksum = entry["sha256"]
            if not isinstance(checksum, str) or len(checksum) != 64:
                errors.append(f"invalid sha256 for artifact: {relpath!r}")
            elif checksum != _sha256(target):
                errors.append(f"checksum mismatch for artifact: {relpath!r}")
    return errors


def inspect_integrity(output_dir: Path, expected_artifacts: list[str]) -> IntegrityResult:
    files = _iter_files(output_dir)
    manifest_path = (output_dir / OUTPUT_MANIFEST_NAME).resolve(strict=False)

    payload_files = [p for p in files if p != manifest_path]
    total_bytes = sum(p.stat().st_size for p in files)

    manifest_errors = _inspect_output_manifest(output_dir)
    errors = list(manifest_errors)
    expected_present = True
    for name in expected_artifacts:
        target, path_error = _safe_path(output_dir, name)
        if path_error:
            errors.append(f"unsafe expected artifact: {path_error}")
            expected_present = False
        elif target is None or not target.is_file():
            errors.append(f"missing expected artifact: {name!r}")
            expected_present = False

    metrics = {
        "artifact_count": len(payload_files),
        "total_output_bytes": total_bytes,
        "expected_artifacts_present": bool(expected_present),
        "output_manifest_valid": not manifest_errors,
    }
    return IntegrityResult(metrics=metrics, errors=tuple(errors))


def compute_metrics(output_dir: Path, expected_artifacts: list[str]) -> dict[str, Any]:
    """Compatibility wrapper for callers that only need the v1 metric map."""
    return inspect_integrity(output_dir, expected_artifacts).metrics
