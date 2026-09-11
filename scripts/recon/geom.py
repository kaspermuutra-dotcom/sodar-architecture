"""Direction grids and cube/equirect sampling shared by every stage. Base frame: y up, longitude 0 = +z, x = +90° (east of front)."""
from __future__ import annotations

import math

import numpy as np


def equirect_dirs(w: int, h: int) -> np.ndarray:
    u = (np.arange(w) + 0.5) / w * 2 * np.pi - np.pi
    v = np.pi / 2 - (np.arange(h) + 0.5) / h * np.pi
    lon, lat = np.meshgrid(u, v)
    return np.stack([np.cos(lat) * np.sin(lon), np.sin(lat), np.cos(lat) * np.cos(lon)], -1)


def dirs_to_equirect(d: np.ndarray, w: int, h: int) -> tuple[np.ndarray, np.ndarray]:
    """Unit directions (base frame) → continuous (col, row) on a w×h equirect (col 0 = −180°)."""
    lon = np.arctan2(d[..., 0], d[..., 2])
    lat = np.arcsin(np.clip(d[..., 1], -1, 1))
    col = (lon + np.pi) / (2 * np.pi) * w - 0.5
    row = (np.pi / 2 - lat) / np.pi * h - 0.5
    return col, row


def face_dirs(face: int, size: int, rows: slice = slice(None)) -> np.ndarray:
    """Unit directions for one cube face in the export's layout (0 up, 1 front +z, 2 right +x, 3 back −z, 4 left −x, 5 down)."""
    fu = (np.arange(size) + 0.5) / size * 2 - 1
    fv = 1 - (np.arange(size)[rows] + 0.5) / size * 2
    u, v = np.meshgrid(fu, fv)
    one = np.ones_like(u)
    if face == 1:
        d = np.stack([u, v, one], -1)
    elif face == 2:
        d = np.stack([one, v, -u], -1)
    elif face == 3:
        d = np.stack([-u, v, -one], -1)
    elif face == 4:
        d = np.stack([-one, v, u], -1)
    elif face == 0:
        d = np.stack([u, one, -v], -1)
    else:
        d = np.stack([u, -one, v], -1)
    return d / np.linalg.norm(d, axis=-1, keepdims=True)


def bilinear(img: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    x = np.clip(x, 0, w - 1.001)
    y = np.clip(y, 0, h - 1.001)
    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    fx = (x - x0)[..., None] if img.ndim == 3 else (x - x0)
    fy = (y - y0)[..., None] if img.ndim == 3 else (y - y0)
    im = img.astype(np.float32)
    return im[y0, x0] * (1 - fx) * (1 - fy) + im[y0, x0 + 1] * fx * (1 - fy) + im[y0 + 1, x0] * (1 - fx) * fy + im[y0 + 1, x0 + 1] * fx * fy


def sample_cube(faces: dict[int, np.ndarray], d: np.ndarray) -> np.ndarray:
    """Bilinear sample of a cube (export layout) along unit directions d (base frame)."""
    x, y, z = d[..., 0], d[..., 1], d[..., 2]
    ax, ay, az = np.abs(x), np.abs(y), np.abs(z)
    out = np.zeros(d.shape[:-1] + (faces[1].shape[2],), np.float32) if faces[1].ndim == 3 else np.zeros(d.shape[:-1], np.float32)
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
        px = (fu + 1) / 2 * (size - 1)
        py = (1 - fv) / 2 * (size - 1)
        val = bilinear(img, px, py)
        out[mask] = val[mask]
    return out


def sample_equirect(img: np.ndarray, d: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    col, row = dirs_to_equirect(d, w, h)
    # wrap the longitude seam by padding one column
    pad = np.concatenate([img, img[:, :1]], axis=1)
    return bilinear(pad, np.mod(col, w), row)


def view_dirs(yaw_deg: float, pitch_deg: float, hfov_deg: float, w: int, h: int) -> np.ndarray:
    """Rectilinear view directions (base frame): yaw clockwise-positive from +z (front), pitch up-positive."""
    f = (w / 2) / math.tan(math.radians(hfov_deg) / 2)
    gx, gy = np.meshgrid((np.arange(w) + 0.5) - w / 2, h / 2 - (np.arange(h) + 0.5))
    d = np.stack([gx, gy, np.full_like(gx, f)], -1)
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    p, yw = math.radians(pitch_deg), math.radians(yaw_deg)
    rx = np.array([[1, 0, 0], [0, math.cos(p), math.sin(p)], [0, -math.sin(p), math.cos(p)]])  # pitch > 0 looks up
    ry = np.array([[math.cos(yw), 0, math.sin(yw)], [0, 1, 0], [-math.sin(yw), 0, math.cos(yw)]])
    return d @ rx.T @ ry.T


def signed_perms() -> list[np.ndarray]:
    """The 48 signed axis permutation matrices."""
    import itertools

    out = []
    for perm in itertools.permutations(range(3)):
        for signs in itertools.product((1, -1), repeat=3):
            m = np.zeros((3, 3))
            for i, (p, s) in enumerate(zip(perm, signs)):
                m[i, p] = s
            out.append(m)
    return out
