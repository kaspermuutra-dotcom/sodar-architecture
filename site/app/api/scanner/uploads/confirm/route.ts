import { NextRequest } from "next/server";
import { apiFailure, authenticated, ApiError } from "@/lib/supabase/server";
export async function POST(request: NextRequest) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request); traceId = auth.traceId;
    const { frameId } = await request.json() as { frameId?: string };
    if (!frameId) throw new ApiError(400, "frame_required", "A frame ID is required.");
    const { data: frame } = await auth.admin.from("capture_frames").select("*").eq("id", frameId).eq("owner_id", auth.userId).maybeSingle();
    if (!frame) throw new ApiError(404, "frame_not_found", "This frame does not belong to the current user.");
    if (frame.confirmed_at) return Response.json({ uploadId: frameId, frameId, privateObjectKey: frame.object_path, completedAt: frame.confirmed_at, traceId });
    const prefix = frame.object_path.split("/").slice(0, -1).join("/");
    const { data: objects, error: listError } = await auth.admin.storage.from("capture-originals").list(prefix, { search: `${frameId}.jpg`, limit: 1 });
    const object = objects?.find((item) => item.name === `${frameId}.jpg`);
    if (listError || !object) throw new ApiError(409, "upload_incomplete", "The frame has not reached private storage yet.");
    if (Number(object.metadata?.size ?? 0) !== Number(frame.byte_size)) throw new ApiError(422, "upload_size_mismatch", "The uploaded frame size does not match the capture.");
    const now = new Date().toISOString();
    await auth.admin.from("capture_frames").update({ confirmed_at: now }).eq("id", frameId).is("confirmed_at", null);
    await auth.admin.from("resumable_uploads").update({ state: "confirmed", confirmed_at: now, updated_at: now }).eq("frame_id", frameId);
    console.info(JSON.stringify({ level: "info", event: "frame_confirmed", traceId, scanId: frame.scan_id, roomId: frame.room_id, frameId }));
    return Response.json({ uploadId: frameId, frameId, privateObjectKey: frame.object_path, completedAt: now, traceId });
  } catch (error) { return apiFailure(error, traceId); }
}
