import { NextRequest } from "next/server";
import { apiFailure, authenticated, ApiError } from "@/lib/supabase/server";
import type { TourLinkRecord } from "@/lib/scanner/contracts";

export const runtime = "nodejs";
const UUID = /^[0-9a-f-]{36}$/i;

async function ownedScan(auth: Awaited<ReturnType<typeof authenticated>>, id: string) {
  const { data: scan } = await auth.admin.from("scans").select("id").eq("id", id).eq("owner_id", auth.userId).maybeSingle();
  if (!scan) throw new ApiError(404, "scan_not_found", "The scan was not found.");
}

const toRecord = (row: Record<string, unknown>): TourLinkRecord => ({ fromRoomId: String(row.from_room_id), toRoomId: String(row.to_room_id), yaw: Number(row.yaw_deg), pitch: Number(row.pitch_deg), label: (row.label as string | null) ?? undefined, confirmed: Boolean(row.confirmed), reverseYaw: row.reverse_yaw_deg == null ? undefined : Number(row.reverse_yaw_deg) });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request);
    traceId = auth.traceId;
    const { id } = await params;
    await ownedScan(auth, id);
    const { data } = await auth.admin.from("room_links").select("*").eq("scan_id", id).eq("owner_id", auth.userId);
    return Response.json({ links: (data ?? []).map(toRecord), traceId });
  } catch (error) {
    return apiFailure(error, traceId);
  }
}

/** Replaces the confirmed doorway links for a scan. Provisional links are never written by the browser. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request);
    traceId = auth.traceId;
    const { id } = await params;
    await ownedScan(auth, id);
    const body = (await request.json().catch(() => ({}))) as { links?: unknown };
    const input = Array.isArray(body.links) ? body.links.slice(0, 200) : [];
    const { data: rooms } = await auth.admin.from("rooms").select("id,name").eq("scan_id", id).eq("owner_id", auth.userId);
    const roomIds = new Set((rooms ?? []).map((room) => room.id));
    const rows = [] as Array<Record<string, unknown>>;
    for (const link of input) {
      if (!link || typeof link !== "object") continue;
      const { fromRoomId, toRoomId, yaw, pitch, label, reverseYaw } = link as Record<string, unknown>;
      if (typeof fromRoomId !== "string" || typeof toRoomId !== "string" || !UUID.test(fromRoomId) || !UUID.test(toRoomId) || fromRoomId === toRoomId) continue;
      if (!roomIds.has(fromRoomId) || !roomIds.has(toRoomId)) throw new ApiError(422, "invalid_link", "Links must connect rooms of this scan.");
      if (typeof yaw !== "number" || !Number.isFinite(yaw) || typeof pitch !== "number" || !Number.isFinite(pitch) || Math.abs(pitch) > 89) throw new ApiError(422, "invalid_link", "Link angles are invalid.");
      rows.push({ scan_id: id, owner_id: auth.userId, from_room_id: fromRoomId, to_room_id: toRoomId, yaw_deg: ((yaw % 360) + 360) % 360, pitch_deg: pitch, label: typeof label === "string" ? label.slice(0, 80) : null, confirmed: true, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString(), provisional: false, reverse_yaw_deg: typeof reverseYaw === "number" && Number.isFinite(reverseYaw) ? ((reverseYaw % 360) + 360) % 360 : null });
    }
    await auth.admin.from("room_links").delete().eq("scan_id", id).eq("owner_id", auth.userId).eq("confirmed", true);
    if (rows.length) {
      const { error } = await auth.admin.from("room_links").upsert(rows, { onConflict: "from_room_id,to_room_id" });
      if (error) throw new ApiError(409, "links_not_saved", "The doorway links could not be saved.");
    }
    const { data } = await auth.admin.from("room_links").select("*").eq("scan_id", id).eq("owner_id", auth.userId);
    console.info(JSON.stringify({ level: "info", event: "tour_links_saved", traceId, scanId: id, confirmed: rows.length }));
    return Response.json({ links: (data ?? []).map(toRecord), traceId });
  } catch (error) {
    return apiFailure(error, traceId);
  }
}
