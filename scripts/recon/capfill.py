"""Multi-view fill of the polar caps (floor below ≈−60°, ceiling above ≈+37°) from neighbouring sweeps' frames.

The sweep's own frames never see its nadir; a neighbour 1–3 m away sees that floor at 25–45° depression, i.e.
with real pixels at several times the 512-px preview's resolution. Geometry: the merged clouds of the sweep and
its neighbours (manifest poses) are splatted into an equirect range map around the sweep centre (0.25° cells);
holes take the floor/ceiling plane fitted from the sweep's own cloud normals. Cap directions are lifted with that
range, transformed into each neighbour's container frame and projected into its calibrated frames (solved
rotation and centre, z-buffer occlusion). The best neighbour frame per direction is the one with the finest
footprint (closest camera, most head-on view); colour is matched to the sweep's own render in the overlap ring.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import sys

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recon.capture import MX, SWEEP_TO_BASE, CaptureExport, Sweep
from recon.geom import bilinear, dirs_to_equirect, equirect_dirs, face_dirs, sample_cube
from recon.render import FACE_NAMES, SweepModel, apply_gain, sample_frame, sky_to_depth

CELL_DEG = 0.25


def sweep_to_sky(p_sweep: np.ndarray) -> np.ndarray:
    return sky_to_depth(p_sweep @ SWEEP_TO_BASE.T)


def sky_to_sweep(d_sky: np.ndarray) -> np.ndarray:
    return sky_to_depth(d_sky) @ SWEEP_TO_BASE


def world_from_sweep(sw: Sweep, p: np.ndarray) -> np.ndarray:
    return p @ sw.man.R_world.T + np.array(sw.man.p)


def sweep_from_world(sw: Sweep, p: np.ndarray) -> np.ndarray:
    return (p - np.array(sw.man.p)) @ sw.man.R_world


def merged_range_map(sw: Sweep, neighbours: list[Sweep], w: int, h: int) -> tuple[np.ndarray, dict]:
    """Nearest-point range per equirect cell (skybox base of `sw`), plus floor/ceiling plane heights (sweep frame)."""
    # dense samples from the unpacked depth images (every 2nd cell) of the sweep and its neighbours
    def depth_points(s: Sweep) -> np.ndarray:
        d_sky = equirect_dirs(1800, 900)
        r = s.depth_lookup(sky_to_depth(d_sky))
        ok = r > 0.2
        return (sky_to_sweep(d_sky[ok]) * r[ok][:, None]).astype(np.float32)

    pts = [depth_points(sw)]
    for n in neighbours:
        pts.append(sweep_from_world(sw, world_from_sweep(n, depth_points(n))))
    P = np.concatenate(pts)
    rng = np.linalg.norm(P, axis=1)
    keep = rng > 0.3
    P, rng = P[keep], rng[keep]
    d_sky = sweep_to_sky(P / rng[:, None])
    col, row = dirs_to_equirect(d_sky, w, h)
    ci = np.clip(np.round(col).astype(int) % w, 0, w - 1)
    ri = np.clip(np.round(row).astype(int), 0, h - 1)
    # per-cell mean range (a min would let any nearby object smear across the floor), holes filled by
    # normalized convolution
    acc = np.zeros((h, w), np.float32)
    cnt = np.zeros((h, w), np.float32)
    np.add.at(acc, (ri, ci), rng.astype(np.float32))
    np.add.at(cnt, (ri, ci), 1.0)
    rm = np.where(cnt > 0, acc / np.maximum(cnt, 1), 0.0).astype(np.float32)
    known = (cnt > 0).astype(np.float32)
    num = cv2.GaussianBlur(rm * known, (0, 0), 3)
    den = cv2.GaussianBlur(known, (0, 0), 3)
    rm = np.where(known > 0, rm, np.where(den > 0.15, num / np.maximum(den, 1e-6), 0.0)).astype(np.float32)
    # planes from the sweep's own normals
    own = sw.cloud
    nz = own["normal"][:, 2]
    z = own["xyz"][:, 2]
    floor = float(np.median(z[(nz > 0.9) & (z < -0.3)])) if ((nz > 0.9) & (z < -0.3)).sum() > 50 else None
    ceil = float(np.median(z[(nz < -0.9) & (z > 0.3)])) if ((nz < -0.9) & (z > 0.3)).sum() > 50 else None
    return rm, {"floor_z": floor, "ceiling_z": ceil}


def cap_range(rm: np.ndarray, planes: dict, d_sky: np.ndarray) -> np.ndarray:
    """Range along cap directions: splatted merged cloud where it has support (3×3 min), else the plane."""
    h, w = rm.shape
    col, row = dirs_to_equirect(d_sky, w, h)
    ci = np.clip(np.round(col).astype(int) % w, 0, w - 1)
    ri = np.clip(np.round(row).astype(int), 0, h - 1)
    r = rm[ri, ci]
    d_sw = sky_to_sweep(d_sky)
    dz = d_sw[..., 2]
    plane = np.zeros_like(r)
    if planes["floor_z"] is not None:
        m = dz < -0.05
        plane[m] = planes["floor_z"] / dz[m]
    if planes["ceiling_z"] is not None:
        m = dz > 0.05
        plane[m] = planes["ceiling_z"] / dz[m]
    # the floor/ceiling plane is the prior; the measured range may deviate within a band (steps, furniture, a
    # stair well) but not by more — beyond that it is a splat of something else
    has_plane = plane > 0
    use_cloud = (r > 0.2) & (~has_plane | ((r > plane * 0.7) & (r < plane * 2.5)))
    return np.where(use_cloud, r, np.where(has_plane, plane, 0.0))


class NeighbourView:
    def __init__(self, sw: Sweep, calib: dict, imgs: list[np.ndarray], scale: int):
        self.sw = sw
        self.model = SweepModel(sw, calib)
        self.model.set_guides([sw.frame(k, 4).astype(np.float32) for k in range(6)], 4)
        self.imgs = imgs
        self.scale = scale

    def sample(self, P_world: np.ndarray, shape: tuple[int, int]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Best-frame sample of world points: (rgb, quality, ok). quality = cos(incidence)/distance² proxy."""
        P_sw = sweep_from_world(self.sw, P_world)
        P_F = sweep_to_sky(P_sw) @ MX.T
        best_q = np.zeros(len(P_F), np.float32)
        best_rgb = np.zeros((len(P_F), 3), np.float32)
        best_ok = np.zeros(len(P_F), bool)
        for k in range(6):
            col, row, ok = self.model.project(k, P_F, iterations=0, occlusion=False)  # the 3-D point is given; caps are rarely occluded and the neighbour's z-buffer has no data there
            if not ok.any():
                continue
            dist = np.linalg.norm(P_F - self.model.t[k], axis=1)
            centre = np.hypot((col - self.model.K.cx) / self.model.K.cx, (row - self.model.K.cy) / self.model.K.cy)
            q = np.where(ok, (1.0 - 0.5 * np.clip(centre, 0, 1)) / np.maximum(dist, 0.3) ** 2, 0.0).astype(np.float32)
            better = q > best_q
            if not better.any():
                continue
            # remap needs 2-D maps below 32 767 rows: lay the points out in a wide grid
            n = len(col)
            wgrid = 4096
            hgrid = (n + wgrid - 1) // wgrid
            cg = np.zeros(hgrid * wgrid, np.float64)
            rg = np.zeros(hgrid * wgrid, np.float64)
            cg[:n], rg[:n] = np.where(better, col, 0.0), np.where(better, row, 0.0)
            v = sample_frame(self.imgs[k], cg.reshape(hgrid, wgrid), rg.reshape(hgrid, wgrid), self.model.K, self.scale).reshape(-1, 3)[:n]
            best_rgb[better] = v[better]
            best_q[better] = q[better]
            best_ok |= better
        return best_rgb, best_q, best_ok


def fill_caps(ex: CaptureExport, id8: str, neighbour_ids: list[str], calib_dir: Path, render_dir: Path, face: int, scale: int = 2, feather_deg: float = 1.5) -> dict:
    sw = ex.by_id8(id8)
    preview = {n: sw.preview_face(n).astype(np.float32) for n in range(6)}
    neigh = [ex.by_id8(n) for n in neighbour_ids if (calib_dir / f"{n}.calib.json").exists()]
    views = [NeighbourView(n, json.loads((calib_dir / f"{n.id8}.calib.json").read_text()), [n.frame(k, scale).astype(np.float32) for k in range(6)], scale) for n in neigh]
    W, H = int(360 / CELL_DEG), int(180 / CELL_DEG)
    rm, planes = merged_range_map(sw, neigh, W, H)
    od = render_dir / id8
    rep = {"neighbours": [n.id8 for n in neigh], "planes": planes, "faces": {}}
    for f in range(6):
        # work from the pristine render (kept as C_raw_*), so the fill can be re-run
        for kind in ("", "conf_"):
            src_p = od / f"C_{kind}{FACE_NAMES[f]}.png"
            raw_p = od / f"C_raw_{kind}{FACE_NAMES[f]}.png"
            if not raw_p.exists():
                raw_p.write_bytes(src_p.read_bytes())
        img = np.asarray(cv2.imread(str(od / f"C_raw_{FACE_NAMES[f]}.png"))[..., ::-1], np.float32)
        conf = np.asarray(cv2.imread(str(od / f"C_raw_conf_{FACE_NAMES[f]}.png"), cv2.IMREAD_GRAYSCALE), np.float32) / 255.0
        need = conf < 0.5  # true caps and the coverage blend zone only — depth-edge/unknown-depth pixels keep the frames
        if need.mean() < 0.002:
            continue
        ys, xs = np.where(need)
        d_sky = face_dirs(f, face, slice(0, face))[ys, xs]
        # floor cap only: neighbours see the ceiling above this sweep obliquely at the top edge of their frames,
        # which looks worse than the preview; the floor they see from above at several times the preview's detail
        below = d_sky[:, 1] < -0.15
        ys, xs, d_sky = ys[below], xs[below], d_sky[below]
        if len(ys) < 100:
            continue
        r = cap_range(rm, planes, d_sky)
        valid = r > 0.2
        P_sw = sky_to_sweep(d_sky) * r[:, None]
        P_w = world_from_sweep(sw, P_sw)
        fill = np.zeros((len(ys), 3), np.float32)
        got = np.zeros(len(ys), bool)
        src = np.full(len(ys), -1, np.int16)
        # nearest neighbour first; each neighbour fills what is still missing (consistent look per region)
        order = np.argsort([math.dist(sw.man.p, v.sw.man.p) for v in views])
        pv_lin = (np.clip(sample_cube(preview, d_sky), 0, 255) / 255.0) ** 2.2
        gains = {}
        for vi in order:
            v = views[vi]
            rgb, qq, ok = v.sample(P_w, (len(ys), 1))
            take = ok & valid & ~got & (qq > 0)
            if take.sum() < 200:
                continue
            # colour: match this neighbour's samples to the target sweep's own preview (linear light, robust)
            lin = (np.clip(rgb[take], 1, 255) / 255.0) ** 2.2
            ref = pv_lin[take]
            good = (ref.mean(1) > 0.02) & (ref.mean(1) < 0.9)
            g = np.clip(np.median(ref[good] / np.maximum(lin[good], 1e-4), axis=0), 0.5, 2.0) if good.sum() > 200 else np.ones(3)
            gains[v.sw.id8] = np.round(g, 3).tolist()
            fill[take] = apply_gain(rgb[take], g)
            got |= take
            src[take] = vi
        if got.sum() < 100:
            continue
        gain = gains
        # feather: the neighbour fill replaces preview pixels with weight (1 − conf) and a spatial feather at its own boundary
        gm = np.zeros((face, face), np.uint8)
        gm[ys[got], xs[got]] = 1
        gm = cv2.morphologyEx(gm, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        dist = cv2.distanceTransform(gm, cv2.DIST_L2, 3)
        feather_px = feather_deg * face / 90.0
        wf = np.clip(dist / feather_px, 0, 1)[ys, xs] * (1.0 - conf[ys, xs]) * got
        out = img.copy()
        out[ys, xs] = img[ys, xs] * (1 - wf)[:, None] + fill * wf[:, None]
        cv2.imwrite(str(od / f"C_{FACE_NAMES[f]}.png"), np.clip(out, 0, 255).astype(np.uint8)[..., ::-1])
        newconf = conf.copy()
        newconf[ys, xs] = np.maximum(conf[ys, xs], 0.85 * wf)
        cv2.imwrite(str(od / f"C_conf_{FACE_NAMES[f]}.png"), (newconf * 255).astype(np.uint8))
        rep["faces"][FACE_NAMES[f]] = {"capPixels": int(need.sum()), "filled": int((wf > 0.5).sum()), "gains": gain}
    (od / "capfill.json").write_text(json.dumps(rep, indent=1))
    return rep


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("export")
    ap.add_argument("id8")
    ap.add_argument("--neighbours", required=True)
    ap.add_argument("--calib", required=True)
    ap.add_argument("--camera-json", required=True)
    ap.add_argument("--render", required=True)
    ap.add_argument("--face", type=int, default=3072)
    a = ap.parse_args()
    ex = CaptureExport(Path(a.export))
    ex.override_camera(json.loads(Path(a.camera_json).read_text())["params_full"])
    print(json.dumps(fill_caps(ex, a.id8, a.neighbours.split(","), Path(a.calib), Path(a.render), a.face)))
