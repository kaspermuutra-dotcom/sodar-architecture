"""Read-only model of a Matterport Capture export (iOS Capture 5.69, container format 4.1.2500).

Everything documented here was established by decoding the Kaldapealse tänav 2 export and cross-checking
against Matterport's own preview cubemaps and frame-assignment maps. Field numbers are protobuf field
numbers; "F" is the container frame in which the per-frame rotations are expressed; "base" is the
skybox/equirectangular base frame (y up, longitude 0 = +z); "sweep" is the z-up frame of the point cloud,
features and depth (the frame the manifest pose maps into the world).

Export layout (<export>/<capture-uuid>/):
  <SWEEP-UUID>.swl                          per-sweep container (~22 MB): 6 camera frames + depth + maps
  SweepProcessorData/manifest.mfst          poses (quaternion xyzw + position, z up), parents, floors, status
  SweepProcessorData/<uuid>_skybox{0..5}.jpg     512 px preview cubemap (0 up, 1..4 sides in yaw order, 5 down)
  SweepProcessorData/<hex>_{128,256,512}_00{0..5}.jpg   the same cubemap pyramid (hex = uuid without dashes)
  SweepProcessorData/<uuid>_skybox_seg{0..5}.jpg 60 px segmentation thumbnails
  SweepProcessorData/<uuid>_sweep_cloud.pb  Matterport's downsampled LiDAR point cloud (sweep frame) + 900×451 range grid
  SweepProcessorData/<uuid>_sweep_features.pb  9000 binary keypoints (512-bit) with 3-D positions, per frame
  SweepProcessorData/<hex>.dam              6-chunk low-poly mesh (float32 xyz + uv, varint indices)
  SweepProcessorData/<uuid>.mmp             mini-map: pose, bounds, three zstd grids (548×559)

.swl container (top-level fields):
  1   sweep uuid (16 bytes)                       2  1800 (depth panorama height/2?)
  5   depth record: .4 zstd TIFF 3600×1801 uint16 millimetres, .5 zstd TIFF uint8 (intensity/confidence),
      .19 zstd TIFF uint8 0..2 (ARKit-style confidence class), .7 JPEG 3600×1801 colour equirect (low quality)
  6   camera records (×2): .2 intrinsics {1 fx, 2 fy, 3 cx, 4 cy, 5-9 distortion (all 0), 10 w, 11 h},
      .6 JPEG frames (×6 of 4032×3024 in record 0; record 1 holds one 960×480 image), .23 device
      {2 make, 3 model, 4 id, 5 os}, .26 per-frame {1 quaternion xyzw (F→camera), 2 translation (always 0)}
  30  frame-assignment map: .2 480, .3 960, .4 zstd TIFF uint8 (0..5 = frame index, 255 = none)
  31  per-frame records (×6): .1 .2 .5 small angles, .3 2×2 identity, .6 tracked camera offset (metres, F frame,
      10–17 cm; see docs/RECON_NOTES.md — must be *measured*, not trusted), .7 (cos, sin) of the frame yaw,
      .9 quaternion xyzw (same rotation as 6.26.1), .10 1.0
  35  app {1 'Capture', 2 version, 3 build, 4 'iOS', 5 os version}
  43  two 80×240×3 float32 grids (all zero in this export)
"""
from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path

import numpy as np
import zstandard
from PIL import Image

from . import pb

MX = np.array([[0, 0, -1], [1, 0, 0], [0, -1, 0]], float)  # base → F (from the earlier pipeline, verified 92 % against the assignment map)
SWEEP_TO_BASE = np.array([[0, -1, 0], [0, 0, 1], [-1, 0, 0]], float)  # z-up sweep frame (cloud, features-3D? no: features are in F; depth, mesh) → base; measured: 100 % cloud/depth agreement
FACE_NAMES = {0: "top", 1: "front", 2: "right", 3: "back", 4: "left", 5: "bottom"}
_ZSTD = zstandard.ZstdDecompressor()


def quat_mat(q) -> np.ndarray:
    x, y, z, w = q
    n = math.sqrt(x * x + y * y + z * z + w * w)
    x, y, z, w = x / n, y / n, z / n, w / n
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


def dashed(hex32: str) -> str:
    h = hex32.replace("-", "").lower()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def _tiff(blob: bytes) -> np.ndarray:
    raw = _ZSTD.decompress(blob, max_output_size=256 * 1024 * 1024)
    return np.asarray(Image.open(io.BytesIO(raw)))


@dataclass
class Intrinsics:
    fx: float
    fy: float
    cx: float
    cy: float
    width: int
    height: int
    distortion: tuple[float, ...] = ()

    @property
    def K(self) -> np.ndarray:
        return np.array([[self.fx, 0, self.cx], [0, self.fy, self.cy], [0, 0, 1.0]])

    def hfov_deg(self) -> float:
        return 2 * math.degrees(math.atan(self.width / 2 / self.fx))

    def vfov_deg(self) -> float:
        return 2 * math.degrees(math.atan(self.height / 2 / self.fy))


@dataclass
class FrameRecord:
    index: int
    quat_xyzw: list[float]  # F → camera
    offset_m: np.ndarray | None  # field 31.6, F frame
    yaw_cs: tuple[float, float] | None  # field 31.7
    small: dict[int, float] = field(default_factory=dict)

    @property
    def R(self) -> np.ndarray:  # F → camera
        return quat_mat(self.quat_xyzw)


@dataclass
class ManifestSweep:
    id: str  # 32-hex
    parent: str | None
    q_xyzw: list[float]
    p: list[float]
    time: float
    floor: int
    status: str
    kind: str  # 'active' | 'failed' | 'removed' | 'cancelled'

    @property
    def R_world(self) -> np.ndarray:  # sweep → world
        return quat_mat(self.q_xyzw)

    @property
    def id8(self) -> str:
        return self.id[:8]


class Sweep:
    """Lazy accessors over one sweep's files. Nothing is cached on disk; the export is never written."""

    def __init__(self, export: "CaptureExport", man: ManifestSweep):
        self.export = export
        self.man = man
        self.id = man.id
        self.id8 = man.id8
        self.dashed = dashed(man.id)
        self.spd = export.spd
        self.swl_path = export.root / f"{self.dashed.upper()}.swl"

    # ---- container --------------------------------------------------------------------------------------
    @cached_property
    def _top(self) -> list[pb.Field]:
        return pb.wire(self.swl_path.read_bytes())

    @cached_property
    def has_container(self) -> bool:
        return self.swl_path.exists()

    @cached_property
    def _cam0(self) -> list[pb.Field]:
        cams = [pb.wire(c) for c in pb.get(self._top, 6)]
        # the record with the six full-size frames
        for c in cams:
            if len(pb.get(c, 6)) == 6:
                return c
        raise ValueError(f"{self.id8}: no six-frame camera record")

    @cached_property
    def intrinsics(self) -> Intrinsics:
        d = {f: v for f, _, v in pb.wire(pb.first(self._cam0, 2))}
        return Intrinsics(d[1], d[2], d[3], d[4], int(d.get(10, 4032)), int(d.get(11, 3024)), tuple(d.get(k, 0.0) for k in (5, 6, 7, 8, 9)))

    @cached_property
    def device(self) -> dict:
        d = {f: (v.decode("utf-8", "replace") if isinstance(v, bytes) else v) for f, _, v in pb.wire(pb.first(self._cam0, 23, b""))}
        app = {f: (v.decode("utf-8", "replace") if isinstance(v, bytes) else v) for f, _, v in pb.wire(pb.first(self._top, 35, b""))}
        return {"make": d.get(2), "model": d.get(3), "os": d.get(5), "app": app.get(1), "appVersion": app.get(2), "build": app.get(3), "container": pb.first(pb.wire(pb.first(self._top, 5)), 18, b"").decode()}

    @cached_property
    def frame_jpegs(self) -> list[bytes]:
        """The six original JPEG byte strings, untouched (no re-encoding). Order = field order = frame index."""
        frames = pb.get(self._cam0, 6)
        w, h = self.intrinsics.width, self.intrinsics.height
        out = []
        for fr in frames:
            with Image.open(io.BytesIO(fr)) as probe:
                if probe.size != (w, h):
                    raise ValueError(f"{self.id8}: frame size {probe.size} != intrinsics {(w, h)}")
            out.append(fr)
        return out

    def frame(self, k: int, scale: int = 1) -> np.ndarray:
        """Decoded RGB uint8 frame k, optionally reduced by an integer factor with the JPEG decoder's DCT scaling."""
        im = Image.open(io.BytesIO(self.frame_jpegs[k]))
        if scale > 1:
            im.draft("RGB", (im.width // scale, im.height // scale))
        return np.asarray(im.convert("RGB"))

    @cached_property
    def frames_meta(self) -> list[FrameRecord]:
        cam = [pb.wire(x) for x in pb.get(self._cam0, 26)]
        recs = [pb.wire(x) for x in pb.get(self._top, 31)]
        out = []
        for k in range(6):
            q = pb.floats(pb.wire(pb.first(cam[k], 1)))
            off = yaw = None
            small = {}
            if k < len(recs):
                r = recs[k]
                if pb.first(r, 6) is not None:
                    off = np.array(pb.floats(pb.wire(pb.first(r, 6))), float)
                if pb.first(r, 7) is not None:
                    yaw = tuple(pb.floats(pb.wire(pb.first(r, 7))))
                small = {f: v for f, t, v in r if t == "f"}
                q31 = pb.floats(pb.wire(pb.first(r, 9)))
                # 6.26.1 stores the same rotation as (w, x, y, z) of the inverse; 31.9 is (x, y, z, w) F→camera
                w, x, y, z = q
                if np.abs(np.abs(np.dot(q31, [-x, -y, -z, w])) - 1) > 1e-3:
                    raise ValueError(f"{self.id8}: frame {k} rotations disagree between 6.26 and 31.9")
                q = q31
            out.append(FrameRecord(k, q, off, yaw, small))
        return out

    @cached_property
    def assignment_map(self) -> np.ndarray | None:
        """960×480 uint8 equirect (base frame): Matterport's chosen source frame per direction, 255 = none."""
        rec = pb.first(self._top, 30)
        if rec is None:
            return None
        blob = pb.first(pb.wire(rec), 4)
        return _tiff(blob) if blob else None

    @cached_property
    def _depth_rec(self) -> list[pb.Field]:
        return pb.wire(pb.first(self._top, 5))

    @cached_property
    def depth_m(self) -> np.ndarray:
        """3600×1801 float32 metres in Matterport's *packed* layout, 0 = unknown.

        Row r = latitude (90° − r·0.1°). Each row stores a full 360° of longitude packed left-aligned into
        3600·cos(lat) pixels: col = ((lon + π) mod 2π) / 2π · 3600·cos(lat), lon measured in the base frame
        (y up, lon 0 = +z, lon = atan2(x, z)). Verified on four sweeps: 100 % of Matterport's own cloud points
        agree to < 2 %, median error 0. Use `depth_lookup` / `depth_equirect`, never index this directly.
        """
        return _tiff(pb.first(self._depth_rec, 4)).astype(np.float32) / 1000.0

    def depth_lookup(self, dirs_base: np.ndarray, img: np.ndarray | None = None) -> np.ndarray:
        """Nearest-sample range (metres, 0 = unknown) along unit directions in the base frame."""
        dm = self.depth_m if img is None else img
        H, W = dm.shape
        lon = np.arctan2(dirs_base[..., 0], dirs_base[..., 2])
        lat = np.arcsin(np.clip(dirs_base[..., 1], -1, 1))
        row = np.clip(np.round((np.pi / 2 - lat) / np.pi * H - 0.5).astype(np.int64), 0, H - 1)
        width = np.maximum(np.round(W * np.cos(lat)), 1.0)
        col = np.mod(np.round(np.mod(lon + np.pi, 2 * np.pi) / (2 * np.pi) * width), width).astype(np.int64)
        col = np.clip(col, 0, W - 1)
        return dm[row, col]

    def depth_equirect(self, w: int = 3600, h: int = 1801) -> np.ndarray:
        """The depth resampled to a plain equirect (base frame, lon 0 at the centre column)."""
        from .geom import equirect_dirs

        return self.depth_lookup(equirect_dirs(w, h))

    def cloud_to_base(self, p_sweep: np.ndarray) -> np.ndarray:
        """Sweep-frame (cloud/mesh/depth, z up) points → base frame (y up, lon 0 = +z)."""
        return p_sweep @ SWEEP_TO_BASE.T

    @cached_property
    def depth_intensity(self) -> np.ndarray | None:
        b = pb.first(self._depth_rec, 5)
        return _tiff(b) if b else None

    @cached_property
    def depth_confidence(self) -> np.ndarray | None:
        b = pb.first(self._depth_rec, 19)
        return _tiff(b) if b else None

    @cached_property
    def colour_equirect_lowres(self) -> np.ndarray:
        return np.asarray(Image.open(io.BytesIO(pb.first(self._depth_rec, 7))).convert("RGB"))

    # ---- SweepProcessorData ------------------------------------------------------------------------------
    def preview_face(self, n: int) -> np.ndarray:
        p = self.spd / f"{self.dashed}_skybox{n}.jpg"
        if not p.exists():
            p = self.spd / f"{self.id}_512_00{n}.jpg"
        return np.asarray(Image.open(p).convert("RGB"))

    @cached_property
    def has_preview(self) -> bool:
        return (self.spd / f"{self.dashed}_skybox0.jpg").exists() or (self.spd / f"{self.id}_512_000.jpg").exists()

    @cached_property
    def cloud(self) -> dict:
        """Matterport's point cloud in the sweep frame: xyz, normals, range, weight, flag; plus the 900×451 range grid."""
        p = self.spd / f"{self.dashed}_sweep_cloud.pb"
        if not p.exists():
            return {}
        m = pb.wire(p.read_bytes())
        xyz, nrm, rng, wgt, flag = [], [], [], [], []
        for r in pb.iter_msgs(m, 7):
            d = {f: v for f, _, v in r}
            v = np.frombuffer(d[5], "<f4")
            xyz.append(v[:3])
            nrm.append(v[3:6])
            rng.append(d.get(1, 0.0))
            wgt.append(d.get(6, 0.0))
            flag.append(d.get(4, 0))
        grid = None
        gb = pb.first(m, 12)
        h, w = pb.first(m, 13), pb.first(m, 14)
        if gb and h and w:
            grid = np.frombuffer(gb, "<u2").reshape(h, w).astype(np.float32) / 1000.0
        return {"xyz": np.array(xyz, np.float32), "normal": np.array(nrm, np.float32), "range": np.array(rng, np.float32), "weight": np.array(wgt, np.float32), "flag": np.array(flag, np.int32), "range_grid": grid}

    @cached_property
    def features(self) -> dict:
        """Matterport's keypoints: normalized frame coordinates, frame index, 3-D point (sweep frame), scale, response, 64-byte binary descriptors."""
        p = self.spd / f"{self.dashed}_sweep_features.pb"
        if not p.exists():
            return {}
        m = pb.wire(p.read_bytes())
        uv, fr, p3, sc, rs = [], [], [], [], []
        for k in pb.iter_msgs(m, 5):
            d = {f: v for f, _, v in k}
            uv.append(pb.floats(pb.wire(d[2])))
            fr.append(d.get(4, 0))
            p3.append(pb.floats(pb.wire(d[9])))
            sc.append(d.get(11, 0.0))
            rs.append(d.get(12, 0.0))
        desc = None
        db = pb.first(m, 4)
        if db:
            dd = {f: v for f, _, v in pb.wire(db)}
            n, w = dd.get(2), dd.get(3)
            desc = np.frombuffer(dd[4], "u1").reshape(n, w)
        frames = []
        f7 = pb.first(m, 7)
        if f7:
            for r in pb.iter_msgs(pb.wire(f7), 1):
                frames.append({"q": pb.floats(pb.wire(pb.first(r, 1))), "t": pb.floats(pb.wire(pb.first(r, 2)))})
        return {"uv": np.array(uv, np.float32), "frame": np.array(fr, np.int32), "xyz": np.array(p3, np.float32), "scale": np.array(sc, np.float32), "response": np.array(rs, np.float32), "desc": desc, "frames": frames}

    @cached_property
    def mesh(self) -> list[dict]:
        p = self.spd / f"{self.id}.dam"
        if not p.exists():
            return []
        chunks = []
        for ch in pb.iter_msgs(pb.wire(p.read_bytes()), 1):
            geo = {f: v for f, _, v in pb.wire(pb.first(ch, 1))}
            V = np.frombuffer(geo[1], "<f4").reshape(-1, 3)
            UV = np.frombuffer(geo[2], "<f4").reshape(-1, 2) if 2 in geo else None
            ib = pb.first(pb.wire(pb.first(ch, 2)), 1)
            idx, i = [], 0
            while i < len(ib):
                v, i = pb.varint(ib, i)
                idx.append(v)
            chunks.append({"name": pb.first(ch, 3, b"").decode("utf-8", "replace"), "material": pb.first(ch, 4, b"").decode("utf-8", "replace"), "V": V, "UV": UV, "I": np.array(idx, np.int64)})
        return chunks

    # ---- geometry helpers ---------------------------------------------------------------------------------
    def project(self, p_F: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Points in F (N×3) → (col, row, in_front) on frame k, with the offset applied only if the caller already subtracted it."""
        R = self.frames_meta[k].R
        K = self.intrinsics
        c = p_F @ R.T
        z = c[..., 2]
        valid = z < -1e-6
        inv = np.where(valid, -z, 1.0)
        col = K.cx - c[..., 0] / inv * K.fx
        row = K.cy - c[..., 1] / inv * K.fy
        return col, row, valid


class CaptureExport:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.spd = self.root / "SweepProcessorData"
        if not (self.spd / "manifest.mfst").exists():
            raise FileNotFoundError(self.spd / "manifest.mfst")

    @cached_property
    def manifest(self) -> dict:
        top = pb.wire((self.spd / "manifest.mfst").read_bytes())
        kinds = {1: "active", 7: "failed", 8: "removed", 25: "cancelled"}
        sweeps: list[ManifestSweep] = []
        floors = []
        address = None
        for f, t, v in top:
            if t != "b":
                continue
            if f == 15:
                m = pb.wire(v)
                floors.append({"index": pb.first(m, 1), "name": (pb.first(m, 2) or b"").decode("utf-8", "replace")})
                continue
            if f == 17:
                address = "(present, not decoded on purpose)"
                continue
            if f not in kinds:
                continue
            m = pb.wire(v)
            pose = pb.floats(pb.wire(pb.first(m, 3))) if pb.first(m, 3) is not None else []
            parent = pb.first(m, 2)
            sweeps.append(
                ManifestSweep(
                    id=pb.first(m, 1).hex(),
                    parent=parent.hex() if isinstance(parent, bytes) and len(parent) == 16 else None,
                    q_xyzw=pose[:4],
                    p=pose[4:7],
                    time=float(pb.first(m, 4, 0.0)),
                    floor=int(pb.first(m, 6, 0)),
                    status=(pb.first(m, 14) or b"").decode("utf-8", "replace") if isinstance(pb.first(m, 14), bytes) else str(pb.first(m, 14, "")),
                    kind=kinds[f],
                )
            )
        sweeps.sort(key=lambda s: s.time)
        return {"sweeps": sweeps, "floors": floors, "address": address}

    @cached_property
    def sweeps(self) -> dict[str, Sweep]:
        return {s.id8: Sweep(self, s) for s in self.manifest["sweeps"]}

    def override_camera(self, params_full: list[float]) -> None:
        """Use a calibrated camera (fx, fy, cx, cy, k1, k2, p1, p2 at full resolution) for every sweep."""
        fx, fy, cx, cy = params_full[:4]
        for sw in self.sweeps.values():
            sw.__dict__["intrinsics"] = Intrinsics(fx, fy, cx, cy, 4032, 3024, tuple(params_full[4:]))

    def active(self) -> list[Sweep]:
        return [s for s in self.sweeps.values() if s.man.kind == "active"]

    def by_id8(self, id8: str) -> Sweep:
        return self.sweeps[id8]
