/**
 * Capture geometry ported from 360-photo-app at b4d6b1257127150713c309a0c535a4f4fcf74e99.
 * Copyright (c) 2025-2026 Neo Malesa, used under the MIT License.
 */
export type Orientation = { yaw: number; pitch: number; roll: number };
export type FieldOfView = { horizontal: number; vertical: number };

export type SphereTarget = {
  yaw: number;
  pitch: number;
  elevation: number;
  direction: readonly [number, number, number];
  ring: number;
  index: number;
};

export type TargetView = { x: number; y: number; z: number; angularDistance: number; inFront: boolean };
export type SpherePlan = { targets: SphereTarget[]; rings: Array<{ start: number; end: number }> };

export const normalizeDegrees = (degrees: number) => ((degrees + 180) % 360 + 360) % 360 - 180;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function adaptiveRingElevations(verticalFov: number, overlap = 0.35): number[] {
  if (verticalFov < 1 || verticalFov > 179 || overlap < 0 || overlap > 1) throw new RangeError("Invalid capture geometry");
  const step = verticalFov * (1 - overlap);
  const cap = Math.min(75, Math.max(step, 90 - verticalFov / 2 + step / 2));
  const elevations = [0];
  for (let elevation = step; elevation < cap - step / 2; elevation += step) elevations.push(elevation, -elevation);
  elevations.push(cap, -cap);
  return elevations;
}

export function createTargetPlan(startYaw: number, fov: FieldOfView, overlap = 0.35): SpherePlan {
  const planned = { horizontal: fov.horizontal * 0.9, vertical: fov.vertical * 0.9 };
  const spacing = planned.horizontal * (1 - overlap);
  const targets: SphereTarget[] = [];
  const rings: SpherePlan["rings"] = [];
  adaptiveRingElevations(planned.vertical, overlap).forEach((elevation, ring) => {
    const shrink = Math.cos(radians(elevation));
    const yawSpacing = shrink <= 1e-3 ? 360 : spacing / shrink;
    const count = Math.max(1, Math.round(360 / yawSpacing));
    const yaws = Array.from({ length: count }, (_, i) => normalizeDegrees(startYaw + (i * 360) / count));
    if (ring % 2) yaws.reverse();
    const start = targets.length;
    yaws.forEach((yaw) => {
      const elevationRadians = radians(elevation);
      const cosElevation = Math.cos(elevationRadians);
      targets.push({ yaw, pitch: -elevation, elevation, ring, index: targets.length, direction: [Math.sin(radians(yaw)) * cosElevation, Math.cos(radians(yaw)) * cosElevation, Math.sin(elevationRadians)] });
    });
    rings.push({ start, end: targets.length - 1 });
  });
  return { targets, rings };
}

export function projectTarget(orientation: Orientation, target: SphereTarget): TargetView {
  const yaw = radians(orientation.yaw);
  const elevation = radians(-orientation.pitch);
  const roll = radians(orientation.roll);
  const sinYaw = Math.sin(yaw), cosYaw = Math.cos(yaw), cosElevation = Math.cos(elevation);
  const forward = [sinYaw * cosElevation, cosYaw * cosElevation, Math.sin(elevation)];
  const right0 = [cosYaw, -sinYaw, 0];
  const up0 = [right0[1] * forward[2], -right0[0] * forward[2], right0[0] * forward[1] - right0[1] * forward[0]];
  const right = right0.map((v, i) => v * Math.cos(roll) - up0[i] * Math.sin(roll));
  const up = up0.map((v, i) => v * Math.cos(roll) + right0[i] * Math.sin(roll));
  const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = dot(target.direction, forward);
  return { x: dot(target.direction, right), y: dot(target.direction, up), z, angularDistance: (Math.acos(Math.max(-1, Math.min(1, z))) * 180) / Math.PI, inFront: z > 1e-3 };
}

export function focalLength(width: number, height: number, fov: FieldOfView) {
  return Math.max(width / 2 / Math.tan(radians(fov.horizontal / 2)), height / 2 / Math.tan(radians(fov.vertical / 2)));
}

export class AlignmentGate {
  private alignedSince?: number;
  constructor(readonly thresholdDegrees = 2, readonly dwellMs = 300) {}
  update(distance: number, now: number) {
    if (!Number.isFinite(distance) || distance > this.thresholdDegrees) {
      this.alignedSince = undefined;
      return { progress: 0, aligned: false, triggered: false };
    }
    const since = this.alignedSince ?? (this.alignedSince = now);
    const progress = this.dwellMs <= 0 ? 1 : Math.min(1, Math.max(0, (now - since) / this.dwellMs));
    const triggered = now - since >= this.dwellMs;
    if (triggered) this.alignedSince = undefined;
    return { progress, aligned: true, triggered };
  }
  reset() { this.alignedSince = undefined; }
}
