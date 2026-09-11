"""Objective proxies for the three-scene scorecard, per candidate, at identical eye-level views.

sharpness       mean Laplacian variance of the six eye-level views (higher = more detail; false detail also scores)
straightness    RMS deviation (px) of edge points from their fitted long straight segments (LSD), lower = straighter
duplication     fraction of strong edge pixels that have a parallel strong edge 4–14 px away (ghost/double proxy)
refAgreement    NCC of the 2°-blurred view against the Matterport preview at the same view (geometric agreement)
colourSpread    std over the six views of the per-view median wall colour distance to the preview (consistency)

Usage: python scripts/recon/score.py <export> --render <dir> --out <json> --ids id8,...
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recon.capture import CaptureExport  # noqa: E402
from recon.compare import render_faces, t3_faces, view  # noqa: E402

VIEWS = [(y, -5, 50) for y in range(0, 360, 60)]
W, H = 960, 640


def lsd_straightness(gray: np.ndarray) -> tuple[float, int]:
    lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    lines = lsd.detect(gray)[0]
    if lines is None:
        return float("nan"), 0
    edges = cv2.Canny(gray, 60, 140)
    ys, xs = np.nonzero(edges)
    pts = np.stack([xs, ys], 1).astype(np.float32)
    devs = []
    for x1, y1, x2, y2 in np.asarray(lines).reshape(-1, 4):
        L = np.hypot(x2 - x1, y2 - y1)
        if L < 120:
            continue
        d = np.array([x2 - x1, y2 - y1]) / L
        n = np.array([-d[1], d[0]])
        rel = pts - np.array([x1, y1])
        along = rel @ d
        perp = rel @ n
        m = (along > 0) & (along < L) & (np.abs(perp) < 6)
        if m.sum() > 40:
            devs.append(float(np.sqrt((perp[m] ** 2).mean())))
    return (float(np.mean(devs)) if devs else float("nan")), len(devs)


def duplication(gray: np.ndarray) -> float:
    e = cv2.Canny(gray, 60, 140) > 0
    if e.sum() < 100:
        return float("nan")
    hits = np.zeros_like(e)
    for sh in range(4, 15, 2):
        for ax in (0, 1):
            hits |= e & np.roll(e, sh, axis=ax)
            hits |= e & np.roll(e, -sh, axis=ax)
    return float(hits.sum() / e.sum())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("export")
    ap.add_argument("--render", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ids", required=True)
    a = ap.parse_args()
    ex = CaptureExport(Path(a.export))
    out = {}
    for id8 in a.ids.split(","):
        sw = ex.by_id8(id8)
        prev = {n: sw.preview_face(n).astype(np.float32) for n in range(6)}
        sources = {"preview": prev, "t3": t3_faces(id8)}
        for c in "ABC":
            sources[c] = render_faces(Path(a.render), id8, c)
        sources = {k: v for k, v in sources.items() if v is not None}
        pv_views = [np.asarray(view(prev, y, p, f, W, H)) for y, p, f in VIEWS]
        res = {}
        for name, faces in sources.items():
            sharp, straight, nlines, dup, ncc, col = [], [], [], [], [], []
            for (y, p, f), pv in zip(VIEWS, pv_views):
                im = np.asarray(view(faces, y, p, f, W, H))
                g = cv2.cvtColor(im, cv2.COLOR_RGB2GRAY)
                sharp.append(float(cv2.Laplacian(g, cv2.CV_32F).var()))
                st, n = lsd_straightness(g)
                straight.append(st)
                nlines.append(n)
                dup.append(duplication(g))
                gb = cv2.GaussianBlur(g.astype(np.float32), (0, 0), 6)
                pb = cv2.GaussianBlur(cv2.cvtColor(pv, cv2.COLOR_RGB2GRAY).astype(np.float32), (0, 0), 6)
                ncc.append(float(np.corrcoef(gb.ravel(), pb.ravel())[0, 1]))
                col.append(float(np.median(np.abs(im.astype(np.float32) - pv.astype(np.float32)).mean(-1))))
            res[name] = {"sharpness": round(float(np.mean(sharp)), 1), "straightness_px": round(float(np.nanmean(straight)), 2), "longLines": int(np.sum(nlines)), "duplication": round(float(np.nanmean(dup)), 3), "refAgreement": round(float(np.mean(ncc)), 3), "colourSpread": round(float(np.std(col)), 2), "colourDiffToPreview": round(float(np.mean(col)), 2)}
        out[id8] = res
        print(id8, json.dumps(res))
    Path(a.out).write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
