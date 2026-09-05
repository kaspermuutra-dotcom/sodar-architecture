"""Regenerate this fixture: a synthetic room panorama sliced into posed frames.

    .venv/bin/python fixtures/valid/panorama-posed-001/make_inputs.py

Builds a seeded 2:1 equirectangular "room" (coloured wall bands, a door, a
window, a striped floor, a plain ceiling), then renders 12 pinhole views around
the equator exactly the way the phone scanner captures a ring — 55°×72° FOV,
30° apart, with ±3° of compass noise and small roll — and writes
`input/frames.json` in the scanner's export format. The stitcher must rebuild
the panorama from those frames; `truth.jpg` is kept for eyeballing.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE / "input"
W, H = 2048, 1024
FRAME_W, FRAME_H = 480, 640
FOV = {"horizontal": 55.0, "vertical": 72.0}
SEED = 20260905


def build_room() -> np.ndarray:
    rng = np.random.default_rng(SEED)
    lon = (np.arange(W) + 0.5) / W * 360 - 180
    lat = 90 - (np.arange(H) + 0.5) / H * 180
    LON, LAT = np.meshgrid(lon, lat)
    img = np.zeros((H, W, 3), np.uint8)
    # walls: four colour bands with a dark baseboard and a picture rail
    walls = [(235, 228, 215), (206, 196, 180), (222, 214, 200), (190, 182, 168)]
    for i, c in enumerate(walls):
        sel = ((LON + 180) // 90 == i) & (LAT < 35) & (LAT > -25)
        img[sel] = c
    img[(LAT >= 35) & (LAT < 90)] = (245, 243, 238)  # ceiling
    img[(LAT <= -25)] = (120, 90, 60)  # floor
    stripes = ((LON // 8) % 2 == 0) & (LAT <= -25)
    img[stripes] = (140, 105, 70)
    img[(LAT > -27) & (LAT < -25)] = (60, 55, 50)  # baseboard
    # a door and a window with frames
    door = (LON > 20) & (LON < 45) & (LAT > -25) & (LAT < 22)
    img[door] = (90, 70, 50)
    win = (LON > -120) & (LON < -80) & (LAT > -5) & (LAT < 25)
    img[win] = (150, 200, 240)
    frame = win & ~((LON > -117) & (LON < -83) & (LAT > -2) & (LAT < 22))
    img[frame] = (250, 250, 250)
    # texture so feature matching has something to hold on to
    noise = rng.integers(-10, 10, size=(H, W, 1))
    img = np.clip(img.astype(int) + noise, 0, 255).astype(np.uint8)
    for _ in range(140):
        x, y = int(rng.integers(0, W - 24)), int(rng.integers(int(H * 0.3), int(H * 0.64)))
        img[y : y + 6, x : x + 24] = rng.integers(40, 220, size=3)
    return img


def render_view(pano: np.ndarray, yaw: float, elevation: float, roll: float) -> np.ndarray:
    from sodar.stitch.posed import camera_basis  # noqa: PLC0415

    right, up, forward = camera_basis(yaw, elevation, roll)
    fx = (FRAME_W / 2) / math.tan(math.radians(FOV["horizontal"] / 2))
    fy = (FRAME_H / 2) / math.tan(math.radians(FOV["vertical"] / 2))
    xs = (np.arange(FRAME_W) + 0.5 - FRAME_W / 2) / fx
    ys = -(np.arange(FRAME_H) + 0.5 - FRAME_H / 2) / fy
    X, Y = np.meshgrid(xs, ys)
    d = X[..., None] * right + Y[..., None] * up + forward
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    lon = np.arctan2(d[..., 0], d[..., 1])
    lat = np.arcsin(np.clip(d[..., 2], -1, 1))
    px = ((lon + math.pi) / (2 * math.pi) * W).astype(int) % W
    py = np.clip(((math.pi / 2 - lat) / math.pi * H).astype(int), 0, H - 1)
    return pano[py, px]


def main() -> None:
    OUT.mkdir(exist_ok=True)
    pano = build_room()
    Image.fromarray(pano).save(HERE / "truth.jpg", "JPEG", quality=85)
    rng = np.random.default_rng(SEED + 1)
    frames = []
    inputs = ["input/frames.json"]
    for i in range(12):
        true_yaw = i * 30.0
        yaw = true_yaw + float(rng.normal(0, 3))  # compass noise the stitcher must absorb
        elevation = float(rng.normal(0, 1.5))
        roll = float(rng.normal(0, 1.0))
        view = render_view(pano, true_yaw, elevation, roll)
        name = f"input/frame-{i + 1:03d}.jpg"
        Image.fromarray(view).save(HERE / name, "JPEG", quality=88)
        frames.append({"file": name, "yaw": round(yaw, 3), "elevation": round(elevation, 3), "roll": round(roll, 3)})
        inputs.append(name)
    (OUT / "frames.json").write_text(json.dumps({"schema": "sodar-frames.v1", "fov": FOV, "frames": frames}, indent=2) + "\n")
    print("wrote", len(frames), "frames; declare in manifest:", json.dumps(inputs))


if __name__ == "__main__":
    main()
