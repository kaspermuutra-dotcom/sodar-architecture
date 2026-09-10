#!/usr/bin/env python3
"""Unlisted human-review assets: for every checkpoint, Matterport's clean 512 px preview cubemap and the current
master rendered at the same six directions, plus floor, ceiling and doorway (link-direction) crops.

Usage:
  python3 scripts/matterport_capture_review.py "<export>/<capture-uuid>" site/lib/demo/<slug>.sweeps.json \
      site/public/media/portfolio/<slug>/<version> site/lib/demo/<slug>.plan-input.json site/public/media/review/<slug> site/lib/demo/<slug>.review.json
Statuses in the review JSON are edited by hand after visual inspection ("needs-review" | "pass" | "rejected").
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import matterport_capture_faces as F  # noqa: E402
import matterport_capture_floorplan as FP  # noqa: E402

W, H = 720, 450
YAWS = (0, 60, 120, 180, 240, 300)


def view(faces, yaw, pitch, hfov, w=W, h=H):
    vf = 2 * math.degrees(math.atan(math.tan(math.radians(hfov) / 2) * h / w))
    f = (h / 2) / math.tan(math.radians(vf) / 2)
    gx, gy = np.meshgrid((np.arange(w) + 0.5) - w / 2, h / 2 - (np.arange(h) + 0.5))
    d = np.stack([gx, gy, np.full_like(gx, f)], -1)
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    p, yw = math.radians(pitch), math.radians(yaw)
    rx = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
    ry = np.array([[math.cos(yw), 0, math.sin(yw)], [0, 1, 0], [-math.sin(yw), 0, math.cos(yw)]])
    return Image.fromarray(np.clip(F.sample_ref(faces, d @ rx.T @ ry.T), 0, 255).astype(np.uint8))


def main() -> None:
    export, sweeps_json, media, levels_json, out_dir, out_json = (Path(a) for a in sys.argv[1:7])
    spd = export / "SweepProcessorData"
    gen = json.loads(sweeps_json.read_text())
    levels = json.loads(levels_json.read_text())
    nodes = {n["id"]: n for n in gen["nodes"]}
    links: dict[str, list] = {}
    for l in gen["candidateLinks"]:
        links.setdefault(l["from"], []).append(l)
    previous = json.loads(out_json.read_text()) if out_json.exists() else {"scenes": {}}
    scenes = {}
    for nid, level in levels.items():
        n = nodes[nid]
        ref, _ = F.load_reference(spd, n["sweep"])
        cur = FP.faces_from_tiles(media, nid, level=1)
        d = out_dir / nid
        d.mkdir(parents=True, exist_ok=True)
        views = []
        for yaw in YAWS:
            for src, tag in ((ref, "ref"), (cur, "cur")):
                view(src, yaw, -8, 72).save(d / f"{tag}-y{yaw}.webp", quality=82, method=4)
            views.append({"yaw": yaw, "ref": f"{nid}/ref-y{yaw}.webp", "cur": f"{nid}/cur-y{yaw}.webp"})
        crops = []
        for name, yaw, pitch, fov in (("floor", 0, -58, 70), ("ceiling", 0, 55, 70)):
            for src, tag in ((ref, "ref"), (cur, "cur")):
                view(src, yaw, pitch, fov).save(d / f"{tag}-{name}.webp", quality=82, method=4)
            crops.append({"name": name, "ref": f"{nid}/ref-{name}.webp", "cur": f"{nid}/cur-{name}.webp"})
        # doorways: the directions of the scene's links (raw panorama yaw = world yaw − heading)
        for i, l in enumerate(sorted(links.get(nid, []), key=lambda x: x["distance"])[:2]):
            yaw = (l["yaw"] - n["heading"]) % 360
            for src, tag in ((ref, "ref"), (cur, "cur")):
                view(src, yaw, -6, 42).save(d / f"{tag}-door{i}.webp", quality=82, method=4)
            crops.append({"name": f"doorway {i + 1} (towards {l['to']})", "ref": f"{nid}/ref-door{i}.webp", "cur": f"{nid}/cur-door{i}.webp"})
        prev = previous.get("scenes", {}).get(nid, {})
        scenes[nid] = {"level": level, "views": views, "crops": crops, "status": prev.get("status", "needs-review"), "note": prev.get("note", "")}
        print("review assets", nid, flush=True)
    out_json.write_text(json.dumps({"media": str(media), "scenes": scenes}, indent=1) + "\n")
    print(len(scenes), "scenes →", out_json)


if __name__ == "__main__":
    main()
