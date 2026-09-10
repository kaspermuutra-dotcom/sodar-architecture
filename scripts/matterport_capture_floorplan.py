#!/usr/bin/env python3
"""Top-down floor plans from the scan's own depth data (Matterport-style plan view).

Each `.swl` sweep container holds a 3600×1801 16-bit depth panorama (mm) in
the sweep's frame — a standard latitude/longitude image with the base frame's
x axis mirrored (verified: the floor is a flat plane and neighbouring sweeps'
walls coincide only under that convention). Combining every sweep's depth with
its composited colour panorama gives a coloured point cloud in the model frame;
rendering it top-down with the ceiling cut away produces the same kind of plan
Matterport shows under its viewer — real geometry, real textures, no drawing.

Outputs (into <media>/plan/):
  outside.webp  every exterior point plus the ground floor cut → garden, path, terrace, house footprint
  ground.webp   ground-floor points below the cut height
  upper.webp    upper-floor points between the floor and the cut height
  plan.json     world→pixel transform (origin, metres per pixel, size) and the levels' cut heights

Usage:
  python3 scripts/matterport_capture_floorplan.py "<export>/<capture-uuid>" \
      site/lib/demo/<slug>.sweeps.json site/public/media/demo/<slug> site/lib/demo/<slug>.plan-input.json
The last argument lists, per node id, the level ("exterior" | "ground" | "upper") — generated from the curation.
"""
from __future__ import annotations

import io
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import matterport_capture_faces as F  # noqa: E402

RES_M = 0.025  # metres per pixel
DEPTH_W, DEPTH_H = 1800, 900  # depth subsample (0.2° per pixel)
AX = np.array([[-1, 0, 0], [0, 1, 0], [0, 0, 1]], float)  # depth equirect → base frame (x mirrored)
CUT_ABOVE_FLOOR = 1.45  # metres: everything above this is removed (ceilings, upper storey)
UPPER_BELOW_FLOOR = 0.35
PLAN_MARGIN_M = 5.0  # metres around the outermost viewpoints (render extent)
CROP_MARGIN_M = 0.6  # metres kept around the rendered content
SPECK_SIGMA_PX = 6  # neighbourhood for the solidity test (≈15 cm)
SPECK_MIN_DENSITY = 0.3
INTERIOR_RADIUS_M = 9.0
EXTERIOR_RADIUS_M = 6.5
DISTANCE_PENALTY = 0.12  # metres of height a point loses per metre of horizontal distance from its sweep
EXTERIOR_WALL_M = 1.3  # metres of facade above the garden level kept on the outside plan (below the roof)


def read_depth(swl: Path) -> np.ndarray | None:
    b = swl.read_bytes()
    top = F._parse(b) or []
    for f, t, v in top:
        if f == 5 and t == "m":
            for ff, tt, x in v:
                if ff == 4 and tt == "b" and x.startswith(b"\x28\xb5\x2f\xfd"):
                    raw = subprocess.run(["zstd", "-d", "-q", "-c"], input=x, capture_output=True, check=True).stdout
                    return np.asarray(Image.open(io.BytesIO(raw)), dtype=np.float32) / 1000.0
    return None


def faces_from_tiles(media: Path, nid: str, level: int = 1) -> dict[int, np.ndarray]:
    size, nb = (1536, 2) if level == 1 else (3072, 4)
    faces = {}
    for idx, name in F.FACE_NAMES.items():
        big = Image.new("RGB", (size, size))
        tile = size // nb
        for c in range(nb):
            for r in range(nb):
                big.paste(Image.open(media / "faces" / nid / f"{name}-{level}-{c}-{r}.webp"), (c * tile, r * tile))
        faces[idx] = np.asarray(big, dtype=np.float32)
    return faces


def sweep_points(export: Path, media: Path, node: dict, pose: tuple[list[float], list[float]]) -> tuple[np.ndarray, np.ndarray] | None:
    sw = node["sweep"]
    dashed = f"{sw[:8]}-{sw[8:12]}-{sw[12:16]}-{sw[16:20]}-{sw[20:]}".upper()
    depth = read_depth(export / f"{dashed}.swl")
    if depth is None:
        return None
    d = np.asarray(Image.fromarray(depth).resize((DEPTH_W, DEPTH_H), Image.NEAREST))
    valid = (d > 0.3) & (d < 14)
    base = F.equirect_dirs(DEPTH_W, DEPTH_H)
    pb = (base @ AX.T) * d[..., None]
    pl = pb @ F.MX.T
    q, p = pose
    pw = pl @ F.quat_mat(q).T + np.array(p)
    colour = F.sample_ref(faces_from_tiles(media, node["id"]), base)  # colour panorama shares the base frame (not mirrored)
    return pw[valid], colour[valid]


def floor_height(points: np.ndarray, cam_z: float) -> float:
    """The sweep's own floor: the strongest horizontal plane below the camera (handheld heights vary by ±0.5 m)."""
    z = points[:, 2]
    below = z[(z < cam_z - 0.6) & (z > cam_z - 2.6)]
    if len(below) < 1000:
        return cam_z - 1.0
    hist, edges = np.histogram(below, bins=np.arange(cam_z - 2.6, cam_z - 0.6, 0.03))
    peak = float(edges[hist.argmax()] + 0.015)
    # a peak hugging the top of the search window is furniture, a handrail or a step, not the floor
    if peak > cam_z - 0.72 or hist.max() < 0.01 * len(z):
        return cam_z - 1.0
    return peak


def pyramid_fill(rgb: np.ndarray, filled: np.ndarray, levels: int = 6, close_px: int = 26) -> np.ndarray:
    """Close the gaps between depth samples (grazing-angle striping, the blind spot under the camera).
    Which pixels get filled is decided by a morphological closing of the coverage mask — only holes
    enclosed by scanned surface, never a halo around the outline. Their colour is the average of the
    nearest scanned pixels, taken from a coverage-weighted image pyramid."""
    from PIL import ImageFilter

    H, W = filled.shape
    # round closing (dilate, then erode, with Gaussian kernels) so bridged gaps do not turn into blocks
    mask_img = Image.fromarray((filled * 255).astype(np.uint8))
    dilated = np.asarray(mask_img.filter(ImageFilter.GaussianBlur(close_px * 0.6))) > 255 * 0.12
    eroded = np.asarray(Image.fromarray((dilated * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(close_px * 0.6))) > 255 * 0.88
    closed = eroded
    keep = filled | closed
    col = [rgb * filled[..., None]]
    cov = [filled.astype(np.float32)]
    for _ in range(levels):
        c, w = col[-1], cov[-1]
        h2, w2 = c.shape[0] // 2 * 2, c.shape[1] // 2 * 2
        col.append(c[:h2, :w2].reshape(h2 // 2, 2, w2 // 2, 2, 3).mean(axis=(1, 3)))
        cov.append(w[:h2, :w2].reshape(h2 // 2, 2, w2 // 2, 2).mean(axis=(1, 3)))
    fill_c, fill_w = col[-1], cov[-1]
    for level in range(levels - 1, -1, -1):
        h, w = cov[level].shape
        up_c = np.stack([np.asarray(Image.fromarray(fill_c[..., i].astype(np.float32), "F").resize((w, h), Image.BILINEAR)) for i in range(3)], -1)
        up_w = np.asarray(Image.fromarray(fill_w.astype(np.float32), "F").resize((w, h), Image.BILINEAR))
        own = cov[level] > 0
        fill_c = np.where(own[..., None], col[level], up_c)
        fill_w = np.where(own, cov[level], up_w)
    keep &= fill_w > 0
    # isolated specks and thin fringes (grazing-angle hits on far grass and foliage) are noise, not plan:
    # keep only pixels whose neighbourhood is reasonably solid
    density = np.asarray(Image.fromarray((keep * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(SPECK_SIGMA_PX)), np.float32) / 255
    keep &= density > SPECK_MIN_DENSITY
    out = np.zeros((H, W, 4), np.uint8)
    out[..., :3] = np.clip(fill_c / np.maximum(fill_w, 1e-6)[..., None], 0, 255).astype(np.uint8)
    out[..., 3] = keep * 255
    return out


def main() -> None:
    export, sweeps_json, media, levels_json = (Path(a) for a in sys.argv[1:5])
    gen = json.loads(sweeps_json.read_text())
    levels = json.loads(levels_json.read_text())
    manifest = F.read_swl  # noqa: F841  (kept for symmetry; poses come from the tour script's output below)
    poses = {n["id"]: n for n in gen["nodes"]}
    # poses: the tour JSON has position + heading; the quaternion is needed for the 3D transform → re-read the manifest
    import matterport_capture_tour as T  # noqa: E402

    man = T.read_manifest(export / "SweepProcessorData" / "manifest.mfst")
    quat = {r["id"][:8]: (r["q"], r["p"]) for r in man["sweeps"]}

    nodes = [n for n in gen["nodes"] if n["id"] in levels]
    clouds = []
    for n in nodes:
        res = sweep_points(export, media, n, quat[n["id"]])
        if res is None:
            continue
        clouds.append((n["id"], levels[n["id"]], res[0], res[1]))
        print("points", n["id"], levels[n["id"]], len(res[0]), flush=True)

    # every sweep gets its own floor height (the scan is handheld; cameras sit 0.8–1.7 m above the floor)
    floors = {nid: floor_height(P, quat[nid][1][2]) for nid, _, P, _ in clouds}
    cams = {nid: np.array(quat[nid][1]) for nid, _, _, _ in clouds}
    # exposure differs per sweep (auto-exposure, handheld); match every sweep's floor brightness to the level median
    means = {}
    for nid, lvl, P, C in clouds:
        near = (np.abs(P[:, 2] - floors[nid]) < 0.2) & (np.linalg.norm(P[:, :2] - cams[nid][:2], axis=1) < 3.0)
        means[nid] = C[near].mean(axis=0) if near.sum() > 500 else None
    for lvl in ("exterior", "ground", "upper"):
        ref = np.median([m for i, m in means.items() if m is not None and levels[i] == lvl], axis=0)
        for k, (nid, l, P, C) in enumerate(clouds):
            if l == lvl and means[nid] is not None:
                gain = np.clip(ref / np.maximum(means[nid], 1), 0.7, 1.4)
                clouds[k] = (nid, l, P, C * gain)
    floor_z = {lvl: float(np.median([floors[i] for i, l, _, _ in clouds if l == lvl])) for lvl in ("exterior", "ground", "upper")}
    print("floor z per level", floor_z, flush=True)
    pos = np.array([cams[nid][:2] for nid, _, _, _ in clouds])
    lo = pos.min(axis=0) - PLAN_MARGIN_M
    hi = pos.max(axis=0) + PLAN_MARGIN_M
    size = np.ceil((hi - lo) / RES_M).astype(int)
    W, H = int(size[0]), int(size[1])
    print("plan size px", W, H, "origin", lo.tolist(), flush=True)

    def render(select, close_px: int = 26) -> np.ndarray:
        # Splat every kept point top-down. Per pixel the winner is the highest point, with a penalty
        # on the horizontal distance to its sweep: close sweeps see a surface sharply, far ones smear
        # it along the ray, so a near sweep's floor beats a far sweep's noisy wall at the same spot.
        score = np.full((H, W), -1e9, np.float32)
        rgb = np.zeros((H, W, 3), np.float32)
        for nid, lvl, P, C in clouds:
            r = np.linalg.norm(P[:, :2] - cams[nid][:2], axis=1)
            keep = np.asarray(select(lvl, P, floors[nid], r))
            if keep.ndim == 0:
                keep = np.full(len(P), bool(keep))
            if not keep.any():
                continue
            Pk, Ck, rk = P[keep], C[keep], r[keep]
            ix = np.clip(((Pk[:, 0] - lo[0]) / RES_M).astype(int), 0, W - 1)
            iy = np.clip(((hi[1] - Pk[:, 1]) / RES_M).astype(int), 0, H - 1)  # north (y) up
            sc = (Pk[:, 2] - floors[nid]) - DISTANCE_PENALTY * rk
            order = np.argsort(sc)  # write lowest first, best last
            ix, iy, Ck, sc = ix[order], iy[order], Ck[order], sc[order]
            better = sc > score[iy, ix]
            # a later duplicate in the same pixel is at least as good (sorted), so plain assignment is fine
            ix, iy, Ck, sc = ix[better], iy[better], Ck[better], sc[better]
            score[iy, ix] = sc
            rgb[iy, ix] = Ck
        zbuf = score
        return Image.fromarray(pyramid_fill(rgb, zbuf > -1e8, close_px=close_px))

    # Each level is drawn from its own sweeps only — exterior sweeps see roofs and foliage that would
    # otherwise land on the interior plans, and interior sweeps see the garden through windows.
    # Cuts are relative to each sweep's own floor, so a low or high hand does not slice the walls.
    def interior(level):
        return lambda lvl, P, fz, r: (lvl == level) & (P[:, 2] > fz - UPPER_BELOW_FLOOR) & (P[:, 2] < fz + CUT_ABOVE_FLOOR) & (r < INTERIOR_RADIUS_M)

    def outside(lvl, P, fz, r):
        if lvl == "exterior":
            return (P[:, 2] > fz - 0.6) & (P[:, 2] < fz + EXTERIOR_WALL_M) & (r < EXTERIOR_RADIUS_M)
        return interior("ground")(lvl, P, fz, r)

    plans = {"outside": render(outside, close_px=10), "ground": render(interior("ground")), "upper": render(interior("upper"))}
    # crop every level to its own content plus a small margin, so the plan fills the panel at each level;
    # plan.json carries one transform per level (shared scale, own origin and size)
    margin = int(round(CROP_MARGIN_M / RES_M))
    level_meta = {}
    cropped = {}
    for name, im in plans.items():
        bx = im.getbbox() or (0, 0, W, H)
        x0, y0 = max(0, bx[0] - margin), max(0, bx[1] - margin)
        x1, y1 = min(W, bx[2] + margin), min(H, bx[3] + margin)
        cropped[name] = im.crop((x0, y0, x1, y1))
        level_meta[name] = {"originX": float(lo[0] + x0 * RES_M), "originY": float(hi[1] - y0 * RES_M), "width": x1 - x0, "height": y1 - y0}
        print("cropped", name, level_meta[name], flush=True)
    plans = cropped
    (media / "plan").mkdir(exist_ok=True)
    for name, im in plans.items():
        from PIL import ImageFilter

        rgb = im.convert("RGB").filter(ImageFilter.MedianFilter(3))
        im = Image.merge("RGBA", (*rgb.split(), im.getchannel("A")))
        im.save(media / "plan" / f"{name}.webp", quality=82, method=6)
        print("wrote", name, im.size, flush=True)
    (media / "plan" / "plan.json").write_text(json.dumps({"metresPerPixel": RES_M, "levels": level_meta, "floorZ": {k: float(v) for k, v in floor_z.items()}, "sweepFloorZ": {k: round(v, 3) for k, v in floors.items()}, "source": "depth panoramas + composited colour from the Capture export; ceiling cut at each sweep's floor + %.2f m" % CUT_ABOVE_FLOOR}, indent=1) + "\n")


if __name__ == "__main__":
    main()
