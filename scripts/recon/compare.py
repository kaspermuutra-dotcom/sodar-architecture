"""Phase 8 helper: identical rectilinear views (yaw, pitch, hfov) from several cube sources of one sweep.

Sources: 'A' / 'C' / 'B' (render dir PNG faces), 't3' (the rejected live master tiles under site/public/media),
'preview' (the 512 px export cube). Writes a contact sheet per sweep with one row per source and 100 % crops.

Usage: python scripts/recon/compare.py <export> <id8> --render <dir> --out <dir> [--views yaw:pitch:hfov,...]
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recon.capture import CaptureExport  # noqa: E402
from recon.geom import sample_cube, view_dirs  # noqa: E402

FACE_NAMES = {0: "top", 1: "front", 2: "right", 3: "back", 4: "left", 5: "bottom"}
T3 = Path("site/public/media/portfolio/kaldapealse-tanav-2/t3/faces")


def t3_faces(id8: str) -> dict[int, np.ndarray] | None:
    d = T3 / id8
    if not d.exists():
        return None
    out = {}
    for f, name in FACE_NAMES.items():
        big = Image.new("RGB", (3072, 3072))
        for c in range(4):
            for r in range(4):
                big.paste(Image.open(d / f"{name}-2-{c}-{r}.webp"), (c * 768, r * 768))
        out[f] = np.asarray(big, np.float32)
    return out


def render_faces(render_dir: Path, id8: str, cand: str) -> dict[int, np.ndarray] | None:
    d = render_dir / id8
    if not (d / f"{cand}_front.png").exists():
        return None
    return {f: np.asarray(Image.open(d / f"{cand}_{n}.png").convert("RGB"), np.float32) for f, n in FACE_NAMES.items()}


def view(faces, yaw, pitch, hfov, w, h):
    d = view_dirs(yaw, pitch, hfov, w, h)
    return Image.fromarray(np.clip(sample_cube(faces, d), 0, 255).astype(np.uint8))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("export")
    ap.add_argument("id8")
    ap.add_argument("--render", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--views", default="0:0:50,60:0:50,120:0:50,180:0:50,240:0:50,300:0:50,0:-45:60,180:-45:60")
    ap.add_argument("--size", default="960x640")
    a = ap.parse_args()
    ex = CaptureExport(Path(a.export))
    sw = ex.by_id8(a.id8)
    w, h = (int(x) for x in a.size.split("x"))
    sources = {"preview": {n: sw.preview_face(n).astype(np.float32) for n in range(6)}, "t3 (rejected live)": t3_faces(a.id8)}
    for c in ("A", "B", "C", "D"):
        sources[f"candidate {c}"] = render_faces(Path(a.render), a.id8, c)
    sources = {k: v for k, v in sources.items() if v is not None}
    views = [tuple(float(x) for x in v.split(":")) for v in a.views.split(",")]
    sheet = Image.new("RGB", (len(views) * (w + 8), len(sources) * (h + 26)), (16, 16, 16))
    dr = ImageDraw.Draw(sheet)
    for r, (name, faces) in enumerate(sources.items()):
        for c, (yaw, pitch, hfov) in enumerate(views):
            im = view(faces, yaw, pitch, hfov, w, h)
            sheet.paste(im, (c * (w + 8), r * (h + 26) + 22))
            dr.text((c * (w + 8) + 4, r * (h + 26) + 4), f"{name}  yaw {yaw:.0f} pitch {pitch:.0f} hfov {hfov:.0f}", fill=(240, 240, 240))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    sheet.save(out / f"{a.id8}.compare.jpg", quality=85)
    print(out / f"{a.id8}.compare.jpg", sheet.size)


if __name__ == "__main__":
    main()
