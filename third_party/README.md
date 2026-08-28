# third_party/

Upstream research repos vendored as **pinned git submodules**. SODAR does not
copy their source into its own tree or history — only a gitlink at a fixed
commit. Update path: `git -C third_party/<name> fetch && checkout <commit>` then
commit the new gitlink.

Clone SODAR with `--recurse-submodules`, or run
`git submodule update --init --depth 1` afterwards.

## What is here and why

These three feed **one experimental pipeline**: parallax-aware view interpolation
between two overlapping phone panoramas — the mechanism behind
[`docs/RECONSTRUCTION_INTEGRATION.md`](../docs/RECONSTRUCTION_INTEGRATION.md),
which is experiment **E4** / decision **TD-008** in
[`wat/SODAR_EXPERIMENTS.md`](../wat/SODAR_EXPERIMENTS.md).

| Submodule | Pinned commit | Code license | Role in SODAR |
|---|---|---|---|
| `RAFT` (princeton-vl) | `2888e15a` | BSD-3-Clause | Learned optical flow. Parallax-aware alignment between overlapping panoramas — corrects the doubled edges / bent frames from a phone rotating around the wrist, not the lens. |
| `Depth-Anything-V2` (DepthAnything) | `a561b849` | Apache-2.0 *(code)* | Monocular depth from one image → coarse room geometry, used to **warp** between the two capture points rather than hallucinate the gap. |
| `lama` (advimman) | `786f5936` | Apache-2.0 *(code)* | Resolution-robust large-mask inpainting (Fourier convolutions). Fills regions **disoccluded** by the warp, masked to the holes only. |

## Reference (not vendored)

- **`bkhanal-11/awesome-360-depth-estimation`** @ `7ac95d56` — a paper survey,
  GPL-3.0, **not code**. Deliberately *not* a submodule (keeps GPL out of SODAR).
  Consult it when a perspective-trained depth model underperforms on
  equirectangular input and a 360-native architecture is needed:
  <https://github.com/bkhanal-11/awesome-360-depth-estimation>

## License notes — read before any commercial use

- **RAFT** — BSD-3-Clause, clean.
- **Depth-Anything-V2** — the *repo code* is Apache-2.0. The **checkpoints** are
  not uniform: `Depth-Anything-V2-Small` is Apache-2.0; `Base` / `Large` /
  `Giant` and the metric-depth checkpoints are **CC-BY-NC-4.0 (non-commercial)**.
  SODAR must use the **Small** checkpoint for any commercial path, or accept the
  NC restriction for experiments only. Also review the upstream training-data
  note.
- **LaMa** — repo code Apache-2.0. The **`big-lama` weights** (maintainers'
  Google Drive) carry their own terms — verify before shipping; treat as
  research-only until confirmed.

## Runtime status: none of this runs in the current environment

| Blocker | Detail |
|---|---|
| No PyTorch | Not installed; Python here is 3.14, ahead of some wheels. |
| No GPU | All three are GPU models for any realistic resolution. |
| No weights | RAFT (Google Drive), Depth-Anything-V2 (Hugging Face), LaMa (Google Drive) — see `scripts/fetch_reconstruction_weights.sh`. |
| Dependency drift | RAFT targets torch 1.6 / CUDA 10.1 (2020); LaMa pins `pytorch-lightning==1.2.9` + Hydra (2021). Expect real porting work — call each model as a subprocess in its own environment, or port the inference path. |

The SODAR-side integration contract is designed in
[`docs/RECONSTRUCTION_INTEGRATION.md`](../docs/RECONSTRUCTION_INTEGRATION.md);
building and measuring the pipeline is GPU-box work, tracked as E4.
