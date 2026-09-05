"""Photo Sphere Viewer provider — TD-003's `ViewerBuilder`.

`build_tour.py` (per `wat/SODAR_AGENT_ARCHITECTURE.md`, step 4): panoramas +
room graph in, a self-contained static browser-viewer bundle out. Wraps
**Photo Sphere Viewer** (github.com/mistic100/Photo-Sphere-Viewer, MIT),
vendored as a pinned git submodule at ``third_party/photo-sphere-viewer``
(tag 5.9.0). TD-003 picked PSV over Pannellum/Marzipano/PlayCanvas for its
virtual-tour + markers plugin API; see `wat/SODAR_TECHNICAL_DECISIONS.md`.

Execution mode: ``offline-deterministic``. This provider does no reconstruction
of its own — it copies the given panorama images, rewrites a room graph into
PSV's VirtualTourPlugin node/link shape, and copies a pinned, self-hosted
viewer template (``src/sodar/viewer_assets/psv/``) into the output directory.
Same inputs + the same fetched vendor bundle always produce byte-identical
output; no network call happens at `execute()` time.

The browser bundle (three.js + PSV core/virtual-tour/markers/gyroscope, built
ESM+CSS published from that same submodule's source) is an **optional local
asset**, not a Python dependency: fetch it once with
``src/sodar/viewer_assets/psv/vendor/fetch-vendor.sh`` (~1 MB, gitignored,
mirrors ``viewer/vendor/fetch-engine.sh`` for the PlayCanvas spike). When it is
absent, `validate()` fails with an instructional message — never an exception —
exactly like `opencv_stitch`'s optional-dependency handling.

Input contract (the fixture supplies this):
  * ``input/tour.json`` — a room graph: ``startNodeId`` plus a ``nodes`` array.
    Each node has a string ``id`` (``[A-Za-z0-9_-]+``, used as the output
    panorama's filename stem), a ``panorama`` path that must be one of the
    fixture's declared inputs, and an optional ``links`` array of
    ``{nodeId, yaw_deg, pitch_deg, label?}`` pointing at other node ids.
  * ``declared_inputs`` — every panorama image referenced by a node, in any
    order (only PNG/JPEG are supported).
"""

from __future__ import annotations

import json
import shutil
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

_TOUR_FILE = "input/tour.json"

TOUR_JSON = "tour.json"
INDEX_HTML = "index.html"
METADATA_FILE = "tour_metadata.json"
PANORAMAS_DIR = "panoramas"
VENDOR_DIR = "vendor"

ADAPTER_VERSION = "0.1.0"
PSV_VERSION = "5.9.0"  # keep equal to third_party/photo-sphere-viewer's pinned tag
SUPPORTED_SUFFIXES = (".png", ".jpg", ".jpeg")
_NODE_ID_CHARS = frozenset(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
)

_TEMPLATE_ROOT = Path(__file__).resolve().parent.parent / "viewer_assets" / "psv"
_VENDOR_FILENAMES = (
    "psv-core.module.js",
    "psv-core.min.css",
    "psv-virtual-tour.module.js",
    "psv-virtual-tour.min.css",
    "psv-markers.module.js",
    "psv-markers.min.css",
    "psv-gyroscope.module.js",
    "three.module.min.js",
)


class TemplateUnavailable(Exception):
    """The vendored PSV browser bundle has not been fetched."""


class _AdapterError(Exception):
    """Internal: a fixture-reading problem to be normalized into a failure."""


# --- seams (kept tiny so tests can substitute fakes) --------------------------


def _template_root() -> Path:
    missing: list[str] = []
    index_html = _TEMPLATE_ROOT / INDEX_HTML
    if not index_html.is_file():
        missing.append(str(index_html))
    vendor_dir = _TEMPLATE_ROOT / VENDOR_DIR
    for name in _VENDOR_FILENAMES:
        path = vendor_dir / name
        if not path.is_file():
            missing.append(str(path))
    if missing:
        raise TemplateUnavailable(
            "Photo Sphere Viewer browser bundle is not fetched; run "
            "src/sodar/viewer_assets/psv/vendor/fetch-vendor.sh, then retry "
            f"(missing {len(missing)} file(s), e.g. {missing[0]})"
        )
    return _TEMPLATE_ROOT


# --- tour.json parsing ---------------------------------------------------------


def _parse_tour(raw: Any) -> tuple[list[str], dict[str, Any] | None]:
    """Validate the room-graph shape. Returns (errors, parsed) — parsed is None
    if errors is non-empty."""
    errors: list[str] = []
    if not isinstance(raw, dict):
        return [f"{_TOUR_FILE}: must be a JSON object"], None

    nodes = raw.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        errors.append(f"{_TOUR_FILE}: 'nodes' must be a non-empty array")
        return errors, None

    seen_ids: set[str] = set()
    for i, node in enumerate(nodes):
        if not isinstance(node, dict):
            errors.append(f"{_TOUR_FILE}: nodes[{i}] must be an object")
            continue
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id:
            errors.append(f"{_TOUR_FILE}: nodes[{i}] missing string 'id'")
        elif any(c not in _NODE_ID_CHARS for c in node_id):
            errors.append(
                f"{_TOUR_FILE}: nodes[{i}].id {node_id!r} must match [A-Za-z0-9_-]+"
            )
        elif node_id in seen_ids:
            errors.append(f"{_TOUR_FILE}: duplicate node id {node_id!r}")
        else:
            seen_ids.add(node_id)
        if not isinstance(node.get("panorama"), str) or not node["panorama"]:
            errors.append(f"{_TOUR_FILE}: nodes[{i}] missing string 'panorama'")
        links = node.get("links", [])
        if not isinstance(links, list):
            errors.append(f"{_TOUR_FILE}: nodes[{i}].links must be an array")
            continue
        for j, link in enumerate(links):
            if not isinstance(link, dict) or not isinstance(link.get("nodeId"), str):
                errors.append(f"{_TOUR_FILE}: nodes[{i}].links[{j}] missing string 'nodeId'")
                continue
            for key in ("yaw_deg", "pitch_deg"):
                val = link.get(key)
                if not isinstance(val, (int, float)) or isinstance(val, bool):
                    errors.append(
                        f"{_TOUR_FILE}: nodes[{i}].links[{j}] missing numeric '{key}'"
                    )

    start_node_id = raw.get("startNodeId")
    if not isinstance(start_node_id, str) or not start_node_id:
        errors.append(f"{_TOUR_FILE}: missing string 'startNodeId'")
    elif start_node_id not in seen_ids:
        errors.append(f"{_TOUR_FILE}: startNodeId {start_node_id!r} is not a node id")

    if errors:
        return errors, None

    for node in nodes:
        for link in node.get("links", []):
            if link["nodeId"] not in seen_ids:
                errors.append(
                    f"{_TOUR_FILE}: node {node['id']!r} links to unknown node {link['nodeId']!r}"
                )

    return errors, (None if errors else raw)


# --- provider -------------------------------------------------------------


class PhotoSphereViewerProvider(Provider):
    id = "psv-viewer"
    description = (
        "Photo Sphere Viewer static tour bundle builder "
        "(optional local asset: run vendor/fetch-vendor.sh)"
    )

    def validate(self, request: ProviderInput) -> ValidationResult:
        errors: list[str] = []

        tour_path = request.path(_TOUR_FILE)
        parsed = self._read_and_parse_tour(tour_path, errors)
        if parsed is not None:
            errors.extend(self._validate_panoramas(request, parsed))

        try:
            _template_root()
        except TemplateUnavailable as exc:
            errors.append(str(exc))

        return ValidationResult.passed() if not errors else ValidationResult.failed(*errors)

    def execute(self, request: ProviderInput, output_dir: Path) -> ProviderResult:
        started = time.perf_counter()

        errors: list[str] = []
        tour = self._read_and_parse_tour(request.path(_TOUR_FILE), errors)
        if tour is None:
            return self._failure(output_dir, errors, started)
        panorama_errors = self._validate_panoramas(request, tour)
        if panorama_errors:
            return self._failure(output_dir, panorama_errors, started)

        try:
            template_root = _template_root()
        except TemplateUnavailable as exc:
            return self._failure(output_dir, [str(exc)], started)

        try:
            copied_panoramas = self._copy_panoramas(request, tour, output_dir)
            output_tour = self._build_output_tour(tour, copied_panoramas)
            write_json_deterministic(output_dir / TOUR_JSON, output_tour)
            self._copy_template(template_root, output_dir)
        except _AdapterError as exc:
            return self._failure(output_dir, [str(exc)], started)

        meta = {
            "adapter": self.id,
            "adapter_version": ADAPTER_VERSION,
            "psv_version": PSV_VERSION,
            "node_count": len(output_tour["nodes"]),
            "link_count": sum(len(n["links"]) for n in output_tour["nodes"]),
            "start_node_id": output_tour["startNodeId"],
        }
        write_json_deterministic(output_dir / METADATA_FILE, meta)

        artifacts: list[ArtifactRef] = [
            artifact_ref(output_dir, TOUR_JSON),
            artifact_ref(output_dir, METADATA_FILE),
            artifact_ref(output_dir, INDEX_HTML),
        ]
        for name in _VENDOR_FILENAMES:
            artifacts.append(artifact_ref(output_dir, f"{VENDOR_DIR}/{name}"))
        for _, relpath in copied_panoramas.items():
            artifacts.append(artifact_ref(output_dir, relpath))
        write_output_manifest(output_dir, artifacts)

        return ProviderResult(
            provider_id=self.id,
            success=True,
            artifacts=tuple(artifacts),
            duration_ms=int((time.perf_counter() - started) * 1000),
            estimated_cost=round(0.001 * len(output_tour["nodes"]), 6),
            provider_metadata={
                "adapter": self.id,
                "adapter_version": ADAPTER_VERSION,
                "execution_mode": "offline-deterministic",
                "deterministic": True,
                "psv_version": PSV_VERSION,
                "node_count": len(output_tour["nodes"]),
                "notes": (
                    "pure file copy + deterministic JSON serialization; "
                    "same inputs and vendored bundle always yield identical bytes"
                ),
            },
        )

    # -- helpers ---------------------------------------------------------

    @staticmethod
    def _read_and_parse_tour(tour_path: Path, errors: list[str]) -> dict[str, Any] | None:
        if not tour_path.is_file():
            errors.append(f"{_TOUR_FILE}: required input file is missing")
            return None
        try:
            raw = json.loads(tour_path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001 - normalize any read/parse error
            errors.append(f"{_TOUR_FILE}: invalid JSON: {exc}")
            return None
        parse_errors, parsed = _parse_tour(raw)
        errors.extend(parse_errors)
        return parsed

    @staticmethod
    def _validate_panoramas(request: ProviderInput, tour: dict[str, Any]) -> list[str]:
        errors: list[str] = []
        for node in tour["nodes"]:
            rel = node["panorama"]
            try:
                resolved = contained_path(request.fixture_root, rel)
            except PathContainmentError as exc:
                errors.append(str(exc))
                continue
            if rel not in request.declared_inputs:
                errors.append(f"panorama {rel!r} (node {node['id']!r}) is not a declared input")
            if not resolved.is_file():
                errors.append(f"panorama does not exist: {rel!r}")
                continue
            if resolved.suffix.lower() not in SUPPORTED_SUFFIXES:
                errors.append(
                    f"unsupported panorama format {resolved.suffix!r} for {rel!r}; "
                    f"supported: {', '.join(SUPPORTED_SUFFIXES)}"
                )
        return errors

    @staticmethod
    def _copy_panoramas(
        request: ProviderInput, tour: dict[str, Any], output_dir: Path
    ) -> dict[str, str]:
        """Copy each node's panorama to panoramas/<node id><suffix>. Returns
        {node_id: output-relative path}, in node order."""
        out_dir = output_dir / PANORAMAS_DIR
        out_dir.mkdir(parents=True, exist_ok=True)
        copied: dict[str, str] = {}
        for node in tour["nodes"]:
            rel = node["panorama"]
            try:
                resolved = contained_path(request.fixture_root, rel)
            except PathContainmentError as exc:
                raise _AdapterError(str(exc)) from exc
            dest_relpath = f"{PANORAMAS_DIR}/{node['id']}{resolved.suffix.lower()}"
            shutil.copyfile(resolved, output_dir / dest_relpath)
            copied[node["id"]] = dest_relpath
        return copied

    @staticmethod
    def _build_output_tour(tour: dict[str, Any], copied_panoramas: dict[str, str]) -> dict[str, Any]:
        nodes_out = []
        for node in tour["nodes"]:
            links_out = [
                {
                    "nodeId": link["nodeId"],
                    "position": {
                        "yaw": f"{link['yaw_deg']}deg",
                        "pitch": f"{link['pitch_deg']}deg",
                    },
                    **({"label": link["label"]} if isinstance(link.get("label"), str) else {}),
                }
                for link in node.get("links", [])
            ]
            nodes_out.append({
                "id": node["id"],
                "name": node.get("name", node["id"]),
                "panorama": copied_panoramas[node["id"]],
                "links": links_out,
            })
        return {
            "schema_version": "tour.v0",
            "title": tour.get("title", ""),
            "startNodeId": tour["startNodeId"],
            "nodes": nodes_out,
        }

    @staticmethod
    def _copy_template(template_root: Path, output_dir: Path) -> None:
        shutil.copyfile(template_root / INDEX_HTML, output_dir / INDEX_HTML)
        vendor_out = output_dir / VENDOR_DIR
        vendor_out.mkdir(parents=True, exist_ok=True)
        for name in _VENDOR_FILENAMES:
            shutil.copyfile(template_root / VENDOR_DIR / name, vendor_out / name)

    def _failure(self, output_dir: Path, errors: list[str], started: float) -> ProviderResult:
        meta = {
            "adapter": self.id,
            "adapter_version": ADAPTER_VERSION,
            "psv_version": PSV_VERSION,
        }
        write_json_deterministic(output_dir / METADATA_FILE, meta)
        artifacts = [artifact_ref(output_dir, METADATA_FILE)]
        write_output_manifest(output_dir, artifacts)
        return ProviderResult(
            provider_id=self.id,
            success=False,
            artifacts=tuple(artifacts),
            duration_ms=int((time.perf_counter() - started) * 1000),
            estimated_cost=0.0,
            provider_metadata={
                "adapter": self.id,
                "adapter_version": ADAPTER_VERSION,
                "execution_mode": "offline-deterministic",
                "deterministic": True,
            },
            errors=tuple(errors),
        )
