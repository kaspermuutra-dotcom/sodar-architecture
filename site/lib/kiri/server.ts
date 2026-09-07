/**
 * KIRI Engine server client (3D Gaussian Splatting from photographs).
 *
 * Reference: https://docs.kiriengine.app — bearer auth, envelope
 * `{code, msg, data, ok}`, image upload `POST /v1/open/3dgs/image`
 * (20–300 JPEG/PNG images), `GET /v1/open/model/getStatus`, and
 * `GET /v1/open/model/getModelZip` (link valid 60 minutes). Finished models are
 * kept by KIRI for about three days, so SODAR copies every output into its own
 * storage as soon as a job succeeds (see lib/reconstruction/service.ts).
 *
 * The API key is read only here, only on the server, and never logged.
 */
import { ProviderError, type RetryClass } from "@/lib/reconstruction/contract";
import { classifyHttp, parseRetryAfter } from "@/lib/reconstruction/backoff";

const DEFAULT_BASE_URL = "https://api.kiriengine.app/api";

export const KIRI_MIN_IMAGES = 20;
export const KIRI_MAX_IMAGES = 300;
export const KIRI_RETENTION_HOURS = 72;
export const KIRI_DOWNLOAD_LINK_MINUTES = 60;

type KiriEnvelope<T> = { code: number; msg: string; data: T; ok: boolean };

export type KiriJobStatusCode = -1 | 0 | 1 | 2 | 3 | 4;
export type KiriJobState = "uploading" | "processing" | "failed" | "succeeded" | "queued" | "expired";
export type KiriJob = { serialize: string; calculateType: number };
export type KiriJobStatus = { serialize: string; status: KiriJobStatusCode; state: KiriJobState };

/** Preserved for the existing routes/tests; new code should catch ProviderError. */
export class KiriApiError extends ProviderError {
  /** KIRI's numeric envelope code when there was one (diagnostics only). */
  readonly rawCode: number | string;
  constructor(readonly status: number, code: number | string, message: string, retry?: RetryClass, retryAfterMs?: number) {
    super("kiri", retry ?? classifyHttp(status), String(code), message, retryAfterMs, status);
    this.name = "KiriApiError";
    this.rawCode = code;
  }
}

export function kiriConfigured(): boolean {
  return Boolean(process.env.KIRI_API_KEY?.trim());
}

function configuration() {
  const key = process.env.KIRI_API_KEY?.trim();
  if (!key) throw new KiriApiError(503, "kiri_unconfigured", "KIRI_API_KEY is not set on the server.", "fatal");
  const configuredBase = process.env.KIRI_API_BASE_URL?.trim();
  const baseUrl = configuredBase || DEFAULT_BASE_URL;
  const url = new URL(baseUrl);
  if (url.protocol !== "https:") throw new KiriApiError(500, "invalid_base_url", "KIRI_API_BASE_URL must use HTTPS.", "fatal");
  return { key, baseUrl: baseUrl.replace(/\/$/, "") };
}

const SERIALIZE = /^[A-Za-z0-9_-]{8,128}$/;
export function isKiriSerialize(value: unknown): value is string {
  return typeof value === "string" && SERIALIZE.test(value);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { key, baseUrl } = configuration();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, ...(init.headers as Record<string, string> | undefined) },
      signal: init.signal ?? AbortSignal.timeout(180_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new KiriApiError(504, timedOut ? "upstream_timeout" : "upstream_unreachable", "KIRI did not answer in time.", "retryable");
  }
  let payload: KiriEnvelope<T> | undefined;
  try {
    payload = (await response.json()) as KiriEnvelope<T>;
  } catch {
    throw new KiriApiError(response.status || 502, "invalid_response", "KIRI returned an unreadable response.", response.status >= 500 || response.status === 0 ? "retryable" : "fatal");
  }
  // KIRI's documentation examples use code 0, while the live balance API
  // returns code 200 for success. Accept both successful envelopes.
  const success = response.ok && payload && payload.ok === true && [0, 200].includes(Number(payload.code));
  if (!success) {
    const status = response.status || 502;
    // 403 means "not enough credit" in KIRI's status-code table, not a permission problem.
    const retry: RetryClass = status === 403 ? "insufficient_credits" : classifyHttp(status);
    throw new KiriApiError(status, payload?.code ?? "upstream_error", "KIRI rejected the request.", retry, parseRetryAfter(response.headers.get("retry-after")));
  }
  return payload.data;
}

export async function getKiriBalance(): Promise<number> {
  const data = await request<{ balance: number }>("/v1/open/balance");
  if (!data || !Number.isFinite(data.balance)) throw new KiriApiError(502, "invalid_balance", "KIRI returned an invalid balance.", "retryable");
  return data.balance;
}

export type KiriJobOptions = { mesh?: boolean; mask?: boolean; fileFormat?: string };
const MESH_FORMATS = new Set(["obj", "fbx", "stl", "ply", "glb", "gltf", "usdz", "xyz"]);

export function validateKiriImages(images: Array<{ type: string; size: number }>): void {
  if (images.length < KIRI_MIN_IMAGES || images.length > KIRI_MAX_IMAGES) {
    throw new KiriApiError(422, "invalid_image_count", `KIRI 3DGS requires ${KIRI_MIN_IMAGES}–${KIRI_MAX_IMAGES} images.`, "fatal");
  }
  if (images.some((image) => !["image/jpeg", "image/png"].includes(image.type))) {
    throw new KiriApiError(415, "unsupported_image", "KIRI uploads must contain only JPEG or PNG images.", "fatal");
  }
  if (images.some((image) => image.size < 1024)) throw new KiriApiError(422, "empty_image", "An image in the upload is empty.", "fatal");
}

export async function createKiri3dgsJob(images: File[], options: KiriJobOptions = {}): Promise<KiriJob> {
  validateKiriImages(images);
  if (options.mesh && options.fileFormat && !MESH_FORMATS.has(options.fileFormat)) throw new KiriApiError(422, "invalid_mesh_format", "Unsupported mesh format.", "fatal");
  const form = new FormData();
  form.set("isMesh", options.mesh ? "1" : "0");
  form.set("isMask", options.mask ? "1" : "0");
  if (options.mesh && options.fileFormat) form.set("fileFormat", options.fileFormat);
  images.forEach((image) => form.append("imagesFiles", image, image.name));
  const job = await request<KiriJob>("/v1/open/3dgs/image", { method: "POST", body: form, signal: AbortSignal.timeout(600_000) });
  if (!job || !isKiriSerialize(job.serialize)) throw new KiriApiError(502, "invalid_job", "KIRI returned an invalid job identifier.", "retryable");
  return job;
}

const STATES: Record<KiriJobStatusCode, KiriJobState> = { [-1]: "uploading", 0: "processing", 1: "failed", 2: "succeeded", 3: "queued", 4: "expired" };

export async function getKiriJobStatus(serialize: string): Promise<KiriJobStatus> {
  if (!isKiriSerialize(serialize)) throw new KiriApiError(400, "invalid_job_id", "Invalid KIRI job identifier.", "fatal");
  const data = await request<{ serialize: string; status: KiriJobStatusCode }>(`/v1/open/model/getStatus?serialize=${encodeURIComponent(serialize)}`);
  const state = data ? STATES[data.status] : undefined;
  if (!state) throw new KiriApiError(502, "invalid_status", "KIRI returned an unknown job status.", "retryable");
  return { serialize: data.serialize, status: data.status, state };
}

export async function getKiriModelDownload(serialize: string): Promise<{ serialize: string; modelUrl: string }> {
  const status = await getKiriJobStatus(serialize);
  if (status.state !== "succeeded") throw new KiriApiError(409, "job_not_ready", `KIRI job is ${status.state}.`, status.state === "expired" || status.state === "failed" ? "fatal" : "retryable");
  const data = await request<{ serialize: string; modelUrl: string }>(`/v1/open/model/getModelZip?serialize=${encodeURIComponent(serialize)}`);
  if (!data?.modelUrl || typeof data.modelUrl !== "string" || !data.modelUrl.startsWith("https://")) throw new KiriApiError(502, "invalid_download", "KIRI returned an invalid model download URL.", "retryable");
  return data;
}
