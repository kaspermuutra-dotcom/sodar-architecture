"""Feature matching for the reconstruction: DISK + LightGlue (kornia) with a SIFT fallback, cached per pair.

Images are matched at a reduced scale; keypoints are returned in full-resolution pixel coordinates of the
source images. Cache: <cache>/<key>.npz with arrays pa, pb (N×2 float32) and score (N).
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

_disk = None
_lg = None
_device = None


def _models():
    global _disk, _lg, _device
    if _disk is None:
        import torch
        import kornia.feature as KF

        _device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
        _disk = KF.DISK.from_pretrained("depth").to(_device).eval()
        _lg = KF.LightGlue("disk").to(_device).eval()
    return _disk, _lg, _device


def _to_tensor(img: np.ndarray):
    import torch

    t = torch.from_numpy(np.ascontiguousarray(img)).float().permute(2, 0, 1)[None] / 255.0
    return t


def match_lightglue(a: np.ndarray, b: np.ndarray, max_kp: int = 4096, min_score: float = 0.2) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Match two RGB uint8 images (same scale). Returns (pa, pb, score) in pixel coordinates of a and b."""
    import torch

    disk, lg, dev = _models()
    with torch.inference_mode():
        out = []
        for im in (a, b):
            # DISK wants dimensions divisible by 16
            h, w = im.shape[:2]
            hp, wp = (h + 15) // 16 * 16, (w + 15) // 16 * 16
            pad = np.zeros((hp, wp, 3), np.uint8)
            pad[:h, :w] = im
            f = disk(_to_tensor(pad).to(dev), n=max_kp, pad_if_not_divisible=False)[0]
            out.append(f)
        fa, fb = out
        data = {
            "image0": {"keypoints": fa.keypoints[None], "descriptors": fa.descriptors[None], "image_size": torch.tensor([[a.shape[1], a.shape[0]]], device=dev).float()},
            "image1": {"keypoints": fb.keypoints[None], "descriptors": fb.descriptors[None], "image_size": torch.tensor([[b.shape[1], b.shape[0]]], device=dev).float()},
        }
        res = lg(data)
        m = res["matches"][0].cpu().numpy()
        sc = res["scores"][0].cpu().numpy() if "scores" in res else np.ones(len(m))
        ka = fa.keypoints.cpu().numpy()
        kb = fb.keypoints.cpu().numpy()
    keep = sc >= min_score
    return ka[m[keep, 0]].astype(np.float32), kb[m[keep, 1]].astype(np.float32), sc[keep].astype(np.float32)


def match_sift(a: np.ndarray, b: np.ndarray, nfeat: int = 8000, ratio: float = 0.75) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    sift = cv2.SIFT_create(nfeatures=nfeat, contrastThreshold=0.015)
    ga, gb = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY), cv2.cvtColor(b, cv2.COLOR_RGB2GRAY)
    ka, da = sift.detectAndCompute(ga, None)
    kb, db = sift.detectAndCompute(gb, None)
    if da is None or db is None:
        return np.zeros((0, 2), np.float32), np.zeros((0, 2), np.float32), np.zeros(0, np.float32)
    bf = cv2.BFMatcher(cv2.NORM_L2)
    good = [x for x, y in (m for m in bf.knnMatch(da, db, k=2) if len(m) == 2) if x.distance < ratio * y.distance]
    pa = np.array([ka[g.queryIdx].pt for g in good], np.float32).reshape(-1, 2)
    pb = np.array([kb[g.trainIdx].pt for g in good], np.float32).reshape(-1, 2)
    return pa, pb, np.ones(len(pa), np.float32)


def cached_match(key: str, cache: Path | None, a: np.ndarray, b: np.ndarray, scale: float = 1.0, method: str = "lightglue") -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Match a and b (already reduced by `scale`); coordinates are multiplied back by `scale`."""
    if cache is not None:
        f = cache / f"{key}.{method}.npz"
        if f.exists():
            z = np.load(f)
            return z["pa"], z["pb"], z["score"]
    pa, pb, sc = (match_lightglue if method == "lightglue" else match_sift)(a, b)
    pa, pb = pa * scale, pb * scale
    if cache is not None:
        cache.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(cache / f"{key}.{method}.npz", pa=pa, pb=pb, score=sc)
    return pa, pb, sc
