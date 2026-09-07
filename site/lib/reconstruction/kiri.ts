/** KIRI Engine adapter: faithful photo-based 3D Gaussian Splatting. */
import { createKiri3dgsJob, getKiriBalance, getKiriJobStatus, getKiriModelDownload, KIRI_MAX_IMAGES, KIRI_MIN_IMAGES, KIRI_RETENTION_HOURS, kiriConfigured, validateKiriImages } from "@/lib/kiri/server";
import { fetchBytes } from "@/lib/server/safe-fetch";
import { listZipEntries, readZipEntry, ZipError } from "@/lib/server/zip";
import { providerEnabled } from "./config";
import { ProviderError, type Capability, type CostEstimate, type ProviderInput, type ProviderJobRef, type ProviderOutput, type ProviderStatus, type ReconstructionProvider } from "./contract";

export const KIRI_ADAPTER_VERSION = "kiri-3dgs/1.0.0";
const MAX_MODEL_ZIP_BYTES = 1_500 * 1024 * 1024;

const SPLAT_EXT = /\.(ply|splat|spz|ksplat)$/i;
const MESH_EXT = /\.(obj|fbx|stl|glb|gltf|usdz|xyz)$/i;

export function splatMimeType(name: string): string {
  if (/\.ply$/i.test(name)) return "application/x-ply";
  if (/\.spz$/i.test(name)) return "application/x-spz";
  if (/\.splat$/i.test(name)) return "application/x-splat";
  if (/\.glb$/i.test(name)) return "model/gltf-binary";
  if (/\.gltf$/i.test(name)) return "model/gltf+json";
  if (/\.obj$/i.test(name)) return "model/obj";
  if (/\.stl$/i.test(name)) return "model/stl";
  if (/\.usdz$/i.test(name)) return "model/vnd.usdz+zip";
  return "application/octet-stream";
}

/** Splits a KIRI model zip into the splat, the optional mesh, and keeps the archive itself. */
export function unpackKiriArchive(zip: Uint8Array): { splat?: { name: string; bytes: Uint8Array }; mesh?: { name: string; bytes: Uint8Array }; entries: string[] } {
  const entries = listZipEntries(zip, { maxEntries: 256, maxTotalBytes: 3 * MAX_MODEL_ZIP_BYTES });
  const names = entries.map((entry) => entry.name);
  const pick = (pattern: RegExp) => {
    const candidates = entries.filter((entry) => pattern.test(entry.name) && entry.size > 0).sort((a, b) => b.size - a.size);
    return candidates[0];
  };
  const splatEntry = pick(SPLAT_EXT);
  const meshEntry = pick(MESH_EXT);
  return {
    splat: splatEntry ? { name: splatEntry.name.split("/").pop()!, bytes: readZipEntry(zip, splatEntry) } : undefined,
    mesh: meshEntry ? { name: meshEntry.name.split("/").pop()!, bytes: readZipEntry(zip, meshEntry) } : undefined,
    entries: names,
  };
}

export const kiriProvider: ReconstructionProvider = {
  id: "kiri",
  capability(): Capability {
    return {
      provider: "kiri",
      version: KIRI_ADAPTER_VERSION,
      outputs: ["kiri_gaussian_splat", "kiri_mesh"],
      inputs: ["images"],
      imageCount: { min: KIRI_MIN_IMAGES, max: KIRI_MAX_IMAGES },
      mediaTypes: ["image/jpeg", "image/png"],
      supportsCancel: false,
      supportsWebhooks: true,
      retentionHours: KIRI_RETENTION_HOURS,
      disclosure: "faithful_reconstruction",
    };
  },
  enabled: () => kiriConfigured() && providerEnabled("kiri"),
  validateInput(input) {
    if (input.kind !== "images") throw new ProviderError("kiri", "fatal", "unsupported_input", "KIRI reconstructs from photographs, not from a panorama.");
    validateKiriImages(input.frames.map((frame) => ({ type: frame.mimeType, size: frame.bytes.byteLength })));
  },
  estimateCost(input): CostEstimate {
    // KIRI does not publish a per-job credit price in its API docs; the balance is
    // checked server-side before submission and the actual deduction is read back
    // by comparing balances. Surface that honestly instead of inventing a number.
    return { credits: null, currency: "provider_credits", note: input.kind === "images" ? `One KIRI 3DGS job for ${input.frames.length} photographs.` : "Not applicable." };
  },
  balance: () => getKiriBalance(),
  async submit(input, options) {
    if (input.kind !== "images") throw new ProviderError("kiri", "fatal", "unsupported_input", "KIRI reconstructs from photographs.");
    const files = input.frames.map((frame, index) => new File([frame.bytes as BlobPart], safeName(frame.name, index, frame.mimeType), { type: frame.mimeType }));
    const job = await createKiri3dgsJob(files, { mesh: options.wantMesh === true, mask: false, fileFormat: options.wantMesh ? "glb" : undefined });
    return { provider: "kiri", externalId: job.serialize, submittedAt: new Date().toISOString(), estimatedCredits: null };
  },
  async status(ref): Promise<ProviderStatus> {
    const job = await getKiriJobStatus(ref.externalId);
    const map: Record<typeof job.state, ProviderStatus["status"]> = { uploading: "uploading", queued: "queued", processing: "processing", succeeded: "ready", failed: "failed", expired: "expired" };
    const submitted = Date.parse(ref.submittedAt);
    return { status: map[job.state], raw: job.status, expiresAt: Number.isFinite(submitted) ? new Date(submitted + KIRI_RETENTION_HOURS * 3_600_000).toISOString() : undefined };
  },
  async fetchOutputs(ref): Promise<ProviderOutput[]> {
    const download = await getKiriModelDownload(ref.externalId);
    const { bytes } = await fetchBytes(download.modelUrl, { provider: "kiri", maxBytes: MAX_MODEL_ZIP_BYTES, timeoutMs: 600_000 });
    let unpacked: ReturnType<typeof unpackKiriArchive>;
    try {
      unpacked = unpackKiriArchive(bytes);
    } catch (error) {
      if (error instanceof ZipError) throw new ProviderError("kiri", "fatal", "invalid_archive", "The finished model archive could not be read.");
      throw error;
    }
    const outputs: ProviderOutput[] = [
      { type: "kiri_gaussian_splat", name: `${ref.externalId}.zip`, bytes, mimeType: "application/zip", provenance: "captured", metadata: { container: "zip", entries: unpacked.entries, adapter: KIRI_ADAPTER_VERSION } },
    ];
    if (unpacked.splat) outputs.push({ type: "kiri_gaussian_splat", name: unpacked.splat.name, bytes: unpacked.splat.bytes, mimeType: splatMimeType(unpacked.splat.name), provenance: "captured", metadata: { extractedFrom: `${ref.externalId}.zip`, adapter: KIRI_ADAPTER_VERSION } });
    if (unpacked.mesh) outputs.push({ type: "kiri_mesh", name: unpacked.mesh.name, bytes: unpacked.mesh.bytes, mimeType: splatMimeType(unpacked.mesh.name), provenance: "derived", metadata: { extractedFrom: `${ref.externalId}.zip`, adapter: KIRI_ADAPTER_VERSION } });
    return outputs;
  },
};

function safeName(name: string, index: number, mimeType: string): string {
  const ext = mimeType === "image/png" ? "png" : "jpg";
  const base = name.replace(/[^A-Za-z0-9._-]/g, "").replace(/\.(jpe?g|png)$/i, "").slice(0, 48) || `frame-${String(index + 1).padStart(3, "0")}`;
  return `${base}.${ext}`;
}
