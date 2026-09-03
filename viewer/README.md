# `viewer/` — PlayCanvas panorama tour viewer (TD-003 candidate spike)

A self-contained static browser viewer for a **connected equirectangular-panorama
tour** — the Phase-1 reconstruction output (TD-001). Each panorama is a texture on
the inside of a sphere; the camera sits at the centre. Pointer + touch look,
pinch / wheel zoom, optional `DeviceOrientation` gyro, DOM hotspots that fade
between rooms.

Built on the **PlayCanvas engine v2.21.4** (MIT), pinned in `vendor/`.

## Status: NOT adopted — bake-off decided for Photo Sphere Viewer (2026-09-03)

This directory was the measured challenger for **TD-003**. The bake-off
(experiment **E-VIEW**) ran: PlayCanvas's engine is **+33% transferred bytes to
first interactive frame** vs the PSV library stack, against a registered **+10%**
gate (R7 is the named risk), and the viewer is **385 LOC vs ~48** for the PSV
shell. PlayCanvas fails the byte gate; under the pre-registered rule the pending
phone perf/gyro numbers cannot overturn that.

**Outcome:** TD-003 stands — **Photo Sphere Viewer** is the `ViewerBuilder`
([`src/sodar/providers/psv_viewer.py`](../src/sodar/providers/psv_viewer.py),
[`scripts/psv_tour_spike.py`](../scripts/psv_tour_spike.py)). **This directory is
retained as the E3 splat-viewer reference** — per TD-007, PlayCanvas / SuperSplat
is the `.spz` splat playback path *if* the Gaussian-splat premium tier greenlights.

## Run it

```bash
viewer/serve.sh          # fetches the engine + demo panoramas if missing, serves :8777
```

Then open `http://localhost:8777/` — and the **same URL on a phone on your LAN**
(that is the only test that matters for risk R7). `file://` will not work: ES
modules and textures need `http://`.

Manual equivalent:

```bash
viewer/vendor/fetch-engine.sh
python3 viewer/panoramas/make_demo_panoramas.py
cd viewer && python3 -m http.server 8777
```

## Files

| Path | What |
|---|---|
| `index.html` | the whole viewer — one file, one `<script type="module">` |
| `vendor/playcanvas-2.21.4.min.mjs` | pinned engine (gitignored; `fetch-engine.sh` is the version pin) |
| `tour.json` | example scene graph — schema `tour.v0` |
| `panoramas/*.jpg` | demo equirectangular panoramas (gitignored; `make_demo_panoramas.py` regenerates) |
| `panoramas/make_demo_panoramas.py` | synthetic 2:1 panoramas — grid + coloured heading markers |
| `serve.sh`, `vendor/fetch-engine.sh` | run / fetch helpers |

## `tour.v0` manifest contract

**Canonical schema: [`schemas/tour.v0.json`](../schemas/tour.v0.json)** — the
shared `ViewerBuilder.build()` output. Every viewer template (this one;
`scripts/psv_tour_spike.py`, which adapts it to PSV in-browser) consumes this one
file. `index.html` reads it via `fetch('tour.json')` (override with `?tour=<url>`).

```jsonc
{
  "schema_version": "tour.v0",
  "scan_id": "demo-scan-0001",
  "title": "Demo property — panorama tour",
  "start_node": "living-room",
  "nodes": [
    {
      "id": "living-room",              // stable node id (→ maps to rooms.id)
      "room": "Living room",            // display label
      "panorama": "panoramas/living-room.jpg",  // relative to the bundle root
      "north_offset_deg": 0,            // stitcher yaw 0 vs building north (reserved)
      "initial_yaw_deg": 0,             // where the camera faces on entry
      "hotspots": [
        { "to": "kitchen", "label": "Kitchen", "yaw_deg": 90, "pitch_deg": -6 }
      ]
    }
  ]
}
```

`yaw_deg` is measured clockwise from the panorama's forward direction; `0` faces
the centre column of the equirectangular image, `+90` is to the right.

Debug query params: `?pano=<url>` (single panorama, no manifest), `?node=<id>`
(start elsewhere), `?tour=<url>`.

## How it maps to the architecture

Per [`wat/SODAR_AGENT_ARCHITECTURE.md`](../wat/SODAR_AGENT_ARCHITECTURE.md):

```
ViewerBuilder.build(panoramas, room_graph) -> StaticBundle
```

`build_tour.py` (Phase 1, step 4) would:

1. take the stitched equirectangular panoramas + the room adjacency graph,
2. derive hotspot `yaw_deg` from room headings / the graph,
3. write `tour.json` + copy the panoramas + copy `index.html` + `vendor/` into a
   bundle directory,
4. hand the directory to `deploy_viewer.py`.

The bundle is fully static — no build step, no server code. `index.html` +
`vendor/` are the template; only `tour.json` and the images are per-scan.

## What this spike proves / does not prove

**Shown working (desktop + emulated mobile):** equirectangular render on an
inverted sphere, drag / touch look with inertia, pinch + wheel zoom, DOM-hotspot
projection tracking the panorama, fade transition on room change, neighbour
prefetch, graceful failure + fallback manifest.

**Not yet tested:** real phone (LAN) — smoothness, thermals, battery; the gyro
path on real iOS/Android sensors (the math is provisional); tiled / progressive
loading for 6–8 K panoramas; > 2 rooms; accessibility.

## Bake-off — results (E-VIEW)

Both spikes, same two **6K** panoramas (`viewer/panoramas/make_demo_panoramas.py`
and `scripts/psv_tour_spike.py` emit byte-identical `living-room.jpg`, 6144×3072
JPEG q82 ≈ 535 KB). Decision rule was registered in
[`wat/SODAR_EXPERIMENTS.md`](../wat/SODAR_EXPERIMENTS.md) **before** these numbers.

| Metric | Photo Sphere Viewer | PlayCanvas (`viewer/`) | Winner |
|---|---|---|---|
| **Viewer JS/CSS payload** (gzip) | three.js 258 KB + PSV core 45 + virtual-tour 11 + CSS 4 = **318 KB** | engine **595 KB** (one file) | **PSV** (−47%) |
| **Bytes to first interactive frame** (shell + JS/CSS + `tour.json` + 1 pano) | ≈ **854 KB** | ≈ **1,134 KB** | **PSV** — PlayCanvas +33% vs a +10% gate → **Gate 1 FAIL** |
| **Delivery** | 5 requests to jsDelivr (must self-host to be self-contained; ~270 KB brotli when vendored) | 1 repo-pinned file, no third-party origin | PlayCanvas (CSP posture); PSV still lighter after vendoring |
| **Viewer LOC to maintain** | **~48** (shell) on maintained `VirtualTourPlugin` | **385** (bespoke sphere render + hotspot projection + gyro math) | **PSV** (~8×) |
| Sustained drag FPS | *pending — phone* | *pending — phone* | — (workload is GPU-trivial; large gap unlikely) |
| Frame drops on room change | *pending — phone* | *pending — phone* | — |
| Throttled TTI (Fast 3G / 4× CPU) | *pending — phone* | *pending — phone* | — (PlayCanvas ~2× parse/compile CPU) |
| Gyro feel on real sensors | *pending* — maintained `GyroscopePlugin` | *pending* — README: "math is provisional" | — (PSV favoured) |

**Verdict:** PlayCanvas fails Gate 1 (bytes). Per the registered rule the pending
phone metrics cannot overturn it → **TD-003 stands, Photo Sphere Viewer wins.**
`viewer/` → E3 splat-viewer reference.

**Viewer-agnostic finding:** at 6K the 535 KB panorama alone is ~11 s at Fast-3G
downlink — both viewers blow the "< ~2 s" target. **Tiled / progressive panorama
loading is required regardless of viewer.**

The phone run is still worth doing to confirm PSV clears R7 / AC-4 on a real
device — see [`wat/SODAR_EXPERIMENTS.md`](../wat/SODAR_EXPERIMENTS.md) E-VIEW
"Status" for the runbook.
