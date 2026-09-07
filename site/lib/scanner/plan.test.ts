import { describe, expect, it } from "vitest";
import { coverageGaps, full3dPlan, minimumFrames, nextTargetIndex, planFor, planProgress, quickPlan, RECOMMENDED_COUNTS } from "./plan";

const FOV = { horizontal: 55, vertical: 72 };

describe("capture plans", () => {
  it("quick ring plan is a single equator ring of a dozen-ish targets", () => {
    const plan = quickPlan(0, FOV, "ring");
    expect(plan.mode).toBe("quick");
    expect(plan.targets.length).toBeGreaterThanOrEqual(8);
    expect(plan.targets.every((t) => t.elevation === 0)).toBe(true);
    expect(plan.stations).toHaveLength(1);
    const sphere = quickPlan(0, FOV, "sphere");
    expect(sphere.targets.length).toBeGreaterThan(plan.targets.length);
    expect(sphere.targets.some((t) => t.purpose === "ceiling")).toBe(true);
    expect(sphere.targets.some((t) => t.purpose === "floor")).toBe(true);
  });

  it("full 3D plan lands in the recommended ranges and has translated stations, heights, corners, ceiling and floor", () => {
    const normal = full3dPlan(0, FOV, "normal");
    const large = full3dPlan(0, FOV, "large");
    expect(normal.targets.length).toBeGreaterThanOrEqual(RECOMMENDED_COUNTS.normal[0]);
    expect(normal.targets.length).toBeLessThanOrEqual(RECOMMENDED_COUNTS.normal[1] + 10);
    expect(large.targets.length).toBeGreaterThanOrEqual(RECOMMENDED_COUNTS.large[0]);
    expect(large.targets.length).toBeLessThanOrEqual(RECOMMENDED_COUNTS.large[1]);
    expect(normal.targets.length).toBeGreaterThanOrEqual(20); // KIRI minimum with margin
    expect(normal.stations.filter((s) => s.kind === "perimeter")).toHaveLength(6);
    expect(normal.stations.some((s) => s.kind === "interior")).toBe(true);
    expect(normal.stations.some((s) => s.kind === "doorway")).toBe(true);
    expect(normal.stations.some((s) => s.height === "low")).toBe(true);
    for (const purpose of ["corner", "ceiling", "floor", "wall", "interior", "doorway"] as const) expect(normal.targets.some((t) => t.purpose === purpose), purpose).toBe(true);
    // every station change is flagged as a move so the UI can ask the person to walk first
    const moves = normal.targets.filter((t) => t.move);
    expect(moves.length).toBe(normal.stations.length);
    expect(normal.overlap).toBeGreaterThanOrEqual(0.6);
    expect(normal.overlap).toBeLessThanOrEqual(0.8);
  });

  it("consecutive headings at one station overlap by 60–80 %", () => {
    const plan = full3dPlan(90, FOV, "normal");
    const station0 = plan.targets.filter((t) => t.station === 0 && t.purpose !== "ceiling" && t.purpose !== "floor");
    for (let i = 1; i < station0.length; i++) {
      const step = Math.abs(((station0[i].yaw - station0[i - 1].yaw + 540) % 360) - 180);
      const overlap = 1 - step / FOV.horizontal;
      expect(overlap).toBeGreaterThanOrEqual(0.6);
      expect(overlap).toBeLessThanOrEqual(0.8);
    }
  });

  it("indexes are contiguous, directions are unit vectors and yaws are normalized", () => {
    const plan = full3dPlan(33, FOV, "large");
    plan.targets.forEach((t, i) => {
      expect(t.index).toBe(i);
      expect(t.yaw).toBeGreaterThanOrEqual(-180);
      expect(t.yaw).toBeLessThan(180);
      expect(Math.hypot(...t.direction)).toBeCloseTo(1, 6);
      expect(t.pitch).toBe(-t.elevation);
    });
  });

  it("checkpoint progression skips captured targets and reports missing ones", () => {
    const plan = quickPlan(0, FOV);
    expect(nextTargetIndex(plan, [])).toBe(0);
    expect(nextTargetIndex(plan, [0, 1, 2])).toBe(3);
    expect(nextTargetIndex(plan, [0, 2])).toBe(1);
    expect(nextTargetIndex(plan, plan.targets.map((t) => t.index))).toBeUndefined();
    const progress = planProgress(plan, [0, 1]);
    expect(progress.done).toBe(2);
    expect(progress.missing).toHaveLength(plan.targets.length - 2);
    expect(progress.fraction).toBeCloseTo(2 / plan.targets.length);
  });

  it("coverage gaps identify empty horizon sectors and missing caps", () => {
    const plan = quickPlan(0, FOV, "sphere");
    const half = Array.from({ length: 6 }, (_, i) => ({ yaw: i * 30, elevation: 0 }));
    const gaps = coverageGaps(plan, half);
    expect(gaps.missingHorizonSectors).toEqual([6, 7, 8, 9, 10, 11]);
    expect(gaps.ceiling).toBe(false);
    expect(coverageGaps(plan, [...half, { yaw: 0, elevation: 70 }, { yaw: 0, elevation: -70 }])).toMatchObject({ ceiling: true, floor: true });
  });

  it("minimum frames per mode match provider requirements", () => {
    expect(minimumFrames("full3d")).toBe(20);
    expect(minimumFrames("quick")).toBe(8);
    expect(planFor("quick", 0, FOV).mode).toBe("quick");
    expect(planFor("full3d", 0, FOV, { size: "large", doorways: 2 }).stations.filter((s) => s.kind === "doorway")).toHaveLength(2);
  });
});
