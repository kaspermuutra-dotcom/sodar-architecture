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

## Panorama → 3D (scouted on GitHub, 2026-09-05)

What turns one equirectangular panorama into something with depth or a walkable
scene. None of these are in the Phase-1 path (TD-001 is flat panoramas), but
they are the candidates for the premium tier (TD-007) and for parallax-correct
room-to-room transitions.

| Project | License | What it does | Fit for SODAR |
|---|---|---|---|
| **[juniorxsound/THREE.SixDOF](https://github.com/juniorxsound/THREE.SixDOF)** | MIT | three.js plugin: equirect colour + depth map → 6-DoF sphere mesh you can lean into. TypeScript. | **Cheapest depth upgrade**: pair each panorama with a depth map and render in three.js next to Photo Sphere Viewer. |
| [mellinger/three-depthmaps](https://github.com/mellinger/three-depthmaps) | MIT | Same idea, simpler. | Fallback reference. |
| **[Insta360-Research-Team/DA360](https://github.com/Insta360-Research-Team/DA360)** | code Apache-2.0 (check weights) | Depth Anything adapted to 360° with circular padding — zero-shot panoramic depth, no seam at the wrap. | **Depth source** for SixDOF and for splats; replaces perspective Depth-Anything-V2 (`third_party/`) on equirect input. |
| [Insta360-Research-Team/DAP](https://github.com/Insta360-Research-Team/DAP) | code Apache-2.0 (check weights) | "Depth Any Panoramas" foundation model (DINOv3 backbone). | Higher quality than DA360; heavier. |
| **[cedarconnor/SPAG4d](https://github.com/cedarconnor/SPAG4d)** | MIT | One equirect → 3D Gaussian splat file via DA360 / DAP / PaGeR depth or Apple SHARP. | Direct route to the `.spz` splat tier the PlayCanvas viewer in `viewer/` was kept for. |
| [LeoDarcy/360GS](https://github.com/LeoDarcy/360GS) | research | Layout-guided panoramic Gaussian splatting for indoor roaming. | Indoor-specific; good reference for floor/ceiling priors. |
| [chengzhag/PanSplat](https://github.com/chengzhag/PanSplat) · [thucz/splatter360](https://github.com/thucz/splatter360) | research | Feed-forward splats from *two* wide-baseline panoramas. | Exactly the two-capture-point case in E4/TD-008; heavy models. |
| [zcq15/gsplat360](https://github.com/zcq15/gsplat360) | Apache-2.0 | Panoramic-camera rasteriser for 3DGS/2DGS. | Renderer piece if we train splats ourselves. |
| [inuex35/360-gaussian-splatting](https://github.com/inuex35/360-gaussian-splatting) | MIT | OpenSfM + Gaussian splatting from 360-camera imagery. | Multi-panorama capture → full-room splat; needs many captures. |
| **[sunset1995/HorizonNet](https://github.com/sunset1995/HorizonNet)** · [HoHoNet](https://github.com/sunset1995/HoHoNet) · [LED2-Net](https://github.com/fuenwang/LED2-Net) | MIT | Room layout (walls/floor/ceiling) from one panorama → a clean box/polygon room mesh. | The "floor plan + measurements" feature and a geometry prior for transitions. |
| [pchen66/panolens.js](https://github.com/pchen66/panolens.js) | MIT | three.js panorama viewer (unmaintained). | No — Photo Sphere Viewer already chosen. |
| [three.js equirectangular example](https://github.com/mrdoob/three.js/blob/master/examples/webgl_panorama_equirectangular.html) | MIT | Baseline sphere-texture viewer. | Reference only. |

Recommended order: DA360 depth → THREE.SixDOF in the viewer (weeks, no training),
then SPAG-4D for the splat tier, then HorizonNet for floor plans.

## In the website (2026-09-05)

`/scan` now stitches **on the device** with WebGL2 (`site/lib/scanner/stitch.ts`,
same projection as `posed-stitch`), stores the panorama in IndexedDB, and opens
it in Photo Sphere Viewer straight away; `/scan?demo=1` runs the bundled
12-frame room without a camera. `/api/ai-fill` forwards the padded panorama +
mask to GPT Image 2 (OpenAI Images edit) when `OPENAI_API_KEY` is set; the
client enables it with `NEXT_PUBLIC_AI_FILL=1`.

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
