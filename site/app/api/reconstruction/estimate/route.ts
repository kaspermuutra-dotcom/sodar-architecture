import { NextRequest } from "next/server";
import { apiFailure, authenticated, ApiError } from "@/lib/supabase/server";
import { reconstructionService } from "@/lib/reconstruction";
import { isProviderId, type ProviderId } from "@/lib/reconstruction/contract";
import { reconstructionConfig } from "@/lib/reconstruction/config";

export const runtime = "nodejs";

/** What the consent sheet shows before any paid job: provider availability, balance state, expected credits, limits. */
export async function POST(request: NextRequest) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request);
    traceId = auth.traceId;
    const body = (await request.json().catch(() => ({}))) as { roomId?: unknown; providers?: unknown };
    if (typeof body.roomId !== "string") throw new ApiError(400, "room_required", "A room is required.");
    const providers = Array.isArray(body.providers) ? body.providers.filter(isProviderId) : (["kiri", "marble"] as ProviderId[]);
    const estimate = await reconstructionService(auth.admin).estimate(auth.userId, body.roomId, providers);
    const config = reconstructionConfig();
    // Balances are operator information; the browser only learns whether a provider is usable.
    return Response.json({ ...estimate, providers: estimate.providers.map(({ balance: _balance, ...rest }) => rest), mode: config.mode, traceId });
  } catch (error) {
    return apiFailure(error, traceId);
  }
}
