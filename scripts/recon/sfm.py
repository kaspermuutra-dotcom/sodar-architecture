"""Phase 3b: joint structure-from-motion over many sweeps with learned matches and manifest pose priors.

Pipeline (all inside COLMAP's database so bundle adjustment, verification and the mapper are the standard ones):
  1. export the six frames of every selected sweep at half resolution (2016×1512, JPEG q95);
  2. DISK keypoints (4096 per image at quarter resolution, coordinates scaled to the export) written as COLMAP
     keypoints; LightGlue matches for within-sweep pairs and for every frame pair of neighbouring sweeps whose
     nominal optical axes are within 110°; geometric verification by pycolmap.verify_matches;
  3. one shared OPENCV camera (prior from the container intrinsics or a calibration JSON);
  4. a Cartesian pose prior per image = the manifest sweep position (σ from --prior-std, default 0.35 m: the frame
     centres sit 10–30 cm off the sweep centre), then `colmap pose_prior_mapper` — priors fix scale and gauge,
     so the result is metric and in the manifest's world frame;
  5. summary.json: camera, registered images, per-sweep frame centres (world), radii, rotations, reprojection error.

Usage: python scripts/recon/sfm.py <export> <workdir> --ids id8,... [--neighbours-of id8,...] [--prior-std 0.35]
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation as Rot

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recon.capture import MX, CaptureExport, Sweep  # noqa: E402
from recon.colmap_run import export_images  # noqa: E402

SKY_TO_DEPTH = np.diag([1.0, 1.0, -1.0])


def frame_axis_world(sw: Sweep, k: int) -> np.ndarray:
    """Nominal optical axis of frame k in the world frame (via F → skybox base → physical base → sweep → world)."""
    a_F = sw.frames_meta[k].R.T @ np.array([0.0, 0.0, -1.0])
    a_sky = MX.T @ a_F
    a_dep = SKY_TO_DEPTH @ a_sky
    from recon.capture import SWEEP_TO_BASE

    a_sweep = SWEEP_TO_BASE.T @ a_dep
    return sw.man.R_world @ a_sweep


def disk_features(images: list[Path], max_kp: int = 4096, scale_down: int = 2):
    import torch
    import kornia.feature as KF
    from PIL import Image

    dev = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    disk = KF.DISK.from_pretrained("depth").to(dev).eval()
    feats = {}
    with torch.inference_mode():
        for p in images:
            im = Image.open(p).convert("RGB")
            w, h = im.size
            im = im.resize((w // scale_down, h // scale_down))
            a = np.asarray(im)
            hp, wp = (a.shape[0] + 15) // 16 * 16, (a.shape[1] + 15) // 16 * 16
            pad = np.zeros((hp, wp, 3), np.uint8)
            pad[: a.shape[0], : a.shape[1]] = a
            t = torch.from_numpy(pad).float().permute(2, 0, 1)[None].to(dev) / 255.0
            f = disk(t, n=max_kp, pad_if_not_divisible=False)[0]
            feats[p.name] = (f.keypoints.cpu().numpy() * scale_down, f.descriptors.cpu(), (w, h))
    return feats, dev


def lightglue_pairs(feats: dict, pairs: list[tuple[str, str]], dev, min_score: float = 0.2) -> dict:
    import torch
    import kornia.feature as KF

    lg = KF.LightGlue("disk").to(dev).eval()
    out = {}
    with torch.inference_mode():
        for a, b in pairs:
            ka, da, sa = feats[a]
            kb, db, sb = feats[b]
            data = {
                "image0": {"keypoints": torch.from_numpy(ka).float()[None].to(dev), "descriptors": da[None].to(dev), "image_size": torch.tensor([[sa[0], sa[1]]], device=dev).float()},
                "image1": {"keypoints": torch.from_numpy(kb).float()[None].to(dev), "descriptors": db[None].to(dev), "image_size": torch.tensor([[sb[0], sb[1]]], device=dev).float()},
            }
            res = lg(data)
            m = res["matches"][0].cpu().numpy()
            sc = res["scores"][0].cpu().numpy() if "scores" in res else np.ones(len(m))
            m = m[sc >= min_score]
            if len(m) >= 15:
                out[(a, b)] = m.astype(np.uint32)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("export")
    ap.add_argument("work")
    ap.add_argument("--ids", required=True)
    ap.add_argument("--prior-std", type=float, default=0.35)
    ap.add_argument("--camera-json")
    ap.add_argument("--neighbour-m", type=float, default=4.6)
    ap.add_argument("--axis-deg", type=float, default=110.0)
    ap.add_argument("--no-priors", action="store_true")
    ap.add_argument("--stage", default="all", choices=["all", "match", "db"])
    a = ap.parse_args()
    ex = CaptureExport(Path(a.export))
    work = Path(a.work)
    work.mkdir(parents=True, exist_ok=True)
    ids = a.ids.split(",")
    t0 = time.time()
    export_images(ex, ids, work / "images", 2)
    sweeps = {i: ex.by_id8(i) for i in ids}
    names = [f"{i}_{k}.jpg" for i in ids for k in range(6)]
    # --- pairs
    pairs = []
    for i in ids:
        for k in range(6):
            for l in range(k + 1, 6):
                pairs.append((f"{i}_{k}.jpg", f"{i}_{l}.jpg"))
    axes = {(i, k): frame_axis_world(sweeps[i], k) for i in ids for k in range(6)}
    cross = 0
    for x, i in enumerate(ids):
        for j in ids[x + 1 :]:
            if math.dist(sweeps[i].man.p, sweeps[j].man.p) > a.neighbour_m:
                continue
            for k in range(6):
                for l in range(6):
                    if math.degrees(math.acos(float(np.clip(axes[(i, k)] @ axes[(j, l)], -1, 1)))) <= a.axis_deg:
                        pairs.append((f"{i}_{k}.jpg", f"{j}_{l}.jpg"))
                        cross += 1
    print(f"{len(ids)} sweeps, {len(names)} images, {len(pairs)} pairs ({cross} cross-sweep)", flush=True)
    # --- features + matches (torch process) — kept out of the pycolmap process: two OpenMP runtimes crash together
    mf = work / "matches.npz"
    if a.stage in ("match", "all"):
        feats, dev = disk_features([work / "images" / n for n in names])
        print(f"features done {time.time() - t0:.0f}s", flush=True)
        matches = lightglue_pairs(feats, pairs, dev)
        print(f"matching done {time.time() - t0:.0f}s: {len(matches)} pairs with ≥15 matches, median {np.median([len(m) for m in matches.values()]) if matches else 0}", flush=True)
        np.savez_compressed(mf, names=np.array(names), **{f"kp__{n}": feats[n][0].astype(np.float32) for n in names}, **{f"m__{na}__{nb}": m for (na, nb), m in matches.items()})
        if a.stage == "match":
            return
        # re-exec the db stage in a fresh process without torch loaded
        subprocess.run([sys.executable, __file__] + [x for x in sys.argv[1:] if x not in ("--stage", "match", "all")] + ["--stage", "db"], check=True)
        return
    import pycolmap  # only in the db stage: never in the same process as torch

    z = np.load(mf)
    feats = {n: (z[f"kp__{n}"], None, None) for n in names}
    matches = {}
    for key in z.files:
        if key.startswith("m__"):
            _, na, nb = key.split("__")
            matches[(na, nb)] = z[key]
    # --- database
    dbp = work / "database.db"
    if dbp.exists():
        dbp.unlink()
    db = pycolmap.Database.open(str(dbp))
    K = sweeps[ids[0]].intrinsics
    if a.camera_json:
        cj = json.loads(Path(a.camera_json).read_text())
        params = cj["params_half"]
    else:
        params = [K.fx / 2, K.fy / 2, K.cx / 2, K.cy / 2, 0, 0, 0, 0]
    cam = pycolmap.Camera(model="OPENCV", width=K.width // 2, height=K.height // 2, params=params, camera_id=1)
    db.write_camera(cam, use_camera_id=True)
    image_ids = {}
    for n in names:
        im = pycolmap.Image(name=n, camera_id=1)
        iid = db.write_image(im)
        image_ids[n] = iid
        kp = feats[n][0].astype(np.float32)
        db.write_keypoints(iid, kp)
        if not a.no_priors:
            sid = n.split("_")[0]
            pp = pycolmap.PosePrior()
            pp.position = np.array(sweeps[sid].man.p, float)
            pp.position_covariance = np.eye(3) * a.prior_std ** 2
            pp.coordinate_system = pycolmap.PosePriorCoordinateSystem.CARTESIAN
            img = db.read_image(iid)
            pp.corr_data_id = img.data_id
            db.write_pose_prior(pp)
    for (na, nb), m in matches.items():
        db.write_matches(image_ids[na], image_ids[nb], m)
    db.close()
    pairs_txt = work / "pairs.txt"
    pairs_txt.write_text("\n".join(f"{na} {nb}" for (na, nb) in matches) + "\n")
    opts = pycolmap.TwoViewGeometryOptions()
    opts.min_num_inliers = 15
    pycolmap.verify_matches(str(dbp), str(pairs_txt), opts)
    db = pycolmap.Database.open(str(dbp))
    nverified = db.num_verified_image_pairs()
    db.close()
    print(f"verified pairs {nverified} of {len(matches)} ({time.time() - t0:.0f}s)", flush=True)
    # --- mapper
    sparse = work / "sparse"
    sparse.mkdir(exist_ok=True)
    log = work / "mapper.log"
    cmd = ["colmap", "pose_prior_mapper" if not a.no_priors else "mapper", "--database_path", str(dbp), "--image_path", str(work / "images"), "--output_path", str(sparse), "--Mapper.ba_refine_focal_length", "1", "--Mapper.ba_refine_principal_point", "1", "--Mapper.ba_refine_extra_params", "1", "--Mapper.init_min_tri_angle", "3", "--Mapper.abs_pose_min_num_inliers", "12", "--Mapper.filter_max_reproj_error", "6"]
    if not a.no_priors:
        cmd += ["--prior_position_std_x", str(a.prior_std), "--prior_position_std_y", str(a.prior_std), "--prior_position_std_z", str(a.prior_std)]
    with log.open("w") as f:
        subprocess.run(cmd, check=True, stdout=f, stderr=subprocess.STDOUT)
    # --- summary
    summary = {"ids": ids, "images": len(names), "pairs": len(pairs), "matched": len(matches), "verified": nverified, "seconds": round(time.time() - t0), "models": []}
    for m in sorted(p for p in sparse.iterdir() if p.is_dir()):
        rec = pycolmap.Reconstruction(str(m))
        camr = rec.cameras[1]
        per_sweep = {}
        for iid, img in rec.images.items():
            if not img.has_pose:
                continue
            sid, k = img.name[:-4].split("_")
            c = np.asarray(img.projection_center())
            R = np.asarray(img.cam_from_world.rotation.matrix())
            per_sweep.setdefault(sid, {})[int(k)] = {"centre": c.tolist(), "R_cam_from_world": R.tolist()}
        for sid, fr in per_sweep.items():
            cs = np.array([v["centre"] for v in fr.values()])
            mean = cs.mean(0)
            fr["_mean_centre"] = mean.tolist()
            fr["_manifest_p"] = sweeps[sid].man.p
            fr["_mean_vs_manifest_m"] = round(float(np.linalg.norm(mean - np.array(sweeps[sid].man.p))), 3)
            fr["_radius_m"] = [round(float(np.linalg.norm(c - mean)), 3) for c in cs]
        summary["models"].append({"path": str(m), "registered": rec.num_reg_images(), "points3D": rec.num_points3D(), "mean_reproj_px": round(float(rec.compute_mean_reprojection_error()), 3), "mean_track": round(float(rec.compute_mean_track_length()), 2), "camera": {"model": str(camr.model), "params_half": np.asarray(camr.params).tolist(), "params_full": (np.asarray(camr.params) * np.array([2, 2, 2, 2, 1, 1, 1, 1])).tolist()}, "sweeps": per_sweep})
    (work / "summary.json").write_text(json.dumps(summary, indent=1))
    for m in summary["models"]:
        print(f"model {m['path']}: registered {m['registered']}/{len(names)}, points {m['points3D']}, reproj {m['mean_reproj_px']} px, camera(full) {np.round(m['camera']['params_full'], 4).tolist()}")
        for sid, fr in m["sweeps"].items():
            print(f"   {sid}: {len([k for k in fr if not str(k).startswith('_')])} frames, radius {fr['_radius_m']}, mean-vs-manifest {fr['_mean_vs_manifest_m']} m")


if __name__ == "__main__":
    main()
