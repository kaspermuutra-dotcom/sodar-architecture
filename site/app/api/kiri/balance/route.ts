import { NextRequest } from "next/server";
import { apiFailure, authenticated } from "@/lib/supabase/server";
import { kiriProvider } from "@/lib/reconstruction/kiri";
import { ProviderError } from "@/lib/reconstruction/contract";

export const runtime = "nodejs";

/**
 * Availability probe for the KIRI provider. Authenticated; reports whether
 * KIRI can be used right now without exposing the operator's credit balance
 * to the browser (balances are operator information — see
 * /api/reconstruction/estimate for the customer-facing view).
 */
export async function GET(request: NextRequest) {
  let traceId: string | undefined;
  try {
    const auth = await authenticated(request);
    traceId = auth.traceId;
    if (!kiriProvider.enabled()) return Response.json({ configured: false, available: false, traceId });
    try {
      const balance = await kiriProvider.balance();
      return Response.json({ configured: true, available: balance === null || balance > 0, traceId });
    } catch (error) {
      if (error instanceof ProviderError) return Response.json({ configured: true, available: false, reason: error.retry === "unauthorized" ? "provider_unauthorized" : "balance_unavailable", traceId });
      throw error;
    }
  } catch (error) {
    return apiFailure(error, traceId);
  }
}
