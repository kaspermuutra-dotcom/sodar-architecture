import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredFrame } from "./db";
import { BackendError, type ScannerBackend, type UploadReceipt, type UploadTicket } from "./contracts";

const frames = new Map<string, StoredFrame>();
vi.mock("./db", () => ({
  roomFrames: async (roomId: string) => [...frames.values()].filter((f) => f.metadata.roomId === roomId).sort((a, b) => a.metadata.checkpoint.index - b.metadata.checkpoint.index),
  updateFrameUpload: async (frame: StoredFrame, upload: StoredFrame["upload"]) => {
    frames.set(frame.id, { ...frame, upload });
  },
}));

const { uploadRoom } = await import("./upload");

function frame(i: number, upload?: StoredFrame["upload"]): StoredFrame {
  return { id: `f${i}`, jpeg: new Blob([new Uint8Array(4096)], { type: "image/jpeg" }), upload, metadata: { id: `f${i}`, roomId: "room", sessionId: "scan", yaw: 0, pitch: 0, roll: 0, fov: { horizontal: 55, vertical: 72 }, timestamp: new Date().toISOString(), checkpoint: { index: i, ring: 0, yaw: 0, pitch: 0, elevation: 0 }, width: 4032, height: 3024, mimeType: "image/jpeg" } };
}
const ticket = (id: string, offset = 0): UploadTicket => ({ uploadId: `u-${id}`, frameId: id, privateObjectKey: `o/${id}.jpg`, uploadUrl: "https://s/x", uploadToken: "tok", offset, expiresAt: new Date(Date.now() + 600_000).toISOString() });
const receipt = (id: string): UploadReceipt => ({ uploadId: `u-${id}`, frameId: id, privateObjectKey: `o/${id}.jpg`, completedAt: new Date().toISOString() });

function backend(overrides: Partial<ScannerBackend> = {}): ScannerBackend & { begun: string[]; parts: string[] } {
  const b = {
    begun: [] as string[],
    parts: [] as string[],
    beginUpload: async (metadata: { id: string }) => {
      b.begun.push(metadata.id);
      return ticket(metadata.id);
    },
    uploadPart: async (t: UploadTicket) => {
      b.parts.push(t.frameId);
      return receipt(t.frameId);
    },
    ...overrides,
  } as unknown as ScannerBackend & { begun: string[]; parts: string[] };
  return b;
}

beforeEach(() => frames.clear());

describe("resumable room upload", () => {
  it("skips confirmed frames, reuses live tickets, and returns keys in checkpoint order", async () => {
    frames.set("f0", frame(0, receipt("f0")));
    frames.set("f1", frame(1, ticket("f1")));
    frames.set("f2", frame(2));
    const b = backend();
    const result = await uploadRoom("room", { backend: b, sleep: async () => undefined });
    expect(result.keys).toEqual(["o/f0.jpg", "o/f1.jpg", "o/f2.jpg"]);
    expect(b.begun).toEqual(["f2"]); // f1 already had a ticket
    expect(b.parts.sort()).toEqual(["f1", "f2"]);
    expect(result.progress).toMatchObject({ total: 3, done: 3, failed: 0 });
    expect(frames.get("f2")?.upload && "completedAt" in frames.get("f2")!.upload!).toBe(true);
  });

  it("recovers from a transient failure with a fresh grant for the same frame id (never a second object)", async () => {
    frames.set("f0", frame(0));
    let attempts = 0;
    const b = backend({
      uploadPart: async (t: UploadTicket) => {
        attempts++;
        if (attempts === 1) throw new BackendError(409, "upload_incomplete", "not yet", false);
        return receipt(t.frameId);
      },
    });
    const result = await uploadRoom("room", { backend: b, sleep: async () => undefined });
    expect(result.keys).toEqual(["o/f0.jpg"]);
    expect(b.begun).toEqual(["f0", "f0"]);
    expect(attempts).toBe(2);
  });

  it("gives up on a frame after the attempt budget but finishes the others", async () => {
    frames.set("f0", frame(0));
    frames.set("f1", frame(1));
    const b = backend({
      uploadPart: async (t: UploadTicket) => {
        if (t.frameId === "f0") throw new BackendError(503, "upload_failed", "down", true);
        return receipt(t.frameId);
      },
    });
    const result = await uploadRoom("room", { backend: b, attempts: 2, sleep: async () => undefined });
    expect(result.failed).toEqual(["f0"]);
    expect(result.keys).toEqual(["o/f1.jpg"]);
    expect(result.progress.failed).toBe(1);
    expect(frames.get("f0")?.upload && "completedAt" in frames.get("f0")!.upload!).toBeFalsy();
  });

  it("stops immediately when the session is gone so the person can sign in again", async () => {
    frames.set("f0", frame(0));
    const b = backend({ beginUpload: async () => { throw new BackendError(401, "authentication_required", "sign in", false); } });
    await expect(uploadRoom("room", { backend: b, sleep: async () => undefined })).rejects.toMatchObject({ code: "authentication_required" });
  });

  it("limits concurrency", async () => {
    for (let i = 0; i < 8; i++) frames.set(`f${i}`, frame(i));
    let inFlight = 0, peak = 0;
    const b = backend({
      uploadPart: async (t: UploadTicket) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return receipt(t.frameId);
      },
    });
    await uploadRoom("room", { backend: b, concurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
});
