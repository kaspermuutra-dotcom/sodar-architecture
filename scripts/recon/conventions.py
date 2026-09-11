"""Empirical convention checks for one sweep — every axis convention in this pipeline is *measured* here, not assumed.

  features : which signed axis permutation A maps Matterport's 3-D keypoints (sweep frame) into F so that the
             frame rotation + intrinsics reproduce the stored normalized keypoint coordinates
  depth    : which permutation maps cloud points into the depth panorama's equirect frame (range agreement)
  assign   : with MX, do directions labelled k by the assignment map fall inside frame k

Usage: python scripts/recon/conventions.py <export> <id8> [--json out]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recon.capture import MX, CaptureExport  # noqa: E402
from recon.geom import dirs_to_equirect, equirect_dirs, signed_perms  # noqa: E402


def check_features(sw) -> dict:
    ft = sw.features
    if not ft:
        return {"available": False}
    uv, fr, p3 = ft["uv"], ft["frame"], ft["xyz"]
    best = None
    for ai, A in enumerate(signed_perms()):
        pF = p3 @ A.T
        errs = []
        for k in range(6):
            sel = fr == k
            c = pF[sel] @ sw.frames_meta[k].R.T
            z = c[:, 2]
            ok = np.abs(z) > 1e-6
            for su in (1, -1):
                for sv in (1, -1):
                    u_pred = su * c[:, 0] / z
                    v_pred = sv * c[:, 1] / z
                    e = np.hypot(u_pred - uv[sel, 0], v_pred - uv[sel, 1])
                    errs.append(((su, sv), k, np.median(e[ok]) if ok.any() else 9, np.mean(e[ok] < 0.01) if ok.any() else 0))
        # aggregate per sign choice
        for su in (1, -1):
            for sv in (1, -1):
                rows = [x for x in errs if x[0] == (su, sv)]
                med = float(np.median([x[2] for x in rows]))
                frac = float(np.mean([x[3] for x in rows]))
                if best is None or frac > best["inlierFrac"]:
                    best = {"A": A.astype(int).tolist(), "signs": (su, sv), "medianErr": med, "inlierFrac": frac, "perFrameInlier": [round(x[3], 3) for x in rows]}
    best["available"] = True
    return best


def check_depth(sw) -> dict:
    cl = sw.cloud
    if not cl:
        return {"available": False}
    dm = sw.depth_m
    h, w = dm.shape
    p = cl["xyz"]
    rng = np.linalg.norm(p, axis=1)
    keep = rng > 0.3
    p, rng = p[keep], rng[keep]
    best = None
    for A in signed_perms():
        d = (p @ A.T) / rng[:, None]
        col, row = dirs_to_equirect(d, w, h)
        ci = np.clip(np.round(col).astype(int) % w, 0, w - 1)
        ri = np.clip(np.round(row).astype(int), 0, h - 1)
        z = dm[ri, ci]
        ok = z > 0.2
        rel = np.abs(z[ok] - rng[ok]) / rng[ok]
        frac = float(np.mean(rel < 0.03)) if ok.any() else 0.0
        if best is None or frac > best["inlierFrac"]:
            best = {"A": A.astype(int).tolist(), "inlierFrac": frac, "medianRel": float(np.median(rel)) if ok.any() else None, "known": float(ok.mean())}
    best["available"] = True
    best["depthKnownFrac"] = float((dm > 0.2).mean())
    return best


def check_assignment(sw) -> dict:
    am = sw.assignment_map
    if am is None:
        return {"available": False}
    h, w = am.shape
    d = equirect_dirs(w, h)
    dF = d @ MX.T
    out = {"available": True, "coverage": float((am != 255).mean()), "perFrame": []}
    K = sw.intrinsics
    for k in range(6):
        sel = am == k
        if not sel.any():
            out["perFrame"].append(None)
            continue
        col, row, valid = sw.project(dF[sel], k)
        inside = valid & (col >= 0) & (col < K.width) & (row >= 0) & (row < K.height)
        out["perFrame"].append({"labelled": int(sel.sum()), "insideFrac": round(float(inside.mean()), 4), "centreDist": round(float(np.median(np.hypot((col - K.cx) / K.width, (row - K.cy) / K.height)[inside])) if inside.any() else 9, 3)})
    return out


def check_offsets(sw) -> dict:
    offs = [f.offset_m for f in sw.frames_meta]
    if any(o is None for o in offs):
        return {"available": False}
    O = np.array(offs)
    axes = [f.R.T @ np.array([0, 0, -1.0]) for f in sw.frames_meta]  # optical axes in F
    return {"available": True, "radius_m": [round(float(np.linalg.norm(o[:2])), 3) for o in O], "z_m": [round(float(o[2]), 3) for o in O], "angleOffsetVsAxis_deg": [round(float(np.degrees(np.arctan2(o[1], o[0]) - np.arctan2(a[1], a[0]))) % 360, 1) for o, a in zip(O, axes)], "axisDown_deg": [round(float(np.degrees(np.arcsin(-a[2]))), 2) for a in axes]}


def run(export: CaptureExport, id8: str) -> dict:
    sw = export.by_id8(id8)
    return {"id": id8, "features": check_features(sw), "depth": check_depth(sw), "assignment": check_assignment(sw), "offsets": check_offsets(sw)}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("export")
    ap.add_argument("ids", nargs="+")
    ap.add_argument("--json")
    a = ap.parse_args()
    ex = CaptureExport(Path(a.export))
    res = [run(ex, i) for i in a.ids]
    print(json.dumps(res, indent=1))
    if a.json:
        Path(a.json).write_text(json.dumps(res, indent=1))
