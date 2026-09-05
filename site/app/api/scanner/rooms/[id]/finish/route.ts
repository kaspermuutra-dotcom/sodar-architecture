import { NextRequest } from "next/server";
import { apiFailure, authenticated, ApiError } from "@/lib/supabase/server";
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request); traceId = auth.traceId; const { id } = await params;
    const { data: room } = await auth.admin.from("rooms").select("*").eq("id", id).eq("owner_id", auth.userId).maybeSingle();
    if (!room) throw new ApiError(404, "room_not_found", "The room was not found.");
    const { count } = await auth.admin.from("capture_frames").select("id", { count: "exact", head: true }).eq("room_id", id).not("confirmed_at", "is", null);
    if ((count ?? 0) < 2) throw new ApiError(422, "insufficient_frames", "Upload at least two confirmed overlapping frames before finishing this room.");
    const key = `stitch:${id}:v1`;
    await auth.admin.from("processing_jobs").upsert({ scan_id: room.scan_id, room_id: id, owner_id: auth.userId, stage: "stitch", idempotency_key: key, trace_id: traceId }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    await auth.admin.from("processing_jobs").update({ status: "queued", available_at: new Date().toISOString(), failure_code: null, failure_message: null }).eq("idempotency_key", key).eq("status", "failed").lt("attempts", 3);
    await auth.admin.from("rooms").update({ status: "queued", frame_count: count, failure_code: null, failure_message: null }).eq("id", id).in("status", ["capturing", "failed"]);
    await auth.admin.from("scans").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", room.scan_id);
    const { data: job } = await auth.admin.from("processing_jobs").select("*").eq("idempotency_key", key).single();
    console.info(JSON.stringify({ level: "info", event: "room_queued", traceId, scanId: room.scan_id, roomId: id, jobId: job.id }));
    return Response.json({ job, traceId });
  } catch (error) { return apiFailure(error, traceId); }
}
