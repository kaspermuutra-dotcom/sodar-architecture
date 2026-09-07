import { NextRequest } from "next/server";
import { apiFailure, authenticated, ApiError } from "@/lib/supabase/server";
import { reconstructionService } from "@/lib/reconstruction";
import { publicJob } from "@/lib/reconstruction/service";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Refreshes one job (polls the provider only when due) and returns its public state. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request);
    traceId = auth.traceId;
    const { id } = await params;
    const service = reconstructionService(auth.admin);
    const job = await service.refresh(id);
    if (job.ownerId !== auth.userId) throw new ApiError(404, "job_not_found", "The processing job was not found.");
    return Response.json({ job: publicJob(job), traceId });
  } catch (error) {
    return apiFailure(error, traceId);
  }
}
