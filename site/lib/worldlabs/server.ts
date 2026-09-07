/**
 * World Labs World API client (Marble).
 *
 * Reference: https://docs.worldlabs.ai/api — base `https://api.worldlabs.ai`,
 * header `WLT-Api-Key`, `POST /marble/v1/worlds:generate` (returns an
 * operation), `GET /marble/v1/operations/{id}`, `GET /marble/v1/worlds/{id}`,
 * `POST /marble/v1/media-assets:prepare_upload` + `PUT` to the signed URL,
 * `POST /marble/v1/worlds/{id}:export`, `GET /marble/v1/credits`. Errors carry
 * `{detail}`; 402 = insufficient credits, 429 = rate limited (honour
 * Retry-After), 422 = schema mismatch. Default tier allows about 3 generation
 * starts per minute; each generation takes about five minutes.
 *
 * The key is read only here, only on the server, and never logged.
 */
import { ProviderError, type RetryClass } from "@/lib/reconstruction/contract";
import { classifyHttp, parseRetryAfter } from "@/lib/reconstruction/backoff";

const DEFAULT_BASE_URL = "https://api.worldlabs.ai";

export type MarbleModel = "marble-1.0-draft" | "marble-1.0" | "marble-1.1" | "marble-1.1-plus";
export const MARBLE_MODELS: readonly MarbleModel[] = ["marble-1.0-draft", "marble-1.0", "marble-1.1", "marble-1.1-plus"];

/** Published credit prices (docs.worldlabs.ai/api/pricing, read 2026-09-07). */
export const MARBLE_CREDITS: Record<MarbleModel, { pano: number; image: number; multiImage: number; video: number; text: number }> = {
  "marble-1.0-draft": { pano: 150, image: 230, multiImage: 250, video: 250, text: 230 },
  "marble-1.0": { pano: 1500, image: 1580, multiImage: 1600, video: 1600, text: 1580 },
  "marble-1.1": { pano: 1500, image: 1580, multiImage: 1600, video: 1600, text: 1580 },
  "marble-1.1-plus": { pano: 3000, image: 3080, multiImage: 3100, video: 3100, text: 3080 },
};

export type MediaSource = { source: "media_asset"; media_asset_id: string } | { source: "uri"; uri: string };
export type WorldPrompt =
  | { type: "image"; image_prompt: MediaSource; text_prompt?: string; is_pano?: "auto" | boolean; disable_recaption?: boolean }
  | { type: "multi-image"; multi_image_prompt: Array<{ azimuth?: number; content: MediaSource }>; text_prompt?: string; reconstruct_images?: boolean; disable_recaption?: boolean }
  | { type: "video"; video_prompt: MediaSource; text_prompt?: string; disable_recaption?: boolean };

export type GenerateRequest = { display_name?: string; model?: MarbleModel; seed?: number; tags?: string[]; permission?: { public: boolean }; world_prompt: WorldPrompt };

export type Operation = {
  operation_id: string;
  done: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  expires_at?: string | null;
  error?: { code?: number | null; message?: string | null } | null;
  metadata?: { progress?: { status?: string; description?: string }; world_id?: string; [key: string]: unknown } | null;
  response?: World | ExportResult | null;
  cost?: { total_credits: number; line_items?: Array<{ name: string; credits: number }> } | null;
};

export type World = {
  world_id: string;
  display_name?: string;
  world_marble_url?: string;
  model?: string;
  assets?: {
    imagery?: { pano_url?: string };
    mesh?: { full_res_mesh_url?: string; hq_mesh_url?: string; collider_mesh_url?: string };
    splats?: { spz_urls?: Record<string, string>; semantics_metadata?: { metric_scale_factor?: number; ground_plane_offset?: number } };
    caption?: string;
    thumbnail_url?: string;
  };
};

export type ExportResult = { asset_url?: string; url?: string; download_url?: string; [key: string]: unknown };

export type PreparedUpload = { media_asset: { media_asset_id: string }; upload_info: { upload_url: string; upload_method?: string; required_headers?: Record<string, string> | null } };

export class WorldLabsError extends ProviderError {
  constructor(status: number, code: string, message: string, retry?: RetryClass, retryAfterMs?: number) {
    super("marble", retry ?? classifyHttp(status), code, message, retryAfterMs, status);
    this.name = "WorldLabsError";
  }
}

export function worldLabsConfigured(): boolean {
  return Boolean(process.env.WORLDLABS_API_KEY?.trim());
}

function configuration() {
  const key = process.env.WORLDLABS_API_KEY?.trim();
  if (!key) throw new WorldLabsError(503, "worldlabs_unconfigured", "WORLDLABS_API_KEY is not set on the server.", "fatal");
  const base = process.env.WORLDLABS_API_BASE_URL?.trim() || DEFAULT_BASE_URL;
  if (new URL(base).protocol !== "https:") throw new WorldLabsError(500, "invalid_base_url", "WORLDLABS_API_BASE_URL must use HTTPS.", "fatal");
  return { key, base: base.replace(/\/$/, "") };
}

const ID = /^[A-Za-z0-9_-]{6,128}$/;
export const isWorldLabsId = (value: unknown): value is string => typeof value === "string" && ID.test(value);

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { key, base } = configuration();
  const headers: Record<string, string> = { "WLT-Api-Key": key, Accept: "application/json", ...(init.headers as Record<string, string> | undefined) };
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { ...init, headers, body, signal: init.signal ?? AbortSignal.timeout(60_000) });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new WorldLabsError(504, timedOut ? "upstream_timeout" : "upstream_unreachable", "World Labs did not answer in time.", "retryable");
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (response.ok) throw new WorldLabsError(502, "invalid_response", "World Labs returned an unreadable response.", "retryable");
    }
  }
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload ? (payload as { detail: unknown }).detail : undefined;
    const code = response.status === 402 ? "insufficient_credits" : response.status === 429 ? "rate_limited" : response.status === 422 ? "validation_error" : response.status === 404 ? "not_found" : "upstream_error";
    // Provider detail can include policy text; keep it in diagnostics only, never in customer errors.
    const error = new WorldLabsError(response.status, code, "World Labs rejected the request.", undefined, parseRetryAfter(response.headers.get("retry-after")));
    (error as WorldLabsError & { detail?: unknown }).detail = typeof detail === "string" ? detail.slice(0, 300) : Array.isArray(detail) ? detail.slice(0, 5) : undefined;
    throw error;
  }
  return payload as T;
}

export const getCredits = async (): Promise<number> => {
  const data = await request<{ remaining_credits: number }>("/marble/v1/credits");
  if (!data || !Number.isFinite(data.remaining_credits)) throw new WorldLabsError(502, "invalid_balance", "World Labs returned an invalid balance.", "retryable");
  return data.remaining_credits;
};

export async function prepareUpload(fileName: string, kind: "image" | "video", extension: string): Promise<PreparedUpload> {
  const prepared = await request<PreparedUpload>("/marble/v1/media-assets:prepare_upload", { method: "POST", json: { file_name: fileName.slice(0, 64), kind, extension } });
  if (!prepared?.media_asset?.media_asset_id || !prepared.upload_info?.upload_url) throw new WorldLabsError(502, "invalid_upload_grant", "World Labs returned an invalid upload grant.", "retryable");
  if (!prepared.upload_info.upload_url.startsWith("https://")) throw new WorldLabsError(502, "invalid_upload_grant", "World Labs returned a non-HTTPS upload URL.", "fatal");
  return prepared;
}

export async function uploadMedia(prepared: PreparedUpload, bytes: Uint8Array, contentType: string): Promise<void> {
  const method = (prepared.upload_info.upload_method || "PUT").toUpperCase();
  const headers: Record<string, string> = { "Content-Type": contentType, ...(prepared.upload_info.required_headers ?? {}) };
  let response: Response;
  try {
    response = await fetch(prepared.upload_info.upload_url, { method, headers, body: bytes as BodyInit, signal: AbortSignal.timeout(300_000) });
  } catch {
    throw new WorldLabsError(504, "upload_failed", "Uploading to World Labs did not complete.", "retryable");
  }
  if (!response.ok) throw new WorldLabsError(response.status, "upload_failed", "World Labs storage rejected the upload.", response.status >= 500 ? "retryable" : "fatal");
}

export async function generateWorld(body: GenerateRequest): Promise<Operation> {
  const operation = await request<Operation>("/marble/v1/worlds:generate", { method: "POST", json: body });
  if (!operation || !isWorldLabsId(operation.operation_id)) throw new WorldLabsError(502, "invalid_operation", "World Labs returned an invalid operation.", "retryable");
  return operation;
}

export async function getOperation(operationId: string): Promise<Operation> {
  if (!isWorldLabsId(operationId)) throw new WorldLabsError(400, "invalid_operation_id", "Invalid World Labs operation identifier.", "fatal");
  const operation = await request<Operation>(`/marble/v1/operations/${encodeURIComponent(operationId)}`);
  if (!operation || typeof operation.done !== "boolean") throw new WorldLabsError(502, "invalid_operation", "World Labs returned an invalid operation.", "retryable");
  return operation;
}

export async function getWorld(worldId: string): Promise<World> {
  if (!isWorldLabsId(worldId)) throw new WorldLabsError(400, "invalid_world_id", "Invalid World Labs world identifier.", "fatal");
  const world = await request<World>(`/marble/v1/worlds/${encodeURIComponent(worldId)}`);
  if (!world || !world.world_id) throw new WorldLabsError(502, "invalid_world", "World Labs returned an invalid world.", "retryable");
  return world;
}

export async function exportWorld(worldId: string, body: { asset_type: "splats"; format: "ply" } | { asset_type: "mesh"; format: "glb" }): Promise<Operation> {
  if (!isWorldLabsId(worldId)) throw new WorldLabsError(400, "invalid_world_id", "Invalid World Labs world identifier.", "fatal");
  const operation = await request<Operation>(`/marble/v1/worlds/${encodeURIComponent(worldId)}:export`, { method: "POST", json: body });
  if (!operation || !isWorldLabsId(operation.operation_id)) throw new WorldLabsError(502, "invalid_operation", "World Labs returned an invalid export operation.", "retryable");
  return operation;
}
