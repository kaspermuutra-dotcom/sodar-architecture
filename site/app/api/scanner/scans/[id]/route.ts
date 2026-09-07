import { NextRequest } from "next/server";
import { apiFailure, authenticated, ApiError } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request); traceId = auth.traceId; const { id } = await params;
    const { data } = await auth.admin.from("scans").select("*, rooms(*, processing_jobs(*))").eq("id", id).eq("owner_id", auth.userId).maybeSingle();
    if (!data) throw new ApiError(404, "scan_not_found", "The scan was not found.");
    return Response.json({ scan: data, traceId });
  } catch (error) { return apiFailure(error, traceId); }
}

/**
 * Deletes a scan: every original frame, every panorama and every
 * reconstruction output in SODAR storage, then marks the records. Requires the
 * scan id repeated in the body as confirmation. Provider-side copies (KIRI
 * keeps models ~3 days, Marble keeps worlds in the account) are documented in
 * docs/SCANNER_ARCHITECTURE.md and are not reachable from here.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request); traceId = auth.traceId; const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { confirm?: unknown };
    if (body.confirm !== id) throw new ApiError(400, "confirmation_required", "Repeat the scan id to confirm deletion.");
    const { data: scan } = await auth.admin.from("scans").select("id").eq("id", id).eq("owner_id", auth.userId).maybeSingle();
    if (!scan) throw new ApiError(404, "scan_not_found", "The scan was not found.");
    const removeAll = async (bucket: string, paths: string[]) => {
      for (let i = 0; i < paths.length; i += 100) await auth.admin.storage.from(bucket).remove(paths.slice(i, i + 100));
    };
    const { data: frames } = await auth.admin.from("capture_frames").select("object_path").eq("scan_id", id).eq("owner_id", auth.userId);
    await removeAll("capture-originals", (frames ?? []).map((row) => row.object_path));
    const { data: legacy } = await auth.admin.from("panorama_assets").select("bucket_id,object_path").eq("scan_id", id).eq("owner_id", auth.userId);
    for (const asset of legacy ?? []) await auth.admin.storage.from(asset.bucket_id).remove([asset.object_path]);
    const { data: artifacts } = await auth.admin.from("artifacts").select("id,bucket_id,object_path").eq("scan_id", id).eq("owner_id", auth.userId).neq("retention", "deleted");
    const byBucket = new Map<string, string[]>();
    for (const artifact of artifacts ?? []) byBucket.set(artifact.bucket_id, [...(byBucket.get(artifact.bucket_id) ?? []), artifact.object_path]);
    for (const [bucket, paths] of byBucket) await removeAll(bucket, paths);
    await auth.admin.rpc("schedule_scan_deletion", { p_scan_id: id, p_owner_id: auth.userId });
    await auth.admin.from("artifacts").update({ retention: "deleted", deleted_at: new Date().toISOString() }).eq("scan_id", id).eq("owner_id", auth.userId);
    await auth.admin.from("capture_frames").delete().eq("scan_id", id).eq("owner_id", auth.userId);
    await auth.admin.from("reconstruction_jobs").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("scan_id", id).eq("owner_id", auth.userId).in("status", ["validating", "uploading", "queued", "processing", "downloading"]);
    console.info(JSON.stringify({ level: "info", event: "scan_deleted", traceId, scanId: id, frames: frames?.length ?? 0, artifacts: artifacts?.length ?? 0 }));
    return Response.json({ deleted: true, frames: frames?.length ?? 0, artifacts: artifacts?.length ?? 0, traceId });
  } catch (error) { return apiFailure(error, traceId); }
}
