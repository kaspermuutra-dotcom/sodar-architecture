#!/usr/bin/env python3
"""Pipeline QA manifest for a walkthrough media version (consumed by site/lib/demo/media.test.ts).

Per sweep: mean absolute difference between the 512 px base face and each tile level reduced to 512 px (all
levels come from one master, so only sharpness may differ), and an orientation check of the top/bottom faces
across levels (correlation of the reduced level-2 face with the base). Per linked pair: the neighbour colour
differences measured by matterport_capture_colour.py on the same version (--measure-only).

Usage:
  python3 scripts/matterport_capture_qa.py site/public/media/portfolio/<slug>/<version> site/lib/demo/<slug>.colour.json site/lib/demo/<slug>.plan-input.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import matterport_capture_faces as F  # noqa: E402

THRESHOLDS = {"levelDiff": 6.0, "pairEv": 0.6, "pairChroma": 25.0, "exteriorPairEv": 1.4, "exteriorPairChroma": 40.0}  # exterior pairs see sky, sun and shade: looser


def face_from_tiles(d: Path, name: str, level: int) -> Image.Image:
    size, nb = (1536, 2) if level == 1 else (3072, 4)
    big = Image.new("RGB", (size, size))
    tile = size // nb
    for c in range(nb):
        for r in range(nb):
            big.paste(Image.open(d / f"{name}-{level}-{c}-{r}.webp"), (c * tile, r * tile))
    return big


def ncc(a: np.ndarray, b: np.ndarray) -> float:
    a = a - a.mean()
    b = b - b.mean()
    return float((a * b).sum() / (np.sqrt((a * a).sum() * (b * b).sum()) + 1e-9))


def main() -> None:
    media, colour_json = Path(sys.argv[1]), Path(sys.argv[2])
    levels = json.loads(Path(sys.argv[3]).read_text()) if len(sys.argv) > 3 else {}
    colour = json.loads(colour_json.read_text())
    faces_dir = media / "faces"
    sweeps = {}
    for d in sorted(p for p in faces_dir.iterdir() if p.is_dir()):
        diffs = {"baseVsLevel1": [], "baseVsLevel2": [], "level1VsLevel2": []}
        orient = []
        for name in F.FACE_NAMES.values():
            base = np.asarray(Image.open(d / f"{name}-0.webp").convert("RGB"), np.float32)
            l1 = np.asarray(face_from_tiles(d, name, 1).resize((512, 512), Image.LANCZOS), np.float32)
            l2 = np.asarray(face_from_tiles(d, name, 2).resize((512, 512), Image.LANCZOS), np.float32)
            diffs["baseVsLevel1"].append(float(np.abs(base - l1).mean()))
            diffs["baseVsLevel2"].append(float(np.abs(base - l2).mean()))
            diffs["level1VsLevel2"].append(float(np.abs(l1 - l2).mean()))
            if name in ("top", "bottom"):
                orient.append(ncc(base.mean(-1), l2.mean(-1)))
        sweeps[d.name] = {k: round(max(v), 2) for k, v in diffs.items()}
        sweeps[d.name]["topBottomOrientation"] = round(min(orient), 3)
        print(d.name, sweeps[d.name], flush=True)
    pairs = {}
    measured = colour.get("measuredAfter") or colour.get("measured") or {}
    for k, v in measured.items():
        m = v["measured"]
        a, b = k.split(">")
        # exterior ↔ interior pairs carry real lighting differences (daylight vs. indoor); they are reported, not bounded
        pairs[k] = {"ev": m["ev"], "rg": m["rg"], "bg": m["bg"], "n": v["n"], "weight": v.get("weight", 1), "crossLevel": levels.get(a) != levels.get(b) if levels else False, "exterior": levels.get(a) == "exterior" and levels.get(b) == "exterior"}
    out = {"version": media.name, "thresholds": THRESHOLDS, "sweeps": sweeps, "pairs": pairs, "colourSource": colour.get("source")}
    (media / "qa.json").write_text(json.dumps(out, indent=1) + "\n")
    worst = max(max(s["baseVsLevel1"], s["baseVsLevel2"]) for s in sweeps.values())
    print(f"{len(sweeps)} sweeps, worst base-vs-level diff {worst:.2f}, {len(pairs)} pairs → {media / 'qa.json'}")


if __name__ == "__main__":
    main()
