import { NextRequest } from "next/server";
import { apiFailure, authenticated, objectPath, ApiError } from "@/lib/supabase/server";
import { LIMITS, validateFrame } from "@/lib/scanner/server";
import type { FrameMetadata } from "@/lib/scanner/contracts";

export async function POST(request: NextRequest) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request); traceId = auth.traceId;
    const { metadata, size } = await request.json() as { metadata: FrameMetadata; size: number };
    if (!metadata?.id || !metadata.roomId || !metadata.sessionId) throw new ApiError(400, "invalid_request", "Frame, room, and scan IDs are required.");
    validateFrame(metadata, size);
    const since = new Date(Date.now() - 60_000).toISOString();
    const { count } = await auth.admin.from("resumable_uploads").select("id", { count: "exact", head: true }).eq("owner_id", auth.userId).gte("created_at", since);
    if ((count ?? 0) >= 120) throw new ApiError(429, "upload_rate_limited", "Too many upload requests. Wait one minute and retry.");
    const path = objectPath(auth.userId, metadata.sessionId, metadata.roomId, metadata.id);
    const row = { id: metadata.id, owner_id: auth.userId, scan_id: metadata.sessionId, room_id: metadata.roomId, checkpoint_index: metadata.checkpoint.index, checkpoint_ring: metadata.checkpoint.ring, yaw: metadata.yaw, pitch: metadata.pitch, roll: metadata.roll, target_yaw: metadata.checkpoint.yaw, target_pitch: metadata.checkpoint.pitch, target_elevation: metadata.checkpoint.elevation, fov_horizontal: metadata.fov.horizontal, fov_vertical: metadata.fov.vertical, captured_at: metadata.timestamp, width: metadata.width, height: metadata.height, byte_size: size, mime_type: metadata.mimeType, object_path: path, trace_id: traceId };
    const { error: frameError } = await auth.admin.from("capture_frames").upsert(row, { onConflict: "id", ignoreDuplicates: true });
    if (frameError) throw new ApiError(frameError.code === "23503" ? 404 : 409, "frame_registration_failed", frameError.code === "23503" ? "The scan or room was not found." : "That checkpoint already contains a different frame.");
    const { data: registered } = await auth.admin.from("capture_frames").select("owner_id,room_id,byte_size,object_path").eq("id", metadata.id).maybeSingle();
    if (!registered || registered.owner_id !== auth.userId || registered.room_id !== metadata.roomId || Number(registered.byte_size) !== size || registered.object_path !== path) throw new ApiError(409, "frame_id_conflict", "That frame ID is already registered with different capture metadata.");
    const { data: existing } = await auth.admin.from("resumable_uploads").select("*").eq("frame_id", metadata.id).eq("owner_id", auth.userId).maybeSingle();
    if (existing?.state === "confirmed") return Response.json({ uploadId: existing.id, frameId: metadata.id, privateObjectKey: path, completedAt: existing.confirmed_at, traceId });
    const expiresAt = new Date(Date.now() + LIMITS.signedUrlSeconds * 1000).toISOString();
    const { data: signed, error: signError } = await auth.admin.storage.from("capture-originals").createSignedUploadUrl(path, { upsert: false });
    if (signError || !signed) throw new ApiError(503, "upload_grant_failed", "Could not create a private upload grant. Retry shortly.");
    const { data: upload, error: uploadError } = await auth.admin.from("resumable_uploads").upsert({ frame_id: metadata.id, owner_id: auth.userId, object_path: path, expected_bytes: size, state: "pending", expires_at: expiresAt, attempt_count: (existing?.attempt_count ?? 0) + 1 }, { onConflict: "frame_id" }).select().single();
    if (uploadError) throw uploadError;
    console.info(JSON.stringify({ level: "info", event: "frame_upload_granted", traceId, scanId: metadata.sessionId, roomId: metadata.roomId, frameId: metadata.id }));
    return Response.json({ uploadId: upload.id, frameId: metadata.id, privateObjectKey: path, uploadUrl: signed.signedUrl, uploadToken: signed.token, offset: 0, expiresAt, traceId });
  } catch (error) { return apiFailure(error, traceId); }
}
