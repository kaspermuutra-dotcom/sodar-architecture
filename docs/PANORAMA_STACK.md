# Panorama stack — open-source candidates and what SODAR uses

Survey date: 2026-09-05. Scope: everything between a phone camera and a
walkthrough embedded in a listing — **capture**, **stitch**, **fill/clean**,
**view**. Verdicts are for the Phase-1 product (TD-001: connected
equirectangular panoramas, no mesh).

## Capture (guided, on the phone)

| Project | License | Platform | What it gives us | Verdict |
|---|---|---|---|---|
| **n30dyn4m1c/360-photo-app** ("Photo Sphere") — `third_party/360-photo-app` | MIT | Android / Kotlin | Sphere target plan, alignment gate with dwell, orientation tracker, sharpness selection, then a full pose-driven equirectangular stitcher (seam finder, multiband blender, pose refiner). | **Adopted as the reference.** Capture logic is ported to the browser in `site/lib/scanner/sphere.ts`; the stitcher's approach (project by sensor pose, refine, seam, blend) is what `src/sodar/providers/posed_stitch.py` re-implements in Python. |
| Google Street View app / Cardboard Camera | proprietary | iOS/Android | The UX everyone knows (dot-to-dot capture). | Reference for UX only. |
| `panorama` capture in AR.js / A-Frame | MIT | Web | AR scene tooling, no guided panorama capture. | No. |
| OpenCamera | GPL-3 | Android | Manual panorama mode. | GPL, not a library. No. |

There is no maintained open-source **web** panorama capture library. The browser
port in `site/lib/scanner/` (DeviceOrientation + getUserMedia + the Photo
Sphere target plan) is the capture layer.

## Stitch (frames → 2:1 equirectangular)

| Project | License | What it does | Verdict |
|---|---|---|---|
| **OpenCV `cv::Stitcher`** (`opencv-python-headless`) | Apache-2.0 | Feature-based (ORB/SIFT) + bundle adjustment + multiband blend; `PANORAMA` mode assumes pure rotation. | **In the harness** as `opencv-stitch`. Best pixels when it converges; fails (`ERR_NEED_MORE_IMGS` / homography) on blank walls and low-texture rooms — exactly the real-estate failure mode. Used as the *refinement* path. |
| **Pose-guided projection** (Photo Sphere's method, our Python port) | MIT (ours) | Uses the sensor yaw/pitch/roll recorded per frame to inverse-map every frame onto the equirect canvas; feathered blend; gain compensation; optional ORB yaw refinement. Never fails, degrades gracefully. | **Primary path** — `posed-stitch`. Every scanner frame carries a pose, so this always produces a panorama. |
| Hugin / PanoTools (`nona`, `enblend`, `autooptimiser`) | GPL-2 | The classic desktop stitcher; excellent optimiser and blender. | GPL and CLI-only; fine as an offline experiment (`brew install hugin`), not linkable into the product. |
| AutoStitch | research, non-commercial | Original SIFT stitcher. | No (license). |
| OpenPano (ppwwyyxx) | MIT | Compact C++ stitcher, cylindrical mode. | Possible C++ alternative to OpenCV; not needed while OpenCV works. |
| LightGlue / SuperPoint (via kornia) | Apache-2.0 | Learned feature matching — far more robust than ORB on textureless walls. | **Next step** for the refinement stage if OpenCV keeps failing on real rooms. |
| Insta360 / Ricoh SDKs | proprietary | Hardware-specific. | Out of scope (phone-only product). |

## Fill and clean (holes, seams, missing zenith/nadir)

| Project | License | Role | Verdict |
|---|---|---|---|
| **GPT Image 2** (OpenAI, also via Higgsfield `gpt_image_2`) | API | Image edit with prompt: fill the missing top/bottom bands of a ring capture, remove seam ghosting, keep geometry. | **Integrated** as `ai-fill`. Two backends: OpenAI Images edit (`OPENAI_API_KEY`) or the Higgsfield CLI (`higgsfield generate create gpt_image_2 --image …`). Verified once through the Higgsfield connector on the fixture panorama. |
| FLUX.2 Pro Outpaint (Higgsfield `flux_2_pro_outpaint`) | API | Per-side expansion. | Alternative for the top/bottom bands only. |
| **LaMa** — `third_party/lama` | Apache-2.0 (code) | Local, offline large-mask inpainting. | Offline fallback for hole filling when no API key is present (E4 track). |
| OpenCV `inpaint` (Telea / Navier-Stokes) | Apache-2.0 | Small-hole inpainting. | Used for seam-line cleanup only; useless for large bands. |

## View (equirectangular → walkthrough in a browser)

| Project | License | Verdict |
|---|---|---|
| **Photo Sphere Viewer** 5.x — `third_party/photo-sphere-viewer` | MIT | **Adopted (TD-003).** Virtual-tour plugin for room-to-room hotspots, gyroscope plugin, markers. `psv-viewer` provider builds the static bundle. |
| Pannellum | MIT | Lighter, fewer plugins, tour support. Runner-up. |
| Marzipano | Apache-2.0 | Cube-map tiles, great for very large panoramas; no tour plugin. |
| PlayCanvas (`viewer/`) | MIT | Lost the bake-off (E-VIEW): +33% bytes to first frame. Kept for the splat tier. |
| three.js + custom sphere | MIT | What PSV wraps. Only if we need custom shaders. |
| A-Frame | MIT | WebXR-first; heavier than needed. |
| krpano | commercial | The industry incumbent; not open source. |

## The pipeline this gives us

```
phone (/scan) ──frames + poses──▶ posed-stitch ──▶ opencv-stitch (refine, optional)
                                       │
                                       ▼
                                  ai-fill (GPT Image 2: zenith/nadir bands, seams)
                                       │
                                       ▼
                                  psv-viewer (tour.json → static walkthrough)
```

Run it locally on a frame export from the phone:

```bash
.venv/bin/python -m sodar stitch path/to/frames-export --out artifacts/tours/my-scan
```

`frames-export` is the zip the scanner produces ("Export frames"): one JPEG per
frame plus `frames.json` with yaw/pitch/roll/fov per frame.
