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

// ---------------------------------------------------------------------------
// Orientation normalisation — one place for the sensor → SODAR convention.
// ---------------------------------------------------------------------------

/** Raw values as delivered by a DeviceOrientationEvent (all optional on real devices). */
export type RawOrientation = { alpha: number | null; beta: number | null; gamma: number | null; webkitCompassHeading?: number | null; absolute?: boolean };

/** Wraps an angle into [0, 360). */
export const wrap360 = (degrees: number) => ((degrees % 360) + 360) % 360;

/** Smallest signed difference b − a in degrees, in (−180, 180]. */
export const yawDelta = (a: number, b: number) => normalizeDegrees(b - a);

/**
 * Converts a DeviceOrientationEvent into SODAR's orientation convention:
 * yaw compass-like (0 = north, clockwise, in [0, 360)); pitch = beta − 90, so
 * a phone held upright looking at the horizon reads 0 and tilting the camera
 * up reads positive, clamped to ±90; roll = gamma wrapped to (−180, 180].
 * Targets are planned with `pitch: -elevation` and `projectTarget` negates
 * `orientation.pitch`, so elevation for the stitcher is `-pitch` — the same
 * convention the Photo Sphere port, `stitch.ts` and `posed.py` use.
 * Returns null when the event carries no usable data.
 */
export function normalizeOrientation(raw: RawOrientation): Orientation | null {
  if (raw.alpha == null && raw.beta == null && raw.webkitCompassHeading == null) return null;
  const compass = raw.webkitCompassHeading;
  const yaw = compass != null && Number.isFinite(compass) ? wrap360(compass) : wrap360(360 - (raw.alpha ?? 0));
  const beta = raw.beta ?? 90;
  const pitch = Math.max(-90, Math.min(90, beta - 90));
  const gamma = raw.gamma ?? 0;
  const roll = normalizeDegrees(gamma);
  if (![yaw, pitch, roll].every(Number.isFinite)) return null;
  return { yaw, pitch, roll };
}

/**
 * Orientation continuity filter: the compass occasionally jumps by tens of
 * degrees for one sample (magnetic interference, iOS re-calibration). A single
 * outlier that snaps back is dropped; a sustained change is accepted after
 * `holdSamples` readings so real fast turns are still followed.
 */
export class OrientationFilter {
  private last?: Orientation;
  private pending?: { value: Orientation; count: number };
  constructor(readonly jumpDegrees = 35, readonly holdSamples = 3) {}
  update(next: Orientation): Orientation {
    if (!this.last) return (this.last = next);
    const jump = Math.abs(yawDelta(this.last.yaw, next.yaw));
    if (jump < this.jumpDegrees) {
      this.pending = undefined;
      return (this.last = next);
    }
    if (this.pending && Math.abs(yawDelta(this.pending.value.yaw, next.yaw)) < this.jumpDegrees) {
      this.pending.count += 1;
      if (this.pending.count >= this.holdSamples) {
        this.pending = undefined;
        return (this.last = next);
      }
    } else this.pending = { value: next, count: 1 };
    return { ...this.last, pitch: next.pitch, roll: next.roll };
  }
  reset() {
    this.last = undefined;
    this.pending = undefined;
  }
}

/** Angular speed in degrees per second between two timed orientations. */
export function angularSpeed(prev: Orientation & { t: number }, next: Orientation & { t: number }): number {
  const dt = Math.max(1, next.t - prev.t) / 1000;
  const yaw = Math.abs(yawDelta(prev.yaw, next.yaw));
  const pitch = Math.abs(next.pitch - prev.pitch);
  return Math.hypot(yaw, pitch) / dt;
}
