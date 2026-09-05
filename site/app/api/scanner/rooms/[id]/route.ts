import { NextRequest } from "next/server";
import { apiFailure, authenticated, ApiError } from "@/lib/supabase/server";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request); traceId = auth.traceId; const { id } = await params;
    const { data } = await auth.admin.from("rooms").select("*, processing_jobs(*)").eq("id", id).eq("owner_id", auth.userId).maybeSingle();
    if (!data) throw new ApiError(404, "room_not_found", "The room was not found.");
    return Response.json({ room: data, traceId });
  } catch (error) { return apiFailure(error, traceId); }
}
