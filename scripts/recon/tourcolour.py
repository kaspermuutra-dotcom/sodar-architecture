"""Tour-wide colour solve on the reconstructed panoramas (correct depth geometry).

For every pair of sweeps within 4.6 m on the same floor: directions of A are lifted with A's depth, transformed to B
through the manifest poses, kept only where B's own depth agrees (±8 %) and both samples are unclipped and inside
the frames' coverage (|latitude| < 35°); the pair measurement is the per-channel median ratio of linear-light
samples. One log-gain per sweep and channel is solved by least squares over the graph with a weak zero prior
and the median-exposure sweep of each level as reference; gains are clamped to ±0.7 EV luminance, ±15 % chroma.

Usage: python scripts/recon/tourcolour.py <export> --render <dir> --ids id8,... --levels <plan-input.json> --out <json>
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recon.capfill import sky_to_sweep, sweep_from_world, sweep_to_sky, world_from_sweep  # noqa: E402
from recon.capture import CaptureExport, Sweep  # noqa: E402
from recon.geom import bilinear, dirs_to_equirect, equirect_dirs  # noqa: E402
from recon.render import sky_to_depth  # noqa: E402

W, H = 1024, 512


def load_equirect(render: Path, id8: str) -> np.ndarray:
    # render.py writes 2048×1024 equirects; the solve samples at W×H
    return np.asarray(Image.open(render / id8 / "C_equirect.jpg").convert("RGB").resize((W, H), Image.LANCZOS), np.float32)


def lin(v: np.ndarray) -> np.ndarray:
    return (np.clip(v, 0, 255) / 255.0) ** 2.2


def pair_ratio(a: Sweep, b: Sweep, ea: np.ndarray, eb: np.ndarray) -> tuple[np.ndarray, int] | None:
    d = equirect_dirs(W, H)
    lat = np.degrees(np.arcsin(np.clip(d[..., 1], -1, 1)))
    band = np.abs(lat) < 35
    ra = a.depth_lookup(sky_to_depth(d))
    ok = band & (ra > 0.3)
    P_sw = sky_to_sweep(d[ok]) * ra[ok][:, None]
    P_b = sweep_from_world(b, world_from_sweep(a, P_sw))
    rb_pred = np.linalg.norm(P_b, axis=1)
    d_b = sweep_to_sky(P_b / rb_pred[:, None])
    rb = b.depth_lookup(sky_to_depth(d_b))
    lat_b = np.degrees(np.arcsin(np.clip(d_b[:, 1], -1, 1)))
    vis = (rb > 0.3) & (np.abs(rb - rb_pred) / rb_pred < 0.08) & (np.abs(lat_b) < 35)
    if vis.sum() < 300:
        return None
    col, row = dirs_to_equirect(d_b[vis], W, H)
    sb = bilinear(np.concatenate([eb, eb[:, :1]], 1), np.mod(col, W), row)
    sa = ea[ok][vis]
    good = (sa.mean(1) > 20) & (sa.mean(1) < 235) & (sb.mean(1) > 20) & (sb.mean(1) < 235)
    if good.sum() < 200:
        return None
    r = np.median(np.log(lin(sa[good]) + 1e-4) - np.log(lin(sb[good]) + 1e-4), axis=0)  # log(a/b)
    return r, int(good.sum())


def solve(ids: list[str], pairs: dict, refs: set[str], lam: float = 0.05, lam_ref: float = 2.0) -> dict[str, np.ndarray]:
    idx = {i: k for k, i in enumerate(ids)}
    n = len(ids)
    gains = np.zeros((n, 3))
    for c in range(3):
        rows, rhs = [], []
        for (a, b), (r, cnt) in pairs.items():
            w = math.sqrt(min(cnt, 20000) / 20000.0)  # a pair seen on a few thousand samples (a doorway sliver) must not outweigh one seen on 80 000
            row = np.zeros(n)
            row[idx[a]] = w
            row[idx[b]] = -w
            rows.append(row)
            rhs.append(-w * r[c])  # g_a − g_b = −log(a/b) equalises the pair
        for i in range(n):
            row = np.zeros(n)
            row[i] = math.sqrt(lam_ref if ids[i] in refs else lam)
            rows.append(row)
            rhs.append(0.0)
        A = np.array(rows)
        g, *_ = np.linalg.lstsq(A, np.array(rhs), rcond=None)
        gains[:, c] = g
    out = {}
    for i, s in enumerate(ids):
        g = gains[i]
        lum = g.mean()
        lum = float(np.clip(lum, -0.7 * math.log(2), 0.7 * math.log(2)))
        chroma = np.clip(g - g.mean(), math.log(0.85), math.log(1.15))
        out[s] = np.exp(lum + chroma)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("export")
    ap.add_argument("--render", required=True)
    ap.add_argument("--ids", required=True)
    ap.add_argument("--levels", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    ex = CaptureExport(Path(a.export))
    ids = [i for i in a.ids.split(",") if (Path(a.render) / i / "C_equirect.jpg").exists()]
    levels = json.loads(Path(a.levels).read_text())
    sweeps = {i: ex.by_id8(i) for i in ids}
    eq = {i: load_equirect(Path(a.render), i) for i in ids}
    pairs = {}
    for x, i in enumerate(ids):
        for j in ids[x + 1 :]:
            if levels.get(i) != levels.get(j) or math.dist(sweeps[i].man.p, sweeps[j].man.p) > 4.6:
                continue
            r = pair_ratio(sweeps[i], sweeps[j], eq[i], eq[j])
            if r is not None:
                pairs[(i, j)] = r
    refs = set()
    for lv in set(levels.values()):
        members = [i for i in ids if levels.get(i) == lv]
        if members:
            lum = {i: float(np.median(eq[i][H // 4 : 3 * H // 4].mean(-1))) for i in members}
            refs.add(sorted(members, key=lambda i: lum[i])[len(members) // 2])
    gains = solve(ids, pairs, refs)
    before = {f"{a_}>{b_}": {"ev": round(float(r.mean() / math.log(2)), 3), "n": n} for (a_, b_), (r, n) in pairs.items()}
    after = {f"{a_}>{b_}": round(float((r + np.log(gains[a_]) - np.log(gains[b_])).mean() / math.log(2)), 3) for (a_, b_), (r, n) in pairs.items()}
    res = {"source": str(a.render), "gains": {i: np.round(gains[i], 4).tolist() for i in ids}, "references": sorted(refs), "pairs": len(pairs), "measuredBefore": before, "evAfter": after, "evBeforeAbsMedian": round(float(np.median([abs(v["ev"]) for v in before.values()])), 3) if before else None, "evAfterAbsMedian": round(float(np.median([abs(v) for v in after.values()])), 3) if after else None}
    Path(a.out).write_text(json.dumps(res, indent=1))
    print(json.dumps({k: v for k, v in res.items() if k in ("pairs", "references", "evBeforeAbsMedian", "evAfterAbsMedian")}))


if __name__ == "__main__":
    main()
