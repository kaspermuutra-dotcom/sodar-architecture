#!/usr/bin/env python3
"""Tour-wide colour normalisation for a Matterport Capture walkthrough.

Neighbouring sweeps of a handheld capture are exposed and white-balanced independently, so the same wall
changes shade from one viewpoint to the next. This script measures those differences on *the same surfaces*
and solves one multiplicative linear-RGB gain per sweep over the whole navigation graph at once, so nothing
drifts from scene to scene.

Correspondences: every sweep's depth panorama gives a 3-D point per direction. A point seen by sweep A is
projected into a linked sweep B; it counts only if B's own depth agrees with the predicted distance (so the
surface is visible from both, not occluded), both samples are unclipped, and both directions lie inside the
camera frames' coverage (the polar caps come from Matterport's preview with different processing). The
median per-channel ratio in linear light between the two colour samples is the pair's measurement.

Solve: minimise Σ_pairs w_ab (g_a − g_b − r_ab)² + λ Σ_s (g_s − 0)² + λ_ref Σ_refs g_s², with g = log gain
per channel. The weak prior keeps the tour's overall exposure; the reference sweeps (median-exposure sweep of
each level) anchor it. Gains are clamped (±0.7 EV luminance, ±15 % chroma) — the goal is camera
consistency, not equalising real lighting: a sunlit wall next to a shaded one keeps its difference because
correspondences on that pair pull the solution only as far as the *shared* surfaces justify.

Usage:
  python3 scripts/matterport_capture_colour.py "<export>/<capture-uuid>" site/lib/demo/<slug>.sweeps.json \
      site/public/media/portfolio/<slug>/<version> site/lib/demo/<slug>.plan-input.json site/lib/demo/<slug>.colour.json
Reads the colour from the version's 1536 px faces; writes the gains + pair measurements to the JSON (and a
copy next to the media). Rerun on a regenerated version with --measure-only to record the "after" values.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import matterport_capture_faces as F  # noqa: E402
import matterport_capture_floorplan as FP  # noqa: E402
import matterport_capture_tour as T  # noqa: E402

W, H = 1200, 600  # sampling grid (0.3° per pixel)
MAX_LINK_M = 6.5
ELEV_MIN, ELEV_MAX = -58.0, 30.0  # inside the camera frames' coverage
MIN_PAIRS = 300
PRIOR = 0.05
PRIOR_REF = 1.0
LUM_CLAMP = (0.62, 1.62)  # ±0.7 EV
CHROMA_CLAMP = (0.85, 1.18)
MAX_PAIR_EV = 1.25  # larger measured differences are glass/occlusion artefacts, not camera exposure
MAX_PAIR_CHROMA = 0.45
CROSS_LEVEL_WEIGHT = 0.35


def srgb_to_linear(x: np.ndarray) -> np.ndarray:
    x = x / 255.0
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def sweep_data(export: Path, media: Path, node: dict, pose):
    sw = node["sweep"]
    dashed = f"{sw[:8]}-{sw[8:12]}-{sw[12:16]}-{sw[16:20]}-{sw[20:]}".upper()
    depth = FP.read_depth(export / f"{dashed}.swl")
    d = np.asarray(Image.fromarray(depth).resize((W, H), Image.NEAREST))
    base = F.equirect_dirs(W, H)
    faces = FP.faces_from_tiles(media, node["id"], level=1)
    colour = F.sample_ref(faces, base)
    q, p = pose
    R = F.quat_mat(q)
    valid = (d > 0.4) & (d < 9.0)
    elev = np.degrees(np.arcsin(np.clip(base[..., 1], -1, 1)))
    valid &= (elev > ELEV_MIN) & (elev < ELEV_MAX)
    pw = ((base @ FP.AX.T) * d[..., None]) @ F.MX.T @ R.T + np.array(p)
    return {"id": node["id"], "depth": d, "colour": colour, "world": pw, "valid": valid, "R": R, "p": np.array(p), "faces": faces}


def pair_ratio(a: dict, b: dict) -> tuple[np.ndarray, int] | None:
    """Median log(linear colour of B / A) over surfaces both sweeps see, per channel."""
    P = a["world"][a["valid"]]
    C = a["colour"][a["valid"]]
    local = (P - b["p"]) @ b["R"]  # world → B container frame
    dist = np.linalg.norm(local, axis=1)
    base = (local / np.maximum(dist, 1e-6)[:, None]) @ F.MX  # container → base frame
    elev = np.degrees(np.arcsin(np.clip(base[:, 1], -1, 1)))
    dd = base @ FP.AX.T
    lon = np.arctan2(dd[:, 0], dd[:, 2])
    lat = np.arcsin(np.clip(dd[:, 1], -1, 1))
    col = ((lon + np.pi) / (2 * np.pi) * W).astype(int) % W
    row = np.clip(((np.pi / 2 - lat) / np.pi * H).astype(int), 0, H - 1)
    meas = b["depth"][row, col]
    ok = (meas > 0.4) & (np.abs(meas - dist) < 0.12 + 0.04 * dist) & (elev > ELEV_MIN) & (elev < ELEV_MAX) & (dist > 0.5)
    if ok.sum() < MIN_PAIRS:
        return None
    Cb = F.sample_ref(b["faces"], base[ok])
    Ca = C[ok]
    unclipped = (Ca.max(axis=1) < 242) & (Cb.max(axis=1) < 242) & (Ca.min(axis=1) > 6) & (Cb.min(axis=1) > 6)
    if unclipped.sum() < MIN_PAIRS:
        return None
    la = srgb_to_linear(Ca[unclipped])
    lb = srgb_to_linear(Cb[unclipped])
    # per-pixel log ratios, then a robust centre: median of the middle 60 %
    r = np.log(np.maximum(lb, 1e-3) / np.maximum(la, 1e-3))
    lo, hi = np.percentile(r, 20, axis=0), np.percentile(r, 80, axis=0)
    keep = np.all((r >= lo) & (r <= hi), axis=1)
    if keep.sum() < MIN_PAIRS // 2:
        keep = np.ones(len(r), bool)
    return np.median(r[keep], axis=0), int(keep.sum())


def pair_weight(r: np.ndarray, cnt: int, cross_level: bool) -> float:
    """Trust of a pair measurement. Camera-to-camera differences are modest; a huge luminance or chroma ratio
    means the shared surfaces were seen through glass, or the count was tiny — such pairs must not steer the
    solve. Exterior↔interior pairs carry real lighting differences and count less."""
    ev = abs(r[1] / np.log(2))
    rg = abs(np.exp(r[0] - r[1]) - 1)
    bg = abs(np.exp(r[2] - r[1]) - 1)
    if ev > MAX_PAIR_EV or rg > MAX_PAIR_CHROMA or bg > MAX_PAIR_CHROMA or cnt < MIN_PAIRS:
        return 0.0
    w = np.sqrt(min(cnt, 3000) / 3000)
    return w * (CROSS_LEVEL_WEIGHT if cross_level else 1.0)


def solve(ids: list[str], pairs: dict[tuple[str, str], tuple[np.ndarray, int]], refs: set[str], levels: dict[str, str]) -> dict[str, np.ndarray]:
    idx = {s: i for i, s in enumerate(ids)}
    n = len(ids)
    gains = np.zeros((n, 3))
    for c in range(3):
        rows, rhs = [], []
        for (a, b), (r, cnt) in pairs.items():
            w = pair_weight(r, cnt, levels[a] != levels[b])
            if w == 0:
                continue
            row = np.zeros(n)
            row[idx[b]] = w
            row[idx[a]] = -w
            rows.append(row)
            rhs.append(w * r[c])
        for s in ids:
            row = np.zeros(n)
            row[idx[s]] = np.sqrt(PRIOR_REF if s in refs else PRIOR)
            rows.append(row)
            rhs.append(0.0)
        A = np.array(rows)
        y = np.array(rhs)
        g, *_ = np.linalg.lstsq(A, y, rcond=None)
        gains[:, c] = -g  # measurement r = log(B/A) means B is brighter → B needs gain exp(-g_b) relative to A
    out = {}
    for s in ids:
        g = np.exp(gains[idx[s]])
        lum = float(np.clip(g[1], *LUM_CLAMP))
        rg = float(np.clip(g[0] / g[1], *CHROMA_CLAMP))
        bg = float(np.clip(g[2] / g[1], *CHROMA_CLAMP))
        out[s] = np.array([lum * rg, lum, lum * bg])
    return out


def describe(r: np.ndarray) -> dict:
    """Human-readable pair difference: luminance in EV and chroma shifts in % from a per-channel log ratio."""
    return {"ev": round(float(r[1] / np.log(2)), 3), "rg": round(float(np.exp(r[0] - r[1]) - 1) * 100, 1), "bg": round(float(np.exp(r[2] - r[1]) - 1) * 100, 1)}


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    measure_only = "--measure-only" in sys.argv
    export, sweeps_json, media, levels_json, out_json = (Path(a) for a in args[:5])
    gen = json.loads(sweeps_json.read_text())
    levels = json.loads(levels_json.read_text())
    man = T.read_manifest(export / "SweepProcessorData" / "manifest.mfst")
    quat = {r["id"][:8]: (r["q"], r["p"]) for r in man["sweeps"]}
    nodes = [n for n in gen["nodes"] if n["id"] in levels]
    data = {}
    for n in nodes:
        data[n["id"]] = sweep_data(export, media, n, quat[n["id"]])
        print("sampled", n["id"], flush=True)
    links = {}
    for l in gen["candidateLinks"]:
        a, b = l["from"], l["to"]
        if a in data and b in data and l["distance"] <= MAX_LINK_M and (b, a) not in links:
            links[(a, b)] = l["distance"]
    pairs = {}
    for (a, b) in links:
        res = pair_ratio(data[a], data[b])
        if res is not None:
            pairs[(a, b)] = res
            print("pair", a, b, "n", res[1], describe(res[0]), flush=True)
    ids = [n["id"] for n in nodes]
    # reference sweeps: the median-exposure sweep of each level (mean linear luminance of its own valid samples)
    refs = set()
    for lvl in ("exterior", "ground", "upper"):
        members = [(float(srgb_to_linear(data[s]["colour"][data[s]["valid"]]).mean()), s) for s in ids if levels[s] == lvl]
        if members:
            members.sort()
            refs.add(members[len(members) // 2][1])
    previous = json.loads(out_json.read_text()) if measure_only and out_json.exists() else None
    gains = previous["gains"] if previous else {s: [1.0, 1.0, 1.0] for s in ids}
    if not measure_only:
        gains = {s: [round(float(x), 4) for x in g] for s, g in solve(ids, pairs, refs, levels).items()}
    pair_out = {}
    for (a, b), (r, cnt) in pairs.items():
        ga, gb = np.log(np.array(gains[a])), np.log(np.array(gains[b]))
        pair_out[f"{a}>{b}"] = {"n": cnt, "distance": round(links[(a, b)], 2), "weight": round(pair_weight(r, cnt, levels[a] != levels[b]), 3), "measured": describe(r), "predictedAfter": describe(r + gb - ga)}
    key = "measuredAfter" if measure_only else "measured"
    result = previous or {}
    result.update({"source": str(media), "gains": gains, "references": sorted(refs), "method": __doc__.split("\n\n")[1].strip()})
    result[key] = pair_out
    out_json.write_text(json.dumps(result, indent=1) + "\n")
    (media / "colour.json").write_text(json.dumps(result, indent=1) + "\n")
    trusted = [v for v in pair_out.values() if v["weight"] > 0]
    evs = [abs(v["measured"]["ev"]) for v in trusted]
    evs_after = [abs(v["predictedAfter"]["ev"]) for v in trusted]
    print(f"trusted pairs {len(trusted)} of {len(pair_out)}")
    print(f"pairs {len(pair_out)}  |ΔEV| median before {np.median(evs):.3f} → after {np.median(evs_after):.3f}; max {max(evs):.3f} → {max(evs_after):.3f}")
    print("references", sorted(refs))


if __name__ == "__main__":
    main()
