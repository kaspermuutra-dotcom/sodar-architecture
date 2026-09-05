import { NextRequest } from "next/server";
import { apiFailure, authenticated, ApiError } from "@/lib/supabase/server";
export async function POST(request: NextRequest) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request); traceId = auth.traceId;
    const { scanId } = await request.json() as { scanId?: string };
    if (!scanId) throw new ApiError(400, "scan_required", "A scan ID is required.");
    const { error } = await auth.admin.from("scans").upsert({ id: scanId, owner_id: auth.userId, trace_id: traceId }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new ApiError(409, "scan_create_failed", "The scan could not be created.");
    const { data } = await auth.admin.from("scans").select("*").eq("id", scanId).eq("owner_id", auth.userId).maybeSingle();
    if (!data) throw new ApiError(409, "scan_id_conflict", "That scan ID belongs to another account.");
    return Response.json({ scan: data, traceId });
  } catch (error) { return apiFailure(error, traceId); }
}
