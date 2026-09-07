/**
 * Capture plans for the two scanner modes.
 *
 * Quick panorama — rotational capture from one standing spot (the Photo Sphere
 * sphere plan in sphere.ts, ring or full sphere). Fast, previewable at once,
 * not enough for a good 3D reconstruction.
 *
 * Full 3D scan — the default for the premium demo. The person walks a loop of
 * standing positions ("stations") around the room: at each station they turn
 * through a short arc facing inward-and-outward with the camera at chest
 * height, then a second pass at a lower height on alternating stations, plus
 * ceiling, floor and doorway targets. That yields translated viewpoints with
 * 60–80 % overlap, several heights, corners, floors and ceilings — what KIRI's
 * 3DGS needs — while never asking the person to walk with their eyes on the
 * screen: the plan tells them to *move*, then to *stand still and turn*.
 */
import { createTargetPlan, normalizeDegrees, type FieldOfView, type SpherePlan, type SphereTarget } from "./sphere";

export type CaptureMode = "quick" | "full3d";
export type RoomSize = "normal" | "large";

export type StationKind = "perimeter" | "interior" | "doorway";
export type Station = { index: number; kind: StationKind; /** 0..1 around the loop, clockwise from the start wall */ position: number; height: "chest" | "low"; label: string };

/** A full-3D target is a sphere target bound to a station; `move` marks the first target after a station change. */
export type PlanTarget = SphereTarget & { station: number; move: boolean; purpose: "wall" | "corner" | "ceiling" | "floor" | "doorway" | "interior" };

export type CapturePlan = { mode: CaptureMode; targets: PlanTarget[]; stations: Station[]; overlap: number; recommendedRange: [number, number] };

export const PLAN_LIMITS = { quickMin: 8, full3dMin: 20, full3dMax: 300 } as const;

/** Recommended photograph counts by room size (KIRI needs ≥ 20; more viewpoints = better splats). */
export const RECOMMENDED_COUNTS: Record<RoomSize, [number, number]> = { normal: [40, 80], large: [80, 150] };

/** Quick panorama: one ring or the whole sphere from a fixed spot. */
export function quickPlan(startYaw: number, fov: FieldOfView, scope: "ring" | "sphere" = "ring"): CapturePlan {
  const full = createTargetPlan(startYaw, fov);
  const base: SpherePlan = scope === "sphere" ? full : { targets: full.targets.filter((t) => t.ring === 0).map((t, index) => ({ ...t, index })), rings: [{ start: 0, end: full.targets.filter((t) => t.ring === 0).length - 1 }] };
  const targets: PlanTarget[] = base.targets.map((t) => ({ ...t, station: 0, move: false, purpose: t.elevation > 45 ? "ceiling" : t.elevation < -45 ? "floor" : "wall" }));
  return { mode: "quick", targets, stations: [{ index: 0, kind: "interior", position: 0, height: "chest", label: "centre" }], overlap: 0.35, recommendedRange: [targets.length, targets.length] };
}

function direction(yaw: number, elevation: number): readonly [number, number, number] {
  const y = (yaw * Math.PI) / 180, e = (elevation * Math.PI) / 180;
  return [Math.sin(y) * Math.cos(e), Math.cos(y) * Math.cos(e), Math.sin(e)];
}

function target(yaw: number, elevation: number, index: number, station: number, purpose: PlanTarget["purpose"], move: boolean, ring: number): PlanTarget {
  const wrapped = normalizeDegrees(yaw);
  return { yaw: wrapped, pitch: -elevation, elevation, direction: direction(wrapped, elevation), ring, index, station, move, purpose };
}

/**
 * Full 3D plan. `startYaw` is the direction the person faces at the first
 * station (the wall behind the door is a good start). Stations are laid out as
 * a loop: N perimeter stations, then 2 interior stations; every other perimeter
 * station gets a second, low-height pass. Overlap between consecutive headings
 * at one station is 1 − step/hfov ≈ 0.7.
 */
export function full3dPlan(startYaw: number, fov: FieldOfView, size: RoomSize = "normal", options: { doorways?: number } = {}): CapturePlan {
  const perimeter = size === "large" ? 10 : 6;
  const overlap = 0.7;
  const step = Math.max(12, fov.horizontal * (1 - overlap)); // ≈ 16.5° for a 55° lens
  const arc = size === "large" ? 120 : 100; // degrees swept at each perimeter station, facing into the room
  const interiorStations = size === "large" ? 2 : 1;
  const stations: Station[] = [];
  const targets: PlanTarget[] = [];
  let index = 0;
  const push = (yaw: number, elevation: number, station: number, purpose: PlanTarget["purpose"], move: boolean, ring = 0) => {
    targets.push(target(yaw, elevation, index, station, purpose, move, ring));
    index += 1;
  };
  for (let s = 0; s < perimeter; s++) {
    const position = s / perimeter;
    const low = s % 2 === 1;
    stations.push({ index: s, kind: "perimeter", position, height: low ? "low" : "chest", label: `perimeter-${s + 1}` });
    // Standing at the wall, face the opposite wall and sweep the arc; the sensor start yaw is the first station's facing.
    const facing = startYaw + 180 + position * 360;
    const count = Math.round(arc / step) + 1;
    for (let k = 0; k < count; k++) {
      const yaw = facing - arc / 2 + k * step;
      const isCorner = k === 0 || k === count - 1;
      push(yaw, 0, s, isCorner ? "corner" : "wall", k === 0);
    }
    // A short upward and downward pass at chest-height stations covers ceiling line and floor line with parallax.
    if (!low) {
      push(facing - arc / 4, 35, s, "ceiling", false, 1);
      push(facing + arc / 4, 35, s, "ceiling", false, 1);
      push(facing, -35, s, "floor", false, 2);
    } else {
      push(facing - arc / 4, -30, s, "floor", false, 2);
      push(facing + arc / 4, -30, s, "floor", false, 2);
    }
  }
  // Interior stations: one (two for large rooms) spot inside the room, full turn at chest height
  // (loop closure and the far walls; ~55 % overlap between headings, plus the overlap with perimeter frames).
  for (let i = 0; i < interiorStations; i++) {
    const s = stations.length;
    stations.push({ index: s, kind: "interior", position: i === 0 ? 0.25 : 0.75, height: "chest", label: `interior-${i + 1}` });
    const count = Math.round(360 / (step * 1.5));
    for (let k = 0; k < count; k++) push(startYaw + (k * 360) / count + (i ? 180 / count : 0), 0, s, "interior", k === 0);
    push(startYaw + (i ? 90 : 270), 65, s, "ceiling", false, 1);
    push(startYaw + (i ? 90 : 270), -65, s, "floor", false, 2);
  }
  // Doorway transition: a few frames stepping through the door plane, facing the next room.
  const doorways = Math.max(0, Math.min(4, options.doorways ?? 1));
  for (let d = 0; d < doorways; d++) {
    const s = stations.length;
    stations.push({ index: s, kind: "doorway", position: d / Math.max(1, doorways), height: "chest", label: `doorway-${d + 1}` });
    const facing = startYaw + (d * 360) / Math.max(1, doorways);
    push(facing - step, 0, s, "doorway", true);
    push(facing, 0, s, "doorway", false);
    push(facing + step, 0, s, "doorway", false);
  }
  return { mode: "full3d", targets, stations, overlap, recommendedRange: RECOMMENDED_COUNTS[size] };
}

export function planFor(mode: CaptureMode, startYaw: number, fov: FieldOfView, options: { scope?: "ring" | "sphere"; size?: RoomSize; doorways?: number } = {}): CapturePlan {
  return mode === "full3d" ? full3dPlan(startYaw, fov, options.size ?? "normal", { doorways: options.doorways }) : quickPlan(startYaw, fov, options.scope ?? "ring");
}

/** Minimum photographs a room must have before the corresponding processing is offered. */
export function minimumFrames(mode: CaptureMode): number {
  return mode === "full3d" ? PLAN_LIMITS.full3dMin : PLAN_LIMITS.quickMin;
}

/** Index of the next target to capture given which checkpoint indexes exist. Skips retaken/filled ones. */
export function nextTargetIndex(plan: CapturePlan, capturedIndexes: Iterable<number>): number | undefined {
  const done = new Set(capturedIndexes);
  return plan.targets.find((t) => !done.has(t.index))?.index;
}

/** Fraction of the plan captured, and the count still missing. */
export function planProgress(plan: CapturePlan, capturedIndexes: Iterable<number>): { done: number; total: number; fraction: number; missing: number[] } {
  const set = new Set(capturedIndexes);
  const missing = plan.targets.filter((t) => !set.has(t.index)).map((t) => t.index);
  const done = plan.targets.length - missing.length;
  return { done, total: plan.targets.length, fraction: plan.targets.length ? done / plan.targets.length : 0, missing };
}

/**
 * Coverage weakness detection for the quick panorama: yaw sectors (30°) of the
 * horizon ring with no capture, and whether ceiling/floor rings were captured.
 */
export function coverageGaps(plan: CapturePlan, captured: Array<{ yaw: number; elevation: number }>): { missingHorizonSectors: number[]; ceiling: boolean; floor: boolean } {
  const sectors = new Set<number>();
  let ceiling = false, floor = false;
  for (const c of captured) {
    if (Math.abs(c.elevation) < 30) sectors.add(Math.floor((((c.yaw % 360) + 360) % 360) / 30));
    if (c.elevation > 45) ceiling = true;
    if (c.elevation < -45) floor = true;
  }
  const missing = Array.from({ length: 12 }, (_, i) => i).filter((i) => !sectors.has(i));
  return { missingHorizonSectors: missing, ceiling: plan.mode === "quick" ? ceiling : ceiling, floor };
}
