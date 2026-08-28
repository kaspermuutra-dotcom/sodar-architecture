# Harness implementation notes

Concrete decisions made while building Steps 0–6. Not architecture — just the
"why" behind choices a reader of the code might question.

## Language: Python, standard library only

The existing WAT convention (`wat/tools/`) is Python. The harness needs a CLI,
JSON handling, typed data holders, and tests — all covered by the stdlib
(`argparse`, `json`, `dataclasses`, `hashlib`, `unittest`). No runtime
dependencies; `python -m unittest` runs on a bare interpreter. `ruff` + `mypy`
are configured in `pyproject.toml` as an optional `dev` extra but are not
required and were not installable in the build environment (offline).

## Package layout

`src/sodar/` is a real package (not a bare `src/`) so imports work under an
editable install and from `python -m sodar`. The task's `providers/base.*`,
`providers/dummy.*`, and `eval/` all exist, nested under the package.

## `run_id` is deliberately non-deterministic

Each run must occupy its own directory and never overwrite a prior one, so
`run_id` is `<utc-compact>-<nanosecond-suffix>` and the runner refuses to reuse
an existing directory. Determinism lives in `metrics`, `estimated_cost`, and
artifact hashes — none of which depend on `run_id` or the wall clock.
`started_at` / `completed_at` / `duration_ms` are real measurements and are
expected to vary between runs; they are not in `metrics`.

## `output_manifest.json` is part of the provider contract

`execute()` must write an `output_manifest.json` listing its artifacts with
sizes and SHA-256s. The evaluator reads this file generically to compute
`output_manifest_valid` — it never asks which provider produced it. This is how
the evaluator stays provider-agnostic while still "inspecting artifacts".

## Exit code for provider input-validation failure: 3, not 4

`provider.validate()` failing means the fixture's input is not usable — the same
category as a malformed fixture manifest — so both map to exit code 3. Exit code
4 is reserved for a provider that actually ran and then failed.

## `eval run` on an invalid fixture does not persist

If `provider.validate()` rejects the input, there is no execution to evaluate.
The CLI exits 3 with the validation errors and writes nothing under
`artifacts/evals/`. (A future "evaluate the rejection itself" mode can be added
without breaking this.)

## `provider run` output location

Writes to `artifacts/provider-runs/<run_id>/output/` (gitignored). Kept for
inspection; never overwritten. Separate from `artifacts/evals/` because it is
not an evaluation and carries no `eval-result.json`.

## Schema validation

`src/sodar/schema.py` is a ~90-line validator covering only the JSON Schema
keywords these schemas use. The schema files are standard Draft 2020-12, so
swapping in the `jsonschema` package later needs no schema changes.

---

## opencv-stitch provider

### Upstream verification (inspected 2026-08-28)

| Item | Finding |
|---|---|
| Repository | OpenCV: <https://github.com/opencv/opencv> · Python packaging: <https://github.com/opencv/opencv-python> |
| Documentation | High-level stitching API: <https://docs.opencv.org/4.x/d8/d19/tutorial_stitcher.html> · `cv::Stitcher` reference: <https://docs.opencv.org/4.13.0/d2/d8d/classcv_1_1Stitcher.html> |
| License | OpenCV library: **Apache-2.0** (since 4.5.0, Nov 2020; BSD-3-Clause before). `opencv-python` packaging scripts: MIT. Non-headless wheels also bundle FFmpeg (LGPLv2.1) and Qt5 (LGPLv3) — **avoided** by depending on the headless wheel. |
| Redistribution | SODAR declares `opencv-python-headless` as an *optional* PyPI dependency; it does not vendor or redistribute OpenCV source or binaries, so there are no bundling obligations. No upstream source was copied into this repo. |
| Python API | `cv2.Stitcher_create(cv2.Stitcher_PANORAMA)` → `status, pano = stitcher.stitch(images)`, `images` = list of BGR `uint8` ndarrays. Status ints (stable across OpenCV 4.x): `0` OK, `1` ERR_NEED_MORE_IMGS, `2` ERR_HOMOGRAPHY_EST_FAIL, `3` ERR_CAMERA_PARAMS_ADJUST_FAIL. |
| Package boundary | `opencv-python-headless` — OpenCV **main** modules, no GUI libraries. The `stitching` module is a *main* module (not opencv_contrib); modern stitching uses ORB by default, so no `OPENCV_ENABLE_NONFREE` / contrib build is required. Latest at time of writing: 4.13.0.92 (2026-02-05). |
| NumPy | `opencv-python-headless` declares `numpy` as a required install dependency (version floor varies by Python), so NumPy is pulled in transitively and is **not** listed separately in the `[opencv]` extra. |
| Operational limits | Stitcher output — pixels *and* output dimensions — is **not byte-reproducible** across OpenCV versions, platforms, or runs (iterative ORB + RANSAC homography + bundle adjustment + multi-band blend). Needs ~30 %+ overlap and real texture; textureless walls, repetitive patterns, and strong parallax produce ERR_NEED_MORE_IMGS / ERR_HOMOGRAPHY_EST_FAIL. |

### Harness determinism vs provider determinism

The evaluator's guarantees are **structural**: run isolation (each run in its own
never-reused directory) and the integrity metrics (`artifact_count`,
`expected_artifacts_present`, `output_manifest_valid`). Those hold for any
provider.

Whether *artifact bytes* are reproducible is a **per-provider** property,
declared in `provider_metadata`:

- `dummy` → `execution_mode: offline-deterministic` (implicit — it predates the
  key; a follow-up task owning `dummy.py` should add it). Byte-identical output
  for identical input.
- `opencv-stitch` → `execution_mode: local-compute`, `deterministic: false`.
  `panorama.png` and even `stitch_metadata.json` (which records OpenCV's version
  and the output dimensions) vary between environments. `metrics.total_output_bytes`
  will therefore vary for real runs of this provider — that is expected and is
  not a harness regression.

### Adapter design

- `cv2` and `numpy` are imported **lazily** inside four seam functions
  (`_load_cv2`, `_decode_image`, `_stitch`, `_encode_png`). Importing the module,
  the registry, or running any other provider never imports them. Tests
  substitute fakes for these seams, so the whole test suite runs with no OpenCV
  installed (one real-`cv2` test is marked and skips when absent).
- Missing optional dependency → normalized `ValidationResult.failed(...)` (and a
  normalized failure `ProviderResult` from `execute`, defensively) — never an
  `ImportError`.
- Path containment lives in `base.contained_path()` (shared, reusable): rejects
  absolute paths, `..`, and symlink targets that resolve outside the fixture
  root, without opening the target.
- The fixture's declared `inputs` array **is** the ordered image set. Supported
  formats: `.png`, `.jpg`, `.jpeg`.
- `estimated_cost` is a synthetic local-compute figure (per-image + per-MB), not
  a price.

### `panorama-stitch-001` fixture

Three overlapping 300×200 synthetic views sliced from one seeded scene (~50 %
overlap). `expect.provider_validation: "pass"` describes the *inputs* being
well-formed for `opencv-stitch`; validation additionally requires the `[opencv]`
extra to be installed. The images are ~2 KB each and reproducible via
`make_inputs.py` (stdlib + numpy). Because they are synthetic, a given OpenCV
build may still return a non-OK status — so the marked real-`cv2` test asserts
"normalized result, no crash, schema-valid", not "success".
