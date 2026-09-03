"""Generate two synthetic equirectangular panoramas for the viewer demo.

These stand in for real stitcher output (StitchEngine -> EquirectangularImage)
so `viewer/index.html` renders with no external assets. Not a fixture; throwaway.

    python3 viewer/panoramas/make_demo_panoramas.py
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image

# 6K equirectangular — a realistic single-shot 360 camera resolution, so
# bytes-to-first-frame in the TD-003 bake-off reflect production, not a toy.
W, H = 6144, 3072
HERE = Path(__file__).parent


def base_room(rgb_wall: tuple[int, int, int], rgb_floor: tuple[int, int, int]) -> np.ndarray:
    img = np.zeros((H, W, 3), dtype=np.float64)
    # vertical gradient: ceiling (light) -> wall -> floor
    for y in range(H):
        lat = (y / H) * math.pi - math.pi / 2  # -pi/2 .. pi/2
        t = (y / H)
        ceil = np.array([236, 238, 242], dtype=np.float64)
        wall = np.array(rgb_wall, dtype=np.float64)
        floor = np.array(rgb_floor, dtype=np.float64)
        if t < 0.42:
            k = t / 0.42
            col = ceil * (1 - k) + wall * k
        elif t > 0.62:
            k = (t - 0.62) / 0.38
            col = wall * (1 - k) + floor * k
        else:
            col = wall
        # subtle horizon vignette
        col *= 0.82 + 0.18 * math.cos(lat)
        img[y, :, :] = col
    return img


def draw_grid(img: np.ndarray, step_deg: int = 15) -> None:
    step_x = int(W * step_deg / 360)
    step_y = int(H * step_deg / 180)
    img[::step_y, :, :] *= 0.7
    img[:, ::step_x, :] *= 0.7


def draw_marker(img: np.ndarray, heading_deg: float, rgb: tuple[int, int, int]) -> None:
    """Paint a coloured pillar at a compass heading so orientation is legible."""
    cx = int((heading_deg % 360) / 360 * W)
    half = int(W * 0.012)
    y0, y1 = int(H * 0.30), int(H * 0.72)
    x0, x1 = max(0, cx - half), min(W, cx + half)
    img[y0:y1, x0:x1, :] = np.array(rgb, dtype=np.float64)


def finish(img: np.ndarray, name: str) -> None:
    out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB")
    path = HERE / name
    out.save(path, "JPEG", quality=82)  # matched with scripts/psv_tour_spike.py
    print(f"wrote {path}  ({path.stat().st_size // 1024} KiB)")


def main() -> None:
    living = base_room((150, 120, 96), (110, 82, 60))     # warm room
    draw_grid(living)
    draw_marker(living, 90, (70, 130, 180))   # hotspot toward "kitchen" (east)
    draw_marker(living, 270, (200, 90, 90))   # back wall
    finish(living, "living-room.jpg")

    kitchen = base_room((120, 140, 150), (90, 100, 105))  # cool room
    draw_grid(kitchen)
    draw_marker(kitchen, 270, (70, 130, 180))  # hotspot back toward "living room" (west)
    finish(kitchen, "kitchen.jpg")


if __name__ == "__main__":
    main()
