import { ApiError } from "../supabase/server";
import type { FrameMetadata } from "./contracts";

export const LIMITS = { maxFrameBytes: 25 * 1024 * 1024, maxFramesPerRoom: 300, signedUrlSeconds: 600, maxPanoramaBytes: 40 * 1024 * 1024 } as const;

export function validateFrame(metadata: FrameMetadata, size: number) {
  if (metadata.mimeType !== "image/jpeg") throw new ApiError(415, "invalid_file_type", "Only JPEG camera frames are accepted.");
  if (!Number.isInteger(size) || size < 1024 || size > LIMITS.maxFrameBytes) throw new ApiError(413, "invalid_file_size", "Each frame must be between 1 KB and 25 MB.");
  if (!Number.isInteger(metadata.checkpoint.index) || metadata.checkpoint.index < 0 || metadata.checkpoint.index >= LIMITS.maxFramesPerRoom) throw new ApiError(422, "invalid_checkpoint", "The frame checkpoint is outside the capture plan.");
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height) || metadata.width < 320 || metadata.height < 320 || metadata.width > 16384 || metadata.height > 16384) throw new ApiError(422, "invalid_dimensions", "The camera frame dimensions are unsupported.");
  for (const [key, value] of [["yaw", metadata.yaw], ["pitch", metadata.pitch], ["roll", metadata.roll]] as const) if (typeof value !== "number" || !Number.isFinite(value)) throw new ApiError(422, "invalid_orientation", `The frame orientation (${key}) is invalid.`);
  if (Math.abs(metadata.pitch) > 90 || Math.abs(metadata.roll) > 180 || Math.abs(metadata.yaw) > 360) throw new ApiError(422, "invalid_orientation", "The frame orientation is out of range.");
  if (!metadata.fov || metadata.fov.horizontal < 1 || metadata.fov.horizontal > 179 || metadata.fov.vertical < 1 || metadata.fov.vertical > 179) throw new ApiError(422, "invalid_fov", "The frame field of view is invalid.");
  if (metadata.captureMode !== undefined && metadata.captureMode !== "quick" && metadata.captureMode !== "full3d") throw new ApiError(422, "invalid_capture_mode", "Unknown capture mode.");
  if (metadata.qualityScore !== undefined && (typeof metadata.qualityScore !== "number" || metadata.qualityScore < 0 || metadata.qualityScore > 1)) throw new ApiError(422, "invalid_quality", "Invalid quality score.");
  if (!Number.isFinite(Date.parse(metadata.timestamp))) throw new ApiError(422, "invalid_timestamp", "The capture time is invalid.");
}

/** File names for artifacts must be plain: no paths, no control characters, bounded length. */
export function sanitizeFilename(name: string, fallback = "file"): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80);
  return clean || fallback;
}

/** Decoded-image sanity check without a decoder: JPEG and PNG magic numbers. */
export function sniffImage(bytes: Uint8Array): "image/jpeg" | "image/png" | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  return null;
}

export type ReadyRoom = { id: string; name: string; panoramaUrl: string; ordinal: number };
/** Legacy two-room preview manifest (tour.v0), kept for the Python worker path. */
export function buildTourManifest(scanId: string, rooms: ReadyRoom[]) {
  if (rooms.length < 2) return null;
  const selected = [...rooms].sort((a, b) => a.ordinal - b.ordinal);
  return { schema_version: "tour.v0", scanId, startNodeId: selected[0].id, provisionalLinks: true, nodes: selected.map((room, i) => ({ id: room.id, name: room.name, panorama: room.panoramaUrl, links: [{ nodeId: selected[(i + 1) % selected.length].id, position: { yaw: `${i ? 180 : 0}deg`, pitch: "0deg" }, label: selected[(i + 1) % selected.length].name, provisional: true }] })) };
}
