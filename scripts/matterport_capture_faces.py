#!/usr/bin/env python3
"""High-resolution cube faces + tile pyramid for the walkthrough, from the raw
camera frames inside a Matterport Capture export.

Why this exists: the export's `*_skybox0..5.jpg` faces are a 512 px preview
level (the full-resolution cube is only produced by Matterport's cloud after
upload). The genuinely high-resolution imagery is inside each sweep's `.swl`
container: six 4032×3024 JPEG frames (iPhone camera, ~1500 px focal length,
~27 px per degree) with per-frame rotations and intrinsics in the container's
protobuf header, plus Matterport's own per-pixel frame-assignment map, which
was used to pin down the conventions below (92 % agreement).

Conventions (verified on 5 sweeps, correlation 0.96–1.0 with the reference):
  • the container frame F is the skybox frame: equirect(y up, lon 0 = +z) →
    F through MX = [[0,0,-1],[1,0,0],[0,-1,0]]; only a small per-sweep tilt
    (a few degrees) separates them, fitted below against the 512 px faces;
  • frame rotation R maps F → camera; the camera looks along −z; pixel
    column = cx + fx·x/z, row = cy − fy·y/(−z) on the 4032×3024 sensor image;
  • overlapping frames disagree by up to ~1° on nearby surfaces (parallax of
    the handheld capture), so frames are NOT cross-faded: each direction takes
    one frame, chosen from Matterport's own frame-assignment map (field 30 of
    the container, a 960×480 zstd-compressed TIFF) with a soft edge, and an
    angular nearest-frame rule where that map has no entry. Depth-assisted
    reprojection was implemented (--depth-sigma ≥ 0: field 5.4 depth panorama,
    per-frame offsets from field 31.6, fitted room planes, per-frame
    occlusion) and rejected after measurement: the recorded offsets do not
    predict the seam offsets (which are ~0.8° and neither depth- nor
    rotation-dependent), and reprojecting through them displaces near
    surfaces by several degrees and bends recesses. It stays available for
    experiments only.
  • one linear-RGB gain per sweep (from scripts/matterport_capture_colour.py,
    solved over the whole tour) and one per-sweep gain that matches the 512 px
    preview used for the uncovered polar caps to the frames, so the caps, the
    base faces, every tile level and the previews share one colour transform.

Per sweep this script fits the tilt, equalises exposure between frames,
renders six cube faces at FACE px (default 3072 — matching the source's
angular resolution) in the export's face layout (0 = up, 1..4 = sides in yaw
order, 5 = down), fills only the polar caps the frames never cover from the
reference 512 px faces, and writes Photo Sphere Viewer cubemap tiles:
`<face>-0.webp` (512 base), `<face>-1-<col>-<row>.webp` (1536 px, 2×2),
`<face>-2-<col>-<row>.webp` (FACE px, 4×4), plus the page's 512×256 preview
and 320×160 thumbnail. The export is only read.

Usage:
  python3 scripts/matterport_capture_faces.py "<export>/<capture-uuid>" \
      site/lib/demo/<slug>.sweeps.json site/public/media/demo/<slug> [--face 3072] [--jobs 6] [--only id8,id8]\
      [--colour site/lib/demo/<slug>.colour.json] [--depth-sigma 0.7] [--no-depth]
"""
from __future__ import annotations

import argparse
import io
import json
import math
import re
import struct
import subprocess
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

TILE_QUALITY = 88
BASE_QUALITY = 84
FIT_W, FIT_H = 512, 256
SEAM_BLUR_PX = 4.0  # on the 960×480 assignment map: ≈1.5° soft edge on far surfaces (optimal seams run through plain areas)
SEAM_BLUR_NEAR_PX = 1.6  # ≈0.6° on near surfaces, where residual parallax would double edges
VIGNETTE_A, VIGNETTE_B = -0.2758, -0.0322  # lens falloff log v(r) = a r² + b r⁴, r = radius / half-diagonal (fitted from frame overlaps)
DEPTH_SIGMA_DEG = -1.0  # depth reprojection is off by default: see the note in the module docstring
MX = np.array([[0, 0, -1], [1, 0, 0], [0, -1, 0]], float)  # equirect/skybox base frame → container frame
FACE_NAMES = {0: "top", 1: "front", 2: "right", 3: "back", 4: "left", 5: "bottom"}


# ---------------------------------------------------------------------------
# protobuf wire format (schema-less), bytes preserved
# ---------------------------------------------------------------------------
def _varint(b: bytes, i: int) -> tuple[int, int]:
    r = s = 0
    while True:
        if i >= len(b) or s > 63:
            raise ValueError("bad varint")
        c = b[i]
        i += 1
        r |= (c & 0x7F) << s
        s += 7
        if not c & 0x80:
            return r, i


def _parse(b: bytes, depth: int = 0) -> list | None:
    i, out = 0, []
    while i < len(b):
        try:
            key, i = _varint(b, i)
        except ValueError:
            return None
        f, wt = key >> 3, key & 7
        if f == 0 or f > 200:
            return None
        if wt == 0:
            try:
                v, i = _varint(b, i)
            except ValueError:
                return None
            out.append((f, "v", v))
        elif wt == 1:
            if i + 8 > len(b):
                return None
            out.append((f, "d", struct.unpack("<d", b[i : i + 8])[0]))
            i += 8
        elif wt == 5:
            if i + 4 > len(b):
                return None
            out.append((f, "f", struct.unpack("<f", b[i : i + 4])[0]))
            i += 4
        elif wt == 2:
            try:
                n, i = _varint(b, i)
            except ValueError:
                return None
            if i + n > len(b):
                return None
            v = b[i : i + n]
            i += n
            sub = _parse(v, depth + 1) if depth < 4 and n >= 2 and not v.startswith(b"\xff\xd8\xff") and not v.startswith(b"\x28\xb5\x2f\xfd") else None
            out.append((f, "m", sub) if sub is not None else (f, "b", v))
        else:
            return None
    return out


def read_swl(path: Path) -> dict:
    """Frames (JPEG bytes), intrinsics and F→camera rotations of one sweep container."""
    b = path.read_bytes()
    top = _parse(b) or []
    intr = None
    quats = []
    offsets = []
    for f, t, v in top:
        if f == 6 and t == "m":
            for ff, tt, x in v:
                if ff == 2 and tt == "m":
                    d = {y[0]: y[2] for y in x}
                    if 1 in d and d[1] > 100:
                        intr = (d[1], d[2], d[3], d[4], d.get(10, 4032), d.get(11, 3024))
        if f == 31 and t == "m":
            for ff, tt, x in v:
                if ff == 9 and tt == "m":
                    quats.append([y[2] for y in x])
                if ff == 6 and tt == "m":
                    offsets.append(np.array([y[2] for y in x], float))
    # The container also embeds an equirect placeholder and a thumbnail (and sometimes a stray SOI marker inside
    # binary data), so the six camera frames are picked by their decoded size rather than by position.
    offs = [m.start() for m in re.finditer(b"\xff\xd8\xff", b)] + [len(b)]
    frames = []
    for i in range(len(offs) - 1):
        try:
            with Image.open(io.BytesIO(b[offs[i] : offs[i] + 65536])) as probe:
                size = probe.size
        except Exception:
            continue
        if size == (intr[4], intr[5]) if intr else size[0] >= 4000:
            frames.append(b[offs[i] : offs[i + 1]])
    if intr is None or len(quats) != 6 or len(frames) != 6:
        raise ValueError(f"{path.name}: intrinsics, rotations or frames missing (frames found: {len(frames)})")
    labels = None
    for f, t, v in top:
        if f == 30 and t == "m":
            for ff, tt, x in v:
                if ff == 4 and tt == "b" and x.startswith(b"\x28\xb5\x2f\xfd"):
                    raw = subprocess.run(["zstd", "-d", "-q", "-c"], input=x, capture_output=True, check=True).stdout
                    labels = np.asarray(Image.open(io.BytesIO(raw)))  # 960×480 uint8, 0..5 = frame index, 255 = none
    return {"frames": frames, "intr": intr, "quats": quats, "labels": labels, "offsets": offsets if len(offsets) == 6 else None}


def read_depth(swl: Path) -> np.ndarray | None:
    """The sweep's depth panorama (field 5.4): 1801×3600 float32 metres, 0 where unknown."""
    b = swl.read_bytes()
    for f, t, v in _parse(b) or []:
        if f == 5 and t == "m":
            for ff, tt, x in v:
                if ff == 4 and tt == "b" and x.startswith(b"\x28\xb5\x2f\xfd"):
                    raw = subprocess.run(["zstd", "-d", "-q", "-c"], input=x, capture_output=True, check=True).stdout
                    return np.asarray(Image.open(io.BytesIO(raw)), dtype=np.float32) / 1000.0
    return None


def box_blur(a: np.ndarray, r: int) -> np.ndarray:
    """Separable box blur of radius r px with edge clamping (cumulative sums)."""
    if r <= 0:
        return a

    def blur1(x: np.ndarray, axis: int) -> np.ndarray:
        pad = [(0, 0)] * x.ndim
        pad[axis] = (r + 1, r)
        cs = np.cumsum(np.pad(x, pad, mode="edge"), axis=axis, dtype=np.float64)
        hi = [slice(None)] * x.ndim
        lo = [slice(None)] * x.ndim
        hi[axis] = slice(2 * r + 1, None)
        lo[axis] = slice(0, -(2 * r + 1))
        return ((cs[tuple(hi)] - cs[tuple(lo)]) / (2 * r + 1)).astype(np.float32)

    return blur1(blur1(a, 0), 1)


def smooth_depth(depth: np.ndarray, sigma_deg: float) -> np.ndarray:
    """Coverage-weighted smoothing (three box passes ≈ Gaussian) that ignores unknown depth; unknown stays 0."""
    if sigma_deg <= 0:
        return depth
    r = max(1, int(round(sigma_deg * depth.shape[1] / 360 * 0.6)))
    valid = (depth > 0.2).astype(np.float32)
    num, den = depth * valid, valid
    for _ in range(3):
        num, den = box_blur(num, r), box_blur(den, r)
    return np.where(den > 0.05, num / np.maximum(den, 1e-6), 0.0).astype(np.float32)


AX = np.array([[-1, 0, 0], [0, 1, 0], [0, 0, 1]], float)  # base frame → depth panorama frame (x mirrored)


def depth_lookup(dmap: np.ndarray, dirs_base: np.ndarray) -> np.ndarray:
    """Bilinear depth along base-frame directions; 0 where any neighbour is unknown."""
    dd = dirs_base @ AX.T
    lon = np.arctan2(dd[..., 0], dd[..., 2])
    lat = np.arcsin(np.clip(dd[..., 1], -1, 1))
    h, w = dmap.shape
    col = np.clip((lon + np.pi) / (2 * np.pi) * w - 0.5, 0, w - 1.001)
    row = np.clip((np.pi / 2 - lat) / np.pi * h - 0.5, 0, h - 1.001)
    c0 = col.astype(np.int32)
    r0 = row.astype(np.int32)
    fc = col - c0
    fr = row - r0
    v = dmap[r0, c0] * (1 - fc) * (1 - fr) + dmap[r0, c0 + 1] * fc * (1 - fr) + dmap[r0 + 1, c0] * (1 - fc) * fr + dmap[r0 + 1, c0 + 1] * fc * fr
    ok = (dmap[r0, c0] > 0.2) & (dmap[r0, c0 + 1] > 0.2) & (dmap[r0 + 1, c0] > 0.2) & (dmap[r0 + 1, c0 + 1] > 0.2)
    return np.where(ok, v, 0.0).astype(np.float32)


UP_F = np.array([0.0, 0.0, -1.0])  # container-frame "up" (MX maps the base frame's +y to −z)


def fit_layout(dmap: np.ndarray, sub: int = 4) -> list[tuple[np.ndarray, float]]:
    """Room layout as planes (n, d) with n·P = d in the container frame: floor and ceiling from the
    vertical histogram, walls as vertical planes found by iterative RANSAC on the mid-height points.
    Straight edges on these planes stay straight when the frames are reprojected through them."""
    h, w = dmap.shape
    d = dmap[::sub, ::sub]
    dirs = equirect_dirs(d.shape[1], d.shape[0])  # lat/lon grid of the subsampled depth panorama
    dd = dirs @ AX.T  # depth panorama frame → base frame (the mirror is its own inverse)
    P = (dd @ MX.T) * d[..., None]
    ok = (d > 0.3) & (d < 14)
    P = P[ok]
    up = P @ UP_F
    planes: list[tuple[np.ndarray, float]] = []
    hist, edges = np.histogram(up, bins=np.arange(-6, 6, 0.03))
    below = hist.copy()
    below[edges[:-1] > -0.4] = 0
    if below.max() > 0.01 * len(up):
        z0 = edges[below.argmax()] + 0.015
        sel = np.abs(up - z0) < 0.08
        planes.append((UP_F.copy(), float(np.median(up[sel]))))
    above = hist.copy()
    above[edges[:-1] < 0.4] = 0
    if above.max() > 0.01 * len(up):
        z1 = edges[above.argmax()] + 0.015
        sel = np.abs(up - z1) < 0.08
        planes.append((UP_F.copy(), float(np.median(up[sel]))))
    floor_z = planes[0][1] if planes else -1.0
    ceil_z = planes[1][1] if len(planes) > 1 else floor_z + 2.7
    mid = (up > floor_z + 0.3) & (up < ceil_z - 0.25)
    horiz = P[mid] - np.outer(P[mid] @ UP_F, UP_F)  # project onto the horizontal plane
    xy = np.stack([horiz @ np.array([1.0, 0, 0]), horiz @ np.array([0, 1.0, 0])], 1)
    rng = np.random.default_rng(7)
    remaining = np.ones(len(xy), bool)
    min_inl = max(300, int(0.012 * len(xy)))
    for _ in range(14):
        idx = np.flatnonzero(remaining)
        if len(idx) < min_inl:
            break
        best = None
        for _ in range(240):
            i, j = rng.choice(idx, 2, replace=False)
            a, b = xy[i], xy[j]
            v = b - a
            nrm = np.linalg.norm(v)
            if nrm < 0.3:
                continue
            n2 = np.array([-v[1], v[0]]) / nrm
            dist = np.abs(xy[idx] @ n2 - a @ n2)
            inl = dist < 0.06
            if best is None or inl.sum() > best[0]:
                best = (inl.sum(), n2, a @ n2, inl)
        if best is None or best[0] < min_inl:
            break
        cnt, n2, off, inl = best
        pts = xy[idx[inl]]
        c = pts.mean(axis=0)
        u, sv, vt = np.linalg.svd(pts - c)
        n2 = vt[1]
        off = float(c @ n2)
        n3 = np.array([n2[0], n2[1], 0.0])
        planes.append((n3, off))
        remaining[idx[inl]] = False
    return planes


def layout_depth(dmap: np.ndarray, planes: list[tuple[np.ndarray, float]]) -> tuple[np.ndarray, np.ndarray]:
    """Per depth-pixel geometry for reprojection: the fitted plane's distance where the measured depth agrees with
    a plane (exact, keeps straight lines straight), the measured depth for off-plane objects and openings (lightly
    smoothed beyond the walls, where parallax is small anyway). Returns (depth, mask of plane-consistent pixels)."""
    h, w = dmap.shape
    dirs = equirect_dirs(w, h)
    dd = dirs @ AX.T
    d_f = (dd @ MX.T).astype(np.float32)
    out = dmap.copy()
    planar = np.zeros(dmap.shape, bool)
    best_err = np.full(dmap.shape, np.inf, np.float32)
    tol = 0.22 + 0.06 * dmap
    for n, off in planes:
        denom = d_f @ n.astype(np.float32)
        with np.errstate(divide="ignore", invalid="ignore"):
            t = np.where(np.abs(denom) > 1e-4, off / denom, np.inf).astype(np.float32)
        err = np.abs(t - dmap)
        hit = (t > 0.25) & (dmap > 0.2) & (err < tol) & (err < best_err)
        out[hit] = t[hit]
        best_err[hit] = err[hit]
        planar |= hit
    beyond = (~planar) & (dmap > 0.2)
    if beyond.any():
        soft = smooth_depth(np.where(beyond, dmap, 0.0), 1.0)
        out[beyond] = soft[beyond]
    return out.astype(np.float32), planar


def frame_zbuffers(dmap: np.ndarray, intr: tuple, rots: list[np.ndarray], offsets: list[np.ndarray], cell: int = 8) -> list[np.ndarray]:
    """Nearest surface per (coarse) pixel of every frame, from the depth panorama seen from that frame's centre."""
    fx, fy, cx, cy, iw, ih = intr
    d = dmap[::3, ::3]
    dirs = equirect_dirs(d.shape[1], d.shape[0]) @ AX.T
    P = ((dirs @ MX.T) * d[..., None])[(d > 0.2)]
    gw, gh = iw // cell + 1, ih // cell + 1
    zbufs = []
    for R, c in zip(rots, offsets):
        p = (P + c) @ R.T
        z = -p[:, 2]
        ok = z > 0.05
        col = ((cx - p[:, 0] / np.where(ok, z, 1) * fx) / cell).astype(int)
        row = ((cy - p[:, 1] / np.where(ok, z, 1) * fy) / cell).astype(int)
        ok &= (col >= 0) & (col < gw) & (row >= 0) & (row < gh)
        zb = np.full((gh, gw), np.inf, np.float32)
        np.minimum.at(zb, (row[ok], col[ok]), z[ok])
        zbufs.append(zb)
    return zbufs


def calibrate_offsets(small: list[np.ndarray], intr: tuple, rots: list[np.ndarray], rfix: np.ndarray, offsets: list[np.ndarray], dmap: np.ndarray, planar: np.ndarray) -> float:
    """The container's per-frame offsets carry the direction of the camera's travel around the sweep centre but
    not reliably its magnitude; pick the scale (1–4×) that best aligns overlapping frames on the fitted planes."""
    dirs = equirect_dirs(FIT_W * 2, FIT_H * 2)
    fx, fy, cx, cy, iw, ih = intr
    dep = depth_lookup(dmap, dirs)
    onplane = depth_lookup(planar.astype(np.float32), dirs) > 0.99
    valid = onplane & (dep > 0.3) & (dep < 12)
    P0 = ((dirs @ rfix.T) @ MX.T) * np.where(valid, dep, 50)[..., None]
    h, w = small[0].shape[:2]
    sc = w / iw

    def sample(k: int, scale: float):
        p = (P0 + scale * offsets[k]) @ rots[k].T
        z = -p[..., 2]
        ok = z > 0.05
        col = (cx - p[..., 0] / np.where(ok, z, 1) * fx) * sc
        row = (cy - p[..., 1] / np.where(ok, z, 1) * fy) * sc
        ok &= (col >= 0) & (col < w - 1) & (row >= 0) & (row < h - 1)
        c = np.clip(col, 0, w - 1.001)
        r = np.clip(row, 0, h - 1.001)
        c0, r0 = c.astype(np.int32), r.astype(np.int32)
        fc, fr = c - c0, r - r0
        img = small[k].mean(axis=-1) if small[k].ndim == 3 else small[k]
        v = img[r0, c0] * (1 - fc) * (1 - fr) + img[r0, c0 + 1] * fc * (1 - fr) + img[r0 + 1, c0] * (1 - fc) * fr + img[r0 + 1, c0 + 1] * fc * fr
        return v, ok

    def score(scale: float) -> float:
        tot = []
        for i in range(6):
            for j in range(i + 1, 6):
                a, oa = sample(i, scale)
                b, ob = sample(j, scale)
                m = oa & ob & valid
                if m.sum() < 1500:
                    continue
                ga, gb = grad(a)[m], grad(b)[m]
                ga = ga - ga.mean()
                gb = gb - gb.mean()
                tot.append((float((ga * gb).sum() / (math.sqrt((ga * ga).sum() * (gb * gb).sum()) + 1e-9)), int(m.sum())))
        if not tot:
            return -1.0
        return float(np.average([t[0] for t in tot], weights=[t[1] for t in tot]))

    best = max(((score(sc_), sc_) for sc_ in (1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0)), key=lambda t: t[0])
    fine = max(((score(sc_), sc_) for sc_ in (best[1] - 0.25, best[1] + 0.25) if 0.5 <= sc_ <= 4.5), key=lambda t: t[0], default=best)
    return best[1] if best[0] >= fine[0] else fine[1]


def srgb_to_linear(x: np.ndarray) -> np.ndarray:
    x = x / 255.0
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(y: np.ndarray) -> np.ndarray:
    y = np.clip(y, 0, 1)
    return np.where(y <= 0.0031308, y * 12.92, 1.055 * y ** (1 / 2.4) - 0.055) * 255.0


def apply_gain(rgb: np.ndarray, gain: np.ndarray | None) -> np.ndarray:
    """Multiply 0..255 sRGB by a linear-light per-channel gain."""
    if gain is None or np.allclose(gain, 1.0):
        return rgb
    return linear_to_srgb(srgb_to_linear(rgb) * np.asarray(gain, np.float32)).astype(np.float32)


# ---------------------------------------------------------------------------
# geometry
# ---------------------------------------------------------------------------
def quat_mat(q: list[float]) -> np.ndarray:
    x, y, z, w = q
    n = math.sqrt(x * x + y * y + z * z + w * w)
    x, y, z, w = x / n, y / n, z / n, w / n
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def rot(yaw: float, pitch: float, roll: float) -> np.ndarray:
    cy, sy = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)
    cr, sr = math.cos(roll), math.sin(roll)
    rz = np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]])
    ry = np.array([[cp, 0, sp], [0, 1, 0], [-sp, 0, cp]])
    rx = np.array([[1, 0, 0], [0, cr, -sr], [0, sr, cr]])
    return rz @ ry @ rx


def equirect_dirs(w: int, h: int) -> np.ndarray:
    u = (np.arange(w) + 0.5) / w * 2 * np.pi - np.pi
    v = np.pi / 2 - (np.arange(h) + 0.5) / h * np.pi
    lon, lat = np.meshgrid(u, v)
    return np.stack([np.cos(lat) * np.sin(lon), np.sin(lat), np.cos(lat) * np.cos(lon)], -1)


def face_dirs(face: int, size: int, rows: slice) -> np.ndarray:
    """Unit directions (skybox base frame) for the rows of one cube face, in the export's face layout."""
    fu = (np.arange(size) + 0.5) / size * 2 - 1
    fv = 1 - (np.arange(size)[rows] + 0.5) / size * 2
    u, v = np.meshgrid(fu, fv)
    one = np.ones_like(u)
    if face == 1:
        d = np.stack([u, v, one], -1)  # front  (+z)
    elif face == 2:
        d = np.stack([one, v, -u], -1)  # right  (+x)
    elif face == 3:
        d = np.stack([-u, v, -one], -1)  # back   (-z)
    elif face == 4:
        d = np.stack([-one, v, u], -1)  # left   (-x)
    elif face == 0:
        d = np.stack([u, one, -v], -1)  # up     (+y)
    else:
        d = np.stack([u, -one, v], -1)  # down   (-y)
    return d / np.linalg.norm(d, axis=-1, keepdims=True)


def seam_masks(labels: np.ndarray | None, dmap: np.ndarray | None = None) -> list[np.ndarray] | None:
    """Soft per-frame masks (960×480, base-frame equirect) from an assignment map; None without a map.

    The soft edge is depth-aware when a depth panorama is given: residual parallax between frames grows as
    1/distance, so a wide (~1.5°) blend is only used on surfaces beyond ~2.5 m where the frames agree, and it
    narrows to ~0.6° on near surfaces (stair treads, door frames within reach) where a wide blend would
    double edges. Unknown depth (glass, sky) counts as far."""
    if labels is None:
        return None
    from PIL import ImageFilter

    if dmap is not None:
        h, w = labels.shape
        dep = depth_lookup(dmap, equirect_dirs(w, h))
        far = np.where(dep > 0.2, np.clip((dep - 1.2) / 1.4, 0.0, 1.0), 1.0).astype(np.float32)
    else:
        far = np.ones(labels.shape, np.float32)
    masks = []
    for i in range(6):
        src = Image.fromarray(((labels == i) * 255).astype(np.uint8))
        wide = np.asarray(src.filter(ImageFilter.GaussianBlur(SEAM_BLUR_PX)), dtype=np.float32) / 255.0
        narrow = np.asarray(src.filter(ImageFilter.GaussianBlur(SEAM_BLUR_NEAR_PX)), dtype=np.float32) / 255.0
        masks.append(narrow * (1 - far) + wide * far)
    return masks


def optimal_seams(small: list[np.ndarray], intr: tuple, rots: list[np.ndarray], rfix: np.ndarray, gains: np.ndarray, fallback: np.ndarray | None, ppd: float = 4.0) -> np.ndarray:
    """Frame-assignment map (960×480, like Matterport's) whose seams avoid architectural edges.

    The six frames form a ring; between each pair of yaw-neighbours the overlap is ~45° wide. Inside a 36°
    band around the middle of every overlap a seam path is found by dynamic programming (one column per
    row, slope-limited) minimising |frame a − frame b| plus the local gradient magnitude, so the cut runs
    through plain wall where the frames agree and never across a door frame, skirting or corner where a
    residual misregistration would show as a step. Rows the band cannot serve keep the fallback map."""
    axes = [R.T @ np.array([0.0, 0.0, -1.0]) for R in rots]
    base_axes = [(MX.T @ a) for a in axes]  # container → base frame
    yaws = [math.degrees(math.atan2(a[0], a[2])) for a in base_axes]
    order = sorted(range(6), key=lambda k: yaws[k])
    W, H = 960, 480
    labels = np.full((H, W), 255, np.uint8) if fallback is None else fallback.copy()
    lat_rows = np.linspace(90, -90, H, endpoint=False) - 90 / H
    seam_lon = {}
    for i in range(6):
        a, b = order[i], order[(i + 1) % 6]
        ya, yb = yaws[a], yaws[b]
        if yb < ya:
            yb += 360
        mid = (ya + yb) / 2
        half = 18.0
        lons = np.arange(mid - half, mid + half, 1 / ppd)
        lats = np.arange(50, -70, -1 / ppd)
        LON, LAT = np.meshgrid(np.radians(lons), np.radians(lats))
        dirs = np.stack([np.cos(LAT) * np.sin(LON), np.sin(LAT), np.cos(LAT) * np.cos(LON)], -1)
        ia, wa = sample_frames(dirs, [small[a]], intr, [rots[a]], rfix, np.array([gains[a]], np.float32), feather=1e6)
        ib, wb = sample_frames(dirs, [small[b]], intr, [rots[b]], rfix, np.array([gains[b]], np.float32), feather=1e6)
        la, lb = ia.mean(axis=-1), ib.mean(axis=-1)
        both = (wa > 0) & (wb > 0)
        cost = np.abs(la - lb) + 0.6 * (grad(la) + grad(lb))
        cost = np.where(both, cost, 1e4)
        nrow, ncol = cost.shape
        acc = np.full((nrow, ncol), np.inf)
        back = np.zeros((nrow, ncol), np.int16)
        acc[0] = cost[0]
        for r in range(1, nrow):
            prev = acc[r - 1]
            cands = np.stack([np.roll(prev, s) + (0 if s == 0 else 0.4 * abs(s)) for s in (-2, -1, 0, 1, 2)], 0)
            for j, s in enumerate((-2, -1, 0, 1, 2)):
                if s > 0:
                    cands[j, :s] = np.inf
                elif s < 0:
                    cands[j, s:] = np.inf
            best = cands.argmin(axis=0)
            acc[r] = cost[r] + cands[best, np.arange(ncol)]
            back[r] = np.array((-2, -1, 0, 1, 2))[best]
        path = np.zeros(nrow, np.int32)
        path[-1] = int(acc[-1].argmin())
        for r in range(nrow - 1, 0, -1):
            path[r - 1] = path[r] - back[r, path[r]]
        valid_rows = cost[np.arange(nrow), path] < 1e3  # the seam runs through overlap on this row
        seam_lon[(a, b)] = (lats, lons[np.clip(path, 0, ncol - 1)], valid_rows, mid)
    # paint the label map row by row between consecutive seams
    for ri, lat in enumerate(lat_rows):
        cuts = []
        for i in range(6):
            a, b = order[i], order[(i + 1) % 6]
            lats, seam, ok, mid = seam_lon[(a, b)]
            j = int(np.clip(round((lats[0] - lat) * ppd), 0, len(lats) - 1))
            if lats[0] < lat or lats[-1] > lat or not ok[j]:
                cuts = None
                break
            cuts.append(((seam[j] + 180) % 360 - 180, b))
        if cuts is None:
            continue  # outside the band: keep the fallback assignment (polar regions have no frames anyway)
        cuts.sort()
        lon_cols = (np.arange(W) + 0.5) / W * 360 - 180
        row = np.full(W, cuts[-1][1], np.uint8)  # before the first cut belongs to the frame after the last cut (wrap)
        for c, (lon_c, frame) in enumerate(cuts):
            nxt = cuts[c + 1][0] if c + 1 < len(cuts) else 180.0
            row[(lon_cols >= lon_c) & (lon_cols < nxt)] = frame
        labels[ri] = row
    return labels


def sample_mask(mask: np.ndarray, d: np.ndarray) -> np.ndarray:
    """Bilinear sample of an equirect mask (base frame) along unit directions."""
    lon = np.arctan2(d[..., 0], d[..., 2])
    lat = np.arcsin(np.clip(d[..., 1], -1, 1))
    h, w = mask.shape
    col = np.clip((lon + np.pi) / (2 * np.pi) * w - 0.5, 0, w - 1.001)
    row = np.clip((np.pi / 2 - lat) / np.pi * h - 0.5, 0, h - 1.001)
    c0 = np.floor(col).astype(np.int32)
    r0 = np.floor(row).astype(np.int32)
    fc = col - c0
    fr = row - r0
    return mask[r0, c0] * (1 - fc) * (1 - fr) + mask[r0, c0 + 1] * fc * (1 - fr) + mask[r0 + 1, c0] * (1 - fc) * fr + mask[r0 + 1, c0 + 1] * fc * fr


def sample_frames(dirs: np.ndarray, frames: list[np.ndarray], intr: tuple, rots: list[np.ndarray], rfix: np.ndarray, gains: np.ndarray, feather: float = 6.0, masks: list[np.ndarray] | None = None, offsets: list[np.ndarray] | None = None, dmap: np.ndarray | None = None, far: float = 60.0, zbufs: list[np.ndarray] | None = None, zcell: int = 8) -> tuple[np.ndarray, np.ndarray]:
    """Composite the frames along unit directions in the skybox base frame; returns (rgb float32, weight sum).

    With `offsets` and `dmap` every direction is reprojected: the 3-D point dir·depth is seen from each frame's
    own camera centre (parallax-correct), so overlapping frames agree. With `masks` (from the assignment map)
    every direction takes the frame Matterport chose, with a soft ~1.2° edge; where the map has no entry the
    nearest frame axis wins with a 1.5° soft edge. Without masks a wide feather is used (coarse tilt fit only).
    """
    fx, fy, cx, cy, iw, ih = intr
    dirs_base = dirs @ rfix.T
    d_f = dirs_base @ MX.T
    reproject = offsets is not None and dmap is not None
    if reproject:
        dep = depth_lookup(dmap, dirs)  # the depth panorama shares the skybox base frame; rfix belongs to the frames only
        points = d_f * np.where(dep > 0.2, dep, far)[..., None]
    out = np.zeros(dirs.shape[:-1] + (3,), np.float32)
    ws = np.zeros(dirs.shape[:-1], np.float32)
    if masks is not None:
        # frame axes in F: camera looks along −z_cam → axis_F = R^T (0,0,-1)
        axes = [R.T @ np.array([0.0, 0.0, -1.0]) for R in rots]
        cos = np.stack([d_f @ a for a in axes], -1)
        best = cos.max(axis=-1, keepdims=True)
        # angular nearest-frame weights with a 1.5° soft edge (fallback where the map is empty)
        near = np.clip(1 - (np.arccos(np.clip(cos, -1, 1)) - np.arccos(np.clip(best, -1, 1))) / math.radians(1.5), 0, 1)
        mapw = np.stack([sample_mask(m, dirs_base) for m in masks], -1)
        mapped = mapw.sum(axis=-1, keepdims=True) > 0.05
        weights = np.where(mapped, mapw, near)
    for k, (img, R, g) in enumerate(zip(frames, rots, gains)):
        p = ((points + offsets[k]) if reproject else d_f) @ R.T
        z = p[..., 2]
        valid = z < -1e-6
        inv = np.where(valid, -z, 1.0)
        h, w = img.shape[:2]
        sc = w / iw
        col = (cx - p[..., 0] / inv * fx) * sc
        row = (cy - p[..., 1] / inv * fy) * sc
        inside = valid & (col >= 0) & (col < w - 1) & (row >= 0) & (row < h - 1)
        if reproject and zbufs is not None:
            # occlusion: a surface hidden behind something nearer in this frame must come from another frame
            zb = zbufs[k]
            gc = np.clip((col / sc / zcell).astype(np.int32), 0, zb.shape[1] - 1)
            gr = np.clip((row / sc / zcell).astype(np.int32), 0, zb.shape[0] - 1)
            inside &= -z <= zb[gr, gc] * 1.08 + 0.06
        if not inside.any():
            continue
        c = np.clip(col, 0, w - 1.001)
        r = np.clip(row, 0, h - 1.001)
        c0 = np.floor(c).astype(np.int32)
        r0 = np.floor(r).astype(np.int32)
        fc = (c - c0)[..., None].astype(np.float32)
        fr = (r - r0)[..., None].astype(np.float32)
        val = img[r0, c0] * (1 - fc) * (1 - fr) + img[r0, c0 + 1] * fc * (1 - fr) + img[r0 + 1, c0] * (1 - fc) * fr + img[r0 + 1, c0 + 1] * fc * fr
        # undo the lens vignetting (multiplicative in linear light ≈ gamma-compressed power on sRGB values)
        rad2 = np.clip(((c / sc - cx) ** 2 + (r / sc - cy) ** 2) / (cx * cx + cy * cy), 0.0, 1.0)  # clipped coords: finite everywhere
        val = val * np.exp(-(VIGNETTE_A * rad2 + VIGNETTE_B * rad2 * rad2) / 2.2)[..., None]
        if masks is not None:
            # keep a thin guard at the frame border so a seam never samples outside the image
            edge = np.minimum(np.minimum(c, w - 1 - c), np.minimum(r, h - 1 - r)) / (min(w, h) / 60.0)
            wgt = np.where(inside, weights[..., k] * np.minimum(edge, 1.0), 0.0).astype(np.float32)
        else:
            wgt = np.where(inside, np.minimum(np.minimum(c, w - 1 - c), np.minimum(r, h - 1 - r)) / (min(w, h) / feather), 0.0)
            wgt = np.minimum(wgt, 1.0).astype(np.float32)
        out += val * g * wgt[..., None]
        ws += wgt
    cov = ws > 0
    out[cov] /= ws[cov][..., None]
    return out, ws


def ncc(a: np.ndarray, b: np.ndarray, mask: np.ndarray) -> float:
    a = a[mask]
    b = b[mask]
    if a.size < 500:
        return -1.0
    a = a - a.mean()
    b = b - b.mean()
    return float((a * b).sum() / math.sqrt((a * a).sum() * (b * b).sum() + 1e-9))


def grad(im: np.ndarray) -> np.ndarray:
    return np.hypot(np.diff(im, axis=1, prepend=im[:, :1]), np.diff(im, axis=0, prepend=im[:1]))


def fit_tilt(small: list[np.ndarray], intr: tuple, rots: list[np.ndarray], ref: np.ndarray) -> tuple[np.ndarray, float, float, tuple[float, float, float]]:
    """Small rotation (yaw ±4°, pitch/roll ±9°) that best aligns the blended frames with the reference equirect."""
    dirs = equirect_dirs(FIT_W, FIT_H)
    gref = grad(ref)
    gains = np.ones(6, np.float32)

    def score(y: float, p: float, r: float) -> float:
        out, ws = sample_frames(dirs, small, intr, rots, rot(math.radians(y), math.radians(p), math.radians(r)), gains)
        lum = out.mean(axis=-1)
        cov = ws > 0
        return ncc(grad(lum), gref, cov) + ncc(lum, ref, cov)

    identity = score(0, 0, 0)
    best = (identity, 0.0, 0.0, 0.0)
    for y in (-4, -2, 0, 2, 4):
        for p in range(-9, 10, 3):
            for r in range(-9, 10, 3):
                s = score(y, p, r)
                if s > best[0]:
                    best = (s, float(y), float(p), float(r))
    for step in (1.0, 0.5):
        cur = best
        for y in np.arange(cur[1] - step, cur[1] + step + 1e-6, step):
            for p in np.arange(cur[2] - 1.5 * step, cur[2] + 1.5 * step + 1e-6, step):
                for r in np.arange(cur[3] - 1.5 * step, cur[3] + 1.5 * step + 1e-6, step):
                    s = score(y, p, r)
                    if s > best[0]:
                        best = (s, float(y), float(p), float(r))
    return rot(math.radians(best[1]), math.radians(best[2]), math.radians(best[3])), best[0], identity, (best[1], best[2], best[3])


def exposure_gains(small: list[np.ndarray], intr: tuple, rots: list[np.ndarray], rfix: np.ndarray, offsets=None, dmap=None) -> np.ndarray:
    """Per-frame multiplicative gain so overlapping frames agree in mean luminance (two relaxation passes)."""
    dirs = equirect_dirs(FIT_W, FIT_H)
    gains = np.ones(6, np.float32)
    for _ in range(2):
        singles = []
        for i in range(6):
            out, ws = sample_frames(dirs, [small[i]], intr, [rots[i]], rfix, np.array([gains[i]], np.float32), offsets=[offsets[i]] if offsets is not None else None, dmap=dmap)
            singles.append((out.mean(axis=-1), ws > 0))
        new = gains.copy()
        for i in range(6):
            ratios = []
            for j in range(6):
                if i == j:
                    continue
                ov = singles[i][1] & singles[j][1]
                if ov.sum() > 200:
                    ratios.append(singles[j][0][ov].mean() / max(singles[i][0][ov].mean(), 1e-3))
            if ratios:
                new[i] = gains[i] * float(np.exp(np.mean(np.log(ratios))) ** 0.5)
        gains = new / new.mean()
    return np.clip(gains, 0.6, 1.6)


# ---------------------------------------------------------------------------
def load_reference(spd: Path, sweep_hex: str) -> tuple[dict[int, np.ndarray], str]:
    dashed = f"{sweep_hex[:8]}-{sweep_hex[8:12]}-{sweep_hex[12:16]}-{sweep_hex[16:20]}-{sweep_hex[20:]}"
    faces = {}
    for n in range(6):
        p = spd / f"{dashed}_skybox{n}.jpg"
        if not p.exists():
            p = spd / f"{sweep_hex}_512_00{n}.jpg"
        faces[n] = np.asarray(Image.open(p).convert("RGB"), dtype=np.float32)
    return faces, dashed


def sample_ref(faces: dict[int, np.ndarray], d: np.ndarray) -> np.ndarray:
    """Bilinear sample of the reference 512 px cube along unit directions d (skybox base frame)."""
    x, y, z = d[..., 0], d[..., 1], d[..., 2]
    ax, ay, az = np.abs(x), np.abs(y), np.abs(z)
    out = np.zeros(d.shape[:-1] + (3,), np.float32)
    sx, sy, sz = np.where(ax == 0, 1, ax), np.where(ay == 0, 1, ay), np.where(az == 0, 1, az)
    for mask, face, fu, fv in (
        ((az >= ax) & (az >= ay) & (z > 0), 1, x / sz, y / sz),
        ((ax >= az) & (ax >= ay) & (x > 0), 2, -z / sx, y / sx),
        ((az >= ax) & (az >= ay) & (z < 0), 3, -x / sz, y / sz),
        ((ax >= az) & (ax >= ay) & (x < 0), 4, z / sx, y / sx),
        ((ay > ax) & (ay > az) & (y > 0), 0, x / sy, -z / sy),
        ((ay > ax) & (ay > az) & (y < 0), 5, x / sy, z / sy),
    ):
        if not mask.any():
            continue
        img = faces[face]
        size = img.shape[0]
        px = np.clip((fu + 1) / 2 * (size - 1), 0, size - 1.001)
        py = np.clip((1 - fv) / 2 * (size - 1), 0, size - 1.001)
        x0, y0 = np.floor(px).astype(np.int32), np.floor(py).astype(np.int32)
        fxr, fyr = (px - x0)[..., None], (py - y0)[..., None]
        val = img[y0, x0] * (1 - fxr) * (1 - fyr) + img[y0, x0 + 1] * fxr * (1 - fyr) + img[y0 + 1, x0] * (1 - fxr) * fyr + img[y0 + 1, x0 + 1] * fxr * fyr
        out[mask] = val[mask]
    return out


def composite(d: np.ndarray, frames, intr, rots, rfix, gains, ref_faces, masks=None, offsets=None, dmap=None, cap_gain=None, colour_gain=None, zbufs=None) -> np.ndarray:
    """Frames where they cover the direction, reference faces (polar caps) elsewhere, blended over the edge.

    `cap_gain` matches the preview caps to the frames (linear light); `colour_gain` is the sweep's tour-wide
    colour normalisation, applied last to everything so caps, base, tiles and previews share one transform.
    """
    hi, ws = sample_frames(d, frames, intr, rots, rfix, gains, masks=masks, offsets=offsets, dmap=dmap, zbufs=zbufs)
    lo = apply_gain(sample_ref(ref_faces, d), cap_gain)
    t = np.clip(ws / 0.35, 0, 1)[..., None]
    rgb = apply_gain(hi * t + lo * (1 - t), colour_gain)
    return np.clip(rgb + 0.5, 0, 255).astype(np.uint8)


def cap_gain_for(frames, intr, rots, rfix, gains, ref_faces, masks, offsets, dmap, zbufs=None) -> np.ndarray:
    """Linear-light gain that brings the 512 px preview to the frames' exposure, from the fully covered band."""
    d = equirect_dirs(FIT_W, FIT_H)
    hi, ws = sample_frames(d, frames, intr, rots, rfix, gains, masks=masks, offsets=offsets, dmap=dmap, zbufs=zbufs)
    lo = sample_ref(ref_faces, d)
    ok = (ws > 0.9) & (hi.max(axis=-1) < 240) & (lo.max(axis=-1) < 240) & (hi.min(axis=-1) > 8) & (lo.min(axis=-1) > 8)
    if ok.sum() < 500:
        return np.ones(3, np.float32)
    r = srgb_to_linear(hi[ok]) / np.maximum(srgb_to_linear(lo[ok]), 1e-3)
    return np.clip(np.median(r, axis=0), 0.5, 2.0).astype(np.float32)


def render_face(face: int, size: int, frames, intr, rots, rfix, gains, ref_faces, masks=None, offsets=None, dmap=None, cap_gain=None, colour_gain=None, zbufs=None, chunk: int = 384) -> Image.Image:
    out = np.zeros((size, size, 3), np.uint8)
    for r0 in range(0, size, chunk):
        rows = slice(r0, min(size, r0 + chunk))
        out[rows] = composite(face_dirs(face, size, rows), frames, intr, rots, rfix, gains, ref_faces, masks, offsets, dmap, cap_gain, colour_gain, zbufs)
    return Image.fromarray(out)


def process_sweep(args: tuple) -> dict:
    export, spd, media, node, face_size, colour_gain, depth_sigma = args
    export, spd, media = Path(export), Path(spd), Path(media)
    colour_gain = np.asarray(colour_gain, np.float32) if colour_gain is not None else None
    sweep_hex = node["sweep"]
    nid = node["id"]
    ref_faces, dashed = load_reference(spd, sweep_hex)
    swl = export / f"{dashed.upper()}.swl"
    if not swl.exists():
        return {"id": nid, "error": "no .swl container"}
    data = read_swl(swl)
    frames = [np.asarray(Image.open(io.BytesIO(fr)).convert("RGB"), dtype=np.float32) for fr in data["frames"]]
    small = [np.asarray(Image.fromarray(fr.astype(np.uint8)).resize((fr.shape[1] // 8, fr.shape[0] // 8), Image.BILINEAR), dtype=np.float32) for fr in frames]
    rots = [quat_mat(q) for q in data["quats"]]
    intr = data["intr"]

    ref = sample_ref(ref_faces, equirect_dirs(FIT_W, FIT_H)).mean(axis=-1)
    rfix, score, identity, ypr = fit_tilt(small, intr, rots, ref)
    offsets = data["offsets"] if depth_sigma >= 0 else None
    dmap = None
    zbufs = None
    planes: list = []
    offset_scale = 1.0
    planar_frac = 0.0
    if offsets is not None:
        raw = read_depth(swl)
        if raw is not None:
            import os

            use_planes = os.environ.get("FACES_PLANES", "1") == "1"
            use_zbuf = os.environ.get("FACES_ZBUF", "1") == "1"
            fixed_scale = os.environ.get("FACES_SCALE")
            if use_planes:
                planes = fit_layout(raw)
                dmap, planar = layout_depth(raw, planes)
            else:
                dmap, planar = raw, np.ones(raw.shape, bool)
            planar_frac = float(planar[raw > 0.2].mean()) if (raw > 0.2).any() else 0.0
            offset_scale = float(fixed_scale) if fixed_scale else calibrate_offsets(small, intr, rots, rfix, offsets, dmap, planar)
            offsets = [c * offset_scale for c in offsets]
            zbufs = frame_zbuffers(dmap, intr, rots, offsets) if use_zbuf else None
    if dmap is None:
        offsets = None
    gains = exposure_gains(small, intr, rots, rfix, offsets, dmap)
    import os

    seam_mode = os.environ.get("FACES_SEAMS", "optimal")
    labels = optimal_seams(small, intr, rots, rfix, gains, data["labels"]) if seam_mode == "optimal" else data["labels"]
    seam_depth = read_depth(swl) if dmap is None else dmap
    masks = seam_masks(labels, seam_depth)
    cap_gain = cap_gain_for(small, intr, rots, rfix, gains, ref_faces, masks, offsets, dmap, zbufs)

    out_dir = media / "faces" / nid
    out_dir.mkdir(parents=True, exist_ok=True)
    levels = [(1536, 2), (face_size, 4)]
    written = 0
    for face in range(6):
        big = render_face(face, face_size, frames, intr, rots, rfix, gains, ref_faces, masks, offsets, dmap, cap_gain, colour_gain, zbufs)
        name = FACE_NAMES[face]
        for level, (fsz, nb) in enumerate(levels, start=1):
            img = big if fsz == face_size else big.resize((fsz, fsz), Image.LANCZOS)
            tile = fsz // nb
            for row in range(nb):
                for col in range(nb):
                    img.crop((col * tile, row * tile, (col + 1) * tile, (row + 1) * tile)).save(out_dir / f"{name}-{level}-{col}-{row}.webp", quality=TILE_QUALITY, method=4)
                    written += 1
        big.resize((512, 512), Image.LANCZOS).save(out_dir / f"{name}-0.webp", quality=BASE_QUALITY, method=4)
        written += 1
    prev = Image.fromarray(composite(equirect_dirs(1024, 512), frames, intr, rots, rfix, gains, ref_faces, masks, offsets, dmap, cap_gain, colour_gain, zbufs))
    (media / "pano").mkdir(exist_ok=True)
    (media / "thumb").mkdir(exist_ok=True)
    prev.resize((512, 256), Image.LANCZOS).save(media / "pano" / f"{nid}.preview.webp", quality=76, method=4)
    prev.resize((320, 160), Image.LANCZOS).save(media / "thumb" / f"{nid}.webp", quality=74, method=4)
    return {"id": nid, "score": round(score, 3), "identityScore": round(identity, 3), "tiltYawPitchRoll": [round(v, 2) for v in ypr], "gains": [round(float(g), 3) for g in gains], "seams": ("optimal-path" if seam_mode == "optimal" else "assignment-map") if masks is not None else "nearest-frame", "reprojection": "layout-planes+depth" if dmap is not None else "none", "planes": len(planes), "planarFraction": round(planar_frac, 3), "offsetScale": offset_scale, "capGain": [round(float(g), 3) for g in cap_gain], "colourGain": [round(float(g), 4) for g in colour_gain] if colour_gain is not None else None, "files": written, "faceSize": face_size}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("export")
    ap.add_argument("sweeps_json")
    ap.add_argument("media")
    ap.add_argument("--face", type=int, default=3072)
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--only", default="")
    ap.add_argument("--colour", default="", help="colour.json from matterport_capture_colour.py (per-sweep linear gains)")
    ap.add_argument("--depth-sigma", type=float, default=DEPTH_SIGMA_DEG, help="depth smoothing in degrees for the reprojection")
    ap.add_argument("--no-depth", action="store_true", help="direction-only compositing (the old behaviour)")
    a = ap.parse_args()
    colour = json.loads(Path(a.colour).read_text())["gains"] if a.colour else {}
    depth_sigma = -1.0 if a.no_depth else a.depth_sigma
    gen = json.loads(Path(a.sweeps_json).read_text())
    only = {s for s in a.only.split(",") if s}
    nodes = [n for n in gen["nodes"] if not only or n["id"] in only]
    spd = str(Path(a.export) / "SweepProcessorData")
    jobs = [(a.export, spd, a.media, n, a.face, colour.get(n["id"]), depth_sigma) for n in nodes]
    results = []
    if a.jobs <= 1:
        for job in jobs:
            res = process_sweep(job)
            results.append(res)
            print(json.dumps(res), flush=True)
    else:
        with ProcessPoolExecutor(max_workers=a.jobs) as ex:
            for res in ex.map(process_sweep, jobs):
                results.append(res)
                print(json.dumps(res), flush=True)
    report_path = Path(a.media) / "faces" / "registration.json"
    existing = json.loads(report_path.read_text()) if report_path.exists() else {}
    for res in results:
        existing[res["id"]] = res
    report_path.write_text(json.dumps(existing, indent=1) + "\n")
    print(f"{len(results)} sweeps → {report_path}")


if __name__ == "__main__":
    main()
