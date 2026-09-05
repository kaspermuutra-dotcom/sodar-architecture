import { NextRequest } from "next/server";
import { apiFailure, authenticated, ApiError } from "@/lib/supabase/server";
import { buildTourManifest } from "@/lib/scanner/server";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request); traceId = auth.traceId; const { id } = await params;
    const { data: scan } = await auth.admin.from("scans").select("id").eq("id", id).eq("owner_id", auth.userId).maybeSingle();
    if (!scan) throw new ApiError(404, "scan_not_found", "The scan was not found.");
    const { data: assets } = await auth.admin.from("panorama_assets").select("room_id,object_path,rooms!inner(id,name,ordinal,status)").eq("scan_id", id).eq("owner_id", auth.userId).eq("kind", "stitched_original").eq("rooms.status", "ready").order("created_at");
    if (!assets || assets.length < 2) return Response.json({ ready: false, requiredRooms: 2, readyRooms: assets?.length ?? 0, manifest: null, traceId });
    const selected = assets.slice(0, 2);
    const signed = await Promise.all(selected.map(async (asset) => {
      const { data, error } = await auth.admin.storage.from("panorama-originals").createSignedUrl(asset.object_path, 300);
      if (error || !data) throw new ApiError(503, "preview_signing_failed", "The preview is ready but could not be opened. Retry shortly.");
      const room = Array.isArray(asset.rooms) ? asset.rooms[0] : asset.rooms;
      return { id: room.id, name: room.name, ordinal: room.ordinal, panoramaUrl: data.signedUrl };
    }));
    return Response.json({ ready: true, manifest: buildTourManifest(id, signed), expiresIn: 300, traceId });
  } catch (error) { return apiFailure(error, traceId); }
}
