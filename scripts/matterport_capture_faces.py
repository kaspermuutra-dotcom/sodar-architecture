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
    the container, a 960×480 zstd-compressed TIFF) with a ~0.6° soft edge, and
    an angular nearest-frame rule where that map has no entry.

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
      site/lib/demo/<slug>.sweeps.json site/public/media/demo/<slug> [--face 3072] [--jobs 6] [--only id8,id8]
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
    return {"frames": frames, "intr": intr, "quats": quats, "labels": labels}


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


def seam_masks(labels: np.ndarray | None) -> list[np.ndarray] | None:
    """Soft per-frame masks (960×480, base-frame equirect) from Matterport's assignment map; None without a map."""
    if labels is None:
        return None
    from PIL import ImageFilter

    masks = []
    for i in range(6):
        m = Image.fromarray(((labels == i) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
        masks.append(np.asarray(m, dtype=np.float32) / 255.0)
    return masks


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


def sample_frames(dirs: np.ndarray, frames: list[np.ndarray], intr: tuple, rots: list[np.ndarray], rfix: np.ndarray, gains: np.ndarray, feather: float = 6.0, masks: list[np.ndarray] | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Composite the frames along unit directions in the skybox base frame; returns (rgb float32, weight sum).

    With `masks` (from the assignment map) every direction takes the frame Matterport chose, with a soft ~0.6°
    edge, so parallax between frames never shows as a double image. Where the map has no entry the nearest
    frame axis wins with a 1.5° soft edge. Without masks a wide feather is used (only for the coarse tilt fit).
    """
    fx, fy, cx, cy, iw, ih = intr
    d_f = (dirs @ rfix.T) @ MX.T
    out = np.zeros(dirs.shape[:-1] + (3,), np.float32)
    ws = np.zeros(dirs.shape[:-1], np.float32)
    if masks is not None:
        # frame axes in F: camera looks along −z_cam → axis_F = R^T (0,0,-1)
        axes = [R.T @ np.array([0.0, 0.0, -1.0]) for R in rots]
        cos = np.stack([d_f @ a for a in axes], -1)
        best = cos.max(axis=-1, keepdims=True)
        # angular nearest-frame weights with a 1.5° soft edge (fallback where the map is empty)
        near = np.clip(1 - (np.arccos(np.clip(cos, -1, 1)) - np.arccos(np.clip(best, -1, 1))) / math.radians(1.5), 0, 1)
        dirs_base = dirs @ rfix.T
        mapw = np.stack([sample_mask(m, dirs_base) for m in masks], -1)
        mapped = mapw.sum(axis=-1, keepdims=True) > 0.05
        weights = np.where(mapped, mapw, near)
    for k, (img, R, g) in enumerate(zip(frames, rots, gains)):
        p = d_f @ R.T
        z = p[..., 2]
        valid = z < -1e-6
        inv = np.where(valid, -z, 1.0)
        h, w = img.shape[:2]
        sc = w / iw
        col = (cx - p[..., 0] / inv * fx) * sc
        row = (cy - p[..., 1] / inv * fy) * sc
        inside = valid & (col >= 0) & (col < w - 1) & (row >= 0) & (row < h - 1)
        if not inside.any():
            continue
        c = np.clip(col, 0, w - 1.001)
        r = np.clip(row, 0, h - 1.001)
        c0 = np.floor(c).astype(np.int32)
        r0 = np.floor(r).astype(np.int32)
        fc = (c - c0)[..., None].astype(np.float32)
        fr = (r - r0)[..., None].astype(np.float32)
        val = img[r0, c0] * (1 - fc) * (1 - fr) + img[r0, c0 + 1] * fc * (1 - fr) + img[r0 + 1, c0] * (1 - fc) * fr + img[r0 + 1, c0 + 1] * fc * fr
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


def exposure_gains(small: list[np.ndarray], intr: tuple, rots: list[np.ndarray], rfix: np.ndarray) -> np.ndarray:
    """Per-frame multiplicative gain so overlapping frames agree in mean luminance (two relaxation passes)."""
    dirs = equirect_dirs(FIT_W, FIT_H)
    gains = np.ones(6, np.float32)
    for _ in range(2):
        singles = []
        for i in range(6):
            out, ws = sample_frames(dirs, [small[i]], intr, [rots[i]], rfix, np.array([gains[i]], np.float32))
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


def composite(d: np.ndarray, frames, intr, rots, rfix, gains, ref_faces, masks=None) -> np.ndarray:
    """Frames where they cover the direction, reference faces (polar caps) elsewhere, blended over the edge."""
    hi, ws = sample_frames(d, frames, intr, rots, rfix, gains, masks=masks)
    lo = sample_ref(ref_faces, d)
    t = np.clip(ws / 0.35, 0, 1)[..., None]
    return np.clip(hi * t + lo * (1 - t) + 0.5, 0, 255).astype(np.uint8)


def render_face(face: int, size: int, frames, intr, rots, rfix, gains, ref_faces, masks=None, chunk: int = 384) -> Image.Image:
    out = np.zeros((size, size, 3), np.uint8)
    for r0 in range(0, size, chunk):
        rows = slice(r0, min(size, r0 + chunk))
        out[rows] = composite(face_dirs(face, size, rows), frames, intr, rots, rfix, gains, ref_faces, masks)
    return Image.fromarray(out)


def process_sweep(args: tuple) -> dict:
    export, spd, media, node, face_size = args
    export, spd, media = Path(export), Path(spd), Path(media)
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
    gains = exposure_gains(small, intr, rots, rfix)
    masks = seam_masks(data["labels"])

    out_dir = media / "faces" / nid
    out_dir.mkdir(parents=True, exist_ok=True)
    levels = [(1536, 2), (face_size, 4)]
    written = 0
    for face in range(6):
        big = render_face(face, face_size, frames, intr, rots, rfix, gains, ref_faces, masks)
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
    prev = Image.fromarray(composite(equirect_dirs(1024, 512), frames, intr, rots, rfix, gains, ref_faces, masks))
    (media / "pano").mkdir(exist_ok=True)
    (media / "thumb").mkdir(exist_ok=True)
    prev.resize((512, 256), Image.LANCZOS).save(media / "pano" / f"{nid}.preview.webp", quality=76, method=4)
    prev.resize((320, 160), Image.LANCZOS).save(media / "thumb" / f"{nid}.webp", quality=74, method=4)
    return {"id": nid, "score": round(score, 3), "identityScore": round(identity, 3), "tiltYawPitchRoll": [round(v, 2) for v in ypr], "gains": [round(float(g), 3) for g in gains], "seams": "assignment-map" if masks is not None else "nearest-frame", "files": written, "faceSize": face_size}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("export")
    ap.add_argument("sweeps_json")
    ap.add_argument("media")
    ap.add_argument("--face", type=int, default=3072)
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    gen = json.loads(Path(a.sweeps_json).read_text())
    only = {s for s in a.only.split(",") if s}
    nodes = [n for n in gen["nodes"] if not only or n["id"] in only]
    spd = str(Path(a.export) / "SweepProcessorData")
    jobs = [(a.export, spd, a.media, n, a.face) for n in nodes]
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
