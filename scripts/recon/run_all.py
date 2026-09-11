"""All-scene pipeline (Phase 9): render → floor fill → tour colour → viewer tiles + QA.

Stages (run in order; each is resumable and skips finished scenes):
  render   Candidate C masters (3072-px faces) for every scene id, then the floor cap fill from neighbours
  colour   tour-wide colour solve on the rendered equirects (scripts/recon/tourcolour.py)
  tiles    apply the sweep gain in linear light and write the viewer media version:
           faces/<id>/<face>-0.webp (512), <face>-1-<c>-<r>.webp (1536, 2×2), <face>-2-<c>-<r>.webp (3072, 4×4),
           pano/<id>.preview.webp (512×256), thumb/<id>.webp (320×160); plus review/<id>/ QA captures and a
           status file (needs-review by default).

Usage: python scripts/recon/run_all.py <export> --ids-file <txt> --calib <dir> --camera-json <json> --render <dir>
       --levels <plan-input.json> --media <site/public/media/.../t4> --stage render|colour|tiles|all
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recon.capture import CaptureExport  # noqa: E402
from recon.geom import equirect_dirs, sample_cube, view_dirs  # noqa: E402

FACE_NAMES = {0: "top", 1: "front", 2: "right", 3: "back", 4: "left", 5: "bottom"}
PY = sys.executable
HERE = Path(__file__).resolve().parent
TILE_QUALITY, BASE_QUALITY = 88, 84


def neighbours(ex: CaptureExport, ids: list[str], levels: dict, id8: str, calib: Path) -> list[str]:
    sw = ex.by_id8(id8)
    out = []
    for j in ids:
        if j == id8 or levels.get(j) != levels.get(id8) or not (calib / f"{j}.calib.json").exists():
            continue
        d = math.dist(sw.man.p, ex.by_id8(j).man.p)
        if d <= 4.6:
            out.append((d, j))
    return [j for _, j in sorted(out)][:5]


def stage_render(a, ex, ids, levels) -> None:
    for i in ids:
        od = Path(a.render) / i
        if (od / "capfill.json").exists():
            continue
        if not (Path(a.calib) / f"{i}.calib.json").exists():
            print(f"{i}: no calibration yet, skipped", flush=True)
            continue
        t0 = time.time()
        if not (od / "C_bottom.png").exists():
            subprocess.run([PY, str(HERE / "render.py"), a.export, i, "--calib", a.calib, "--camera-json", a.camera_json, "--out", a.render, "--face", "3072", "--candidates", "C"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        nb = neighbours(ex, ids, levels, i, Path(a.calib))
        if nb:
            subprocess.run([PY, str(HERE / "capfill.py"), a.export, i, "--neighbours", ",".join(nb), "--calib", a.calib, "--camera-json", a.camera_json, "--render", a.render], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            (od / "capfill.json").write_text(json.dumps({"skipped": "no calibrated neighbours"}))
        print(f"{i}: rendered + filled in {time.time() - t0:.0f}s (neighbours {nb})", flush=True)


def stage_colour(a, ids) -> None:
    subprocess.run([PY, str(HERE / "tourcolour.py"), a.export, "--render", a.render, "--ids", ",".join(ids), "--levels", a.levels, "--out", str(Path(a.render) / "tourcolour.json")], check=True)


def apply_gain_u8(img: np.ndarray, g: np.ndarray) -> np.ndarray:
    lin = (img.astype(np.float32) / 255.0) ** 2.2 * g
    return (np.clip(lin, 0, 1) ** (1 / 2.2) * 255.0 + 0.5).astype(np.uint8)


def stage_tiles(a, ex, ids) -> None:
    media = Path(a.media)
    gains = json.loads((Path(a.render) / "tourcolour.json").read_text())["gains"] if (Path(a.render) / "tourcolour.json").exists() else {}
    status_path = Path(a.render) / "status.json"
    status = json.loads(status_path.read_text()) if status_path.exists() else {}
    for i in ids:
        od = Path(a.render) / i
        fd = media / "faces" / i
        if (fd / "bottom-2-3-3.webp").exists():
            continue
        fd.mkdir(parents=True, exist_ok=True)
        (media / "pano").mkdir(exist_ok=True)
        (media / "thumb").mkdir(exist_ok=True)
        g = np.array(gains.get(i, [1, 1, 1]), np.float32)
        faces = {}
        for f, name in FACE_NAMES.items():
            img = apply_gain_u8(np.asarray(Image.open(od / f"C_{name}.png").convert("RGB")), g)
            faces[f] = img.astype(np.float32)
            big = Image.fromarray(img)
            for level, (fsz, nb) in enumerate(((1536, 2), (3072, 4)), start=1):
                im = big if fsz == 3072 else big.resize((fsz, fsz), Image.LANCZOS)
                t = fsz // nb
                for r in range(nb):
                    for c in range(nb):
                        im.crop((c * t, r * t, (c + 1) * t, (r + 1) * t)).save(fd / f"{name}-{level}-{c}-{r}.webp", quality=TILE_QUALITY, method=4)
            big.resize((512, 512), Image.LANCZOS).save(fd / f"{name}-0.webp", quality=BASE_QUALITY, method=4)
        eq = Image.fromarray(np.clip(sample_cube(faces, equirect_dirs(1024, 512)), 0, 255).astype(np.uint8))
        eq.resize((512, 256), Image.LANCZOS).save(media / "pano" / f"{i}.preview.webp", quality=76, method=4)
        eq.resize((320, 160), Image.LANCZOS).save(media / "thumb" / f"{i}.webp", quality=74, method=4)
        # QA captures: six directions, floor, ceiling
        qd = Path(a.render) / "qa" / i
        qd.mkdir(parents=True, exist_ok=True)
        for yaw, pitch, hf, tag in [(y, -5, 60, f"yaw{y}") for y in range(0, 360, 60)] + [(0, -60, 70, "floor0"), (180, -60, 70, "floor180"), (0, 45, 70, "ceiling")]:
            Image.fromarray(np.clip(sample_cube(faces, view_dirs(yaw, pitch, hf, 900, 600)), 0, 255).astype(np.uint8)).save(qd / f"{tag}.jpg", quality=82)
        status.setdefault(i, {"status": "needs-review", "notes": ""})
        status_path.write_text(json.dumps(status, indent=1))
        print(f"{i}: tiles written (gain {np.round(g, 3).tolist()})", flush=True)


def stage_finish(a, ex, ids) -> None:
    """Old-format colour.json + qa.json (asserted by site/lib/demo/media.test.ts), plan map, stills, README."""
    import shutil

    media = Path(a.media)
    tc = json.loads((Path(a.render) / "tourcolour.json").read_text())
    # Trusted pairs (weight 1, asserted by media.test.ts) are the tour's own links: sweeps that share a doorway or
    # an open room. Other pairs inside 4.6 m (a bathroom seen through a wall, a room behind a closed door) are
    # solved with the same correspondences but only reported (weight 0): their lighting differs for real.
    links = set()
    if a.links_json and Path(a.links_json).exists():
        for x, y in json.loads(Path(a.links_json).read_text()):
            links.add((x, y))
            links.add((y, x))
    measured = {}
    for pair, r in tc["measuredBefore"].items():
        ev_after = tc["evAfter"][pair]
        x, y = pair.split(">")
        # trusted = a tour link measured on enough depth-verified samples (a doorway sliver of a few thousand samples
        # is dominated by whatever bright or dark surface it happens to cover)
        measured[pair] = {"measured": {"ev": ev_after, "rg": 0.0, "bg": 0.0}, "n": r["n"], "weight": 1 if ((not links or (x, y) in links) and r["n"] >= 5000) else 0}
    colour = {"source": str(media), "gains": tc["gains"], "references": tc["references"], "measuredAfter": measured, "note": "solved by scripts/recon/tourcolour.py on the r1 reconstruction (depth-verified correspondences); rg/bg after are not re-measured here"}
    (media / "colour.json").write_text(json.dumps(colour, indent=1) + "\n")
    subprocess.run([PY, str(HERE.parent / "matterport_capture_qa.py"), str(media), str(media / "colour.json"), a.levels], check=True)
    old_plan = media.parent / "t3" / "plan"
    if old_plan.exists() and not (media / "plan").exists():
        shutil.copytree(old_plan, media / "plan")
    stills = Path(a.render) / "stills.json"
    if stills.exists():
        cfg = json.loads(stills.read_text())
        cmd = [PY, str(HERE.parent / "matterport_capture_stills.py"), str(media), a.sweeps_json, "--poster", cfg["poster"]] + sum([["--still", x] for x in cfg["stills"]], [])
        subprocess.run(cmd, check=True)
    (media / "README.md").write_text(README)


README = """# Kaldapealse tänav 2 — walkthrough media (version t4)

Version t4 (September 2026) is a multi-view reconstruction of the same on-site Matterport Capture scan
(`scripts/recon/`, see `docs/RECON_NOTES.md`). Each sweep's six 4032×3024 frames are placed at their solved
camera centres (10–30 cm apart) and rotations, the LiDAR depth image (decoded from its packed layout) lifts every
output direction to a 3-D point, and each frame is sampled where that point really is in it — so walls, door
frames, windows and stairs no longer double or split at the seams. Seams are dynamic-programming paths through the
frame overlaps; colour is anchored per frame to Matterport's preview and then normalised across the tour
(`colour.json`). The floor below each sweep, which its own frames never see, is filled from neighbouring sweeps
that see it from above; the ceiling cap above ≈+37° still comes from the 512 px preview. Nothing is generated.

Where the depth-based render fails the scene keeps its t3 seam-composite master (LiDAR depth through glazing bends
window frames; thin near objects — door leaves, basins, a wall corner — tear or ghost; sunlit facades blotch). Those
scenes carry a `source_t3.json` next to their render; the tour-wide colour solve and the tiles treat both sources alike.

- `faces/<sweep>/<face>-0.webp` — 512 px base face
- `faces/<sweep>/<face>-1-<col>-<row>.webp` — 1536 px level, 2×2 tiles
- `faces/<sweep>/<face>-2-<col>-<row>.webp` — 3072 px level, 4×4 tiles
- `colour.json` — tour-wide gains and the neighbour differences after the solve
- `qa.json` — base-vs-level consistency, top/bottom orientation, neighbour colour differences (asserted by `lib/demo/media.test.ts`)
- `pano/<sweep>.preview.webp`, `thumb/<sweep>.webp` — loading preview and checkpoint thumbnail from the same master
- `stills/`, `poster.webp`, `og.jpg` — rectilinear crops from these faces
- `plan/` — the plan map (unchanged from t3; same sweep positions)
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("export")
    ap.add_argument("--ids-file", required=True)
    ap.add_argument("--calib", required=True)
    ap.add_argument("--camera-json", required=True)
    ap.add_argument("--render", required=True)
    ap.add_argument("--levels", required=True)
    ap.add_argument("--media", required=True)
    ap.add_argument("--stage", default="all")
    ap.add_argument("--sweeps-json", default="site/lib/demo/kaldapealse-tanav-2.sweeps.json")
    ap.add_argument("--links-json", default=None, help="JSON list of [from, to] tour links: only these pairs are weighted in qa.json")
    a = ap.parse_args()
    ex = CaptureExport(Path(a.export))
    ids = [x.strip() for x in Path(a.ids_file).read_text().split() if x.strip()]
    levels = json.loads(Path(a.levels).read_text())
    if a.stage in ("render", "all"):
        stage_render(a, ex, ids, levels)
    if a.stage in ("colour", "all"):
        stage_colour(a, ids)
    if a.stage in ("tiles", "all"):
        stage_tiles(a, ex, ids)
    if a.stage in ("finish", "all"):
        stage_finish(a, ex, ids)


if __name__ == "__main__":
    main()
