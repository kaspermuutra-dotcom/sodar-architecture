"""The stable provider contract.

Everything downstream of SODAR talks to `Provider`; it never sees a vendor SDK.
An adapter's job is to translate a vendor's request/response shapes into the
normalized types below and to keep all vendor-specific detail inside
`ProviderResult.provider_metadata`.

Contract obligations for `execute()`:

  * Filesystem containment (every provider, always):
      - read only the fixture's declared inputs, each resolved *inside* the
        fixture root (use `contained_path`); never infer files from elsewhere
      - write output only under the given `output_dir`
      - write `output_dir/output_manifest.json` describing the artifacts
        (see `write_output_manifest`); the evaluator reads it generically

  * Execution mode varies by provider and MUST be declared in
    `provider_metadata["execution_mode"]`:
      - ``"offline-deterministic"`` — no network, no nondeterminism; identical
        input yields byte-identical artifacts, cost, and metadata
        (the `dummy` provider guarantees this)
      - ``"local-compute"`` — runs locally with no network, but delegates to a
        native library whose pixel output is not byte-reproducible across
        library versions / platforms (e.g. OpenCV panorama stitching)
      - ``"network"`` — contacts an external service (no such provider yet)

  * Any nondeterminism is the provider's to disclose (set
    ``provider_metadata["deterministic"] = False``). Harness-level determinism —
    run isolation and the structural integrity metrics — is guaranteed by the
    evaluator regardless of provider mode.
"""

from __future__ import annotations

import abc
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

OUTPUT_MANIFEST_NAME = "output_manifest.json"
OUTPUT_MANIFEST_VERSION = "output-manifest.v1"


class PathContainmentError(Exception):
    """A declared input path is absolute, uses ``..``, or escapes its root."""


def contained_path(root: Path, relpath: str) -> Path:
    """Resolve ``relpath`` under ``root``, or raise `PathContainmentError`.

    Rejects absolute paths, any ``..`` component, and symlink targets that
    resolve outside ``root``. Only the *path* is resolved — the target file is
    never opened or read by this function.
    """
    candidate = Path(relpath)
    if candidate.is_absolute():
        raise PathContainmentError(f"absolute path is not allowed: {relpath!r}")
    if ".." in candidate.parts:
        raise PathContainmentError(f"parent traversal is not allowed: {relpath!r}")

    resolved_root = root.resolve()
    resolved = (root / candidate).resolve(strict=False)
    if resolved != resolved_root and resolved_root not in resolved.parents:
        raise PathContainmentError(f"path escapes its root directory: {relpath!r}")
    return resolved


@dataclass(frozen=True)
class ProviderInput:
    """What a provider is given: the fixture id and its on-disk location."""

    fixture_id: str
    fixture_root: Path
    declared_inputs: tuple[str, ...]

    def path(self, relpath: str) -> Path:
        return self.fixture_root / relpath


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    errors: tuple[str, ...] = ()

    @classmethod
    def passed(cls) -> ValidationResult:
        return cls(ok=True)

    @classmethod
    def failed(cls, *errors: str) -> ValidationResult:
        return cls(ok=False, errors=tuple(errors))


@dataclass(frozen=True)
class ArtifactRef:
    """One output file, described relative to the run's output directory."""

    relpath: str
    bytes: int
    sha256: str

    def as_dict(self) -> dict[str, Any]:
        return {"relpath": self.relpath, "bytes": self.bytes, "sha256": self.sha256}


@dataclass(frozen=True)
class ProviderResult:
    """Normalized outcome — the same shape for success and failure."""

    provider_id: str
    success: bool
    artifacts: tuple[ArtifactRef, ...] = ()
    duration_ms: int = 0
    estimated_cost: float = 0.0
    provider_metadata: dict[str, Any] = field(default_factory=dict)
    errors: tuple[str, ...] = ()


class Provider(abc.ABC):
    """Base class for every provider adapter."""

    #: short, stable, lowercase identifier used on the CLI and in results
    id: str
    #: one-line human description
    description: str

    @abc.abstractmethod
    def validate(self, request: ProviderInput) -> ValidationResult:
        """Check the fixture input is usable *before* doing any work."""

    @abc.abstractmethod
    def execute(self, request: ProviderInput, output_dir: Path) -> ProviderResult:
        """Do the work, writing artifacts + the output manifest into ``output_dir``."""


# --- helpers shared by adapters -------------------------------------------------


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def write_json_deterministic(path: Path, obj: Any) -> None:
    """Serialize with sorted keys and a trailing newline so bytes are stable."""
    path.write_text(json.dumps(obj, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def artifact_ref(output_dir: Path, relpath: str) -> ArtifactRef:
    p = output_dir / relpath
    return ArtifactRef(relpath=relpath, bytes=p.stat().st_size, sha256=sha256_file(p))


def write_output_manifest(output_dir: Path, artifacts: list[ArtifactRef]) -> ArtifactRef:
    """Write ``output_manifest.json`` and return a ref to it."""
    body = {
        "manifest_version": OUTPUT_MANIFEST_VERSION,
        "artifacts": [a.as_dict() for a in sorted(artifacts, key=lambda a: a.relpath)],
    }
    manifest_path = output_dir / OUTPUT_MANIFEST_NAME
    write_json_deterministic(manifest_path, body)
    return artifact_ref(output_dir, OUTPUT_MANIFEST_NAME)
