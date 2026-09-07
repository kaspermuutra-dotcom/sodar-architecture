import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findManifest, loadLiveFixture } from "./providers.live.test";

const jpeg = (seed: number, size = 250 * 1024) => {
  const bytes = new Uint8Array(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  for (let i = 3; i < size; i++) bytes[i] = (i * 31 + seed * 17) & 0xff;
  return bytes;
};

/** Writes a folder shaped like the scanner's "Export originals" zip, unpacked. */
function makeExport(options: { rooms: Array<{ name: string; mode: string; count: number; stations: number; dupFrom?: number; skipFile?: number }>; nested?: boolean; smallBytes?: boolean }) {
  const root = mkdtempSync(join(tmpdir(), "sodar-export-"));
  const base = options.nested ? join(root, "sodar-scan-abc123") : root;
  mkdirSync(base, { recursive: true });
  const rooms = options.rooms.map((room, ri) => {
    const dir = `room-${String(ri + 1).padStart(2, "0")}`;
    mkdirSync(join(base, dir), { recursive: true });
    writeFileSync(join(base, dir, "panorama-original.jpg"), jpeg(999 + ri, 4096)); // must be ignored
    const frames = Array.from({ length: room.count }, (_, fi) => {
      const file = `${dir}/frame-${String(fi + 1).padStart(3, "0")}.jpg`;
      if (room.skipFile !== fi) writeFileSync(join(base, file), jpeg(room.dupFrom !== undefined && fi === room.count - 1 ? room.dupFrom : ri * 1000 + fi, options.smallBytes ? 4096 : undefined));
      return { file, yaw: fi * 9, pitch: 0, roll: 0, station: fi % room.stations, checkpoint: { index: fi }, timestamp: new Date().toISOString(), width: 4032, height: 3024 };
    });
    return { id: `room-id-${ri}`, name: room.name, mode: room.mode, fov: { horizontal: 55, vertical: 72 }, targetCount: room.count, frames };
  });
  writeFileSync(join(base, "frames.json"), JSON.stringify({ schema: "sodar-frames.v2", sessionId: "s", exportedAt: new Date().toISOString(), rooms }));
  // A stray JPEG that is not referenced by the manifest must never be picked up.
  writeFileSync(join(base, "stray.jpg"), jpeg(4242));
  return root;
}

describe("live smoke fixture loader (SODAR export structure; never spends credits on bad input)", () => {
  it("refuses a missing directory, a loose folder of JPEGs, and a manifest without rooms", () => {
    expect(() => loadLiveFixture(undefined)).toThrow(/SODAR_LIVE_FIXTURE_DIR/);
    const loose = mkdtempSync(join(tmpdir(), "sodar-loose-"));
    for (let i = 0; i < 24; i++) writeFileSync(join(loose, `f${i}.jpg`), jpeg(i));
    expect(() => loadLiveFixture(loose)).toThrow(/No frames.json/);
    writeFileSync(join(loose, "frames.json"), JSON.stringify({ schema: "sodar-frames.v1", fov: {}, frames: [] }));
    expect(() => loadLiveFixture(loose)).toThrow(/no rooms/);
  });

  it("parses frames.json, selects the first Full 3D room, and reads only its referenced images (nested export folder)", () => {
    const root = makeExport({ rooms: [{ name: "Kitchen", mode: "quick", count: 12, stations: 1 }, { name: "Living room", mode: "full3d", count: 26, stations: 6 }], nested: true });
    expect(findManifest(root)).toHaveLength(1);
    const input = loadLiveFixture(root, undefined);
    expect(input.kind).toBe("images");
    if (input.kind !== "images") throw new Error();
    expect(input.frames).toHaveLength(26);
    expect(input.frames[0].name).toBe("frame-001.jpg");
    expect(input.frames.every((frame) => frame.bytes[0] === 0xff)).toBe(true);
  });

  it("honours SODAR_LIVE_ROOM by id, name or index and rejects a quick room or an unknown selector", () => {
    const root = makeExport({ rooms: [{ name: "Kitchen", mode: "quick", count: 12, stations: 1 }, { name: "Living room", mode: "full3d", count: 24, stations: 5 }, { name: "Bedroom", mode: "full3d", count: 30, stations: 4 }] });
    const count = (selector: string) => {
      const input = loadLiveFixture(root, selector);
      return input.kind === "images" ? input.frames.length : 0;
    };
    expect(count("Bedroom")).toBe(30);
    expect(count("room-id-1")).toBe(24);
    expect(count("3")).toBe(30);
    expect(() => loadLiveFixture(root, "Kitchen")).toThrow(/quick capture/);
    expect(() => loadLiveFixture(root, "Garage")).toThrow(/matches no room/);
  });

  it("requires at least three distinct stations, 20–40 frames, and rejects missing, duplicated or tiny images", () => {
    expect(() => loadLiveFixture(makeExport({ rooms: [{ name: "Hall", mode: "full3d", count: 24, stations: 2 }] }), undefined)).toThrow(/at least 3 distinct standing positions/);
    expect(() => loadLiveFixture(makeExport({ rooms: [{ name: "Hall", mode: "full3d", count: 12, stations: 4 }] }), undefined)).toThrow(/20–40/);
    expect(() => loadLiveFixture(makeExport({ rooms: [{ name: "Hall", mode: "full3d", count: 41, stations: 4 }] }), undefined)).toThrow(/20–40/);
    expect(() => loadLiveFixture(makeExport({ rooms: [{ name: "Hall", mode: "full3d", count: 24, stations: 4, skipFile: 3 }] }), undefined)).toThrow(/missing image/);
    expect(() => loadLiveFixture(makeExport({ rooms: [{ name: "Hall", mode: "full3d", count: 24, stations: 4, dupFrom: 0 }] }), undefined)).toThrow(/duplicates/);
    expect(() => loadLiveFixture(makeExport({ rooms: [{ name: "Hall", mode: "full3d", count: 24, stations: 4 }], smallBytes: true }), undefined)).toThrow(/real capture frames/);
    expect(() => loadLiveFixture(makeExport({ rooms: [{ name: "Only quick", mode: "quick", count: 24, stations: 4 }] }), undefined)).toThrow(/No Full 3D room/);
  });

  it("refuses manifest paths that escape the export folder and ambiguous exports", () => {
    const root = mkdtempSync(join(tmpdir(), "sodar-escape-"));
    writeFileSync(join(root, "frames.json"), JSON.stringify({ rooms: [{ name: "X", mode: "full3d", frames: Array.from({ length: 20 }, (_, i) => ({ file: `../outside-${i}.jpg`, station: i % 4 })) }] }));
    expect(() => loadLiveFixture(root, undefined)).toThrow(/unsafe path/);
    const two = mkdtempSync(join(tmpdir(), "sodar-two-"));
    mkdirSync(join(two, "a"));
    mkdirSync(join(two, "b"));
    writeFileSync(join(two, "a", "frames.json"), "{}");
    writeFileSync(join(two, "b", "frames.json"), "{}");
    expect(() => loadLiveFixture(two, undefined)).toThrow(/Several exports/);
  });
});
