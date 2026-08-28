"""Fixture discovery and manifest loading.

A fixture is a directory under ``fixtures/valid/`` or ``fixtures/invalid/``
containing a ``manifest.json`` (see ``schemas/fixture.v1.json``) plus its input
files. The directory name must equal the manifest's ``fixture_id``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from sodar import paths, schema


class FixtureError(Exception):
    """The fixture is missing or its manifest is malformed."""


@dataclass(frozen=True)
class Fixture:
    fixture_id: str
    kind: str  # "valid" | "invalid"
    root: Path
    description: str
    inputs: tuple[str, ...]
    expected_artifacts: tuple[str, ...]
    expect_provider_validation: str  # "pass" | "fail"
    expect_reason_contains: str | None

    def input_path(self, relpath: str) -> Path:
        return self.root / relpath


def _manifest_schema() -> dict:
    return schema.load_schema(paths.FIXTURE_SCHEMA)


def _load_one(manifest_path: Path) -> Fixture:
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FixtureError(f"{manifest_path}: cannot read manifest: {exc}") from exc

    errs = schema.validate(raw, _manifest_schema())
    if errs:
        raise FixtureError(f"{manifest_path}: invalid manifest: {'; '.join(errs)}")

    root = manifest_path.parent
    if raw["fixture_id"] != root.name:
        raise FixtureError(
            f"{manifest_path}: fixture_id {raw['fixture_id']!r} != directory name {root.name!r}"
        )

    expect = raw["expect"]
    return Fixture(
        fixture_id=raw["fixture_id"],
        kind=raw["kind"],
        root=root,
        description=raw["description"],
        inputs=tuple(raw["inputs"]),
        expected_artifacts=tuple(raw["expected_artifacts"]),
        expect_provider_validation=expect["provider_validation"],
        expect_reason_contains=expect.get("reason_contains"),
    )


def list_fixtures() -> list[Fixture]:
    found: list[Fixture] = []
    for kind in ("valid", "invalid"):
        base = paths.FIXTURES_DIR / kind
        if not base.is_dir():
            continue
        for manifest_path in sorted(base.glob("*/manifest.json")):
            found.append(_load_one(manifest_path))
    return found


def resolve_fixture(fixture_id: str) -> Fixture | None:
    for fixture in list_fixtures():
        if fixture.fixture_id == fixture_id:
            return fixture
    return None
