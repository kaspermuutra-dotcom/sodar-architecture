"""Phase 2: decode and inventory every sweep of the export; contact sheets for the requested sweeps.

Usage: python scripts/recon/inventory.py <export> <out-dir> [--sheets id8,id8,...] [--all-sheets]
Writes <out-dir>/inventory.json, inventory.md and sheets/<id8>.jpg. The export is only read.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recon import conventions  # noqa: E402
from recon.capture import MX, CaptureExport, Sweep  # noqa: E402
from recon.geom import dirs_to_equirect, equirect_dirs, sample_cube  # noqa: E402


def heading_deg(R: np.ndarray) -> float:
    v = R @ np.array([1.0, 0, 0])
    return math.degrees(math.atan2(v[1], v[0]))


def frame_footprint(sw: Sweep, k: int, w: int, h: int, n: int = 40) -> list[tuple[float, float]]:
    """Polyline of frame k's image border on a w×h equirect (base frame)."""
    K = sw.intrinsics
    R = sw.frames_meta[k].R
    W, H = K.width, K.height
    border = []
    for t in np.linspace(0, 1, n, endpoint=False):
        border += [(t * W, 0.0), (W, t * H), (W - t * W, H), (0.0, H - t * H)]
    # the four sides in order
    sides = [[(t * W, 0.0) for t in np.linspace(0, 1, n)], [(W, t * H) for t in np.linspace(0, 1, n)], [(W - t * W, H) for t in np.linspace(0, 1, n)], [(0.0, H - t * H) for t in np.linspace(0, 1, n)]]
    pts = np.array([p for s in sides for p in s])
    x = (K.cx - pts[:, 0]) / K.fx
    y = (K.cy - pts[:, 1]) / K.fy
    cam = np.stack([x, y, -np.ones_like(x)], -1)  # camera looks along −z; col = cx − fx·x/(−z) ⇒ x = (cx − col)/fx at z = −1
    dF = cam @ R  # R is F→camera, so camera→F is Rᵀ: d_F = Rᵀ·cam ⇒ cam @ R
    dB = dF @ MX  # F→base = MXᵀ
    dB /= np.linalg.norm(dB, axis=1, keepdims=True)
    col, row = dirs_to_equirect(dB, w, h)
    return list(zip(col.tolist(), row.tolist()))


def colourize(a: np.ndarray, vmax: float) -> Image.Image:
    x = np.clip(a / vmax, 0, 1)
    rgb = np.stack([x, 1 - np.abs(x - 0.5) * 2, 1 - x], -1)
    rgb[a <= 0] = 0
    return Image.fromarray((rgb * 255).astype(np.uint8))


def contact_sheet(sw: Sweep, out: Path) -> None:
    W, H = 1024, 512
    tw, th = 504, 378
    sheet = Image.new("RGB", (tw * 6 + 70, th + H * 2 + 90), (18, 18, 18))
    d = ImageDraw.Draw(sheet)
    for k in range(6):
        fr = Image.fromarray(sw.frame(k, 8)).resize((tw, th))
        sheet.paste(fr, (k * (tw + 10), 30))
        m = sw.frames_meta[k]
        d.text((k * (tw + 10) + 4, 8), f"frame {k}  yaw {math.degrees(math.atan2(m.yaw_cs[1], m.yaw_cs[0])) if m.yaw_cs else float('nan'):.1f}°  offset r={np.linalg.norm(m.offset_m[:2]) if m.offset_m is not None else float('nan'):.3f} m", fill=(230, 230, 230))
    y0 = th + 50
    # preview cube → equirect with the frame footprints
    if sw.has_preview:
        faces = {n: sw.preview_face(n) for n in range(6)}
        eq = Image.fromarray(np.clip(sample_cube(faces, equirect_dirs(W, H)), 0, 255).astype(np.uint8))
    else:
        eq = Image.new("RGB", (W, H), (60, 0, 0))
    de = ImageDraw.Draw(eq)
    cols = [(255, 80, 80), (80, 255, 80), (80, 120, 255), (255, 220, 60), (255, 90, 255), (80, 240, 240)]
    for k in range(6):
        fp = frame_footprint(sw, k, W, H)
        # break the polyline at the ±180° wrap
        seg = []
        for i, (c, r) in enumerate(fp):
            if seg and abs(c - seg[-1][0]) > W / 2:
                de.line(seg, fill=cols[k], width=2)
                seg = []
            seg.append((c, r))
        if len(seg) > 1:
            de.line(seg, fill=cols[k], width=2)
    sheet.paste(eq, (0, y0))
    d.text((4, y0 - 14), "Matterport 512 px preview cubemap (equirect, base frame) with the six frame footprints (MX·R)", fill=(230, 230, 230))
    lo = Image.fromarray(sw.colour_equirect_lowres).resize((W, H))
    sheet.paste(lo, (W + 20, y0))
    d.text((W + 24, y0 - 14), "container low-res colour equirect (field 5.7)", fill=(230, 230, 230))
    am = sw.assignment_map
    if am is not None:
        rgb = np.zeros(am.shape + (3,), np.uint8)
        for k in range(6):
            rgb[am == k] = cols[k]
        sheet.paste(Image.fromarray(rgb).resize((W, H)), (2 * W + 40, y0))
        d.text((2 * W + 44, y0 - 14), f"frame-assignment map (coverage {(am != 255).mean():.2f})", fill=(230, 230, 230))
    y1 = y0 + H + 30
    dm = sw.depth_equirect(W, H)  # unpacked to a plain equirect in the physical (depth) base frame
    sheet.paste(colourize(dm, 8.0), (0, y1))
    d.text((4, y1 - 14), f"LiDAR depth, unpacked to equirect (0–8 m; known {(sw.depth_m > 0.2).mean():.2f} of the packed image)", fill=(230, 230, 230))
    cf = sw.depth_confidence
    if cf is not None:
        cfe = sw.depth_lookup(equirect_dirs(W, H), cf.astype(np.float32))
        sheet.paste(Image.fromarray((cfe * 120).astype(np.uint8)).convert("RGB"), (W + 20, y1))
        d.text((W + 24, y1 - 14), "depth confidence class 0..2 (unpacked)", fill=(230, 230, 230))
    cl = sw.cloud
    if cl:
        # top-down view of the cloud (sweep frame), 8 m box
        img = np.zeros((H, H, 3), np.uint8)
        p = cl["xyz"]
        xi = np.clip(((p[:, 0] + 6) / 12 * H).astype(int), 0, H - 1)
        yi = np.clip(((6 - p[:, 1]) / 12 * H).astype(int), 0, H - 1)
        zc = np.clip((p[:, 2] + 1.5) / 3, 0, 1)
        img[yi, xi] = np.stack([zc * 255, 120 + 0 * zc, (1 - zc) * 255], -1).astype(np.uint8)
        sheet.paste(Image.fromarray(img), (2 * W + 40, y1))
        d.text((2 * W + 44, y1 - 14), f"sweep_cloud.pb top-down ({len(p)} pts, colour = height)", fill=(230, 230, 230))
    d.text((4, 2), f"{sw.id8}  floor {sw.man.floor}  {sw.man.kind}/{sw.man.status}  device {sw.device.get('model')}", fill=(255, 255, 255))
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, quality=82)


def inventory_sweep(sw: Sweep) -> dict:
    m = sw.man
    rec = {"id8": sw.id8, "id": sw.id, "kind": m.kind, "status": m.status, "floor": m.floor, "parent8": m.parent[:8] if m.parent else None, "time": m.time, "position": [round(x, 4) for x in m.p], "quaternion_xyzw": [round(x, 6) for x in m.q_xyzw], "heading_deg": round(heading_deg(m.R_world), 2), "container": sw.has_container, "preview": sw.has_preview}
    if not sw.has_container:
        return rec
    K = sw.intrinsics
    rec.update({"intrinsics": {"fx": K.fx, "fy": K.fy, "cx": K.cx, "cy": K.cy, "width": K.width, "height": K.height, "distortion": list(K.distortion), "hfov_deg": round(K.hfov_deg(), 2), "vfov_deg": round(K.vfov_deg(), 2)}, "device": sw.device})
    rec["frames"] = [{"index": k, "bytes": len(j), "sha256": hashlib.sha256(j).hexdigest(), "quat_xyzw": [round(x, 6) for x in sw.frames_meta[k].quat_xyzw], "offset_m": [round(float(x), 4) for x in sw.frames_meta[k].offset_m] if sw.frames_meta[k].offset_m is not None else None} for k, j in enumerate(sw.frame_jpegs)]
    am = sw.assignment_map
    rec["assignmentCoverage"] = round(float((am != 255).mean()), 4) if am is not None else None
    dm = sw.depth_m
    rec["depth"] = {"shape": list(dm.shape), "knownFrac": round(float((dm > 0.2).mean()), 4), "median_m": round(float(np.median(dm[dm > 0.2])), 3) if (dm > 0.2).any() else None, "max_m": round(float(dm.max()), 3), "confidenceClassFrac": [round(float((sw.depth_confidence == c).mean()), 3) for c in (0, 1, 2)] if sw.depth_confidence is not None else None}
    cl = sw.cloud
    rec["cloudPoints"] = int(len(cl["xyz"])) if cl else 0
    ft = sw.features
    rec["features"] = {"count": int(len(ft["xyz"])), "descriptorBytes": int(ft["desc"].shape[1]) if ft.get("desc") is not None else None, "perFrame": [int((ft["frame"] == k).sum()) for k in range(6)]} if ft else None
    rec["mesh"] = {"chunks": len(sw.mesh), "vertices": int(sum(len(c["V"]) for c in sw.mesh)), "triangles": int(sum(len(c["I"]) // 3 for c in sw.mesh))}
    rec["conventions"] = {"assignment": conventions.check_assignment(sw), "features": conventions.check_features(sw) if ft else None, "offsets": conventions.check_offsets(sw)}
    return rec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("export")
    ap.add_argument("out")
    ap.add_argument("--sheets", default="")
    ap.add_argument("--all-sheets", action="store_true")
    a = ap.parse_args()
    ex = CaptureExport(Path(a.export))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    recs = []
    for sw in ex.sweeps.values():
        try:
            recs.append(inventory_sweep(sw))
        except Exception as e:  # keep going, record the failure
            recs.append({"id8": sw.id8, "kind": sw.man.kind, "status": sw.man.status, "error": repr(e)})
        print(sw.id8, recs[-1].get("kind"), recs[-1].get("status"), "container" if recs[-1].get("container") else "-", recs[-1].get("error", ""), flush=True)
    # neighbours by position (same floor, ≤ 4.6 m) among active sweeps
    act = [r for r in recs if r.get("kind") == "active"]
    for r in act:
        r["neighbours"] = sorted([(round(math.dist(r["position"], q["position"]), 2), q["id8"]) for q in act if q is not r and q["floor"] == r["floor"] and math.dist(r["position"], q["position"]) <= 4.6])
    inv = {"source": str(ex.root), "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "floors": ex.manifest["floors"], "counts": {"records": len(recs), "active": len(act), "withContainer": sum(1 for r in act if r.get("container")), "withPreview": sum(1 for r in act if r.get("preview"))}, "sweeps": recs}
    (out / "inventory.json").write_text(json.dumps(inv, indent=1))
    lines = ["# Kaldapealse tänav 2 — Capture export inventory", "", f"Source `{ex.root.name}`; {inv['counts']}", "", "| id | kind | status | floor | parent | container | preview | cloud pts | features | mesh tris | depth known | assign cov | offset r (m) | neighbours |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in recs:
        if r.get("kind") != "active":
            continue
        offs = r.get("conventions", {}).get("offsets", {}).get("radius_m") if r.get("container") else None
        lines.append(f"| {r['id8']} | {r['kind']} | {r['status']} | {r['floor']} | {r.get('parent8')} | {'yes' if r.get('container') else 'no'} | {'yes' if r.get('preview') else 'no'} | {r.get('cloudPoints', '')} | {(r.get('features') or {}).get('count', '')} | {(r.get('mesh') or {}).get('triangles', '')} | {(r.get('depth') or {}).get('knownFrac', '')} | {r.get('assignmentCoverage', '')} | {('%.2f–%.2f' % (min(offs), max(offs))) if offs else ''} | {' '.join(n[1] for n in r.get('neighbours', []))} |")
    (out / "inventory.md").write_text("\n".join(lines) + "\n")
    want = set(a.sheets.split(",")) - {""}
    for sw in ex.sweeps.values():
        if (a.all_sheets and sw.man.kind == "active" and sw.has_container) or sw.id8 in want:
            contact_sheet(sw, out / "sheets" / f"{sw.id8}.jpg")
            print("sheet", sw.id8, flush=True)
    print(f"done in {time.time() - t0:.0f}s → {out}")


if __name__ == "__main__":
    main()
