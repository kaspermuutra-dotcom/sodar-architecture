import { describe, expect, it } from "vitest";
import { buildTourManifest, validateFrame } from "./server";
import type { FrameMetadata } from "./contracts";

const frame: FrameMetadata = { id: crypto.randomUUID(), sessionId: crypto.randomUUID(), roomId: crypto.randomUUID(), yaw: 0, pitch: 0, roll: 0, fov: { horizontal: 55, vertical: 72 }, timestamp: new Date().toISOString(), checkpoint: { index: 0, ring: 0, yaw: 0, pitch: 0, elevation: 0 }, width: 4032, height: 3024, mimeType: "image/jpeg" };
describe("capture validation", () => {
  it("accepts a valid full-resolution JPEG", () => expect(() => validateFrame(frame, 4_000_000)).not.toThrow());
  it("rejects invalid type, size, dimensions and frame index", () => {
    expect(() => validateFrame({ ...frame, mimeType: "image/png" as "image/jpeg" }, 4_000_000)).toThrow(/JPEG/);
    expect(() => validateFrame(frame, 30_000_000)).toThrow(/25 MB/);
    expect(() => validateFrame({ ...frame, width: 1 }, 4_000_000)).toThrow(/dimensions/);
    expect(() => validateFrame({ ...frame, checkpoint: { ...frame.checkpoint, index: 240 } }, 4_000_000)).toThrow(/checkpoint/);
  });
});
describe("preview gate", () => {
  const rooms = [{ id: "a", name: "Living", ordinal: 1, panoramaUrl: "signed:a" }, { id: "b", name: "Kitchen", ordinal: 2, panoramaUrl: "signed:b" }];
  it("stays closed until two rooms are ready", () => expect(buildTourManifest("scan", rooms.slice(0, 1))).toBeNull());
  it("builds reciprocal provisional links for the first two rooms", () => {
    const tour = buildTourManifest("scan", rooms)!;
    expect(tour.nodes).toHaveLength(2); expect(tour.nodes[0].links[0].nodeId).toBe("b"); expect(tour.nodes[1].links[0].nodeId).toBe("a");
  });
});
