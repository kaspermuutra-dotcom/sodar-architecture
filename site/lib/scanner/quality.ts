/**
 * Inexpensive local capture-quality gates. Everything here runs on a small
 * grayscale downsample (≤ 96 px) so it costs well under a millisecond per frame
 * and never touches the network. Astra does the semantic review afterwards.
 *
 * Three severities: `blocking` (the frame is not saved as a capture), `retake`
 * (kept, but the person is asked to retake), `info` (a hint only). Users may
 * override `retake`/`info`; they cannot override `blocking`.
 */
import type { Orientation } from "./sphere";
import { yawDelta } from "./sphere";
import type { CaptureMode } from "./plan";

export type Gray = { width: number; height: number; data: Float32Array };

export type FrameMetrics = {
  sharpness: number; // variance of Laplacian on the downsample (higher = sharper)
  brightness: number; // mean luma 0..255
  clippedHighlights: number; // fraction of pixels ≥ 250
  clippedShadows: number; // fraction of pixels ≤ 5
  contrast: number; // luma standard deviation
  texture: number; // mean gradient magnitude (low = blank wall)
};

export type FrameCheckInput = {
  metrics: FrameMetrics;
  width: number;
  height: number;
  mimeType: string;
  previous?: { metrics: FrameMetrics; gray: Gray; orientation: Orientation; timestamp: number };
  gray: Gray;
  orientation: Orientation;
  timestamp: number;
  /** Angular speed at capture time, degrees per second, if known. */
  angularSpeed?: number;
  mode: CaptureMode;
};

export type Severity = "blocking" | "retake" | "info";
export type FindingCode =
  | "unsupported_format"
  | "resolution_too_low"
  | "blurry"
  | "motion"
  | "too_dark"
  | "too_bright"
  | "blown_highlights"
  | "blocked_shadows"
  | "duplicate"
  | "low_texture"
  | "orientation_jump"
  | "too_fast"
  | "exposure_jump";

export type Finding = { code: FindingCode; severity: Severity; value?: number };

export const THRESHOLDS = {
  minWidth: 640,
  minHeight: 480,
  sharpnessBlocking: 8,
  sharpnessRetake: 25,
  darkMean: 28,
  brightMean: 235,
  highlightFraction: 0.12,
  shadowFraction: 0.35,
  duplicateDiff: 4.0, // mean abs luma diff between consecutive downsamples
  duplicateYaw: 3, // degrees
  lowTexture: 3.5,
  orientationJump: 60,
  tooFastDegPerSec: 90,
  exposureJump: 60,
  minIntervalMs: 250,
} as const;

/** Grayscale downsample from RGBA pixels (e.g. `ctx.getImageData` of a ≤96 px canvas). */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Gray {
  const data = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) data[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  return { width, height, data };
}

export function computeMetrics(gray: Gray): FrameMetrics {
  const { width: w, height: h, data } = gray;
  const n = data.length;
  let sum = 0, sumSq = 0, hi = 0, lo = 0;
  for (let i = 0; i < n; i++) {
    const v = data[i];
    sum += v;
    sumSq += v * v;
    if (v >= 250) hi++;
    if (v <= 5) lo++;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  let lapSum = 0, lapSq = 0, grad = 0, count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w];
      lapSum += lap;
      lapSq += lap * lap;
      grad += Math.abs(data[i + 1] - data[i - 1]) + Math.abs(data[i + w] - data[i - w]);
      count++;
    }
  }
  const lapMean = count ? lapSum / count : 0;
  return {
    sharpness: count ? Math.max(0, lapSq / count - lapMean * lapMean) : 0,
    brightness: mean,
    clippedHighlights: hi / n,
    clippedShadows: lo / n,
    contrast: Math.sqrt(variance),
    texture: count ? grad / (2 * count) : 0,
  };
}

/** Mean absolute luma difference between two same-size downsamples. */
export function frameDifference(a: Gray, b: Gray): number {
  if (a.data.length !== b.data.length) return Number.POSITIVE_INFINITY;
  let s = 0;
  for (let i = 0; i < a.data.length; i++) s += Math.abs(a.data[i] - b.data[i]);
  return s / a.data.length;
}

export function checkFrame(input: FrameCheckInput): Finding[] {
  const findings: Finding[] = [];
  const m = input.metrics;
  if (input.mimeType !== "image/jpeg" && input.mimeType !== "image/png") findings.push({ code: "unsupported_format", severity: "blocking" });
  if (Math.min(input.width, input.height) < THRESHOLDS.minHeight || Math.max(input.width, input.height) < THRESHOLDS.minWidth) findings.push({ code: "resolution_too_low", severity: "blocking", value: Math.min(input.width, input.height) });
  const dark = m.brightness < THRESHOLDS.darkMean;
  const bright = m.brightness > THRESHOLDS.brightMean;
  if (dark) findings.push({ code: "too_dark", severity: m.brightness < THRESHOLDS.darkMean / 2 ? "blocking" : "retake", value: m.brightness });
  if (bright) findings.push({ code: "too_bright", severity: "retake", value: m.brightness });
  // Sharpness is meaningless on a near-black or blank frame, so only judge it when there is signal.
  if (!dark && m.texture > 1) {
    if (m.sharpness < THRESHOLDS.sharpnessBlocking) findings.push({ code: "blurry", severity: "blocking", value: m.sharpness });
    else if (m.sharpness < THRESHOLDS.sharpnessRetake) findings.push({ code: "blurry", severity: "retake", value: m.sharpness });
  }
  if ((input.angularSpeed ?? 0) > THRESHOLDS.tooFastDegPerSec) findings.push({ code: "motion", severity: "retake", value: input.angularSpeed });
  if (m.clippedHighlights > THRESHOLDS.highlightFraction) findings.push({ code: "blown_highlights", severity: "info", value: m.clippedHighlights });
  if (!dark && m.clippedShadows > THRESHOLDS.shadowFraction) findings.push({ code: "blocked_shadows", severity: "info", value: m.clippedShadows });
  if (m.texture < THRESHOLDS.lowTexture && !dark) findings.push({ code: "low_texture", severity: "info", value: m.texture });
  const prev = input.previous;
  if (prev) {
    const dt = input.timestamp - prev.timestamp;
    const yaw = Math.abs(yawDelta(prev.orientation.yaw, input.orientation.yaw));
    const pitch = Math.abs(input.orientation.pitch - prev.orientation.pitch);
    const diff = frameDifference(prev.gray, input.gray);
    if (diff < THRESHOLDS.duplicateDiff && yaw < THRESHOLDS.duplicateYaw && pitch < THRESHOLDS.duplicateYaw) findings.push({ code: "duplicate", severity: input.mode === "quick" ? "retake" : "info", value: diff });
    if (dt < THRESHOLDS.minIntervalMs) findings.push({ code: "too_fast", severity: "info", value: dt });
    if (yaw > THRESHOLDS.orientationJump && input.mode === "quick") findings.push({ code: "orientation_jump", severity: "info", value: yaw });
    if (Math.abs(m.brightness - prev.metrics.brightness) > THRESHOLDS.exposureJump) findings.push({ code: "exposure_jump", severity: "info", value: Math.abs(m.brightness - prev.metrics.brightness) });
  }
  return findings;
}

export const worst = (findings: Finding[]): Severity | "ok" => (findings.some((f) => f.severity === "blocking") ? "blocking" : findings.some((f) => f.severity === "retake") ? "retake" : findings.length ? "info" : "ok");

/** 0..1 quality score persisted with the frame; blocking → 0. */
export function qualityScore(metrics: FrameMetrics, findings: Finding[]): number {
  if (findings.some((f) => f.severity === "blocking")) return 0;
  const sharp = Math.min(1, metrics.sharpness / 120);
  const exposure = 1 - Math.min(1, Math.abs(metrics.brightness - 118) / 118);
  const clip = 1 - Math.min(1, metrics.clippedHighlights * 3 + metrics.clippedShadows * 1.5);
  const penalty = findings.filter((f) => f.severity === "retake").length * 0.15;
  return Math.max(0.05, Math.min(1, 0.5 * sharp + 0.3 * exposure + 0.2 * clip - penalty));
}

export type RoomGate = { ok: boolean; blocking: string[]; recommended: string[]; info: string[] };

/**
 * Room-level gate before processing: enough frames, not too many retake-worthy
 * ones, no unsupported formats, weak regions reported by the plan.
 */
export function checkRoom(input: { mode: CaptureMode; frameCount: number; minFrames: number; maxFrames: number; retakeCount: number; missingTargets: number; totalTargets: number; missingHorizonSectors: number; supportedFormats: boolean }): RoomGate {
  const blocking: string[] = [];
  const recommended: string[] = [];
  const info: string[] = [];
  if (!input.supportedFormats) blocking.push("unsupported_format");
  if (input.frameCount < input.minFrames) blocking.push("not_enough_photos");
  if (input.frameCount > input.maxFrames) blocking.push("too_many_photos");
  const coverage = input.totalTargets ? 1 - input.missingTargets / input.totalTargets : 1;
  if (coverage < 0.6) recommended.push("coverage_incomplete");
  else if (coverage < 0.9) info.push("coverage_partial");
  if (input.missingHorizonSectors >= 3) recommended.push("horizon_gaps");
  if (input.retakeCount > 0 && input.retakeCount / Math.max(1, input.frameCount) > 0.2) recommended.push("many_soft_frames");
  else if (input.retakeCount > 0) info.push("some_soft_frames");
  return { ok: blocking.length === 0, blocking, recommended, info };
}
