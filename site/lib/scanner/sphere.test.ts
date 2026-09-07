import { describe, expect, it } from "vitest";
import { AlignmentGate, angularSpeed, createTargetPlan, normalizeDegrees, normalizeOrientation, OrientationFilter, projectTarget, wrap360, yawDelta } from "./sphere";

describe("orientation normalisation", () => {
  it("prefers the iOS compass heading and derives yaw from alpha otherwise", () => {
    expect(normalizeOrientation({ alpha: 0, beta: 90, gamma: 0, webkitCompassHeading: 45 })).toEqual({ yaw: 45, pitch: 0, roll: 0 });
    expect(normalizeOrientation({ alpha: 90, beta: 90, gamma: 0 })).toEqual({ yaw: 270, pitch: 0, roll: 0 });
    expect(normalizeOrientation({ alpha: 0, beta: 90, gamma: 0 })?.yaw).toBe(0);
  });
  it("maps beta to pitch (upright phone = 0, up = positive) and clamps; roll wraps", () => {
    expect(normalizeOrientation({ alpha: 0, beta: 120, gamma: 0 })?.pitch).toBe(30);
    expect(normalizeOrientation({ alpha: 0, beta: 60, gamma: 0 })?.pitch).toBe(-30);
    expect(normalizeOrientation({ alpha: 0, beta: 200, gamma: 0 })?.pitch).toBe(90);
    expect(normalizeOrientation({ alpha: 0, beta: 90, gamma: 190 })?.roll).toBe(-170);
    expect(normalizeOrientation({ alpha: null, beta: null, gamma: null })).toBeNull();
  });
  it("wraps and differences angles", () => {
    expect(wrap360(-30)).toBe(330);
    expect(wrap360(725)).toBe(5);
    expect(normalizeDegrees(190)).toBe(-170);
    expect(yawDelta(350, 10)).toBe(20);
    expect(yawDelta(10, 350)).toBe(-20);
    expect(angularSpeed({ yaw: 0, pitch: 0, roll: 0, t: 0 }, { yaw: 30, pitch: 0, roll: 0, t: 500 })).toBe(60);
  });
  it("drops single compass outliers but follows sustained turns", () => {
    const filter = new OrientationFilter(35, 3);
    filter.update({ yaw: 10, pitch: 0, roll: 0 });
    expect(filter.update({ yaw: 120, pitch: 5, roll: 0 }).yaw).toBe(10);
    expect(filter.update({ yaw: 12, pitch: 0, roll: 0 }).yaw).toBe(12);
    filter.update({ yaw: 200, pitch: 0, roll: 0 });
    filter.update({ yaw: 201, pitch: 0, roll: 0 });
    expect(filter.update({ yaw: 202, pitch: 0, roll: 0 }).yaw).toBe(202);
  });
});

describe("sphere geometry (Photo Sphere port)", () => {
  it("projects the target straight ahead when the phone points at it", () => {
    const plan = createTargetPlan(0, { horizontal: 55, vertical: 72 });
    const target = plan.targets[0];
    const view = projectTarget({ yaw: target.yaw, pitch: target.pitch, roll: 0 }, target);
    expect(view.angularDistance).toBeCloseTo(0, 5);
    expect(view.inFront).toBe(true);
    const turned = projectTarget({ yaw: target.yaw + 20, pitch: target.pitch, roll: 0 }, target);
    expect(turned.x).toBeLessThan(0); // target is to the left when we turned right
    expect(turned.angularDistance).toBeCloseTo(20, 4);
  });
  it("alignment gate needs dwell time inside the threshold and resets when leaving", () => {
    const gate = new AlignmentGate(4, 300);
    expect(gate.update(10, 0).aligned).toBe(false);
    expect(gate.update(2, 100)).toMatchObject({ aligned: true, triggered: false });
    expect(gate.update(6, 200).aligned).toBe(false);
    expect(gate.update(1, 300).triggered).toBe(false);
    expect(gate.update(1, 650).triggered).toBe(true);
    expect(gate.update(1, 700).triggered).toBe(false); // re-arms after a trigger
  });
});
