"""Phase 3b: joint camera calibration with COLMAP over many sweeps (shared camera, half-resolution frames).

Usage: python scripts/recon/colmap_run.py <export> <workdir> --ids id8,id8,... [--scale 2] [--model OPENCV]
Writes <workdir>/images/<id8>_<k>.jpg (JPEG q95 from the original frames, DCT-scaled), runs feature extraction,
exhaustive matching and the mapper, then summarises cameras and per-sweep frame centres in <workdir>/summary.json.
"""
from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recon.capture import CaptureExport  # noqa: E402


def export_images(ex: CaptureExport, ids: list[str], images: Path, scale: int) -> None:
    images.mkdir(parents=True, exist_ok=True)
    for id8 in ids:
        sw = ex.by_id8(id8)
        for k in range(6):
            out = images / f"{id8}_{k}.jpg"
            if out.exists():
                continue
            im = Image.open(io.BytesIO(sw.frame_jpegs[k]))
            if scale > 1:
                im.draft("RGB", (im.width // scale, im.height // scale))
            im.convert("RGB").save(out, quality=95)


def run(cmd: list[str], log: Path) -> None:
    with log.open("a") as f:
        f.write("\n$ " + " ".join(cmd) + "\n")
        f.flush()
        subprocess.run(cmd, check=True, stdout=f, stderr=subprocess.STDOUT)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("export")
    ap.add_argument("work")
    ap.add_argument("--ids", required=True)
    ap.add_argument("--scale", type=int, default=2)
    ap.add_argument("--model", default="OPENCV")
    ap.add_argument("--threads", type=int, default=8)
    a = ap.parse_args()
    ex = CaptureExport(Path(a.export))
    work = Path(a.work)
    work.mkdir(parents=True, exist_ok=True)
    ids = a.ids.split(",")
    t0 = time.time()
    export_images(ex, ids, work / "images", a.scale)
    log = work / "colmap.log"
    db = work / "database.db"
    K = ex.by_id8(ids[0]).intrinsics
    f = K.fx / a.scale
    cx, cy = K.cx / a.scale, K.cy / a.scale
    params = f"{f},{f},{cx},{cy},0,0,0,0" if a.model == "OPENCV" else f"{f},{cx},{cy},0"
    if not db.exists():
        run(["colmap", "feature_extractor", "--database_path", str(db), "--image_path", str(work / "images"), "--ImageReader.single_camera", "1", "--ImageReader.camera_model", a.model, "--ImageReader.camera_params", params, "--FeatureExtraction.use_gpu", "0", "--FeatureExtraction.num_threads", str(a.threads), "--SiftExtraction.max_num_features", "8192", "--SiftExtraction.estimate_affine_shape", "1", "--SiftExtraction.domain_size_pooling", "1"], log)
    if not (work / "matched.ok").exists():
        run(["colmap", "exhaustive_matcher", "--database_path", str(db), "--FeatureMatching.use_gpu", "0", "--FeatureMatching.num_threads", str(a.threads), "--FeatureMatching.guided_matching", "1"], log)
        (work / "matched.ok").write_text("ok")
    sparse = work / "sparse"
    sparse.mkdir(exist_ok=True)
    run(["colmap", "mapper", "--database_path", str(db), "--image_path", str(work / "images"), "--output_path", str(sparse), "--Mapper.num_threads", str(a.threads), "--Mapper.ba_refine_focal_length", "1", "--Mapper.ba_refine_principal_point", "1", "--Mapper.ba_refine_extra_params", "1", "--Mapper.init_min_tri_angle", "4", "--Mapper.abs_pose_min_num_inliers", "15"], log)
    # summarise every model
    models = sorted(p for p in sparse.iterdir() if p.is_dir())
    summary = {"ids": ids, "scale": a.scale, "model": a.model, "seconds": round(time.time() - t0), "reconstructions": []}
    for m in models:
        txt = m / "txt"
        txt.mkdir(exist_ok=True)
        run(["colmap", "model_converter", "--input_path", str(m), "--output_path", str(txt), "--output_type", "TXT"], log)
        cams = [l.split() for l in (txt / "cameras.txt").read_text().splitlines() if l and not l.startswith("#")]
        imgs = [l.split() for i, l in enumerate(x for x in (txt / "images.txt").read_text().splitlines() if x and not x.startswith("#")) if i % 2 == 0]
        centres = {}
        for row in imgs:
            qw, qx, qy, qz = map(float, row[1:5])
            t = np.array(list(map(float, row[5:8])))
            from scipy.spatial.transform import Rotation as Rot

            R = Rot.from_quat([qx, qy, qz, qw]).as_matrix()
            c = -R.T @ t
            centres[row[9]] = c.tolist()
        summary["reconstructions"].append({"path": str(m), "cameras": cams, "registered": len(imgs), "centres": centres})
    (work / "summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps({k: v for k, v in summary.items() if k != "reconstructions"}), [(r["registered"], r["cameras"]) for r in summary["reconstructions"]])


if __name__ == "__main__":
    main()
