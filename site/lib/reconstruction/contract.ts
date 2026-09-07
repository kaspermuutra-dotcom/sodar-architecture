/**
 * Provider-neutral reconstruction contract.
 *
 * Everything downstream of SODAR (routes, the job service, the scanner UI)
 * talks to these types. A provider adapter (`kiri.ts`, `marble.ts`) translates
 * a vendor's request/response shapes into them and keeps vendor detail inside
 * `diagnostics`. Nothing here imports a vendor SDK or reads a secret.
 */

export const PROVIDER_IDS = ["kiri", "marble"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Normalized SODAR job status. Every provider state maps onto exactly one of these. */
export const JOB_STATUSES = [
  "draft",
  "validating",
  "needs_retake",
  "ready_to_upload",
  "uploading",
  "queued",
  "processing",
  "downloading",
  "ready",
  "partially_ready",
  "failed",
  "expired",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Statuses after which no provider call will ever be made again for the job. */
export const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set(["ready", "partially_ready", "failed", "expired", "cancelled"]);

export const ARTIFACT_TYPES = [
  "original_frame",
  "capture_manifest",
  "capture_quality_report",
  "coverage_mask",
  "panorama_stitched_original",
  "panorama_ai_completed",
  "kiri_gaussian_splat",
  "kiri_mesh",
  "marble_panorama",
  "marble_gaussian_splat",
  "marble_collider_mesh",
  "marble_thumbnail",
  "tour_manifest",
  "processing_report",
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/** Whether the pixels/geometry in an artifact were captured by the camera or produced by a model. */
export type Provenance = "captured" | "derived" | "ai_generated" | "mixed";

export type ArtifactRecord = {
  id: string;
  scanId: string;
  roomId: string | null;
  ownerId: string;
  provider: ProviderId | "sodar" | "openai";
  type: ArtifactType;
  bucket: string;
  objectPath: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  sourceArtifactIds: string[];
  createdAt: string;
  providerJobId: string | null;
  processingVersion: string;
  provenance: Provenance;
  aiGenerated: boolean;
  retention: "retained" | "scheduled_for_deletion" | "deleted";
  metadata: Record<string, unknown>;
};

export type Capability = {
  provider: ProviderId;
  version: string;
  /** What the provider produces. */
  outputs: ArtifactType[];
  /** Accepted inputs, most preferred first. */
  inputs: Array<"images" | "panorama" | "video">;
  imageCount: { min: number; max: number };
  mediaTypes: string[];
  supportsCancel: boolean;
  supportsWebhooks: boolean;
  /** How long the provider keeps finished outputs before SODAR must have copied them. */
  retentionHours: number;
  /** Customer-facing disclosure required whenever this provider's output is shown. */
  disclosure: "faithful_reconstruction" | "generative_completion";
};

export type CostEstimate = { credits: number | null; currency: "provider_credits"; note: string };

export type ProviderInput =
  | { kind: "images"; frames: Array<{ name: string; bytes: Uint8Array; mimeType: string; azimuthDeg?: number }> }
  | { kind: "panorama"; name: string; bytes: Uint8Array; mimeType: string };

export type ProviderJobRef = { provider: ProviderId; externalId: string; submittedAt: string; estimatedCredits: number | null };

export type ProviderStatus = {
  status: Extract<JobStatus, "uploading" | "queued" | "processing" | "ready" | "failed" | "expired">;
  /** Vendor's own status token, for diagnostics only. Never shown to customers. */
  raw: string | number;
  progress?: number;
  message?: string;
  costCredits?: number | null;
  /** Provider-side expiry of outputs, if known. */
  expiresAt?: string;
  /** Small provider identifiers worth persisting (e.g. Marble world_id). Never secrets, never URLs. */
  details?: Record<string, string | number | null>;
};

export type ProviderOutput = { type: ArtifactType; name: string; bytes: Uint8Array; mimeType: string; provenance: Provenance; metadata?: Record<string, unknown> };

export type RetryClass = "retryable" | "fatal" | "rate_limited" | "insufficient_credits" | "unauthorized";

/** A provider failure normalized so callers can decide whether to retry without vendor knowledge. */
export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly retry: RetryClass,
    readonly code: string,
    message: string,
    readonly retryAfterMs?: number,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ReconstructionProvider {
  readonly id: ProviderId;
  capability(): Capability;
  /** True when the server has credentials and the provider is not disabled by flag or kill switch. */
  enabled(): boolean;
  /** Cheap pre-flight: validates counts/formats without contacting the vendor. Throws ProviderError(fatal). */
  validateInput(input: ProviderInput): void;
  estimateCost(input: ProviderInput): CostEstimate;
  /** Remaining provider credits, or null when the vendor has no balance endpoint. */
  balance(): Promise<number | null>;
  /** Creates one paid job. Callers MUST guard this with an idempotency key. */
  submit(input: ProviderInput, options: { displayName: string; wantMesh?: boolean }): Promise<ProviderJobRef>;
  status(ref: ProviderJobRef): Promise<ProviderStatus>;
  /** Fetches every output of a finished job. Must be safe to call more than once. */
  fetchOutputs(ref: ProviderJobRef): Promise<ProviderOutput[]>;
  cancel?(ref: ProviderJobRef): Promise<void>;
}

/** Customer-facing stage labels are looked up by this key in the translation files. */
export function customerStage(status: JobStatus): "preparing" | "saving" | "building" | "ready" | "attention" | "stopped" {
  switch (status) {
    case "draft":
    case "validating":
      return "preparing";
    case "needs_retake":
      return "attention";
    case "ready_to_upload":
    case "uploading":
      return "saving";
    case "queued":
    case "processing":
    case "downloading":
      return "building";
    case "ready":
    case "partially_ready":
      return "ready";
    case "failed":
    case "expired":
    case "cancelled":
      return "stopped";
  }
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}
