import { NextRequest } from "next/server";
import { apiFailure, authenticated, ApiError } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Direct KIRI job creation from browser-supplied images is intentionally
 * disabled: it bypassed scan ownership, the consent sheet, balance checks,
 * daily limits and idempotency, so a refresh could pay twice. Rooms are
 * reconstructed through POST /api/reconstruction/jobs, which reads the
 * confirmed originals from private storage.
 */
export async function POST(request: NextRequest) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request);
    traceId = auth.traceId;
    throw new ApiError(410, "use_reconstruction_jobs", "Start 3D processing from the room's results screen.");
  } catch (error) {
    return apiFailure(error, traceId);
  }
}
