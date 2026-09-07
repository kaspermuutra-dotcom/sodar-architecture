import { NextRequest } from "next/server";
import { apiFailure, authenticated, ApiError } from "@/lib/supabase/server";
import { SupabaseJobStore } from "@/lib/reconstruction/store";
import { buildTour, mergeLinks, provisionalLinks, validateTour, type LinkInput } from "@/lib/scanner/tour";

export const runtime = "nodejs";
const SIGNED_SECONDS = 600;

/**
 * Multi-room tour manifest (tour.v1) from stored artifacts: captured
 * panoramas by default, the AI-completed version exposed separately so the
 * viewer can label it, splats where a reconstruction finished, confirmed
 * doorway links over provisional ones.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request);
    traceId = auth.traceId;
    const { id } = await params;
    const { data: scan } = await auth.admin.from("scans").select("id,property_name").eq("id", id).eq("owner_id", auth.userId).is("deleted_at", null).maybeSingle();
    if (!scan) throw new ApiError(404, "scan_not_found", "The scan was not found.");
    const { data: rooms } = await auth.admin.from("rooms").select("id,name,ordinal,floor_label").eq("scan_id", id).eq("owner_id", auth.userId).order("ordinal");
    const store = new SupabaseJobStore(auth.admin);
    const artifacts = await store.listArtifacts({ scanId: id, ownerId: auth.userId });
    const sign = (bucket: string, path: string) => store.signUrl(bucket, path, SIGNED_SECONDS).catch(() => null);
    const nodes = [] as Array<{ id: string; name: string; ordinal: number; floor?: string; panorama: string; panoramaAi?: string | null; panoramaProvenance: "captured" | "mixed"; splat?: { url: string; format: "ply" | "splat" | "spz" | "zip"; provider: "kiri" | "marble"; provenance: "captured" | "ai_generated" } | null; generativeWorld?: boolean }>;
    for (const room of rooms ?? []) {
      const mine = artifacts.filter((artifact) => artifact.roomId === room.id);
      const original = mine.find((artifact) => artifact.type === "panorama_stitched_original");
      if (!original) continue;
      const originalUrl = await sign(original.bucket, original.objectPath);
      if (!originalUrl) continue;
      const ai = mine.find((artifact) => artifact.type === "panorama_ai_completed");
      const splatArtifact = mine.find((artifact) => artifact.type === "kiri_gaussian_splat" && /\.(ply|splat)$/i.test(artifact.objectPath)) ?? mine.find((artifact) => artifact.type === "marble_gaussian_splat" && /\.spz$/i.test(artifact.objectPath) && artifact.metadata.variant !== "500k") ?? mine.find((artifact) => artifact.type === "marble_gaussian_splat" && /\.spz$/i.test(artifact.objectPath));
      const splatUrl = splatArtifact ? await sign(splatArtifact.bucket, splatArtifact.objectPath) : null;
      nodes.push({
        id: room.id, name: room.name, ordinal: room.ordinal, floor: room.floor_label ?? undefined, panorama: originalUrl, panoramaAi: ai ? await sign(ai.bucket, ai.objectPath) : null, panoramaProvenance: "captured",
        splat: splatArtifact && splatUrl ? { url: splatUrl, format: /\.splat$/i.test(splatArtifact.objectPath) ? "splat" : /\.spz$/i.test(splatArtifact.objectPath) ? "spz" : "ply", provider: splatArtifact.provider === "marble" ? "marble" : "kiri", provenance: splatArtifact.provider === "marble" ? "ai_generated" : "captured" } : null,
        generativeWorld: mine.some((artifact) => artifact.provider === "marble"),
      });
    }
    const { data: linkRows } = await auth.admin.from("room_links").select("*").eq("scan_id", id).eq("owner_id", auth.userId);
    const confirmed: LinkInput[] = (linkRows ?? []).filter((row) => row.confirmed).map((row) => ({ fromRoomId: row.from_room_id, toRoomId: row.to_room_id, yaw: row.yaw_deg, pitch: row.pitch_deg, label: row.label ?? undefined, confirmed: true, reverseYaw: row.reverse_yaw_deg ?? undefined }));
    const tour = buildTour({ scanId: id, propertyName: scan.property_name ?? undefined, rooms: nodes, links: mergeLinks(provisionalLinks(nodes.map((node) => node.id)), confirmed) });
    if (!tour) return Response.json({ ready: false, readyRooms: 0, tour: null, traceId });
    const problems = validateTour(tour);
    return Response.json({ ready: tour.nodes.length >= 1, readyRooms: tour.nodes.length, tour, aiPanoramas: Object.fromEntries(nodes.filter((node) => node.panoramaAi).map((node) => [node.id, node.panoramaAi])), problems, expiresIn: SIGNED_SECONDS, traceId }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error, traceId);
  }
}
