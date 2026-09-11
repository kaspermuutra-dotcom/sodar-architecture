"""Phase 4/5: depth-assisted multi-view rendering of one sweep (Candidate C) plus the reference candidates.

Candidate A  — the 512 px preview cube upscaled (Lanczos), no added detail.
Candidate C  — every output direction is lifted to 3-D with the LiDAR depth (from the sweep centre), reprojected
               into each frame with the frame's *solved* rotation and centre, tested for occlusion against a
               z-buffer of that frame, and the best visible frame is chosen by view angle; seams between adjacent
               frames are dynamic-programming paths through the overlap bands that avoid colour differences and
               strong edges; a narrow blend (default 0.35°) hides residual misalignment; polar caps outside the
               frames' coverage come from the preview (marked in the confidence map).

Outputs (out/<id8>/): <face>.png masters (skybox layout), equirect.jpg, labels.png (source frame per pixel),
confidence.png, depth.png, and render.json with statistics.

Usage: python scripts/recon/render.py <export> <id8> --calib <calib-dir> --camera-json <json> --out <dir>
       [--face 3072] [--candidates A,C] [--blend-deg 0.35]
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
from PIL import Image
from scipy.spatial.transform import Rotation as Rot

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recon.capture import MX, CaptureExport, Sweep  # noqa: E402
from recon.geom import bilinear, dirs_to_equirect, equirect_dirs, face_dirs, sample_cube  # noqa: E402

FACE_NAMES = {0: "top", 1: "front", 2: "right", 3: "back", 4: "left", 5: "bottom"}
VIGNETTE_A, VIGNETTE_B = -0.2758, -0.0322  # lens falloff log v(r) = a r² + b r⁴ (fitted earlier on frame overlaps)
FAR_M = 40.0


def sky_to_depth(d: np.ndarray) -> np.ndarray:
    return d * np.array([1.0, 1.0, -1.0], np.float32)


class SweepModel:
    """Calibrated geometry of one sweep in the skybox base frame."""

    def __init__(self, sw: Sweep, calib: dict | None):
        self.sw = sw
        self.K = sw.intrinsics
        if calib is not None:
            p = np.array(calib["params"])
            dr = p[:18].reshape(6, 3)
            self.t = p[18:36].reshape(6, 3)
            self.tilt = Rot.from_rotvec(p[36:39]).as_matrix()
            self.R = [Rot.from_rotvec(dr[k]).as_matrix() @ sw.frames_meta[k].R for k in range(6)]
        else:
            self.t = np.zeros((6, 3))
            self.tilt = np.eye(3)
            self.R = [sw.frames_meta[k].R for k in range(6)]
        # unpacked depth (physical base) at full resolution, plus an edge mask
        self.depth = sw.depth_equirect(3600, 1801)
        d = self.depth
        gx = np.abs(np.diff(d, axis=1, append=d[:, :1]))
        gy = np.abs(np.diff(d, axis=0, append=d[-1:]))
        rel = np.maximum(gx, gy) / np.maximum(d, 0.2)
        self.edge = cv2.dilate(((rel > 0.06) & (d > 0.2)).astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
        # near-object dilation: within the edge zone every direction takes the *nearest* depth in a 0.5° window.
        # The LiDAR silhouette is a few 0.1° cells off; with 10–30 cm frame baselines a far-wall pixel wrongly
        # given the near depth only shows a slightly displaced piece of that wall, whereas a near-object pixel
        # wrongly given the far depth is displaced by degrees (serrated edges). So err towards "near".
        dm_inf = np.where(d > 0.2, d, np.inf).astype(np.float32)
        self.depth_near = cv2.erode(dm_inf, np.ones((9, 9), np.uint8))  # ≈0.9° near-object dilation
        self.depth_near[~np.isfinite(self.depth_near)] = 0.0
        self.zbufs = None

    # --- depth ------------------------------------------------------------------------------------------
    def range_sky(self, d_sky: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Range (m) and 'near a depth edge' flag along skybox-base directions (bilinear on the unpacked equirect)."""
        dd = sky_to_depth(d_sky) @ self.tilt  # tilt maps nominal → depth base; T.T applied to row vectors
        h, w = self.depth.shape
        col, row = dirs_to_equirect(dd, w, h)
        col = np.mod(col, w)
        pad = np.concatenate([self.depth, self.depth[:, :1]], axis=1)
        r = bilinear(pad, col, row)
        # bilinear across a depth edge or an unknown (0) neighbour would invent intermediate depths that float
        # between the two surfaces; use the nearest sample there
        ci = np.clip(np.round(col).astype(int) % w, 0, w - 1)
        ri = np.clip(np.round(row).astype(int), 0, h - 1)
        rn = self.depth_near[ri, ci]
        e = self.edge[ri, ci]
        r = np.where(e | (r < 0.1), rn, r)
        return r, e

    # --- frames -----------------------------------------------------------------------------------------
    def frame_zbuffers(self, cell: int = 4) -> list[np.ndarray]:
        """Per-frame z-buffer (min −z per cell) from the depth map seen from the frame's own centre."""
        if self.zbufs is not None:
            return self.zbufs
        d_sky = equirect_dirs(3600, 1800)
        r, _ = self.range_sky(d_sky)
        valid = r > 0.2
        P_sky = d_sky * np.where(valid, r, np.nan)[..., None]
        P_F = P_sky.reshape(-1, 3) @ MX.T
        W, H = self.K.width // cell + 1, self.K.height // cell + 1
        out = []
        for k in range(6):
            c = (P_F - self.t[k]) @ self.R[k].T
            z = -c[:, 2]
            ok = np.isfinite(z) & (z > 0.05)
            col = self.K.cx - c[:, 0] / np.where(ok, z, 1) * self.K.fx
            row = self.K.cy - c[:, 1] / np.where(ok, z, 1) * self.K.fy
            ok &= (col >= 0) & (col < self.K.width) & (row >= 0) & (row < self.K.height)
            zb = np.full((H, W), np.inf, np.float32)
            gi = (row[ok] / cell).astype(int)
            gj = (col[ok] / cell).astype(int)
            np.minimum.at(zb, (gi, gj), z[ok].astype(np.float32))
            # fill empty cells from neighbours (depth map holes)
            zb = np.where(np.isfinite(zb), zb, np.nan)
            zb = cv2.blur(np.nan_to_num(zb, nan=0.0), (3, 3)) / np.maximum(cv2.blur(np.isfinite(zb).astype(np.float32), (3, 3)), 1e-6)
            out.append(zb)
        self.zbufs = out
        return out

    def set_guides(self, imgs: list[np.ndarray], scale: int) -> None:
        """Frame images (reduced by `scale`) used to align each frame's depth with its own edges."""
        self._guides = []
        for im in imgs:
            g = cv2.cvtColor(np.clip(im, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
            self._guides.append(g)
        self._guide_scale = scale
        self._refined = None

    def frame_depths(self) -> list[np.ndarray]:
        """Per-frame depth (metres along −z) on the 4-px cell grid, joint-bilateral-refined with the frame image so the
        depth silhouettes sit on the image edges (the LiDAR silhouette alone is a few 0.1° cells off, which with
        10–30 cm baselines becomes bands of texture displaced by degrees)."""
        if getattr(self, "_refined", None) is not None:
            return self._refined
        zbs = self.frame_zbuffers()
        out = []
        for k, zb in enumerate(zbs):
            if not hasattr(self, "_guides"):
                out.append(zb)
                continue
            g = self._guides[k]
            gh, gw = zb.shape
            g = cv2.resize(g, (gw, gh), interpolation=cv2.INTER_AREA)
            zb = cv2.medianBlur(zb.astype(np.float32), 5)
            refined = joint_bilateral(zb, g, radius=12, sigma_s=7.0, sigma_c=12.0)
            # at real discontinuities a weighted mean still yields in-between depths: snap to the near or the far
            # surface by an affinity-weighted majority vote instead
            # (a majority-vote near/far snap was tried here and made the edges blockier; see snap_discontinuities)
            # only trust the image-guided depth where the image has an edge to align to; elsewhere the joint
            # bilateral degenerates into a blur that smears silhouettes (white wall in front of a white wall)
            grad = cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1))
            has_edge = cv2.GaussianBlur((grad > 25).astype(np.float32), (0, 0), 4) > 0.08
            out.append(np.where(has_edge, refined, zb).astype(np.float32))
        self._refined = out
        return out

    def project(self, k: int, P_F: np.ndarray, iterations: int = 2, occlusion: bool = True) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Full-resolution pixel coordinates of 3-D points (F) in frame k with a visibility flag.

        P_F is the sweep-centre lift (direction × LiDAR range). The pixel is refined by iterating with the frame's
        own image-aligned depth: the point along the same direction at the range the frame reports, re-projected.
        Occlusion: the frame's depth at the final pixel is well in front of the point."""
        cell = 4
        d = P_F / np.maximum(np.linalg.norm(P_F, axis=-1, keepdims=True), 1e-9)
        depths = self.frame_depths()[k]
        P = P_F
        for it in range(iterations + 1):
            c = (P - self.t[k]) @ self.R[k].T
            z = -c[..., 2]
            ok = z > 0.05
            zz = np.where(ok, z, 1.0)
            col = self.K.cx - c[..., 0] / zz * self.K.fx
            row = self.K.cy - c[..., 1] / zz * self.K.fy
            ok &= (col >= 1) & (col < self.K.width - 2) & (row >= 1) & (row < self.K.height - 2)
            gi = np.clip((row / cell).astype(int), 0, depths.shape[0] - 1)
            gj = np.clip((col / cell).astype(int), 0, depths.shape[1] - 1)
            zf = depths[gi, gj]
            if it == iterations:
                break
            # the frame says the surface at this pixel is at depth zf: move the point along its own direction to
            # the range that puts it there (solve |t + s·d − ...|: use the ratio of depths along the camera axis)
            s_new = np.linalg.norm(P - self.t[k], axis=-1) * np.where(ok & (zf > 0.05), zf / zz, 1.0)
            # back to the sweep-centre ray: X = t_k + s_new·ray_k, then project onto d
            ray = (P - self.t[k]) / np.maximum(np.linalg.norm(P - self.t[k], axis=-1, keepdims=True), 1e-9)
            X = self.t[k] + ray * s_new[..., None]
            rng = np.maximum((X * d).sum(-1), 0.1)
            P = np.where((ok & (zf > 0.05))[..., None], d * rng[..., None], P)
        if occlusion:
            occl = (z > zf * 1.04 + 0.06) & (zf > 0.05)
            ok &= ~occl
        return col, row, ok

    def axis_F(self, k: int) -> np.ndarray:
        return self.R[k].T @ np.array([0.0, 0.0, -1.0])


def joint_bilateral(depth: np.ndarray, guide: np.ndarray, radius: int = 7, sigma_s: float = 4.0, sigma_c: float = 9.0) -> np.ndarray:
    """Joint bilateral filter of a depth map guided by a grayscale image (weights: spatial × colour affinity)."""
    h, w = depth.shape
    valid = (depth > 0.05).astype(np.float32)
    num = np.zeros_like(depth, np.float32)
    den = np.zeros_like(depth, np.float32)
    pad = radius
    dp = cv2.copyMakeBorder(depth, pad, pad, pad, pad, cv2.BORDER_REFLECT)
    vp = cv2.copyMakeBorder(valid, pad, pad, pad, pad, cv2.BORDER_REFLECT)
    gp = cv2.copyMakeBorder(guide, pad, pad, pad, pad, cv2.BORDER_REFLECT)
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            ws = math.exp(-(dx * dx + dy * dy) / (2 * sigma_s * sigma_s))
            if ws < 0.02:
                continue
            gs = gp[pad + dy : pad + dy + h, pad + dx : pad + dx + w]
            ds = dp[pad + dy : pad + dy + h, pad + dx : pad + dx + w]
            vs = vp[pad + dy : pad + dy + h, pad + dx : pad + dx + w]
            wc = np.exp(-((gs - guide) ** 2) / (2 * sigma_c * sigma_c)) * ws * vs
            num += wc * ds
            den += wc
    out = np.where(den > 1e-6, num / np.maximum(den, 1e-6), depth)
    return out.astype(np.float32)


def snap_discontinuities(depth: np.ndarray, guide: np.ndarray, radius: int = 10, sigma_s: float = 6.0, sigma_c: float = 12.0) -> dict:
    """Near/far decision at depth discontinuities by an image-affinity-weighted majority vote.

    Candidates per pixel: the local minimum (near) and maximum (far) depth in the window. Each neighbour votes for
    the candidate its own depth is closer to, weighted by spatial and colour affinity to the centre pixel."""
    h, w = depth.shape
    valid = depth > 0.05
    dinf = np.where(valid, depth, np.inf).astype(np.float32)
    dneg = np.where(valid, depth, -np.inf).astype(np.float32)
    k = np.ones((2 * radius + 1, 2 * radius + 1), np.uint8)
    near = cv2.erode(dinf, k)
    far = cv2.dilate(dneg, k)
    near = np.where(np.isfinite(near), near, depth)
    far = np.where(np.isfinite(far), far, depth)
    mid = 0.5 * (near + far)
    vote_near = np.zeros_like(depth, np.float32)
    vote_far = np.zeros_like(depth, np.float32)
    pad = radius
    dp = cv2.copyMakeBorder(depth, pad, pad, pad, pad, cv2.BORDER_REFLECT)
    vp = cv2.copyMakeBorder(valid.astype(np.float32), pad, pad, pad, pad, cv2.BORDER_REFLECT)
    gp = cv2.copyMakeBorder(guide, pad, pad, pad, pad, cv2.BORDER_REFLECT)
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            ws = math.exp(-(dx * dx + dy * dy) / (2 * sigma_s * sigma_s))
            if ws < 0.02:
                continue
            gs = gp[pad + dy : pad + dy + h, pad + dx : pad + dx + w]
            ds = dp[pad + dy : pad + dy + h, pad + dx : pad + dx + w]
            vs = vp[pad + dy : pad + dy + h, pad + dx : pad + dx + w]
            wc = np.exp(-((gs - guide) ** 2) / (2 * sigma_c * sigma_c)) * ws * vs
            is_near = ds < mid
            vote_near += wc * is_near
            vote_far += wc * (~is_near)
    chosen = np.where(vote_near >= vote_far, near, far).astype(np.float32)
    return {"depth": chosen, "ratio": far / np.maximum(near, 0.05)}


def frame_images(sw: Sweep, scale: int = 1) -> list[np.ndarray]:
    return [sw.frame(k, scale).astype(np.float32) for k in range(6)]


def vignette(K, col: np.ndarray, row: np.ndarray) -> np.ndarray:
    r2 = np.clip(((col - K.cx) ** 2 + (row - K.cy) ** 2) / (K.cx * K.cx + K.cy * K.cy), 0.0, 1.0)  # clipped: far-outside projections must stay finite
    return np.exp(-(VIGNETTE_A * r2 + VIGNETTE_B * r2 * r2) / 2.2)


def apply_gain(v: np.ndarray, g: np.ndarray, field: np.ndarray | None = None) -> np.ndarray:
    """Per-channel gain (and optional per-pixel gain field) in linear light on sRGB-encoded values."""
    lin = np.clip(v / 255.0, 0, None) ** 2.2 * g
    if field is not None:
        lin = lin * field
    return np.clip(lin, 0, 1) ** (1 / 2.2) * 255.0


def field_at(fields: np.ndarray, k: int, col_e: np.ndarray, row_e: np.ndarray, LW: int, LH: int) -> np.ndarray:
    """Sample frame k's gain field (720×360 equirect) at label-map coordinates."""
    fh, fw = fields.shape[1:3]
    fc = np.mod(col_e * (fw / LW), fw)
    fr = np.clip(row_e * (fh / LH), 0, fh - 1.001)
    pad = np.concatenate([fields[k], fields[k][:, :1]], axis=1)
    return bilinear(pad, fc, fr)


def sample_frame(img: np.ndarray, col: np.ndarray, row: np.ndarray, K, scale: int) -> np.ndarray:
    """Bicubic sample of a (possibly reduced) frame at full-resolution pixel coordinates, vignetting removed."""
    cx = np.clip(col / scale, -2, img.shape[1] + 1).astype(np.float32)
    cy = np.clip(row / scale, -2, img.shape[0] + 1).astype(np.float32)
    m = np.clip(cv2.remap(img, cx, cy, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT), 0, 255)  # cubic overshoot would turn into NaN in the gamma maths
    return np.nan_to_num(m * vignette(K, col, row)[..., None], nan=0.0, posinf=0.0, neginf=0.0)


# ---------------------------------------------------------------------------------------------------------
# candidate C
# ---------------------------------------------------------------------------------------------------------
def exposure_gains(model: SweepModel, imgs: list[np.ndarray], scale: int, preview: dict[int, np.ndarray] | None = None) -> np.ndarray:
    """Per-frame, per-channel linear-light gains anchored to Matterport's preview cube (its colour is already
    consistent across the sweep). Robust median of blurred preview / blurred frame over well-exposed, edge-free
    directions; falls back to ring-of-overlaps chaining when no preview is given."""
    d_sky = equirect_dirs(720, 360)
    r, edge = model.range_sky(d_sky)
    valid = (r > 0.2) & ~edge
    P_F = (d_sky * np.where(valid, r, 3.0)[..., None]).reshape(-1, 3) @ MX.T
    vals, oks = [], []
    for k in range(6):
        col, row, ok = model.project(k, P_F)
        v = sample_frame(imgs[k], col.reshape(d_sky.shape[:2]), row.reshape(d_sky.shape[:2]), model.K, scale)
        vals.append(v)
        oks.append((ok & valid.ravel()).reshape(d_sky.shape[:2]))
    g = np.ones((6, 3))
    if preview is not None:
        ref = np.clip(sample_cube(preview, d_sky), 0, 255) / 255.0
        ref_lin = cv2.GaussianBlur(ref ** 2.2, (0, 0), 3)
        fields = np.ones((6,) + d_sky.shape[:2] + (3,), np.float32)
        for k in range(6):
            lin = (np.clip(vals[k], 0, 255) / 255.0) ** 2.2
            good = oks[k] & (vals[k].mean(-1) > 25) & (vals[k].mean(-1) < 235) & (ref.mean(-1) > 0.08) & (ref.mean(-1) < 0.92)
            m = good.astype(np.float32)
            num = cv2.GaussianBlur(lin * m[..., None], (0, 0), 3)
            den = cv2.GaussianBlur(m, (0, 0), 3)
            ok3 = den > 0.9
            if ok3.sum() > 300:
                fr = num[ok3] / den[ok3][:, None]
                g[k] = np.median(ref_lin[ok3] / np.maximum(fr, 1e-4), axis=0)
                # spatial residual: smooth ratio field (lens shading, local exposure), normalized-convolution filled
                ratio = np.where(ok3[..., None], ref_lin / np.maximum(num / np.maximum(den, 1e-6)[..., None], 1e-4) / g[k], 0.0)
                w = ok3.astype(np.float32)
                fine = cv2.GaussianBlur(ratio * w[..., None], (0, 0), 6) / np.maximum(cv2.GaussianBlur(w, (0, 0), 6), 1e-6)[..., None]
                coarse = cv2.GaussianBlur(ratio * w[..., None], (0, 0), 40) / np.maximum(cv2.GaussianBlur(w, (0, 0), 40), 1e-6)[..., None]
                dens = cv2.GaussianBlur(w, (0, 0), 6)
                field = np.where(dens[..., None] > 0.6, fine, np.where(cv2.GaussianBlur(w, (0, 0), 40)[..., None] > 0.05, coarse, 1.0))
                fields[k] = np.clip(field, 0.5, 2.0).astype(np.float32)
        norm = np.exp(np.log(g).mean(0))
        return g / norm, fields
    ratios = np.ones((6, 3))
    for k in range(6):
        j = (k + 1) % 6
        m = oks[k].ravel() & oks[j].ravel()
        a, b = vals[k].reshape(-1, 3)[m], vals[j].reshape(-1, 3)[m]
        good = (a.mean(1) > 20) & (b.mean(1) > 20) & (a.mean(1) < 235) & (b.mean(1) < 235)
        if good.sum() > 200:
            ratios[k] = np.median(((a[good] / 255.0) ** 2.2) / np.maximum((b[good] / 255.0) ** 2.2, 1e-4), axis=0)
    logs = np.zeros((6, 3))
    for k in range(5):
        logs[k + 1] = logs[k] - np.log(np.maximum(ratios[k], 1e-3))
    loop = logs[5] - np.log(np.maximum(ratios[5], 1e-3)) - logs[0]
    logs -= (np.arange(6) / 6)[:, None] * loop[None]
    return np.exp(logs - logs.mean(0)), np.ones((6, 360, 720, 3), np.float32)


def label_map(model: SweepModel, imgs: list[np.ndarray], gains: np.ndarray, scale: int, W: int = 2048, H: int = 1024, edge_w: float = 6.0, fields: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray, dict]:
    """Source-frame label per equirect pixel (skybox base): view-angle preference, then DP seams in the overlap bands."""
    d_sky = equirect_dirs(W, H)
    r, dedge = model.range_sky(d_sky)
    known = r > 0.2
    P_F = (d_sky * np.where(known, r, FAR_M)[..., None]).reshape(-1, 3) @ MX.T
    cost = np.full((6, H, W), np.inf, np.float32)
    vis = np.zeros((6, H, W), bool)
    small = []
    for k in range(6):
        col, row, ok = model.project(k, P_F)
        col, row, ok = col.reshape(H, W), row.reshape(H, W), ok.reshape(H, W)
        vis[k] = ok
        # preference: distance from the frame centre in normalized units (0 centre → 1 corner)
        dist = np.hypot((col - model.K.cx) / model.K.cx, (row - model.K.cy) / model.K.cy)
        cost[k] = np.where(ok, dist, np.inf)
        d_col, d_row = dirs_to_equirect(d_sky, W, H)
        v = apply_gain(sample_frame(imgs[k], col, row, model.K, scale), gains[k], field_at(fields, k, np.mod(d_col, W), d_row, W, H) if fields is not None else None)
        v[~ok] = 0
        small.append(v)
    labels = np.argmin(cost, axis=0).astype(np.int16)
    covered = np.isfinite(cost.min(axis=0))
    labels[~covered] = -1
    # DP seams between adjacent frames inside their overlap: minimise colour difference + edge strength
    gray = [cv2.cvtColor(np.clip(s, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) for s in small]
    edges = [cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1)) for g in gray]
    stats = {}
    order = [int(k) for k in np.argsort([math.atan2(model.axis_F(k)[1], model.axis_F(k)[0]) for k in range(6)])]
    for idx in range(6):
        a, b = order[idx], order[(idx + 1) % 6]
        both = vis[a] & vis[b]
        if both.sum() < 500:
            continue
        cols = np.where(both.any(axis=0))[0]
        # the overlap band may wrap at the ±180° seam: roll so it is contiguous
        roll = 0
        if cols.min() == 0 and cols.max() == W - 1:
            gap = np.where(np.diff(cols) > 1)[0]
            if len(gap):
                roll = W - cols[gap[0] + 1]
        bb = np.roll(both, roll, axis=1)
        cols = np.where(bb.any(axis=0))[0]
        c0, c1 = cols.min(), cols.max() + 1
        diff = np.roll(np.abs(small[a] - small[b]).mean(-1), roll, axis=1)[:, c0:c1]
        e = np.roll(np.maximum(edges[a], edges[b]), roll, axis=1)[:, c0:c1]
        de = np.roll(dedge, roll, axis=1)[:, c0:c1]
        band = bb[:, c0:c1]
        c = diff + edge_w * e / (e.mean() + 1e-6) + 40.0 * de
        c = np.where(band, c, 1e4)
        rows = np.where(band.any(axis=1))[0]
        r0, r1 = rows.min(), rows.max() + 1
        c = c[r0:r1]
        n, m = c.shape
        acc = c.copy()
        back = np.zeros((n, m), np.int32)
        for i in range(1, n):
            prev = acc[i - 1]
            cand = np.stack([np.r_[np.inf, prev[:-1]], prev, np.r_[prev[1:], np.inf]], 0)
            j = np.argmin(cand, axis=0)
            acc[i] += cand[j, np.arange(m)]
            back[i] = j - 1
        path = np.zeros(n, np.int32)
        path[-1] = int(np.argmin(acc[-1]))
        for i in range(n - 1, 0, -1):
            path[i - 1] = path[i] + back[i, path[i]]
        # left of the path → a (if a is on the left in the rolled frame), right → b
        la = np.roll(labels, roll, axis=1)
        a_left = np.roll(vis[a], roll, axis=1)[:, :c0].sum() + (np.roll(vis[a], roll, axis=1)[:, c0:c1] & ~band).sum() > np.roll(vis[b], roll, axis=1)[:, :c0].sum() + (np.roll(vis[b], roll, axis=1)[:, c0:c1] & ~band).sum()
        left, right = (a, b) if a_left else (b, a)
        for i in range(n):
            rr = r0 + i
            lo = c0 + path[i]
            seg = la[rr, c0:c1]
            bd = band[rr]
            sel_l = bd & (np.arange(c0, c1) < lo)
            sel_r = bd & (np.arange(c0, c1) >= lo)
            seg[sel_l] = left
            seg[sel_r] = right
            la[rr, c0:c1] = seg
        labels = np.roll(la, -roll, axis=1)
        stats[f"{a}-{b}"] = {"overlap_px": int(both.sum()), "seam_cost": float(acc[-1].min() / max(n, 1))}
    conf = np.where(covered, 1.0, 0.0).astype(np.float32)
    conf[dedge & covered] = 0.6
    return labels, conf, {"seams": stats, "coverage": float(covered.mean()), "depthKnown": float(known.mean())}


def render_faces(model: SweepModel, imgs: list[np.ndarray], gains: np.ndarray, labels: np.ndarray, scale: int, face: int, blend_deg: float, preview: dict[int, np.ndarray], fields: np.ndarray | None = None) -> tuple[dict[int, np.ndarray], dict[int, np.ndarray]]:
    """Composite the six cube faces from the label map (soft seams), preview fallback outside coverage."""
    LH, LW = labels.shape
    faces, confs = {}, {}
    # soft weights per frame from the label map: distance transform to the seam, in degrees
    weights = []
    for k in range(6):
        m = (labels == k).astype(np.uint8)
        if m.any():
            inside = cv2.distanceTransform(m, cv2.DIST_L2, 3)
            outside = cv2.distanceTransform(1 - m, cv2.DIST_L2, 3)
            sd = (inside - outside) * (360.0 / LW)  # signed distance in degrees (at the equator)
            weights.append(np.clip(sd / blend_deg + 0.5, 0, 1).astype(np.float32))
        else:
            weights.append(np.zeros((LH, LW), np.float32))
    weights = np.stack(weights, 0)
    # low-frequency weights: the same seams, blended over a wide band (two-band blend)
    lo_deg = max(4.0, blend_deg)
    weights_lo = []
    for k in range(6):
        m = (labels == k).astype(np.uint8)
        if m.any():
            sd = (cv2.distanceTransform(m, cv2.DIST_L2, 3) - cv2.distanceTransform(1 - m, cv2.DIST_L2, 3)) * (360.0 / LW)
            weights_lo.append(np.clip(sd / lo_deg + 0.5, 0, 1).astype(np.float32))
        else:
            weights_lo.append(np.zeros((LH, LW), np.float32))
    weights_lo = np.stack(weights_lo, 0)
    # coverage boundary (polar caps): smoothed by closing small notches, blended over 1.5°
    covered = (labels >= 0).astype(np.uint8)
    covered = cv2.morphologyEx(covered, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    covered = cv2.erode(covered, np.ones((5, 5), np.uint8))
    cov_sd = (cv2.distanceTransform(covered, cv2.DIST_L2, 3) - cv2.distanceTransform(1 - covered, cv2.DIST_L2, 3)) * (360.0 / LW)
    cov_sd = cv2.GaussianBlur(cov_sd.astype(np.float32), (0, 0), 3)  # the label grid is coarse: keep the cap boundary smooth at face resolution
    cov_w = np.clip(cov_sd / 2.0 + 0.5, 0, 1).astype(np.float32)
    chunk = 256
    for f in range(6):
        out = np.zeros((face, face, 3), np.float32)
        out_lo = np.zeros((face, face, 3), np.float32)
        cf = np.zeros((face, face), np.float32)
        for r0 in range(0, face, chunk):
            d_sky = face_dirs(f, face, slice(r0, r0 + chunk))
            h = d_sky.shape[0]
            rng, dedge = model.range_sky(d_sky)
            known = rng > 0.2
            P_F = (d_sky * np.where(known, rng, FAR_M)[..., None]).reshape(-1, 3) @ MX.T
            col_e, row_e = dirs_to_equirect(d_sky, LW, LH)
            col_e = np.mod(col_e, LW)
            wsum = np.zeros((h, face), np.float32)
            acc = np.zeros((h, face, 3), np.float32)
            wsum_lo = np.zeros((h, face), np.float32)
            acc_lo = np.zeros((h, face, 3), np.float32)
            for k in range(6):
                wk = bilinear(np.concatenate([weights[k], weights[k][:, :1]], 1), col_e, row_e)
                wl = bilinear(np.concatenate([weights_lo[k], weights_lo[k][:, :1]], 1), col_e, row_e)
                if max(wk.max(), wl.max()) <= 0:
                    continue
                col, row, ok = model.project(k, P_F)
                col, row, ok = col.reshape(h, face), row.reshape(h, face), ok.reshape(h, face)
                # outside-the-frame guard (the label map is coarser than the face)
                wk = np.where(ok, wk, 0.0)
                wl = np.where(ok, wl, 0.0)
                if max(wk.max(), wl.max()) <= 0:
                    continue
                v = apply_gain(sample_frame(imgs[k], col, row, model.K, scale), gains[k], field_at(fields, k, col_e, row_e, LW, LH) if fields is not None else None)
                v[~ok] = 0.0
                acc += v * wk[..., None]
                wsum += wk
                acc_lo += v * wl[..., None]
                wsum_lo += wl
            cw = bilinear(np.concatenate([cov_w, cov_w[:, :1]], 1), col_e, row_e)
            have = wsum > 1e-3
            comp = np.zeros_like(acc)
            comp[have] = acc[have] / wsum[have][:, None]
            # slivers the label map does not cover (occlusion streaks, coarse labels): take any visible frame
            miss = ~have & (cw > 0.01)
            if miss.any():
                # fill from frames in order of their (wide) seam weight here, so slivers take a consistent source
                pref = [k for k in np.argsort([-float(bilinear(np.concatenate([weights_lo[k], weights_lo[k][:, :1]], 1), col_e, row_e)[miss].mean()) if miss.any() else 0.0 for k in range(6)])]
                for k in pref:
                    col, row, ok = model.project(k, P_F)
                    ok = ok.reshape(h, face) & miss
                    if not ok.any():
                        continue
                    v = apply_gain(sample_frame(imgs[k], col.reshape(h, face), row.reshape(h, face), model.K, scale), gains[k], field_at(fields, k, col_e, row_e, LW, LH) if fields is not None else None)
                    comp[ok] = v[ok]
                    have |= ok
                    miss &= ~ok
            cw = np.where(have, cw, 0.0)
            pv = sample_cube(preview, d_sky)
            w_frames = np.where(have, cw, 0.0)
            have_lo = wsum_lo > 1e-3
            comp_lo = comp.copy()
            comp_lo[have_lo] = acc_lo[have_lo] / wsum_lo[have_lo][:, None]
            out[r0 : r0 + h] = comp * w_frames[..., None] + pv * (1 - w_frames)[..., None]
            out_lo[r0 : r0 + h] = comp_lo * w_frames[..., None] + pv * (1 - w_frames)[..., None]
            cf[r0 : r0 + h] = w_frames * np.where(known, 1.0, 0.7) * np.where(dedge, 0.6, 1.0)
        # two-band blend: low frequencies from the wide-seam composite, detail from the narrow one
        sigma = face / 90.0 * 1.2  # ≈1.2° at the face centre
        lo_of_wide = cv2.GaussianBlur(out_lo, (0, 0), sigma)
        lo_of_narrow = cv2.GaussianBlur(out, (0, 0), sigma)
        faces[f] = np.clip(out - lo_of_narrow + lo_of_wide, 0, 255).astype(np.uint8)
        confs[f] = cf
    return faces, confs


def cap_match(faces_c: dict[int, np.ndarray], preview: dict[int, np.ndarray], confs: dict[int, np.ndarray]) -> dict[int, np.ndarray]:
    """Match the preview fallback (caps) to the rendered frames in linear RGB so the cap does not change colour."""
    a, b = [], []
    for f in range(6):
        cf = confs[f]
        m = (cf > 0.95)
        if m.sum() < 1000:
            continue
        pv = cv2.resize(preview[f], (faces_c[f].shape[1], faces_c[f].shape[0]), interpolation=cv2.INTER_CUBIC).astype(np.float32)
        a.append(faces_c[f][m].astype(np.float32))
        b.append(pv[m])
    if not a:
        return preview
    a = np.concatenate(a)
    b = np.concatenate(b)
    good = (b.mean(1) > 15) & (b.mean(1) < 240)
    gain = np.median(((a[good] / 255.0) ** 2.2) / np.maximum((b[good] / 255.0) ** 2.2, 1e-4), axis=0)
    out = {}
    for f in range(6):
        p = (preview[f].astype(np.float32) / 255.0) ** 2.2 * gain
        out[f] = (np.clip(p, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)
    return out


def equirect_from_faces(faces: dict[int, np.ndarray], w: int = 2048, h: int = 1024) -> np.ndarray:
    return np.clip(sample_cube({k: v.astype(np.float32) for k, v in faces.items()}, equirect_dirs(w, h)), 0, 255).astype(np.uint8)


def render_sweep(ex: CaptureExport, id8: str, calib_dir: Path, out: Path, face: int, candidates: list[str], blend_deg: float, scale: int, no_field: bool = False) -> dict:
    t0 = time.time()
    sw = ex.by_id8(id8)
    preview = {n: sw.preview_face(n).astype(np.float32) for n in range(6)}
    od = out / id8
    od.mkdir(parents=True, exist_ok=True)
    rep = {"id": id8, "face": face, "seconds": {}}
    if "A" in candidates:
        for f in range(6):
            Image.fromarray(sw.preview_face(f)).resize((face, face), Image.LANCZOS).save(od / f"A_{FACE_NAMES[f]}.png")
        rep["seconds"]["A"] = round(time.time() - t0, 1)
    if "C" in candidates:
        cj = json.loads((calib_dir / f"{id8}.calib.json").read_text())
        model = SweepModel(sw, cj)
        imgs = frame_images(sw, scale)
        model.set_guides([sw.frame(k, 4).astype(np.float32) for k in range(6)], 4)
        gains, fields = exposure_gains(model, imgs, scale, preview)
        if no_field:
            # per-frame gains only: the smooth preview-anchored ratio field can print grey patches on plain walls
            # where the preview and the frame disagree (shadows, glare); the frames' own shading is kept instead
            fields = np.ones_like(fields)
        labels, conf, lstats = label_map(model, imgs, gains, scale, fields=fields)
        faces, confs = render_faces(model, imgs, gains, labels, scale, face, blend_deg, preview, fields)
        Image.fromarray((np.clip(fields.mean(-1), 0.5, 1.5) * 170 - 85).astype(np.uint8).reshape(-1, fields.shape[2])).save(od / "C_gainfields.png")
        for stale in od.glob("C_raw_*.png"):
            stale.unlink()
        for f in range(6):
            Image.fromarray(faces[f]).save(od / f"C_{FACE_NAMES[f]}.png")
            Image.fromarray((np.clip(confs[f], 0, 1) * 255).astype(np.uint8)).save(od / f"C_conf_{FACE_NAMES[f]}.png")
        Image.fromarray(equirect_from_faces(faces)).save(od / "C_equirect.jpg", quality=90)
        lab = np.zeros(labels.shape + (3,), np.uint8)
        cols = [(255, 80, 80), (80, 255, 80), (80, 120, 255), (255, 220, 60), (255, 90, 255), (80, 240, 240)]
        for k in range(6):
            lab[labels == k] = cols[k]
        Image.fromarray(lab).save(od / "C_labels.png")
        Image.fromarray((np.clip(conf, 0, 1) * 255).astype(np.uint8)).save(od / "C_confidence.png")
        dep = model.range_sky(equirect_dirs(1024, 512))[0]
        Image.fromarray((np.clip(dep / 8.0, 0, 1) * 255).astype(np.uint8)).save(od / "C_depth.png")
        rep.update({"gains": np.round(gains, 4).tolist(), "labels": lstats, "t_radius_m": [round(float(np.linalg.norm(t)), 3) for t in model.t]})
        rep["seconds"]["C"] = round(time.time() - t0, 1)
    if "B" in candidates:
        from recon.candidate_b import ModelB

        cj = json.loads((calib_dir / f"{id8}.calib.json").read_text())
        imgs = frame_images(sw, scale) if "C" not in candidates else imgs
        modelb = ModelB(sw, cj, imgs, scale, preview)
        gains_b, fields_b = exposure_gains(modelb, imgs, scale, preview)
        labels_b, conf_b, lstats_b = label_map(modelb, imgs, gains_b, scale, fields=fields_b)
        faces_b, confs_b = render_faces(modelb, imgs, gains_b, labels_b, scale, face, blend_deg, preview, fields_b)
        for f in range(6):
            Image.fromarray(faces_b[f]).save(od / f"B_{FACE_NAMES[f]}.png")
        Image.fromarray(equirect_from_faces(faces_b)).save(od / "B_equirect.jpg", quality=90)
        rep["B"] = {"labels": lstats_b, "flow_max_deg": 3.0, "seconds": round(time.time() - t0, 1)}
    (od / "render.json").write_text(json.dumps(rep, indent=1))
    return rep


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("export")
    ap.add_argument("ids", nargs="+")
    ap.add_argument("--calib", required=True)
    ap.add_argument("--camera-json")
    ap.add_argument("--out", required=True)
    ap.add_argument("--face", type=int, default=3072)
    ap.add_argument("--candidates", default="A,C")
    ap.add_argument("--blend-deg", type=float, default=0.35)
    ap.add_argument("--scale", type=int, default=1, help="decode frames reduced by this factor (speed/memory)")
    ap.add_argument("--no-field", action="store_true", help="per-frame gains only, no spatial gain field (plain walls with glare/shadow)")
    a = ap.parse_args()
    ex = CaptureExport(Path(a.export))
    if a.camera_json:
        ex.override_camera(json.loads(Path(a.camera_json).read_text())["params_full"])
    for i in a.ids:
        r = render_sweep(ex, i, Path(a.calib), Path(a.out), a.face, a.candidates.split(","), a.blend_deg, a.scale, no_field=a.no_field)
        print(json.dumps(r))
