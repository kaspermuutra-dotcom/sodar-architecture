import { NextRequest } from "next/server";
import { apiFailure, authenticated, ApiError } from "@/lib/supabase/server";
export async function POST(request: NextRequest) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request); traceId = auth.traceId;
    const { scanId, roomId, name, ordinal, targetCount = 0 } = await request.json();
    if (!scanId || !roomId || !name || !Number.isInteger(ordinal)) throw new ApiError(400, "invalid_room", "Scan, room, name, and ordinal are required.");
    const { data: scan } = await auth.admin.from("scans").select("id").eq("id", scanId).eq("owner_id", auth.userId).maybeSingle();
    if (!scan) throw new ApiError(404, "scan_not_found", "The scan was not found.");
    const { error } = await auth.admin.from("rooms").upsert({ id: roomId, scan_id: scanId, owner_id: auth.userId, name, ordinal, target_count: targetCount, trace_id: traceId }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new ApiError(409, "room_create_failed", "This room ID or room position is already in use.");
    const { data } = await auth.admin.from("rooms").select("*").eq("id", roomId).eq("owner_id", auth.userId).single();
    return Response.json({ room: data, traceId });
  } catch (error) { return apiFailure(error, traceId); }
}
