/**
 * World Labs Marble adapter: immersive, explorable world generation.
 *
 * Marble is generative. Even with the most faithful settings it may complete
 * surfaces the camera never saw, so every Marble output is stored with
 * provenance "ai_generated" and shown with the generative disclosure. It never
 * gates delivery of the KIRI reconstruction.
 */
import { exportWorld, generateWorld, getCredits, getOperation, getWorld, MARBLE_CREDITS, MARBLE_MODELS, prepareUpload, uploadMedia, worldLabsConfigured, type ExportResult, type MarbleModel, type Operation, type World, type WorldPrompt } from "@/lib/worldlabs/server";
import { fetchBytes } from "@/lib/server/safe-fetch";
import { providerEnabled } from "./config";
import { ProviderError, type Capability, type CostEstimate, type ProviderInput, type ProviderJobRef, type ProviderOutput, type ProviderStatus, type ReconstructionProvider } from "./contract";

export const MARBLE_ADAPTER_VERSION = "marble-world/1.0.0";
export const MARBLE_MIN_IMAGES = 1;
export const MARBLE_MAX_IMAGES = 8;
const MAX_ASSET_BYTES = 1_000 * 1024 * 1024;

/** Constraint prompt: reconstruct only what is visible; never invent property features. */
export const MARBLE_FAITHFUL_PROMPT =
  "Reconstruct this real interior exactly as photographed. Keep every wall, window, door, ceiling, floor, fixture and piece of furniture in its true position, size, material and colour. " +
  "Do not add rooms, doors, windows, furniture, people, animals, plants, artwork, signs, text or any feature that is not visible in the source images. " +
  "Do not remove or move anything permanent. Do not restyle, redecorate or brighten. Continue unseen surfaces plainly in the same material without inventing new objects.";

export function marbleModel(): MarbleModel {
  const configured = process.env.WORLDLABS_MODEL?.trim() as MarbleModel | undefined;
  return configured && MARBLE_MODELS.includes(configured) ? configured : "marble-1.1";
}

export function marbleEstimate(input: ProviderInput, model = marbleModel()): CostEstimate {
  const table = MARBLE_CREDITS[model];
  if (input.kind === "panorama") return { credits: table.pano, currency: "provider_credits", note: `${model}: equirectangular panorama input.` };
  const credits = input.frames.length === 1 ? table.image : table.multiImage;
  return { credits, currency: "provider_credits", note: `${model}: ${input.frames.length === 1 ? "single image" : `${input.frames.length} images`} input.` };
}

function extensionFor(mimeType: string): "jpg" | "png" | "webp" {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

async function uploadAsset(name: string, bytes: Uint8Array, mimeType: string): Promise<string> {
  const prepared = await prepareUpload(name, "image", extensionFor(mimeType));
  await uploadMedia(prepared, bytes, mimeType);
  return prepared.media_asset.media_asset_id;
}

export function buildWorldPrompt(input: ProviderInput, assetIds: string[]): WorldPrompt {
  if (input.kind === "panorama") {
    return { type: "image", image_prompt: { source: "media_asset", media_asset_id: assetIds[0] }, text_prompt: MARBLE_FAITHFUL_PROMPT, is_pano: true, disable_recaption: true };
  }
  if (input.frames.length === 1) {
    return { type: "image", image_prompt: { source: "media_asset", media_asset_id: assetIds[0] }, text_prompt: MARBLE_FAITHFUL_PROMPT, is_pano: false, disable_recaption: true };
  }
  return {
    type: "multi-image",
    multi_image_prompt: input.frames.map((frame, index) => ({ azimuth: normalizeAzimuth(frame.azimuthDeg ?? (index * 360) / input.frames.length), content: { source: "media_asset", media_asset_id: assetIds[index] } })),
    text_prompt: MARBLE_FAITHFUL_PROMPT,
    reconstruct_images: true,
    disable_recaption: true,
  };
}

export const normalizeAzimuth = (degrees: number) => {
  const wrapped = Math.round((((degrees % 360) + 360) % 360) * 10) / 10;
  return wrapped >= 360 ? 0 : wrapped;
};

function operationStatus(operation: Operation): ProviderStatus {
  const worldId = operation.metadata?.world_id ?? (operation.response && "world_id" in operation.response ? (operation.response as World).world_id : undefined);
  const details = { worldId: worldId ?? null, progress: operation.metadata?.progress?.status ?? null };
  if (!operation.done) {
    const status = operation.metadata?.progress?.status?.toUpperCase();
    return { status: status === "QUEUED" || status === "PENDING" ? "queued" : "processing", raw: status ?? "IN_PROGRESS", message: operation.metadata?.progress?.description, expiresAt: operation.expires_at ?? undefined, details };
  }
  if (operation.error) return { status: "failed", raw: `error:${operation.error.code ?? "unknown"}`, message: operation.error.message ?? undefined, costCredits: operation.cost?.total_credits ?? null, details };
  return { status: "ready", raw: "SUCCEEDED", costCredits: operation.cost?.total_credits ?? null, expiresAt: operation.expires_at ?? undefined, details };
}

function firstHttpsUrl(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value == null) return undefined;
  if (typeof value === "string") return value.startsWith("https://") ? value : undefined;
  if (Array.isArray(value)) return value.map((item) => firstHttpsUrl(item, depth + 1)).find(Boolean);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).map((item) => firstHttpsUrl(item, depth + 1)).find(Boolean);
  return undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Asks Marble for a PLY copy of the splat (free per pricing page) and waits briefly; returns undefined when not ready yet. */
async function tryPlyExport(worldId: string, waitMs: number): Promise<{ url: string; operationId: string } | undefined> {
  const started = await exportWorld(worldId, { asset_type: "splats", format: "ply" });
  const deadline = Date.now() + waitMs;
  let operation = started;
  while (!operation.done && Date.now() < deadline) {
    await sleep(3_000);
    operation = await getOperation(operation.operation_id);
  }
  if (!operation.done || operation.error) return undefined;
  const url = firstHttpsUrl(operation.response as ExportResult | null);
  return url ? { url, operationId: operation.operation_id } : undefined;
}

export const marbleProvider: ReconstructionProvider = {
  id: "marble",
  capability(): Capability {
    return {
      provider: "marble",
      version: MARBLE_ADAPTER_VERSION,
      outputs: ["marble_panorama", "marble_gaussian_splat", "marble_collider_mesh", "marble_thumbnail"],
      inputs: ["panorama", "images"],
      imageCount: { min: MARBLE_MIN_IMAGES, max: MARBLE_MAX_IMAGES },
      mediaTypes: ["image/jpeg", "image/png", "image/webp"],
      supportsCancel: false,
      supportsWebhooks: false,
      // Operations carry an expires_at; asset URLs are treated as temporary and copied immediately.
      retentionHours: 24,
      disclosure: "generative_completion",
    };
  },
  enabled: () => worldLabsConfigured() && providerEnabled("marble"),
  validateInput(input) {
    const accepted = ["image/jpeg", "image/png", "image/webp"];
    if (input.kind === "panorama") {
      if (!accepted.includes(input.mimeType)) throw new ProviderError("marble", "fatal", "unsupported_image", "Marble accepts JPEG, PNG or WebP panoramas.");
      if (input.bytes.byteLength < 1024) throw new ProviderError("marble", "fatal", "empty_image", "The panorama is empty.");
      return;
    }
    if (input.frames.length < MARBLE_MIN_IMAGES || input.frames.length > MARBLE_MAX_IMAGES) throw new ProviderError("marble", "fatal", "invalid_image_count", `Marble multi-image input takes ${MARBLE_MIN_IMAGES}–${MARBLE_MAX_IMAGES} photographs.`);
    if (input.frames.some((frame) => !accepted.includes(frame.mimeType) || frame.bytes.byteLength < 1024)) throw new ProviderError("marble", "fatal", "unsupported_image", "Marble accepts JPEG, PNG or WebP photographs.");
  },
  estimateCost: (input) => marbleEstimate(input),
  balance: () => getCredits(),
  async submit(input, options) {
    marbleProvider.validateInput(input);
    const assetIds: string[] = [];
    if (input.kind === "panorama") assetIds.push(await uploadAsset("panorama", input.bytes, input.mimeType));
    else for (const [index, frame] of input.frames.entries()) assetIds.push(await uploadAsset(`frame-${index + 1}`, frame.bytes, frame.mimeType));
    const operation = await generateWorld({
      display_name: options.displayName.slice(0, 64),
      model: marbleModel(),
      tags: ["sodar", "interior"],
      permission: { public: false },
      world_prompt: buildWorldPrompt(input, assetIds),
    });
    return { provider: "marble", externalId: operation.operation_id, submittedAt: new Date().toISOString(), estimatedCredits: marbleEstimate(input).credits };
  },
  async status(ref) {
    return operationStatus(await getOperation(ref.externalId));
  },
  async fetchOutputs(ref): Promise<ProviderOutput[]> {
    const operation = await getOperation(ref.externalId);
    if (!operation.done) throw new ProviderError("marble", "retryable", "not_ready", "The world is still generating.");
    if (operation.error) throw new ProviderError("marble", "fatal", "generation_failed", "World generation failed.");
    const worldId = operation.metadata?.world_id ?? (operation.response as World | null)?.world_id;
    if (!worldId) throw new ProviderError("marble", "fatal", "missing_world", "World generation finished without a world.");
    const world = await getWorld(worldId);
    const assets = world.assets ?? {};
    const outputs: ProviderOutput[] = [];
    const common = { worldId, model: world.model ?? marbleModel(), adapter: MARBLE_ADAPTER_VERSION, marbleUrl: world.world_marble_url ?? null, costCredits: operation.cost?.total_credits ?? null };
    const pull = async (url: string | undefined, type: ProviderOutput["type"], name: string, fallbackMime: string, extra: Record<string, unknown> = {}) => {
      if (!url) return;
      const { bytes, contentType } = await fetchBytes(url, { provider: "marble", maxBytes: MAX_ASSET_BYTES, timeoutMs: 600_000 });
      outputs.push({ type, name, bytes, mimeType: contentType?.split(";")[0] || fallbackMime, provenance: "ai_generated", metadata: { ...common, ...extra } });
    };
    await pull(assets.imagery?.pano_url, "marble_panorama", `${worldId}-panorama.jpg`, "image/jpeg");
    const spz = assets.splats?.spz_urls ?? {};
    const spzKey = ["full_res", "500k", "100k"].find((key) => spz[key]) ?? Object.keys(spz)[0];
    if (spzKey) await pull(spz[spzKey], "marble_gaussian_splat", `${worldId}-${spzKey}.spz`, "application/x-spz", { variant: spzKey, semantics: assets.splats?.semantics_metadata ?? null });
    await pull(assets.mesh?.collider_mesh_url, "marble_collider_mesh", `${worldId}-collider.glb`, "model/gltf-binary");
    await pull(assets.thumbnail_url, "marble_thumbnail", `${worldId}-thumbnail.jpg`, "image/jpeg");
    try {
      const ply = await tryPlyExport(worldId, 45_000);
      if (ply) await pull(ply.url, "marble_gaussian_splat", `${worldId}.ply`, "application/x-ply", { variant: "ply_export", exportOperationId: ply.operationId });
    } catch (error) {
      // A missing PLY copy is not a failed reconstruction; the SPZ is kept and the viewer falls back to the panorama.
      if (!(error instanceof ProviderError)) throw error;
    }
    return outputs;
  },
};
