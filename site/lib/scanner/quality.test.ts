import { describe, expect, it } from "vitest";
import { checkFrame, checkRoom, computeMetrics, frameDifference, qualityScore, THRESHOLDS, toGray, worst, type Gray } from "./quality";

function synth(fn: (x: number, y: number) => number, size = 96): Gray {
  const data = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data[y * size + x] = Math.max(0, Math.min(255, fn(x, y)));
  return { width: size, height: size, data };
}
const checker = synth((x, y) => ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 200 : 50));
const flat = synth(() => 120);
const dark = synth((x, y) => ((x + y) % 7 ? 10 : 14));
const bright = synth(() => 252);
const base = { width: 4032, height: 3024, mimeType: "image/jpeg", orientation: { yaw: 0, pitch: 0, roll: 0 }, timestamp: 10_000, mode: "quick" as const };

describe("local quality gates", () => {
  it("computes sharpness, brightness, clipping and texture on a downsample", () => {
    const sharp = computeMetrics(checker);
    const blurry = computeMetrics(flat);
    expect(sharp.sharpness).toBeGreaterThan(THRESHOLDS.sharpnessRetake);
    expect(blurry.sharpness).toBe(0);
    expect(blurry.texture).toBe(0);
    expect(computeMetrics(bright).clippedHighlights).toBe(1);
    expect(computeMetrics(dark).brightness).toBeLessThan(THRESHOLDS.darkMean);
    expect(toGray(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1).data[0]).toBeCloseTo(255, 0);
  });

  it("blocks unsupported formats, tiny frames, very dark and very blurry frames", () => {
    const m = computeMetrics(checker);
    expect(worst(checkFrame({ ...base, metrics: m, gray: checker, mimeType: "image/heic" }))).toBe("blocking");
    expect(worst(checkFrame({ ...base, metrics: m, gray: checker, width: 320, height: 240 }))).toBe("blocking");
    expect(checkFrame({ ...base, metrics: computeMetrics(dark), gray: dark }).find((f) => f.code === "too_dark")?.severity).toBe("blocking");
    const soft = synth((x) => 100 + Math.sin(x / 6) * 40); // textured but with no fine detail: a defocused wall
    const softMetrics = computeMetrics(soft);
    expect(softMetrics.sharpness).toBeLessThan(THRESHOLDS.sharpnessBlocking);
    expect(checkFrame({ ...base, metrics: softMetrics, gray: soft }).find((f) => f.code === "blurry")?.severity).toBe("blocking");
  });

  it("asks for retakes on motion, bright frames and duplicates, and flags info-only cases", () => {
    const m = computeMetrics(checker);
    expect(checkFrame({ ...base, metrics: m, gray: checker, angularSpeed: 120 }).find((f) => f.code === "motion")?.severity).toBe("retake");
    expect(checkFrame({ ...base, metrics: computeMetrics(bright), gray: bright }).find((f) => f.code === "too_bright")?.severity).toBe("retake");
    const previous = { metrics: m, gray: checker, orientation: { yaw: 1, pitch: 0, roll: 0 }, timestamp: 9_000 };
    const dup = checkFrame({ ...base, metrics: m, gray: checker, previous });
    expect(dup.find((f) => f.code === "duplicate")?.severity).toBe("retake");
    expect(checkFrame({ ...base, mode: "full3d", metrics: m, gray: checker, previous }).find((f) => f.code === "duplicate")?.severity).toBe("info");
    const jump = checkFrame({ ...base, metrics: m, gray: checker, previous: { ...previous, orientation: { yaw: 100, pitch: 0, roll: 0 }, timestamp: 9_900 } });
    expect(jump.map((f) => f.code)).toEqual(expect.arrayContaining(["orientation_jump", "too_fast"]));
    expect(checkFrame({ ...base, metrics: computeMetrics(flat), gray: flat }).find((f) => f.code === "low_texture")?.severity).toBe("info");
    expect(frameDifference(checker, flat)).toBeGreaterThan(THRESHOLDS.duplicateDiff);
  });

  it("scores quality in 0..1 with blocking = 0", () => {
    const m = computeMetrics(checker);
    expect(qualityScore(m, [])).toBeGreaterThan(0.5);
    expect(qualityScore(m, [{ code: "blurry", severity: "blocking" }])).toBe(0);
    expect(qualityScore(m, [{ code: "motion", severity: "retake" }])).toBeLessThan(qualityScore(m, []));
  });

  it("room gate distinguishes blocking, recommended and info", () => {
    const ok = checkRoom({ mode: "full3d", frameCount: 60, minFrames: 20, maxFrames: 300, retakeCount: 0, missingTargets: 0, totalTargets: 60, missingHorizonSectors: 0, supportedFormats: true });
    expect(ok).toEqual({ ok: true, blocking: [], recommended: [], info: [] });
    const few = checkRoom({ mode: "full3d", frameCount: 12, minFrames: 20, maxFrames: 300, retakeCount: 0, missingTargets: 48, totalTargets: 60, missingHorizonSectors: 6, supportedFormats: true });
    expect(few.ok).toBe(false);
    expect(few.blocking).toContain("not_enough_photos");
    expect(few.recommended).toEqual(expect.arrayContaining(["coverage_incomplete", "horizon_gaps"]));
    const soft = checkRoom({ mode: "quick", frameCount: 12, minFrames: 8, maxFrames: 300, retakeCount: 5, missingTargets: 2, totalTargets: 12, missingHorizonSectors: 1, supportedFormats: true });
    expect(soft.ok).toBe(true);
    expect(soft.recommended).toContain("many_soft_frames");
    expect(soft.info).toContain("coverage_partial");
    expect(checkRoom({ ...ok, mode: "quick", frameCount: 301, minFrames: 8, maxFrames: 300, retakeCount: 0, missingTargets: 0, totalTargets: 0, missingHorizonSectors: 0, supportedFormats: false }).blocking).toEqual(["unsupported_format", "too_many_photos"]);
  });
});
