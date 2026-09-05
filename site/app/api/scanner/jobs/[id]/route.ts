import { NextRequest } from "next/server";
import { apiFailure, authenticated, ApiError } from "@/lib/supabase/server";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request); traceId = auth.traceId; const { id } = await params;
    const { data: job } = await auth.admin.from("processing_jobs").select("*").eq("id", id).eq("owner_id", auth.userId).maybeSingle();
    if (!job) throw new ApiError(404, "job_not_found", "The processing job was not found.");
    return Response.json({ id: job.id, roomId: job.room_id, stage: job.stage, status: job.status, error: job.failure_message, traceId });
  } catch (error) { return apiFailure(error, traceId); }
}
