import { NextRequest } from "next/server";
import { apiFailure, authenticated, ApiError } from "@/lib/supabase/server";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request); traceId = auth.traceId; const { id } = await params;
    const { data } = await auth.admin.from("scans").select("*, rooms(*, processing_jobs(*))").eq("id", id).eq("owner_id", auth.userId).maybeSingle();
    if (!data) throw new ApiError(404, "scan_not_found", "The scan was not found.");
    return Response.json({ scan: data, traceId });
  } catch (error) { return apiFailure(error, traceId); }
}
