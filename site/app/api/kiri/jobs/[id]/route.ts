import { NextRequest } from "next/server";
import { apiFailure, authenticated, ApiError } from "@/lib/supabase/server";
import { isKiriSerialize } from "@/lib/kiri/server";
import { SupabaseJobStore } from "@/lib/reconstruction/store";
import { reconstructionService } from "@/lib/reconstruction";
import { publicJob } from "@/lib/reconstruction/service";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Looks a KIRI job up by its external identifier — but only when it belongs to
 * a SODAR job owned by the caller. The provider is polled through the job
 * service (idempotent download, normalized status), never directly.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request);
    traceId = auth.traceId;
    const { id } = await params;
    if (!isKiriSerialize(id)) throw new ApiError(400, "invalid_job_id", "Invalid job identifier.");
    const jobs = (await new SupabaseJobStore(auth.admin).listJobsByExternalId("kiri", id)).filter((job) => job.ownerId === auth.userId);
    if (!jobs.length) throw new ApiError(404, "job_not_found", "The processing job was not found.");
    const job = await reconstructionService(auth.admin).refresh(jobs[0].id);
    return Response.json({ job: publicJob(job), traceId });
  } catch (error) {
    return apiFailure(error, traceId);
  }
}
