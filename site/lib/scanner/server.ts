import { ApiError } from "../supabase/server";
import type { FrameMetadata } from "./contracts";

export const LIMITS = { maxFrameBytes: 25 * 1024 * 1024, maxFramesPerRoom: 240, signedUrlSeconds: 600 } as const;
export function validateFrame(metadata: FrameMetadata, size: number) {
  if (metadata.mimeType !== "image/jpeg") throw new ApiError(415, "invalid_file_type", "Only JPEG camera frames are accepted.");
  if (!Number.isInteger(size) || size < 1024 || size > LIMITS.maxFrameBytes) throw new ApiError(413, "invalid_file_size", "Each frame must be between 1 KB and 25 MB.");
  if (!Number.isInteger(metadata.checkpoint.index) || metadata.checkpoint.index < 0 || metadata.checkpoint.index >= LIMITS.maxFramesPerRoom) throw new ApiError(422, "invalid_checkpoint", "The frame checkpoint is outside the capture plan.");
  if (metadata.width < 320 || metadata.height < 320 || metadata.width > 16384 || metadata.height > 16384) throw new ApiError(422, "invalid_dimensions", "The camera frame dimensions are unsupported.");
}

export type ReadyRoom = { id: string; name: string; panoramaUrl: string; ordinal: number };
export function buildTourManifest(scanId: string, rooms: ReadyRoom[]) {
  if (rooms.length < 2) return null;
  const selected = [...rooms].sort((a, b) => a.ordinal - b.ordinal);
  return { schema_version: "tour.v0", scanId, startNodeId: selected[0].id, provisionalLinks: true, nodes: selected.map((room, i) => ({ id: room.id, name: room.name, panorama: room.panoramaUrl, links: [{ nodeId: selected[(i + 1) % selected.length].id, position: { yaw: `${i ? 180 : 0}deg`, pitch: "0deg" }, label: selected[(i + 1) % selected.length].name, provisional: true }] })) };
}
