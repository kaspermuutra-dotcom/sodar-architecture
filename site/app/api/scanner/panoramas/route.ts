import { NextRequest } from "next/server";
import { apiFailure, authenticated, ApiError } from "@/lib/supabase/server";
import { LIMITS, sniffImage } from "@/lib/scanner/server";
import { sha256Hex } from "@/lib/server/hash";
import { RECONSTRUCTION_BUCKET, SupabaseJobStore } from "@/lib/reconstruction/store";
import { PROCESSING_VERSION } from "@/lib/reconstruction/service";
import type { ArtifactType, Provenance } from "@/lib/reconstruction/contract";

export const runtime = "nodejs";
export const maxDuration = 60;

const KINDS: Record<string, { type: ArtifactType; provenance: Provenance; provider: "sodar" | "openai"; mime: "image/jpeg" | "image/png"; file: string }> = {
  stitched_original: { type: "panorama_stitched_original", provenance: "captured", provider: "sodar", mime: "image/jpeg", file: "panorama-original.jpg" },
  coverage_mask: { type: "coverage_mask", provenance: "derived", provider: "sodar", mime: "image/png", file: "coverage-mask.png" },
  ai_completed: { type: "panorama_ai_completed", provenance: "mixed", provider: "openai", mime: "image/jpeg", file: "panorama-ai-completed.jpg" },
};

/**
 * Stores the on-device panorama outputs as artifacts with provenance: the
 * stitched original (captured pixels only), its coverage mask, and, if the
 * person chose it, the GPT Image 2 completion as a separate derivative that
 * references the original. Immutable: a second upload of the same kind for
 * the same room is a no-op that returns the existing artifact.
 */
export async function POST(request: NextRequest) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request);
    traceId = auth.traceId;
    if (Number(request.headers.get("content-length") ?? 0) > LIMITS.maxPanoramaBytes + 64 * 1024) throw new ApiError(413, "too_large", "The panorama is too large.");
    const form = await request.formData().catch(() => null);
    if (!form) throw new ApiError(400, "bad_request", "A multipart form is expected.");
    const scanId = String(form.get("scanId") ?? "");
    const roomId = String(form.get("roomId") ?? "");
    const kind = KINDS[String(form.get("kind") ?? "")];
    const file = form.get("file");
    if (!/^[0-9a-f-]{36}$/i.test(scanId) || !/^[0-9a-f-]{36}$/i.test(roomId) || !kind || !(file instanceof Blob)) throw new ApiError(400, "invalid_request", "Scan, room, kind and file are required.");
    if (file.size < 512 || file.size > LIMITS.maxPanoramaBytes) throw new ApiError(413, "invalid_file_size", "The panorama size is not accepted.");
    const store = new SupabaseJobStore(auth.admin);
    const room = await store.getRoom(roomId, auth.userId);
    if (!room || room.scanId !== scanId) throw new ApiError(404, "room_not_found", "The room was not found.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (sniffImage(bytes) !== kind.mime) throw new ApiError(415, "invalid_file_type", "The uploaded file is not the expected image type.");
    const width = Number(form.get("width")), height = Number(form.get("height")), coverage = Number(form.get("coverage"));
    if (!Number.isInteger(width) || !Number.isInteger(height) || width !== height * 2 || width < 512 || width > 16384) throw new ApiError(422, "invalid_dimensions", "Panoramas must be 2:1 equirectangular.");
    const objectPath = `${auth.userId}/${scanId}/${roomId}/sodar/${kind.file}`;
    await store.putObject(RECONSTRUCTION_BUCKET, objectPath, bytes, kind.mime);
    const sources = kind.type === "panorama_ai_completed" ? (await store.listArtifacts({ roomId, ownerId: auth.userId })).filter((a) => a.type === "panorama_stitched_original" || a.type === "coverage_mask").map((a) => a.id) : [];
    const artifact = await store.insertArtifact({ jobId: null, scanId, roomId, ownerId: auth.userId, provider: kind.provider, type: kind.type, bucket: RECONSTRUCTION_BUCKET, objectPath, mimeType: kind.mime, byteSize: bytes.byteLength, sha256: sha256Hex(bytes), sourceArtifactIds: sources, providerJobId: null, processingVersion: PROCESSING_VERSION, provenance: kind.provenance, aiGenerated: kind.provenance === "mixed", retention: "retained", metadata: { width, height, coverage: Number.isFinite(coverage) ? Math.max(0, Math.min(1, coverage)) : null, source: "on_device_webgl" } });
    console.info(JSON.stringify({ level: "info", event: "panorama_stored", traceId, scanId, roomId, kind: kind.type, byteSize: bytes.byteLength }));
    return Response.json({ artifactId: artifact.id, traceId });
  } catch (error) {
    return apiFailure(error, traceId);
  }
}
