/**
 * Browser port of the Photo Sphere Android app's `SphereTargetPlan`
 * (third_party/360-photo-app, MIT). A plan is an ordered list of yaw/elevation
 * targets; rings alternate direction so the user sweeps back and forth instead
 * of unwinding a full turn between rings.
 */
export type SphereTarget = { yaw: number; elevation: number; dir: [number, number, number] };
export type SphereTargetPlan = { targets: SphereTarget[]; rings: [number, number][] };
export type CaptureScope = "ring" | "sphere";

export const DEFAULT_RING_ELEVATIONS = [0, 30, -30];
export const DEFAULT_EQUATOR_SPACING_DEGREES = 30;

export function normalizeDegrees(d: number): number {
  const n = d % 360;
  return n < 0 ? n + 360 : n;
}

function direction(yawDeg: number, elevationDeg: number): [number, number, number] {
  const yaw = (yawDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const c = Math.cos(el);
  return [Math.sin(yaw) * c, Math.cos(yaw) * c, Math.sin(el)];
}

export function target(yaw: number, elevation: number): SphereTarget {
  const y = normalizeDegrees(yaw);
  return { yaw: y, elevation, dir: direction(y, elevation) };
}

function ringYaws(startYaw: number, elevation: number, equatorSpacing: number): number[] {
  const shrink = Math.cos((elevation * Math.PI) / 180);
  const spacing = shrink <= 1e-3 ? 360 : equatorSpacing / shrink;
  const count = Math.max(1, Math.round(360 / spacing));
  const step = 360 / count;
  return Array.from({ length: count }, (_, i) => normalizeDegrees(startYaw + i * step));
}

export function createPlan(startYaw = 0, scope: CaptureScope = "ring", equatorSpacing = DEFAULT_EQUATOR_SPACING_DEGREES): SphereTargetPlan {
  const elevations = scope === "ring" ? [0] : DEFAULT_RING_ELEVATIONS;
  const targets: SphereTarget[] = [];
  const rings: [number, number][] = [];
  elevations.forEach((elevation, ringIndex) => {
    const ring = ringYaws(startYaw, elevation, equatorSpacing);
    const ordered = ringIndex % 2 === 0 ? ring : [...ring].reverse();
    const start = targets.length;
    ordered.forEach((yaw) => targets.push(target(yaw, elevation)));
    if (targets.length > start) rings.push([start, targets.length - 1]);
  });
  return { targets, rings };
}

/** Great-circle distance in degrees between the camera's look direction and a target. */
export function angularDistance(yaw: number, elevation: number, t: SphereTarget): number {
  const d = direction(yaw, elevation);
  const dot = Math.max(-1, Math.min(1, d[0] * t.dir[0] + d[1] * t.dir[1] + d[2] * t.dir[2]));
  return (Math.acos(dot) * 180) / Math.PI;
}

/** Signed yaw difference in (-180, 180]: positive means "turn right". */
export function yawDelta(fromYaw: number, toYaw: number): number {
  let d = normalizeDegrees(toYaw - fromYaw);
  if (d > 180) d -= 360;
  return d;
}
