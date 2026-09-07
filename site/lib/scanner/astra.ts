import { sessionToken } from "./contracts";
import type { CaptureMode } from "./plan";

export type AstraIssue = { kind: string; severity: "info" | "warning" | "critical"; title: string; detail: string; instruction: string; frameIndexes: number[] };
export type AstraCaptureReview = { verdict: "retake" | "usable" | "strong"; summary: string; guidance: string; issues: AstraIssue[]; reconstructionRisk?: "low" | "medium" | "high" };

export class AstraError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AstraError";
  }
}

/** Sends a bounded sample of thumbnails (never originals) for the semantic quality review. */
export async function reviewCapture(input: { roomName: string; captured: number; targetCount: number; images: string[]; captureMode: CaptureMode; localFindings: string[]; locale: string }): Promise<AstraCaptureReview> {
  const token = await sessionToken();
  const response = await fetch("/api/astra", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ ...input, images: input.images.slice(0, 8) }),
  });
  const result = (await response.json().catch(() => ({}))) as Partial<AstraCaptureReview> & { message?: string; error?: string | { code?: string; message?: string } };
  if (!response.ok) {
    const code = typeof result.error === "string" ? result.error : result.error?.code ?? "review_failed";
    throw new AstraError(code, (typeof result.error === "object" ? result.error?.message : undefined) || result.message || "Capture review failed.");
  }
  return { verdict: result.verdict ?? "usable", summary: result.summary ?? "", guidance: result.guidance ?? "", issues: Array.isArray(result.issues) ? result.issues : [], reconstructionRisk: result.reconstructionRisk };
}
