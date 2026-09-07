import { NextRequest } from "next/server";
import { apiFailure, authenticated, ApiError } from "@/lib/supabase/server";
import { reconstructionService } from "@/lib/reconstruction";
import { publicJob } from "@/lib/reconstruction/service";
import { isProviderId, type ProviderId } from "@/lib/reconstruction/contract";
import { providersForMode } from "@/lib/reconstruction/config";

export const runtime = "nodejs";
// Uploading up to 300 originals to a provider from a function can take minutes.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Starts reconstruction for one room. Idempotent: the same room + inputs +
 * provider returns the existing job. Requires explicit consent flags in the
 * body; the browser shows the consent sheet before calling this.
 */
export async function POST(request: NextRequest) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request);
    traceId = auth.traceId;
    const body = (await request.json().catch(() => ({}))) as { scanId?: unknown; roomId?: unknown; providers?: unknown; wantMesh?: unknown; consent?: { aiProcessing?: unknown; paid?: unknown } };
    if (typeof body.scanId !== "string" || !UUID.test(body.scanId) || typeof body.roomId !== "string" || !UUID.test(body.roomId)) throw new ApiError(400, "invalid_request", "Scan and room are required.");
    const requested = Array.isArray(body.providers) ? body.providers.filter(isProviderId) : undefined;
    const providers: ProviderId[] = providersForMode(requested);
    if (!providers.length) throw new ApiError(503, "no_provider_available", "3D processing is not available right now. Your photos are saved.");
    const result = await reconstructionService(auth.admin).createJobs({
      ownerId: auth.userId,
      scanId: body.scanId,
      roomId: body.roomId,
      providers,
      wantMesh: body.wantMesh === true,
      consent: { aiProcessing: body.consent?.aiProcessing === true, paid: body.consent?.paid === true },
      traceId: auth.traceId,
    });
    return Response.json({ jobs: result.jobs.map(publicJob), skipped: result.skipped, traceId }, { status: 202 });
  } catch (error) {
    return apiFailure(error, traceId);
  }
}
