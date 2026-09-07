export type AstraCaptureReview = {
  verdict: "retake" | "usable" | "strong";
  summary: string;
  guidance: string;
  issues: Array<{ severity: "info" | "warning" | "critical"; title: string; detail: string }>;
};

export async function reviewCapture(input: {
  roomName: string;
  captured: number;
  targetCount: number;
  images: string[];
}): Promise<AstraCaptureReview> {
  const response = await fetch("/api/astra", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = (await response.json()) as AstraCaptureReview & { message?: string };
  if (!response.ok) throw new Error(result.message || "Astra review failed.");
  return result;
}
