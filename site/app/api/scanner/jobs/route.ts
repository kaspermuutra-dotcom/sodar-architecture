import { NextRequest } from "next/server";
import { apiFailure, authenticated, ApiError } from "@/lib/supabase/server";
export async function POST(request: NextRequest) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request); traceId = auth.traceId;
    const body = await request.json();
    if (body.stage !== "stitch") throw new ApiError(403, "cleansing_disabled", "Image cleansing is not enabled. Original panoramas remain preserved.");
    const { data: room } = await auth.admin.from("rooms").select("*").eq("id", body.roomId).eq("scan_id", body.sessionId).eq("owner_id", auth.userId).maybeSingle();
    if (!room) throw new ApiError(404, "room_not_found", "The room was not found.");
    const { count } = await auth.admin.from("capture_frames").select("id", { count: "exact", head: true }).eq("room_id", room.id).not("confirmed_at", "is", null);
    if ((count ?? 0) < 2) throw new ApiError(422, "insufficient_frames", "Upload at least two confirmed frames before stitching.");
    const idempotencyKey = `stitch:${room.id}:v1`;
    await auth.admin.from("processing_jobs").upsert({ scan_id: room.scan_id, room_id: room.id, owner_id: auth.userId, stage: "stitch", idempotency_key: idempotencyKey, trace_id: traceId }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    await auth.admin.from("processing_jobs").update({ status: "queued", available_at: new Date().toISOString(), failure_code: null, failure_message: null }).eq("idempotency_key", idempotencyKey).eq("status", "failed").lt("attempts", 3);
    await auth.admin.from("rooms").update({ status: "queued", frame_count: count }).eq("id", room.id).in("status", ["capturing", "failed"]);
    const { data: job } = await auth.admin.from("processing_jobs").select("*").eq("idempotency_key", idempotencyKey).single();
    return Response.json({ id: job.id, roomId: job.room_id, stage: job.stage, status: job.status, traceId });
  } catch (error) { return apiFailure(error, traceId); }
}
