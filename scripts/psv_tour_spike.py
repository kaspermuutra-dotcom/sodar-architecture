"""Phase-1 step-4 spike: Photo Sphere Viewer connected-room tour.

Answers the TD-003 open question — is a PSV equirectangular tour smooth on a real
phone (risk R7), and does room-to-room hotspot navigation work (AC-4)?

This is a throwaway spike ahead of the real `build_tour.py` / `PhotoSphereViewerBuilder`.
It generates two synthetic 6K equirectangular panoramas (a lat/long grid so
projection distortion is visible, plus heading markers per room) and writes a
self-contained static bundle:

    artifacts/tours/psv-spike/
      index.html          PSV core + VirtualTourPlugin (from jsDelivr, ESM)
      tour.json           tour.v0 scene graph, transformed to PSV nodes at runtime
      panoramas/living-room.jpg, kitchen.jpg

Panorama resolution + JPEG quality are matched with
`viewer/panoramas/make_demo_panoramas.py` so the TD-003 bytes-to-first-frame
comparison is apples-to-apples.

    cd artifacts/tours/psv-spike && python3 -m http.server 8080
    # then http://localhost:8080  — and the same URL on a phone on the LAN
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts" / "tours" / "psv-spike"
W, H = 6144, 3072  # 6K 2:1 equirectangular — matched with viewer/
JPEG_QUALITY = 82  # matched with viewer/

# tour.v0 (see schemas/tour.v0.json). The PSV spike consumes the shared contract
# and maps it to PSV's native nodes/links shape in the browser.
TOUR_V0 = {
    "schema_version": "tour.v0",
    "scan_id": "demo-scan-0001",
    "title": "Demo property — panorama tour",
    "start_node": "living-room",
    "nodes": [
        {
            "id": "living-room",
            "room": "Living room",
            "panorama": "panoramas/living-room.jpg",
            "north_offset_deg": 0,
            "initial_yaw_deg": 0,
            "hotspots": [{"to": "kitchen", "label": "Kitchen", "yaw_deg": 90, "pitch_deg": -6}],
        },
        {
            "id": "kitchen",
            "room": "Kitchen",
            "panorama": "panoramas/kitchen.jpg",
            "north_offset_deg": 0,
            "initial_yaw_deg": 0,
            "hotspots": [
                {"to": "living-room", "label": "Living room", "yaw_deg": 270, "pitch_deg": -6}
            ],
        },
    ],
}

_ROOMS = [
    ("living-room", (150, 120, 96), (110, 82, 60), 90),
    ("kitchen", (120, 140, 150), (90, 100, 105), 270),
]


def make_pano(wall: tuple[int, int, int], floor: tuple[int, int, int], marker_deg: int) -> np.ndarray:
    y = np.arange(H)[:, None]
    t = y / H
    ceil = np.array([236, 238, 242.0])
    wall_a = np.array(wall, dtype=float)
    floor_a = np.array(floor, dtype=float)
    col = np.where(
        t < 0.42,
        ceil * (1 - t / 0.42) + wall_a * (t / 0.42),
        np.where(t > 0.62, wall_a * (1 - (t - 0.62) / 0.38) + floor_a * ((t - 0.62) / 0.38), wall_a),
    )
    lat = t * math.pi - math.pi / 2
    col = col * (0.82 + 0.18 * np.cos(lat))
    img = np.broadcast_to(col[:, None, :], (H, W, 3)).astype(float).copy()

    step_x, step_y = int(W * 15 / 360), int(H * 15 / 180)
    img[::step_y, :, :] *= 0.7
    img[:, ::step_x, :] *= 0.7

    for deg, rgb in ((marker_deg, (70, 130, 180)), ((marker_deg + 180) % 360, (200, 90, 90))):
        cx = int(deg / 360 * W)
        half = int(W * 0.012)
        img[int(H * 0.30) : int(H * 0.72), max(0, cx - half) : min(W, cx + half), :] = rgb
    return np.clip(img, 0, 255).astype(np.uint8)


def main() -> None:
    (OUT / "panoramas").mkdir(parents=True, exist_ok=True)
    for name, wall, floor, marker in _ROOMS:
        p = OUT / "panoramas" / f"{name}.jpg"
        Image.fromarray(make_pano(wall, floor, marker), "RGB").save(p, "JPEG", quality=JPEG_QUALITY)
        print(f"wrote {p.relative_to(ROOT)}  ({p.stat().st_size // 1024} KiB)")

    (OUT / "tour.json").write_text(json.dumps(TOUR_V0, indent=2) + "\n", encoding="utf-8")
    (OUT / "index.html").write_text(_INDEX_HTML, encoding="utf-8")

    print(f"bundle: {OUT.relative_to(ROOT)}")
    print("serve:  cd", f'"{OUT}"', "&& python3 -m http.server 8080")
    print("open:   http://localhost:8080   (and the same on a phone on your LAN)")


_INDEX_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>SODAR PSV tour spike</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@photo-sphere-viewer/core@5/index.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@photo-sphere-viewer/virtual-tour-plugin@5/index.min.css">
<style>html,body,#viewer{margin:0;width:100%;height:100%}#hud{position:fixed;left:8px;top:8px;z-index:9;
font:13px/1.4 system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.55);padding:6px 9px;border-radius:6px}</style>
</head>
<body>
<div id="hud">SODAR spike · drag to look · click a doorway marker to change room</div>
<div id="viewer"></div>
<script type="importmap">
{"imports":{
  "@photo-sphere-viewer/core":"https://cdn.jsdelivr.net/npm/@photo-sphere-viewer/core@5/index.module.js",
  "@photo-sphere-viewer/virtual-tour-plugin":"https://cdn.jsdelivr.net/npm/@photo-sphere-viewer/virtual-tour-plugin@5/index.module.js",
  "three":"https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js"
}}
</script>
<script type="module">
import { Viewer } from '@photo-sphere-viewer/core';
import { VirtualTourPlugin } from '@photo-sphere-viewer/virtual-tour-plugin';

// Consume the shared tour.v0 contract; map it to PSV's native nodes/links shape.
const t0 = performance.now();
const tour = await fetch('tour.json').then(r => r.json());
const nodes = tour.nodes.map((n) => ({
  id: n.id,
  panorama: n.panorama,
  name: n.room,
  sphereCorrection: { pan: `${n.north_offset_deg ?? 0}deg` },
  links: (n.hotspots ?? []).map((h) => ({
    nodeId: h.to,
    position: { yaw: `${h.yaw_deg}deg`, pitch: `${h.pitch_deg ?? 0}deg` },
  })),
}));

const viewer = new Viewer({
  container: 'viewer',
  defaultYaw: `${tour.nodes.find((n) => n.id === tour.start_node)?.initial_yaw_deg ?? 0}deg`,
  navbar: ['zoom', 'move', 'fullscreen'],
  plugins: [[VirtualTourPlugin, { positionMode: 'manual', renderMode: 'markers' }]],
});

viewer.getPlugin(VirtualTourPlugin).setNodes(nodes, tour.start_node);

viewer.addEventListener('ready', () => {
  const ms = Math.round(performance.now() - t0);
  document.getElementById('hud').textContent =
    `SODAR PSV spike · first panorama ready in ${ms} ms · drag to look · tap a doorway marker`;
}, { once: true });
</script>
</body>
</html>
"""

if __name__ == "__main__":
    main()
