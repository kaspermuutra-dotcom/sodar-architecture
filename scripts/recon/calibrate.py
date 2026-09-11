"""Phase 3a: solve the true camera system of one sweep — six rotations and six centres — from evidence.

Findings that motivate this (measured on this export, see docs/RECON_NOTES.md):
  * the container rotations are nominal (adjacent axes always ~57.6° apart); real frames deviate by 5–16°;
  * the focal length (1499.76 px) is right (free-focal fits return to it), distortion is negligible;
  * after correcting rotations, the residual ray disagreement is 0.2–1° — a few centimetres of baseline,
    not the 15–19 cm of the tracked offsets (field 31.6).

Model: frame k has rotation dR_k·R_k (F→camera) and centre t_k (F, metres). A pixel in frame a is lifted to
3-D with the LiDAR depth (base frame ← F via MXᵀ·T, where T is a small tilt solved jointly), reprojected into
frame b. Absolute orientation is anchored by matching each frame against the preview cubemap rendered in the
frame's nominal direction (Matterport's own single-centre rendering; near-field matches are down-weighted).

Usage: python scripts/recon/calibrate.py <export> <id8>... --out <dir> [--scale 4] [--method lightglue|sift]
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation as Rot

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recon.capture import MX, CaptureExport, Sweep  # noqa: E402
from recon.geom import dirs_to_equirect, sample_cube, view_dirs  # noqa: E402
from recon.matching import cached_match  # noqa: E402

PAIRS = [(k, (k + 1) % 6) for k in range(6)]
SKY_TO_DEPTH = np.diag([1.0, 1.0, -1.0])  # the skybox/assignment base is the mirror image of the physical depth base (mesh-UV test)


def sky_to_depth(dirs_sky: np.ndarray) -> np.ndarray:
    return dirs_sky * np.array([1.0, 1.0, -1.0])
PREVIEW_W, PREVIEW_H = 1024, 768  # rectilinear render of the preview per frame (≈ 9.6 px/deg, above the 512 px cube's ≈5.7)


def pix_to_ray(sw: Sweep, k: int, pts: np.ndarray, R: np.ndarray | None = None) -> np.ndarray:
    K = sw.intrinsics
    x = (K.cx - pts[:, 0]) / K.fx
    y = (K.cy - pts[:, 1]) / K.fy
    cam = np.stack([x, y, -np.ones_like(x)], -1)
    cam /= np.linalg.norm(cam, axis=1, keepdims=True)
    R = sw.frames_meta[k].R if R is None else R
    return cam @ R


def project_R(sw: Sweep, R: np.ndarray, P: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    K = sw.intrinsics
    c = P @ R.T
    z = c[:, 2]
    front = z < -0.05
    inv = np.where(front, -z, 1.0)
    return np.stack([K.cx - c[:, 0] / inv * K.fx, K.cy - c[:, 1] / inv * K.fy], -1), front


class DepthField:
    def __init__(self, sw: Sweep, w: int = 3600, h: int = 1801):
        self.dm = sw.depth_equirect(w, h)
        self.h, self.w = self.dm.shape
        d = self.dm
        gx = np.abs(np.diff(d, axis=1, prepend=d[:, :1]))
        gy = np.abs(np.diff(d, axis=0, prepend=d[:1]))
        rel = np.maximum(gx, gy) / np.maximum(d, 0.2)
        edge = (rel > 0.04) | (d <= 0.2)
        self.edge = cv2.dilate(edge.astype(np.uint8), np.ones((11, 11), np.uint8)).astype(bool)

    def lookup(self, dirs_base: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        col, row = dirs_to_equirect(dirs_base, self.w, self.h)
        ci = np.clip(np.round(col).astype(int) % self.w, 0, self.w - 1)
        ri = np.clip(np.round(row).astype(int), 0, self.h - 1)
        return self.dm[ri, ci], ~self.edge[ri, ci]


def preview_view(sw: Sweep, k: int) -> tuple[np.ndarray, np.ndarray]:
    """Rectilinear render of the preview cube along frame k's nominal axis, returned with its pixel→ray map (F)."""
    faces = {n: sw.preview_face(n) for n in range(6)}
    K = sw.intrinsics
    f = K.fx * PREVIEW_W / K.width
    gx, gy = np.meshgrid((np.arange(PREVIEW_W) + 0.5) - PREVIEW_W / 2, (np.arange(PREVIEW_H) + 0.5) - PREVIEW_H / 2)
    # same camera model as the frames: col = cx − fx·x/(−z) ⇒ x = −gx/f, y = −gy/f at z = −1
    cam = np.stack([-gx / f, -gy / f, -np.ones_like(gx)], -1)
    cam /= np.linalg.norm(cam, axis=-1, keepdims=True)
    dF = cam @ sw.frames_meta[k].R  # camera → F
    dB = dF @ MX  # F → base
    img = np.clip(sample_cube(faces, dB), 0, 255).astype(np.uint8)
    return img, dF


def gather(sw: Sweep, scale: int, cache: Path, method: str) -> dict:
    frames = [sw.frame(k, scale) for k in range(6)]
    pairs = {}
    for i, j in PAIRS:
        pa, pb, sc = cached_match(f"{sw.id8}.f{i}-f{j}.s{scale}", cache, frames[i], frames[j], scale, method)
        if len(pa) >= 12:
            pairs[(i, j)] = (pa, pb, sc)
    anchors = {}
    for k in range(6):
        img, dF = preview_view(sw, k)
        fr = frames[k]
        # match the frame (reduced) against the preview render at the render's resolution
        s2 = fr.shape[1] / PREVIEW_W
        fr2 = cv2.resize(fr, (PREVIEW_W, int(round(fr.shape[0] / s2)))) if abs(s2 - 1) > 1e-3 else fr
        pa, pb, sc = cached_match(f"{sw.id8}.f{k}-preview.s{scale}", cache, fr2, img, 1.0, method)
        if len(pa) >= 12:
            # frame pixels back to full resolution; preview pixels → rays in F (nominal)
            pa_full = pa * (sw.intrinsics.width / PREVIEW_W)
            ci = np.clip(pb[:, 0].astype(int), 0, PREVIEW_W - 1)
            ri = np.clip(pb[:, 1].astype(int), 0, PREVIEW_H - 1)
            anchors[k] = (pa_full, dF[ri, ci], sc)
    return {"pairs": pairs, "anchors": anchors}


def unpack(params: np.ndarray, sw: Sweep):
    dr = params[:18].reshape(6, 3)
    t = params[18:36].reshape(6, 3)
    tilt = params[36:39]
    Rs = [Rot.from_rotvec(dr[k]).as_matrix() @ sw.frames_meta[k].R for k in range(6)]
    T = Rot.from_rotvec(tilt).as_matrix()
    return Rs, t, T


def residuals(params: np.ndarray, sw: Sweep, data: dict, depth: DepthField, w_anchor: float, use_t: bool) -> np.ndarray:
    Rs, t, T = unpack(params, sw)
    if not use_t:
        t = np.zeros_like(t)
    res = []
    for (i, j), (pi, pj, sc) in data["pairs"].items():
        for a, b, pa, pb in ((i, j, pi, pj), (j, i, pj, pi)):
            r = pix_to_ray(sw, a, pa, Rs[a])
            # the ray leaves t[a]; the depth map is single-centre, so intersect iteratively: look the range up in the
            # direction of the current estimate of P, intersect the ray with that sphere, repeat
            P = r * 3.0
            ok = np.ones(len(r), bool)
            for _ in range(3):
                dirs = P / np.maximum(np.linalg.norm(P, axis=1, keepdims=True), 1e-6)
                d, ok_e = depth.lookup(sky_to_depth((dirs @ MX) @ T.T))
                ok = ok_e & (d > 0.2)
                d = np.where(ok, d, 3.0)
                b_ = 2 * (r * t[a]).sum(1)
                c_ = (t[a] ** 2).sum() - d * d
                s = (-b_ + np.sqrt(np.maximum(b_ * b_ - 4 * c_, 1e-9))) / 2
                P = t[a] + r * s[:, None]
            q, front = project_R(sw, Rs[b], P - t[b])
            e = np.clip(q - pb, -300, 300)
            e[~(ok & front)] = 0.0
            res.append(e.ravel())
    for k, (pa, dF, sc) in data["anchors"].items():
        # preview rays are single-centre: the point along dF at the LiDAR depth, seen from t[k]
        d, ok = depth.lookup(sky_to_depth((dF @ MX) @ T.T))
        far = d > 0.2
        d = np.where(far, d, 4.0)
        P = dF * d[:, None]
        q, front = project_R(sw, Rs[k], P - t[k])
        e = np.clip(q - pa, -300, 300) * w_anchor
        e[~front] = 0.0
        res.append(e.ravel())
    return np.concatenate(res)


def summarize(r: np.ndarray, n_pair: int) -> dict:
    e = np.hypot(r[0::2], r[1::2])
    ep = e[:n_pair]
    ea = e[n_pair:]
    out = {}
    for name, v in (("pairs", ep), ("anchors", ea)):
        v = v[v > 0]
        if len(v):
            out[name] = {"n": int(len(v)), "median_px": round(float(np.median(v)), 2), "p90_px": round(float(np.percentile(v, 90)), 2), "rms_px": round(float(np.sqrt((v ** 2).mean())), 2)}
    return out


def solve(sw: Sweep, data: dict, depth: DepthField, w_anchor: float = 0.5) -> dict:
    n_pair = 2 * sum(2 * len(v[0]) for v in data["pairs"].values())
    x0 = np.zeros(39)
    rep = {"before": summarize(residuals(x0, sw, data, depth, w_anchor, True), n_pair)}
    # stage 1: rotations + tilt only
    idx1 = np.r_[0:18]  # tilt frozen at 0: the depth base equals the skybox base (mesh-UV test, edge correlation)

    def f1(x):
        p = x0.copy()
        p[idx1] = x
        return residuals(p, sw, data, depth, w_anchor, False)

    s1 = least_squares(f1, x0[idx1], loss="soft_l1", f_scale=4.0, max_nfev=80)
    p1 = x0.copy()
    p1[idx1] = s1.x
    rep["rotations_only"] = summarize(residuals(p1, sw, data, depth, w_anchor, False), n_pair)
    # stage 2: everything, translations gauge-fixed by a weak prior to zero mean
    idx2 = np.r_[0:36]

    def f2(x):
        p = p1.copy()
        p[idx2] = x
        r = residuals(p, sw, data, depth, w_anchor, True)
        t = x[18:36].reshape(6, 3)
        return np.concatenate([r, 50.0 * t.mean(0)])

    s2 = least_squares(f2, p1[idx2], loss="soft_l1", f_scale=4.0, max_nfev=120)
    p2 = p1.copy()
    p2[idx2] = s2.x
    rep["full"] = summarize(residuals(p2, sw, data, depth, w_anchor, True), n_pair)
    Rs, t, T = unpack(p2, sw)
    dr = p2[:18].reshape(6, 3)
    rep["dR_deg"] = [round(float(np.degrees(np.linalg.norm(v))), 3) for v in dr]
    rep["t_m"] = np.round(t, 4).tolist()
    rep["t_radius_m"] = [round(float(np.linalg.norm(v)), 4) for v in t]
    rep["tilt_deg"] = [round(float(np.degrees(v)), 3) for v in p2[36:39]]
    offs = np.array([f.offset_m for f in sw.frames_meta])
    o = offs - offs.mean(0)
    rep["offset_vs_solved"] = {"recorded_radius_m": [round(float(np.linalg.norm(v)), 3) for v in o], "cosine": round(float((o * t).sum() / (np.linalg.norm(o) * np.linalg.norm(t) + 1e-9)), 3), "scale": round(float((o * t).sum() / ((o * o).sum() + 1e-9)), 3)}
    rep["params"] = p2.tolist()
    rep["R_solved_xyzw"] = [Rot.from_matrix(R).as_quat().tolist() for R in Rs]
    return rep


def run(sw: Sweep, scale: int, out: Path, method: str) -> dict:
    t0 = time.time()
    data = gather(sw, scale, out / "matches", method)
    depth = DepthField(sw)
    rep = {"id": sw.id8, "scale": scale, "method": method, "pairs": {f"{i}-{j}": int(len(v[0])) for (i, j), v in data["pairs"].items()}, "anchors": {str(k): int(len(v[0])) for k, v in data["anchors"].items()}}
    rep.update(solve(sw, data, depth))
    rep["seconds"] = round(time.time() - t0, 1)
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{sw.id8}.calib.json").write_text(json.dumps(rep, indent=1))
    return rep


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("export")
    ap.add_argument("ids", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--scale", type=int, default=4)
    ap.add_argument("--method", default="lightglue")
    ap.add_argument("--camera-json")
    a = ap.parse_args()
    ex = CaptureExport(Path(a.export))
    if a.camera_json:
        ex.override_camera(json.loads(Path(a.camera_json).read_text())["params_full"])
    for i in a.ids:
        r = run(ex.by_id8(i), a.scale, Path(a.out), a.method)
        print(json.dumps({k: v for k, v in r.items() if k not in ("params", "R_solved_xyzw", "t_m")}, indent=None))
