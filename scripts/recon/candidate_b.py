"""Candidate B: preview-constrained high-resolution reconstruction with bounded local warps (no depth).

Each frame is projected single-centre with its *solved* rotation; a dense optical flow from that projection to the
(upsampled) preview cubemap, computed on a 1024×512 equirect, smoothed and clamped to ±MAX_DEG, moves the frame's
texture onto Matterport's geometry. Sampling applies the flow as a direction displacement, so any output
resolution works. Seams and compositing reuse the Candidate C machinery with a model that has no translation
and no occlusion test.
"""
from __future__ import annotations

import cv2
import numpy as np

from recon.capture import MX, Sweep
from recon.geom import bilinear, dirs_to_equirect, equirect_dirs, sample_cube
from recon.render import SweepModel, sample_frame

FW, FH = 1024, 512
MAX_DEG = 3.0


class ModelB(SweepModel):
    def __init__(self, sw: Sweep, calib: dict | None, imgs: list[np.ndarray], scale: int, preview: dict[int, np.ndarray]):
        super().__init__(sw, calib)
        self.t = np.zeros((6, 3))
        self.flows = self._flows(imgs, scale, preview)

    def frame_zbuffers(self, cell: int = 4):
        return None

    def _project_plain(self, k: int, P_F: np.ndarray):
        c = P_F @ self.R[k].T
        z = -c[..., 2]
        ok = z > 0.05
        zz = np.where(ok, z, 1.0)
        col = self.K.cx - c[..., 0] / zz * self.K.fx
        row = self.K.cy - c[..., 1] / zz * self.K.fy
        ok &= (col >= 1) & (col < self.K.width - 2) & (row >= 1) & (row < self.K.height - 2)
        return col, row, ok

    def _flows(self, imgs, scale, preview) -> list[np.ndarray]:
        d_sky = equirect_dirs(FW, FH)
        P_F = d_sky.reshape(-1, 3) @ MX.T
        ref = np.clip(sample_cube(preview, d_sky), 0, 255).astype(np.uint8)
        ref_g = cv2.cvtColor(ref, cv2.COLOR_RGB2GRAY)
        dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        dis.setFinestScale(1)
        flows = []
        max_px = MAX_DEG * FW / 360.0
        for k in range(6):
            col, row, ok = self._project_plain(k, P_F)
            col, row, ok = col.reshape(FH, FW), row.reshape(FH, FW), ok.reshape(FH, FW)
            fr = np.clip(sample_frame(imgs[k], col, row, self.K, scale), 0, 255).astype(np.uint8)
            fr[~ok] = 0
            fr_g = cv2.GaussianBlur(cv2.cvtColor(fr, cv2.COLOR_RGB2GRAY), (0, 0), 1.5)  # match the preview's softness
            flow = dis.calc(fr_g, ref_g, None)  # frame → preview displacement (px)
            # reliability: local gradient energy of the frame and validity
            g = cv2.magnitude(cv2.Sobel(fr_g.astype(np.float32), cv2.CV_32F, 1, 0), cv2.Sobel(fr_g.astype(np.float32), cv2.CV_32F, 0, 1))
            w = (cv2.GaussianBlur(g, (0, 0), 6) > 4.0).astype(np.float32) * ok.astype(np.float32)
            wb = cv2.GaussianBlur(w, (0, 0), 8)
            f_s = cv2.GaussianBlur(flow * w[..., None], (0, 0), 8) / np.maximum(wb, 1e-6)[..., None]
            f_s = np.where(wb[..., None] > 0.3, f_s, 0.0)
            mag = np.linalg.norm(f_s, axis=-1, keepdims=True)
            f_s = f_s * np.minimum(1.0, max_px / np.maximum(mag, 1e-6))
            flows.append(f_s.astype(np.float32))
        return flows

    def project(self, k: int, P_F: np.ndarray):
        """Displace the direction by frame k's flow (equirect pixels) before the single-centre projection."""
        d_F = P_F / np.maximum(np.linalg.norm(P_F, axis=-1, keepdims=True), 1e-9)
        d_sky = d_F @ MX  # F → skybox base
        col_e, row_e = dirs_to_equirect(d_sky, FW, FH)
        col_e = np.mod(col_e, FW)
        fl = self.flows[k]
        pad = np.concatenate([fl, fl[:, :1]], axis=1)
        disp = bilinear(pad, col_e, row_e)
        # the frame texture that belongs at this direction sits at direction − flow (flow maps frame → preview)
        c2 = col_e - disp[..., 0]
        r2 = np.clip(row_e - disp[..., 1], 0, FH - 1)
        lon = (c2 + 0.5) / FW * 2 * np.pi - np.pi
        lat = np.pi / 2 - (r2 + 0.5) / FH * np.pi
        d2 = np.stack([np.cos(lat) * np.sin(lon), np.sin(lat), np.cos(lat) * np.cos(lon)], -1)
        return self._project_plain(k, (d2 @ MX.T).reshape(-1, 3))
