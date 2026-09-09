#!/usr/bin/env python3
"""Turn a Matterport Capture export into a linked 360° walkthrough for the site.

The Capture app stores, per sweep, six 512 px skybox faces
(`<sweep>_skybox0..5.jpg`: 0 = up, 1..4 = sides in yaw order, 5 = down) and a
protobuf manifest (`SweepProcessorData/manifest.mfst`) with each sweep's pose
(quaternion + position, z up), the sweep it was aligned against, its floor
index and capture time. This script

  1. decodes the manifest without a schema (protobuf wire format only),
  2. writes a 512×256 preview and a 320×160 thumbnail per processed sweep from
     the export's 512 px skybox faces (placeholders until
     `matterport_capture_faces.py` renders the high-resolution cube faces),
  3. derives candidate links between sweeps from their positions (relative
     neighbourhood graph per floor, distance-capped) with hotspot yaw/pitch
     computed from the poses, and
  4. writes `<slug>.sweeps.json` next to the curated manifest in
     `site/lib/demo/`, which applies labels, checkpoints and link corrections.

Nothing here is synthetic and the export is only read, never modified.

Usage:
  python3 scripts/matterport_capture_tour.py \
      "<export>/<capture-uuid>" site/public/media/demo/<slug> site/lib/demo/<slug>.sweeps.json

Requires Pillow + numpy.
"""
from __future__ import annotations

import json
import math
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

EQUI_W, EQUI_H = 2048, 1024
PREVIEW_W, PREVIEW_H = 512, 256
THUMB_W, THUMB_H = 320, 160
STILL_W, STILL_H = 1280, 800
LINK_MAX_M = 4.6  # farther sweeps never link directly
LINK_MAX_PER_NODE = 5


# ---------------------------------------------------------------------------
# protobuf wire-format reader (schema-less)
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
            sub = _parse(v, depth + 1) if depth < 6 and n >= 2 else None
            if sub is not None:
                out.append((f, "m", sub))
            else:
                try:
                    s = v.decode("utf-8")
                    out.append((f, "s", s) if s.isprintable() else (f, "b", v.hex()))
                except UnicodeDecodeError:
                    out.append((f, "b", v.hex()))
        else:
            return None
    return out


def read_manifest(path: Path) -> dict:
    """Active sweeps (field 1) with pose, parent, floor, time and status; plus floors and excluded records."""
    top = _parse(path.read_bytes()) or []
    sweeps, floors, failed, cancelled, removed = [], [], [], [], []
    for f, t, v in top:
        if t != "m":
            continue
        rec = {}
        for ff, tt, vv in v:
            if ff == 1 and tt == "b":
                rec["id"] = vv
            elif ff == 2 and tt == "b":
                rec["parent"] = vv
            elif ff == 3 and tt == "m":
                fl = [x[2] for x in vv if x[1] == "f"]
                rec["q"], rec["p"] = fl[:4], fl[4:7]
            elif ff == 4 and tt == "d":
                rec["time"] = vv
            elif ff == 6 and tt == "v":
                rec["floor"] = vv
            elif ff == 14 and tt == "s":
                rec["status"] = vv
        if f == 1:
            sweeps.append(rec)
        elif f == 7:
            failed.append(rec)
        elif f == 8:
            removed.append(rec)
        elif f == 25:
            cancelled.append(rec)
        elif f == 15:
            floors.append({"index": next((x[2] for x in v if x[0] == 1), None), "name": next((x[2] for x in v if x[0] == 2), None)})
    sweeps.sort(key=lambda r: r.get("time", 0))
    return {"sweeps": sweeps, "floors": floors, "failed": failed, "cancelled": cancelled, "removed": removed}


# ---------------------------------------------------------------------------
# geometry
# ---------------------------------------------------------------------------
def heading_deg(q: list[float]) -> float:
    """Yaw of the sweep's local +x axis in the model frame (degrees, counter-clockwise from +x)."""
    x, y, z, w = q
    v = np.array([1.0, 0.0, 0.0])
    t = 2 * np.cross([x, y, z], v)
    r = v + w * t + np.cross([x, y, z], t)
    return math.degrees(math.atan2(r[1], r[0]))


def link_angles(a: dict, b: dict) -> tuple[float, float, float]:
    """(yaw, pitch, distance) of a hotspot in sweep a pointing at sweep b. Yaw is PSV-style: 0 = panorama centre, clockwise positive."""
    dx, dy, dz = b["p"][0] - a["p"][0], b["p"][1] - a["p"][1], b["p"][2] - a["p"][2]
    dist = math.hypot(dx, dy)
    theta = math.degrees(math.atan2(dy, dx))
    yaw = (a["heading"] - theta) % 360
    pitch = max(-40.0, min(25.0, math.degrees(math.atan2(dz, max(dist, 0.3))) - 14.0))
    return round(yaw, 1), round(pitch, 1), round(dist, 2)


def candidate_links(nodes: list[dict]) -> list[dict]:
    """Relative-neighbourhood graph within each floor, capped by distance and degree. Cross-floor links are curated by hand."""
    links = []
    by_floor: dict[int, list[dict]] = {}
    for n in nodes:
        by_floor.setdefault(n["floor"], []).append(n)
    for group in by_floor.values():
        for a in group:
            cands = []
            for b in group:
                if a is b:
                    continue
                dab = math.dist(a["p"][:2], b["p"][:2])
                if dab > LINK_MAX_M:
                    continue
                blocked = any(c is not a and c is not b and max(math.dist(a["p"][:2], c["p"][:2]), math.dist(b["p"][:2], c["p"][:2])) < dab for c in group)
                if not blocked:
                    cands.append((dab, b))
            cands.sort(key=lambda t: t[0])
            for dab, b in cands[:LINK_MAX_PER_NODE]:
                yaw, pitch, dist = link_angles(a, b)
                links.append({"from": a["id"], "to": b["id"], "yaw": yaw, "pitch": pitch, "distance": dist})
    return links


# ---------------------------------------------------------------------------
# imagery
# ---------------------------------------------------------------------------
def load_faces(spd: Path, sweep_dashed: str, sweep_hex: str) -> dict[int, np.ndarray] | None:
    faces = {}
    for n in range(6):
        p = spd / f"{sweep_dashed}_skybox{n}.jpg"
        if not p.exists():
            p = spd / f"{sweep_hex}_512_00{n}.jpg"  # identical faces, older naming
        if not p.exists():
            return None
        faces[n] = np.asarray(Image.open(p).convert("RGB"), dtype=np.float32)
    return faces


def _bilinear(img: np.ndarray, fu: np.ndarray, fv: np.ndarray) -> np.ndarray:
    size = img.shape[0]
    px = np.clip((fu + 1) / 2 * (size - 1), 0, size - 1)
    py = np.clip((1 - fv) / 2 * (size - 1), 0, size - 1)
    x0, y0 = np.floor(px).astype(int), np.floor(py).astype(int)
    x1, y1 = np.minimum(x0 + 1, size - 1), np.minimum(y0 + 1, size - 1)
    fx, fy = (px - x0)[..., None], (py - y0)[..., None]
    return img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x1] * fx * (1 - fy) + img[y1, x0] * (1 - fx) * fy + img[y1, x1] * fx * fy


def sample_cube(faces: dict[int, np.ndarray], x: np.ndarray, y: np.ndarray, z: np.ndarray) -> np.ndarray:
    ax, ay, az = np.abs(x), np.abs(y), np.abs(z)
    out = np.zeros(x.shape + (3,), np.float32)
    for mask, face, fu, fv in (
        ((az >= ax) & (az >= ay) & (z > 0), 1, x / az, y / az),
        ((ax >= az) & (ax >= ay) & (x > 0), 2, -z / ax, y / ax),
        ((az >= ax) & (az >= ay) & (z < 0), 3, -x / az, y / az),
        ((ax >= az) & (ax >= ay) & (x < 0), 4, z / ax, y / ax),
        ((ay > ax) & (ay > az) & (y > 0), 0, x / ay, -z / ay),
        ((ay > ax) & (ay > az) & (y < 0), 5, x / ay, z / ay),
    ):
        out[mask] = _bilinear(faces[face], fu, fv)[mask]
    return out


def equirect(faces: dict[int, np.ndarray]) -> Image.Image:
    u = (np.arange(EQUI_W) + 0.5) / EQUI_W * 2 * np.pi - np.pi
    v = np.pi / 2 - (np.arange(EQUI_H) + 0.5) / EQUI_H * np.pi
    lon, lat = np.meshgrid(u, v)
    return Image.fromarray(sample_cube(faces, np.cos(lat) * np.sin(lon), np.sin(lat), np.cos(lat) * np.cos(lon)).astype(np.uint8))


def rectilinear(faces: dict[int, np.ndarray], yaw_deg: float, fov_deg: float, pitch_deg: float = -4) -> Image.Image:
    f = (STILL_W / 2) / np.tan(np.radians(fov_deg) / 2)
    gx, gy = np.meshgrid((np.arange(STILL_W) + 0.5) - STILL_W / 2, STILL_H / 2 - (np.arange(STILL_H) + 0.5))
    d = np.stack([gx, gy, np.full_like(gx, f)], -1)
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    p, yw = np.radians(pitch_deg), np.radians(yaw_deg)
    rx = np.array([[1, 0, 0], [0, np.cos(p), -np.sin(p)], [0, np.sin(p), np.cos(p)]])
    ry = np.array([[np.cos(yw), 0, np.sin(yw)], [0, 1, 0], [-np.sin(yw), 0, np.cos(yw)]])
    d = d @ rx.T @ ry.T
    return Image.fromarray(sample_cube(faces, d[..., 0], d[..., 1], d[..., 2]).astype(np.uint8))


# ---------------------------------------------------------------------------
def main() -> None:
    export, media, out_json = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    poster_sweep = sys.argv[4] if len(sys.argv) > 4 else None  # "<id8>:<yaw>:<fov>" for og.jpg + poster
    stills = sys.argv[5].split(",") if len(sys.argv) > 5 else []  # "<id8>:<yaw>:<fov>,..." gallery stills (raw panorama yaw)
    spd = export / "SweepProcessorData"
    man = read_manifest(spd / "manifest.mfst")
    (media / "pano").mkdir(parents=True, exist_ok=True)
    (media / "thumb").mkdir(parents=True, exist_ok=True)

    nodes, excluded = [], []
    for rec in man["sweeps"]:
        hex_id = rec["id"]
        dashed = f"{hex_id[:8]}-{hex_id[8:12]}-{hex_id[12:16]}-{hex_id[16:20]}-{hex_id[20:]}"
        faces = load_faces(spd, dashed, hex_id)
        if faces is None:
            excluded.append({"sweep": hex_id, "status": rec.get("status"), "reason": "no processed skybox faces in the export"})
            continue
        node = {
            "id": hex_id[:8],
            "sweep": hex_id,
            "parent": (rec.get("parent") or "")[:8] or None,
            "floor": rec.get("floor", 1),
            "p": [round(c, 3) for c in rec["p"]],
            "heading": round(heading_deg(rec["q"]), 2),
            "time": rec.get("time"),
            "status": rec.get("status"),
            "faces": "skybox" if (spd / f"{dashed}_skybox0.jpg").exists() else "512",
        }
        # Preview/thumbnail placeholders from the 512 px faces; scripts/matterport_capture_faces.py replaces them with
        # the high-resolution composite and writes the cube-face tile pyramid the viewer actually renders.
        eq = equirect(faces)
        eq.resize((PREVIEW_W, PREVIEW_H), Image.LANCZOS).save(media / "pano" / f"{node['id']}.preview.webp", quality=74, method=6)
        eq.resize((THUMB_W, THUMB_H), Image.LANCZOS).save(media / "thumb" / f"{node['id']}.webp", quality=74, method=6)
        nodes.append(node)
        print("converted", node["id"], node["status"], node["faces"])

    if poster_sweep:
        pid, pyaw, pfov = poster_sweep.split(":")
        rec = next(r for r in man["sweeps"] if r["id"].startswith(pid))
        hex_id = rec["id"]
        dashed = f"{hex_id[:8]}-{hex_id[8:12]}-{hex_id[12:16]}-{hex_id[16:20]}-{hex_id[20:]}"
        faces = load_faces(spd, dashed, hex_id)
        rectilinear(faces, float(pyaw), float(pfov)).save(media / "poster.webp", quality=80, method=6)
        og = rectilinear(faces, float(pyaw), float(pfov) + 8, pitch_deg=-2).resize((1200, 750), Image.LANCZOS).crop((0, 60, 1200, 690))
        og.save(media / "og.jpg", quality=84, optimize=True)

    if stills:
        (media / "stills").mkdir(exist_ok=True)
    for spec in stills:
        sid, syaw, sfov = spec.split(":")
        rec = next(r for r in man["sweeps"] if r["id"].startswith(sid))
        hex_id = rec["id"]
        dashed = f"{hex_id[:8]}-{hex_id[8:12]}-{hex_id[12:16]}-{hex_id[16:20]}-{hex_id[20:]}"
        rectilinear(load_faces(spd, dashed, hex_id), float(syaw), float(sfov)).save(media / "stills" / f"{sid}.webp", quality=80, method=6)

    for r in man["failed"]:
        excluded.append({"sweep": r.get("id"), "status": r.get("status"), "reason": "Capture could not align this sweep; it has no pose in the model"})
    for r in man["cancelled"]:
        excluded.append({"sweep": r.get("id"), "status": r.get("status"), "reason": "cancelled by the operator during capture"})
    out = {
        "source": "Matterport Capture export — skybox faces re-projected to equirectangular; poses from manifest.mfst. No generative imagery.",
        "floors": man["floors"],
        "nodes": nodes,
        "candidateLinks": candidate_links(nodes),
        "excluded": excluded,
        "removedRecords": len(man["removed"]),
    }
    out_json.write_text(json.dumps(out, indent=2) + "\n")
    print(f"{len(nodes)} nodes, {len(out['candidateLinks'])} candidate links, {len(excluded)} excluded, {len(man['removed'])} removed-from-model records → {out_json}")


if __name__ == "__main__":
    main()
