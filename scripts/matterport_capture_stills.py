#!/usr/bin/env python3
"""Poster, social image and gallery stills rendered from a media version's own 3072 px faces, so they carry
exactly the same registration and colour transform as the walkthrough.

Usage:
  python3 scripts/matterport_capture_stills.py site/public/media/portfolio/<slug>/<version> site/lib/demo/<slug>.sweeps.json \
      --poster <id8>:<worldYaw>:<pitch>:<hfov> --still <id8>:<worldYaw>:<pitch>:<hfov> [--still ...]
Yaws are world yaws (the curated `yaw` values in properties.ts); the node's heading is added like the viewer does.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import matterport_capture_faces as F  # noqa: E402
import matterport_capture_floorplan as FP  # noqa: E402


def view(faces: dict[int, np.ndarray], world_yaw: float, pitch: float, hfov: float, w: int, h: int, heading: float) -> Image.Image:
    vf = 2 * math.degrees(math.atan(math.tan(math.radians(hfov) / 2) * h / w))
    f = (h / 2) / math.tan(math.radians(vf) / 2)
    gx, gy = np.meshgrid((np.arange(w) + 0.5) - w / 2, h / 2 - (np.arange(h) + 0.5))
    d = np.stack([gx, gy, np.full_like(gx, f)], -1)
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    p, yw = math.radians(pitch), math.radians(heading + world_yaw)
    rx = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
    ry = np.array([[math.cos(yw), 0, math.sin(yw)], [0, 1, 0], [-math.sin(yw), 0, math.cos(yw)]])
    return Image.fromarray(np.clip(F.sample_ref(faces, d @ rx.T @ ry.T), 0, 255).astype(np.uint8))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("media")
    ap.add_argument("sweeps_json")
    ap.add_argument("--poster", required=True)
    ap.add_argument("--still", action="append", default=[])
    a = ap.parse_args()
    media = Path(a.media)
    nodes = {n["id"]: n for n in json.loads(Path(a.sweeps_json).read_text())["nodes"]}
    pid, pyaw, ppitch, pfov = a.poster.split(":")
    faces = FP.faces_from_tiles(media, pid, level=2)
    h = nodes[pid]["heading"]
    view(faces, float(pyaw), float(ppitch), float(pfov), 1600, 1000, h).save(media / "poster.webp", quality=84, method=6)
    view(faces, float(pyaw), float(ppitch) + 1, float(pfov) + 4, 1200, 630, h).save(media / "og.jpg", quality=86, optimize=True)
    print("poster + og from", pid)
    (media / "stills").mkdir(exist_ok=True)
    for spec in a.still:
        sid, syaw, spitch, sfov = spec.split(":")
        view(FP.faces_from_tiles(media, sid, level=2), float(syaw), float(spitch), float(sfov), 1280, 800, nodes[sid]["heading"]).save(media / "stills" / f"{sid}.webp", quality=82, method=6)
        print("still", sid)


if __name__ == "__main__":
    main()
