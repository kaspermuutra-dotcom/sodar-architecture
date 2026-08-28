"""Regenerate this fixture's input images. Deterministic: stdlib + numpy only.

    python fixtures/valid/panorama-stitch-001/make_inputs.py

Builds one seeded, feature-rich synthetic "scene" and slices three overlapping
views out of it (~50% overlap), so OpenCV's stitcher has real ORB features and
generous overlap to work with. No real property or capture data. The committed
PNGs are the source of truth; this script only reproduces them.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent / "input"
SCENE_H, SCENE_W = 200, 600
VIEW_W = 300
STARTS = (0, 150, 300)  # three 200x300 views, 50% overlap between neighbours
SEED = 20260828


def build_scene() -> np.ndarray:
    """Flat, few-colour background (compresses well) plus sharp high-contrast
    blocks that give ORB plenty of corners across the whole width."""
    rng = np.random.default_rng(SEED)
    yy, xx = np.mgrid[0:SCENE_H, 0:SCENE_W]
    # coarse 3-band background, quantized to keep entropy (and file size) low
    scene = np.stack(
        [
            np.where(xx % 120 < 60, 60, 190).astype(np.uint8),
            np.where(yy % 80 < 40, 70, 200).astype(np.uint8),
            ((xx // 40 * 40) * 255 // SCENE_W).astype(np.uint8),
        ],
        axis=-1,
    )
    palette = np.array(
        [[20, 20, 20], [240, 240, 240], [230, 30, 30], [30, 200, 60], [40, 60, 230]],
        dtype=np.uint8,
    )
    for _ in range(200):
        h, w = int(rng.integers(8, 20)), int(rng.integers(8, 20))
        y = int(rng.integers(0, SCENE_H - h))
        x = int(rng.integers(0, SCENE_W - w))
        scene[y : y + h, x : x + w] = palette[rng.integers(0, len(palette))]
    return scene


def write_png(path: Path, arr: np.ndarray) -> None:
    height, width, _ = arr.shape
    rows = bytearray()
    for y in range(height):
        rows.append(0)  # filter: none
        rows.extend(arr[y].tobytes())

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(rows), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    HERE.mkdir(parents=True, exist_ok=True)
    scene = build_scene()
    for i, start in enumerate(STARTS, start=1):
        view = scene[:, start : start + VIEW_W]
        write_png(HERE / f"view_{i:02d}.png", view)
        print(f"wrote {HERE / f'view_{i:02d}.png'} ({view.shape[1]}x{view.shape[0]})")


if __name__ == "__main__":
    main()
