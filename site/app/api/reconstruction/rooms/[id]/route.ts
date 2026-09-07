import { NextRequest } from "next/server";
import { apiFailure, authenticated } from "@/lib/supabase/server";
import { reconstructionService } from "@/lib/reconstruction";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Everything the results screen needs for one room: jobs, artifacts (short-lived URLs), combined status. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request);
    traceId = auth.traceId;
    const { id } = await params;
    const view = await reconstructionService(auth.admin).roomView(auth.userId, id);
    return Response.json({ ...view, traceId }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error, traceId);
  }
}
