"""A tiny, dependency-free JSON Schema validator.

Supports only the keywords this harness actually uses:
``type``, ``required``, ``properties``, ``additionalProperties`` (bool),
``items``, ``enum``, ``const``, ``minimum``, ``minLength``, ``maxLength``.

The schema files under ``schemas/`` are ordinary Draft 2020-12 JSON Schema, so a
full validator (``jsonschema``) can be dropped in later without changing them.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_JSON_TYPES: dict[str, type | tuple[type, ...]] = {
    "object": dict,
    "array": list,
    "string": str,
    "integer": int,
    "number": (int, float),
    "boolean": bool,
    "null": type(None),
}


def load_schema(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def validate(instance: Any, schema: dict[str, Any]) -> list[str]:
    """Return a list of human-readable errors; empty means valid."""
    errors: list[str] = []
    _validate(instance, schema, "$", errors)
    return errors


def _type_ok(value: Any, json_type: str) -> bool:
    expected = _JSON_TYPES[json_type]
    if json_type == "boolean":
        return isinstance(value, bool)
    if json_type in ("integer", "number") and isinstance(value, bool):
        return False  # bool is a subclass of int in Python; reject it here
    return isinstance(value, expected)


def _validate(value: Any, schema: dict[str, Any], path: str, errors: list[str]) -> None:
    if "const" in schema and value != schema["const"]:
        errors.append(f"{path}: expected const {schema['const']!r}, got {value!r}")

    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: {value!r} not in {schema['enum']!r}")

    json_type = schema.get("type")
    if json_type is not None:
        types = [json_type] if isinstance(json_type, str) else list(json_type)
        if not any(_type_ok(value, t) for t in types):
            errors.append(f"{path}: expected type {json_type!r}, got {type(value).__name__}")
            return  # further checks assume the type matched

    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append(f"{path}: string shorter than minLength {schema['minLength']}")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            errors.append(f"{path}: string longer than maxLength {schema['maxLength']}")

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{path}: {value} below minimum {schema['minimum']}")

    if isinstance(value, dict):
        _validate_object(value, schema, path, errors)

    if isinstance(value, list) and "items" in schema:
        for i, item in enumerate(value):
            _validate(item, schema["items"], f"{path}[{i}]", errors)


def _validate_object(value: dict[str, Any], schema: dict[str, Any], path: str, errors: list[str]) -> None:
    for key in schema.get("required", []):
        if key not in value:
            errors.append(f"{path}: missing required property {key!r}")

    properties = schema.get("properties", {})
    for key, subschema in properties.items():
        if key in value:
            _validate(value[key], subschema, f"{path}.{key}", errors)

    additional = schema.get("additionalProperties", True)
    if additional is False:
        for key in value:
            if key not in properties:
                errors.append(f"{path}: unexpected property {key!r}")
