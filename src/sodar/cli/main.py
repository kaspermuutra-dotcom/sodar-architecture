"""`sodar` CLI entry point.

Commands:
  sodar provider list
  sodar provider run <provider> <fixture>
  sodar eval run <provider> <fixture>

Every command accepts --json. With --json, stdout carries exactly one JSON
object and nothing else; all human/diagnostic text goes to stderr. Exit codes
are defined in `sodar.exit_codes`.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from sodar import __version__, exit_codes, ids, paths
from sodar.fixtures import Fixture, FixtureError, list_fixtures, resolve_fixture
from sodar.providers.base import Provider, ProviderInput
from sodar.providers.registry import get_provider, list_providers
from sodar.eval.runner import (
    EvalError,
    ProviderValidationError,
    run_eval,
)


class CliExit(Exception):
    """Carry an exit code and a machine-readable payload out to `main`."""

    def __init__(self, code: int, message: str, payload: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.payload = payload or {}


# --- output helpers -----------------------------------------------------------


def _emit(as_json: bool, human: str, payload: dict[str, Any]) -> None:
    if as_json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print(human)


def _fail(as_json: bool, exc: CliExit) -> int:
    if as_json:
        print(json.dumps(
            {"error": exc.message, "exit_code": exc.code, **exc.payload},
            indent=2, sort_keys=True,
        ))
    else:
        print(f"error: {exc.message}", file=sys.stderr)
    return exc.code


# --- resolution --------------------------------------------------------------


def _require_provider(provider_id: str) -> Provider:
    provider = get_provider(provider_id)
    if provider is None:
        known = ", ".join(p.id for p in list_providers()) or "(none)"
        raise CliExit(
            exit_codes.USAGE,
            f"unknown provider {provider_id!r}; known providers: {known}",
            {"provider_id": provider_id},
        )
    return provider


def _require_fixture(fixture_id: str) -> Fixture:
    try:
        fixture = resolve_fixture(fixture_id)
    except FixtureError as exc:
        raise CliExit(exit_codes.FIXTURE, str(exc), {"fixture_id": fixture_id}) from exc
    if fixture is None:
        known = ", ".join(f.fixture_id for f in _safe_list_fixtures()) or "(none)"
        raise CliExit(
            exit_codes.USAGE,
            f"unknown fixture {fixture_id!r}; known fixtures: {known}",
            {"fixture_id": fixture_id},
        )
    return fixture


def _safe_list_fixtures() -> list[Fixture]:
    try:
        return list_fixtures()
    except FixtureError:
        return []


# --- commands ---------------------------------------------------------------


def cmd_provider_list(args: argparse.Namespace) -> int:
    providers = list_providers()
    payload = {"providers": [{"id": p.id, "description": p.description} for p in providers]}
    human = "\n".join(f"{p.id:12}  {p.description}" for p in providers) or "(no providers registered)"
    _emit(args.json, human, payload)
    return exit_codes.OK


def cmd_provider_run(args: argparse.Namespace) -> int:
    provider = _require_provider(args.provider)
    fixture = _require_fixture(args.fixture)

    request = ProviderInput(
        fixture_id=fixture.fixture_id,
        fixture_root=fixture.root,
        declared_inputs=fixture.inputs,
    )

    validation = provider.validate(request)
    if not validation.ok:
        raise CliExit(
            exit_codes.FIXTURE,
            f"provider {provider.id!r} rejected fixture {fixture.fixture_id!r}: "
            + "; ".join(validation.errors),
            {"provider_id": provider.id, "fixture_id": fixture.fixture_id,
             "validation_errors": list(validation.errors)},
        )

    run_id = ids.new_run_id()
    run_dir = paths.PROVIDER_RUNS_DIR / run_id
    output_dir = run_dir / "output"
    output_dir.mkdir(parents=True, exist_ok=False)

    result = provider.execute(request, output_dir)

    payload = {
        "provider_id": result.provider_id,
        "fixture_id": fixture.fixture_id,
        "success": result.success,
        "duration_ms": result.duration_ms,
        "estimated_cost": result.estimated_cost,
        "artifacts": [a.as_dict() for a in result.artifacts],
        "provider_metadata": result.provider_metadata,
        "errors": list(result.errors),
        "output_dir": str(output_dir.relative_to(paths.ROOT)),
    }
    human = (
        f"provider : {result.provider_id}\n"
        f"fixture  : {fixture.fixture_id}\n"
        f"success  : {result.success}\n"
        f"cost     : {result.estimated_cost}\n"
        f"artifacts: {', '.join(a.relpath for a in result.artifacts) or '(none)'}\n"
        f"output   : {payload['output_dir']}"
    )
    _emit(args.json, human, payload)
    if not result.success:
        raise CliExit(exit_codes.PROVIDER, "provider execution failed", payload)
    return exit_codes.OK


def cmd_eval_run(args: argparse.Namespace) -> int:
    provider = _require_provider(args.provider)
    fixture = _require_fixture(args.fixture)

    try:
        outcome = run_eval(provider, fixture)
    except ProviderValidationError as exc:
        raise CliExit(
            exit_codes.FIXTURE,
            f"provider {provider.id!r} rejected fixture {fixture.fixture_id!r}: {exc}",
            {"provider_id": provider.id, "fixture_id": fixture.fixture_id,
             "validation_errors": exc.errors},
        ) from exc
    except EvalError as exc:
        raise CliExit(exit_codes.INTERNAL, str(exc)) from exc

    result = outcome.result
    payload = {
        "eval_result": result,
        "run_dir": str(outcome.run_dir.relative_to(paths.ROOT)),
    }
    human = (
        f"run_id   : {result['run_id']}\n"
        f"provider : {result['provider_id']}\n"
        f"fixture  : {result['fixture_id']}\n"
        f"success  : {result['success']}\n"
        f"metrics  : {json.dumps(result['metrics'], sort_keys=True)}\n"
        f"cost     : {result['estimated_cost']}\n"
        f"saved    : {payload['run_dir']}/eval-result.json"
    )
    _emit(args.json, human, payload)
    if not result["success"]:
        raise CliExit(exit_codes.PROVIDER, "provider execution failed", payload)
    return exit_codes.OK


def cmd_stitch(args: argparse.Namespace) -> int:
    """Frames export (zip or directory) → panorama(s) → optional AI fill → PSV tour bundle."""
    import shutil
    import tempfile
    import zipfile

    from sodar.stitch.posed import load_frames_json, save_outputs, stitch

    src = Path(args.source)
    if not src.exists():
        raise CliExit(exit_codes.USAGE, f"no such file or directory: {src}")
    workdir = Path(tempfile.mkdtemp(prefix="sodar-stitch-"))
    if src.is_file() and src.suffix.lower() == ".zip":
        with zipfile.ZipFile(src) as zf:
            zf.extractall(workdir)
        root = workdir
    else:
        root = src
    manifest = root / "frames.json"
    if not manifest.is_file():
        raise CliExit(exit_codes.USAGE, f"frames.json not found under {root}")
    data = json.loads(manifest.read_text())
    rooms = data["rooms"] if "rooms" in data else [{"id": "room-1", "name": data.get("name", "Room"), "fov": data.get("fov"), "frames": data["frames"]}]

    out = Path(args.out)
    panos = out / "panoramas"
    panos.mkdir(parents=True, exist_ok=True)
    nodes: list[dict[str, Any]] = []
    report: list[dict[str, Any]] = []
    for i, room in enumerate(rooms):
        fov = {"horizontal": float((room.get("fov") or {}).get("horizontal", 55)), "vertical": float((room.get("fov") or {}).get("vertical", 72))}
        frames = []
        from sodar.stitch.posed import Frame  # noqa: PLC0415

        for f in room["frames"]:
            elevation = f.get("elevation")
            if elevation is None:
                elevation = -float(f.get("pitch", 0.0))
            frames.append(Frame(path=root / f["file"], yaw=float(f["yaw"]), elevation=float(elevation), roll=float(f.get("roll", 0.0))))
        if len(frames) < 2:
            report.append({"room": room.get("name"), "skipped": "fewer than two frames"})
            continue
        stem = f"room-{i + 1:02d}"
        result = stitch(frames, fov, width=args.width, refine=not args.no_refine)
        meta = save_outputs(result, panos, stem=stem)
        panorama_rel = f"panoramas/{stem}.jpg"
        if args.fill:
            from sodar.providers.ai_fill import AIFillProvider  # noqa: PLC0415

            tmp = Path(tempfile.mkdtemp(prefix="sodar-fill-"))
            (tmp / "input").mkdir()
            shutil.copy(panos / f"{stem}.jpg", tmp / "input" / "panorama.jpg")
            shutil.copy(panos / f"{stem}-mask.png", tmp / "input" / "panorama-mask.png")
            fill_out = tmp / "out"
            res = AIFillProvider().execute(ProviderInput(fixture_id=stem, fixture_root=tmp, declared_inputs=("input/panorama.jpg", "input/panorama-mask.png")), fill_out)
            if res.success:
                shutil.copy(fill_out / "panorama-filled.png", panos / f"{stem}-filled.png")
                panorama_rel = f"panoramas/{stem}-filled.png"
                meta["fill"] = res.provider_metadata
            else:
                meta["fill_error"] = list(res.errors)
        node_id = f"room-{i + 1}"
        nodes.append({"id": node_id, "name": room.get("name") or node_id, "panorama": panorama_rel, "links": []})
        report.append({"room": room.get("name"), **meta})

    # link rooms in a chain so the tour is navigable
    for i, node in enumerate(nodes):
        if i + 1 < len(nodes):
            node["links"].append({"nodeId": nodes[i + 1]["id"], "yaw_deg": 90, "pitch_deg": -6, "label": nodes[i + 1]["name"]})
        if i > 0:
            node["links"].append({"nodeId": nodes[i - 1]["id"], "yaw_deg": -90, "pitch_deg": -6, "label": nodes[i - 1]["name"]})
    tour = {"title": data.get("title", "Sodar scan"), "startNodeId": nodes[0]["id"] if nodes else "", "nodes": nodes}

    if nodes and not args.no_tour:
        from sodar.providers.psv_viewer import PhotoSphereViewerProvider  # noqa: PLC0415

        tmp = Path(tempfile.mkdtemp(prefix="sodar-tour-"))
        (tmp / "input").mkdir()
        declared = ["input/tour.json"]
        tour_in = json.loads(json.dumps(tour))
        for node in tour_in["nodes"]:
            rel = "input/" + Path(node["panorama"]).name
            shutil.copy(panos / Path(node["panorama"]).name, tmp / rel)
            node["panorama"] = rel
            declared.append(rel)
        (tmp / "input" / "tour.json").write_text(json.dumps(tour_in, indent=2))
        res = PhotoSphereViewerProvider().execute(ProviderInput(fixture_id="stitch", fixture_root=tmp, declared_inputs=tuple(declared)), out / "tour")
        report.append({"tour": "ok" if res.success else list(res.errors)})

    (out / "stitch_report.json").write_text(json.dumps(report, indent=2) + "\n")
    human = "\n".join(f"{r.get('room', r.get('tour', ''))!s:14} coverage={r.get('coverage', '-')} refined={r.get('refined', '-')} {r.get('fill', {}).get('backend', '') if isinstance(r.get('fill'), dict) else ''}" for r in report)
    human += f"\noutput   : {out}"
    if nodes and not args.no_tour:
        human += f"\ntour     : cd {out}/tour && python3 -m http.server 8080"
    _emit(args.json, human, {"report": report, "output": str(out)})
    return exit_codes.OK


# --- parser ---------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    # --json lives on every leaf command (via this shared parent) so it can be
    # passed trailing: `sodar eval run dummy <fixture> --json`.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true", help="emit a single JSON object on stdout")

    parser = argparse.ArgumentParser(prog="sodar", description="SODAR engineering harness")
    parser.add_argument("--version", action="version", version=f"sodar {__version__}")

    sub = parser.add_subparsers(dest="group", required=True)

    p_provider = sub.add_parser("provider", help="inspect and run providers")
    provider_sub = p_provider.add_subparsers(dest="action", required=True)

    lst = provider_sub.add_parser("list", help="list registered providers", parents=[common])
    lst.set_defaults(func=cmd_provider_list)

    run = provider_sub.add_parser(
        "run", help="run a provider against a fixture (no evaluation)", parents=[common]
    )
    run.add_argument("provider")
    run.add_argument("fixture")
    run.set_defaults(func=cmd_provider_run)

    p_eval = sub.add_parser("eval", help="run deterministic evaluations")
    eval_sub = p_eval.add_subparsers(dest="action", required=True)

    erun = eval_sub.add_parser(
        "run", help="evaluate a provider against a fixture", parents=[common]
    )
    erun.add_argument("provider")
    erun.add_argument("fixture")
    erun.set_defaults(func=cmd_eval_run)

    p_stitch = sub.add_parser("stitch", help="stitch a scanner frames export into panoramas + a viewer bundle", parents=[common])
    p_stitch.add_argument("source", help="frames export .zip or a directory containing frames.json")
    p_stitch.add_argument("--out", required=True, help="output directory")
    p_stitch.add_argument("--width", type=int, default=4096, help="panorama width (height = width/2)")
    p_stitch.add_argument("--no-refine", action="store_true", help="skip ORB yaw refinement")
    p_stitch.add_argument("--fill", action="store_true", help="run the ai-fill provider (GPT Image 2) on each panorama")
    p_stitch.add_argument("--no-tour", action="store_true", help="skip building the Photo Sphere Viewer bundle")
    p_stitch.set_defaults(func=cmd_stitch)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    # argparse prints its own message and exits 2 on bad usage — matches USAGE.
    args = parser.parse_args(argv)
    as_json = bool(getattr(args, "json", False))
    try:
        return args.func(args)
    except CliExit as exc:
        return _fail(as_json, exc)
    except KeyboardInterrupt:  # pragma: no cover
        print("interrupted", file=sys.stderr)
        return exit_codes.INTERNAL
    except Exception as exc:  # noqa: BLE001 - last-resort guard
        return _fail(as_json, CliExit(exit_codes.INTERNAL, f"unexpected: {type(exc).__name__}: {exc}"))


if __name__ == "__main__":
    raise SystemExit(main())
