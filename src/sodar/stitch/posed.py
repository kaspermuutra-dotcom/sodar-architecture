"""Pose-guided equirectangular stitching.

Re-implements the core of the Photo Sphere Android app's stitcher
(third_party/360-photo-app, MIT, `EquirectangularRenderer` + `PoseRefiner`) in
numpy: every captured frame carries the orientation the phone reported when
the shutter fired, so each frame is *projected* onto the equirectangular
canvas from that pose instead of being matched feature-by-feature. Blank walls
and low-texture rooms — where OpenCV's feature stitcher gives up — still
produce a panorama. Optional ORB refinement (when cv2 is importable) corrects
compass noise between neighbouring frames.

Conventions (match `site/lib/scanner/sphere.ts`):
  yaw        degrees, compass-like: 0 = +Y ("north"), increasing clockwise
  elevation  degrees above the horizon (positive = camera looks up)
  roll       degrees, rotation about the optical axis
  fov        {"horizontal": deg, "vertical": deg} of the *captured* frame
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


@dataclass(frozen=True)
class Frame:
    path: Path
    yaw: float
    elevation: float
    roll: float = 0.0


@dataclass
class StitchResult:
    panorama: np.ndarray  # H×W×3 uint8
    coverage: np.ndarray  # H×W bool, True where any frame contributed
    yaws_used: list[float]
    refined: bool
    notes: list[str] = field(default_factory=list)

    @property
    def coverage_fraction(self) -> float:
        return float(self.coverage.mean())


def _rad(d: float) -> float:
    return d * math.pi / 180.0


def camera_basis(yaw: float, elevation: float, roll: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Right / up / forward unit vectors in world space for one pose."""
    y, e, r = _rad(yaw), _rad(elevation), _rad(roll)
    forward = np.array([math.sin(y) * math.cos(e), math.cos(y) * math.cos(e), math.sin(e)])
    right0 = np.array([math.cos(y), -math.sin(y), 0.0])
    up0 = np.cross(right0, forward)
    right = right0 * math.cos(r) - up0 * math.sin(r)
    up = up0 * math.cos(r) + right0 * math.sin(r)
    return right, up, forward


def equirect_directions(width: int, height: int) -> np.ndarray:
    """H×W×3 unit direction for every output pixel (lon → yaw, lat → elevation)."""
    xs = (np.arange(width) + 0.5) / width * 2 * math.pi - math.pi  # -π..π, 0 = north
    ys = math.pi / 2 - (np.arange(height) + 0.5) / height * math.pi  # +π/2 top
    lon, lat = np.meshgrid(xs, ys)
    cos_lat = np.cos(lat)
    return np.stack([np.sin(lon) * cos_lat, np.cos(lon) * cos_lat, np.sin(lat)], axis=-1)


def _feather(w: int, h: int, fraction: float = 0.18) -> np.ndarray:
    """Weight that ramps from 0 at the frame edge to 1 inside; kills visible seams."""
    fx = np.minimum(np.arange(w) + 0.5, w - 0.5 - np.arange(w)) / (w * fraction)
    fy = np.minimum(np.arange(h) + 0.5, h - 0.5 - np.arange(h)) / (h * fraction)
    return np.clip(np.minimum(fx[None, :], fy[:, None]), 0.02, 1.0).astype(np.float32)


def _bilinear(img: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    x0 = np.floor(u).astype(np.int32)
    y0 = np.floor(v).astype(np.int32)
    x1 = np.clip(x0 + 1, 0, w - 1)
    y1 = np.clip(y0 + 1, 0, h - 1)
    x0 = np.clip(x0, 0, w - 1)
    y0 = np.clip(y0, 0, h - 1)
    fx = (u - x0)[..., None]
    fy = (v - y0)[..., None]
    top = img[y0, x0] * (1 - fx) + img[y0, x1] * fx
    bottom = img[y1, x0] * (1 - fx) + img[y1, x1] * fx
    return top * (1 - fy) + bottom * fy


def _load(path: Path, max_dim: int) -> np.ndarray:
    im = Image.open(path).convert("RGB")
    if max(im.size) > max_dim:
        im.thumbnail((max_dim, max_dim), Image.LANCZOS)
    return np.asarray(im, dtype=np.float32)


def refine_yaws(images: list[np.ndarray], frames: list[Frame], fov: dict[str, float]) -> tuple[list[float], bool, list[str]]:
    """ORB-based yaw correction between yaw-adjacent frames (Photo Sphere's PoseRefiner, simplified).

    Sensor yaw drifts a few degrees; matched features between neighbours give
    the true relative rotation as a horizontal pixel shift. We keep the sensor
    yaw as the anchor for the first frame and chain corrections along the ring,
    accepting a correction only when enough inliers agree.
    """
    try:
        import cv2  # noqa: PLC0415
    except Exception:  # pragma: no cover - optional dependency
        return [f.yaw for f in frames], False, ["cv2 unavailable: sensor yaws used as-is"]

    order = sorted(range(len(frames)), key=lambda i: frames[i].yaw % 360)
    orb = cv2.ORB_create(nfeatures=1500)
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    descs = []
    for i in order:
        gray = cv2.cvtColor(images[i].astype(np.uint8), cv2.COLOR_RGB2GRAY)
        descs.append(orb.detectAndCompute(gray, None))
    yaws = [frames[i].yaw for i in order]
    corrected = [yaws[0]]
    notes: list[str] = []
    applied = 0
    for k in range(1, len(order)):
        i_prev, i_cur = order[k - 1], order[k]
        kp_a, d_a = descs[k - 1]
        kp_b, d_b = descs[k]
        sensor_delta = (frames[i_cur].yaw - frames[i_prev].yaw) % 360
        if sensor_delta > 180:
            sensor_delta -= 360
        delta = sensor_delta
        if d_a is not None and d_b is not None and len(kp_a) > 20 and len(kp_b) > 20:
            matches = matcher.match(d_a, d_b)
            if len(matches) >= 20:
                w = images[i_cur].shape[1]
                fx = (w / 2) / math.tan(_rad(fov["horizontal"] / 2))
                shifts = np.array([kp_a[m.queryIdx].pt[0] - kp_b[m.trainIdx].pt[0] for m in matches])
                med = float(np.median(shifts))
                inliers = np.abs(shifts - med) < 6
                if inliers.sum() >= 15:
                    measured = math.degrees(math.atan(med / fx))
                    if abs(measured - sensor_delta) < 12:
                        delta = measured
                        applied += 1
        corrected.append(corrected[-1] + delta)
    # distribute closure error so the ring meets itself
    total = corrected[-1] - corrected[0]
    expected = 360 - ((yaws[0] - corrected[-1]) % 360) if len(order) > 2 else total
    closure = (expected - total) if len(order) > 2 else 0.0
    if abs(closure) < 20 and len(order) > 2:
        for k in range(1, len(corrected)):
            corrected[k] += closure * k / (len(corrected) - 1)
    out = [0.0] * len(frames)
    for k, i in enumerate(order):
        out[i] = corrected[k]
    notes.append(f"orb refinement applied to {applied}/{len(order) - 1} pairs; ring closure {closure:+.1f}°")
    return out, applied > 0, notes


def stitch(frames: list[Frame], fov: dict[str, float], width: int = 4096, max_input_dim: int = 1600, refine: bool = True, gain: bool = True) -> StitchResult:
    height = width // 2
    images = [_load(f.path, max_input_dim) for f in frames]
    yaws, refined, notes = refine_yaws(images, frames, fov) if refine else ([f.yaw for f in frames], False, [])

    if gain and images:
        means = np.array([im.mean() for im in images])
        target = float(np.median(means))
        images = [im * (target / m) if m > 1 else im for im, m in zip(images, means)]
        notes.append("per-frame gain normalised to the median luminance")

    dirs = equirect_directions(width, height)  # H×W×3
    color = np.zeros((height, width, 3), np.float32)
    weight = np.zeros((height, width), np.float32)

    for im, frame, yaw in zip(images, frames, yaws):
        h, w = im.shape[:2]
        fx = (w / 2) / math.tan(_rad(fov["horizontal"] / 2))
        fy = (h / 2) / math.tan(_rad(fov["vertical"] / 2))
        right, up, forward = camera_basis(yaw, frame.elevation, frame.roll)
        cz = dirs @ forward
        # only the hemisphere in front of the camera can hit the image plane
        region = cz > 0.15
        if not region.any():
            continue
        ys, xs = np.nonzero(region)
        d = dirs[ys, xs]
        czr = cz[ys, xs]
        u = w / 2 + fx * (d @ right) / czr
        v = h / 2 - fy * (d @ up) / czr
        inside = (u >= 0) & (u <= w - 1) & (v >= 0) & (v <= h - 1)
        if not inside.any():
            continue
        ys, xs, u, v = ys[inside], xs[inside], u[inside], v[inside]
        feather = _feather(w, h)
        wgt = feather[np.clip(v.astype(np.int32), 0, h - 1), np.clip(u.astype(np.int32), 0, w - 1)]
        color[ys, xs] += _bilinear(im, u, v) * wgt[:, None]
        weight[ys, xs] += wgt

    covered = weight > 0
    out = np.zeros_like(color)
    out[covered] = color[covered] / weight[covered][:, None]
    return StitchResult(panorama=np.clip(out, 0, 255).astype(np.uint8), coverage=covered, yaws_used=list(map(float, yaws)), refined=refined, notes=notes)


def load_frames_json(path: Path, root: Path | None = None) -> tuple[list[Frame], dict[str, float]]:
    """Read the scanner's export manifest (`frames.json`) into Frame objects.

    Accepts the flat shape `{fov, frames:[{file, yaw, elevation|pitch, roll}]}` and the
    multi-room export `{rooms:[{id, name, fov, frames:[…]}]}` (first room, or the
    room selected by the caller via `room_id`).
    """
    data = json.loads(Path(path).read_text())
    root = root or Path(path).parent
    if "rooms" in data:
        data = data["rooms"][0]
    fov = {"horizontal": float(data.get("fov", {}).get("horizontal", 55)), "vertical": float(data.get("fov", {}).get("vertical", 72))}
    frames: list[Frame] = []
    for f in data["frames"]:
        elevation = f.get("elevation")
        if elevation is None:
            elevation = -float(f.get("pitch", 0.0))
        frames.append(Frame(path=root / f["file"], yaw=float(f["yaw"]), elevation=float(elevation), roll=float(f.get("roll", 0.0))))
    return frames, fov


def save_outputs(result: StitchResult, out_dir: Path, stem: str = "panorama") -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    pano = out_dir / f"{stem}.jpg"
    mask = out_dir / f"{stem}-mask.png"
    Image.fromarray(result.panorama).save(pano, "JPEG", quality=90, optimize=True)
    Image.fromarray((~result.coverage).astype(np.uint8) * 255).save(mask, "PNG")
    return {"panorama": pano.name, "mask": mask.name, "coverage": round(result.coverage_fraction, 4), "refined": result.refined, "yaws_used": [round(y, 2) for y in result.yaws_used], "notes": result.notes}
