"""Regenerate this fixture's input images. Deterministic: stdlib + numpy only.

    python fixtures/valid/panorama-tour-001/make_inputs.py

Two small synthetic 2:1 equirectangular panoramas (a lat/long grid so
projection distortion is visible, plus a colour marker per room) for the
psv-viewer provider's room-graph + panorama input contract. No real property
or capture data. The committed JPEGs/tour.json are the source of truth; this
script only reproduces them.
"""

from __future__ import annotations

import json
import struct
import zlib
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent / "input"
W, H = 512, 256  # small 2:1 equirectangular — this is a fixture, not a real capture

ROOMS = [
    {"id": "living-room", "name": "Living room", "bg": (40, 70, 120), "accent": (235, 180, 90)},
    {"id": "kitchen", "name": "Kitchen", "bg": (60, 110, 90), "accent": (210, 90, 110)},
]


def _make_pano(bg: tuple[int, int, int], accent: tuple[int, int, int]) -> np.ndarray:
    yy, xx = np.mgrid[0:H, 0:W]
    img = np.zeros((H, W, 3), dtype=np.uint8)
    img[:] = bg
    grid = ((xx % (W // 12)) < 1) | ((yy % (H // 6)) < 1)
    img[grid] = (230, 230, 235)
    cx, cy = W // 2, H // 2
    marker = (np.abs(xx - cx) < 18) & (np.abs(yy - cy) < 18)
    img[marker] = accent
    return img


def _write_png(path: Path, arr: np.ndarray) -> None:
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
    for room in ROOMS:
        out_path = HERE / f"{room['id']}.png"
        _write_png(out_path, _make_pano(room["bg"], room["accent"]))
        print(f"wrote {out_path}")

    tour = {
        "title": "Fixture — two-room demo tour",
        "startNodeId": "living-room",
        "nodes": [
            {
                "id": "living-room",
                "name": "Living room",
                "panorama": "input/living-room.png",
                "links": [{"nodeId": "kitchen", "yaw_deg": 90, "pitch_deg": -6, "label": "Kitchen"}],
            },
            {
                "id": "kitchen",
                "name": "Kitchen",
                "panorama": "input/kitchen.png",
                "links": [
                    {"nodeId": "living-room", "yaw_deg": -90, "pitch_deg": -6, "label": "Living room"}
                ],
            },
        ],
    }
    (HERE / "tour.json").write_text(json.dumps(tour, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {HERE / 'tour.json'}")


if __name__ == "__main__":
    main()
