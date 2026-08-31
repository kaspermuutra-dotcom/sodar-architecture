import { getSupabaseEnv } from "./env";

export type SupabaseHealth =
  | { status: "unconfigured" }
  | { status: "ok"; host: string }
  | { status: "error"; host: string; detail: string };

/**
 * Pings the Supabase REST root with the anon key. Needs no tables to exist,
 * so it works against a brand-new, empty project.
 */
export async function checkSupabase(): Promise<SupabaseHealth> {
  const { url, anonKey, configured } = getSupabaseEnv();
  if (!configured) return { status: "unconfigured" };

  const host = new URL(url!).host;

  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: anonKey!, Authorization: `Bearer ${anonKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { status: "error", host, detail: `HTTP ${res.status}` };
    }
    return { status: "ok", host };
  } catch (err) {
    return {
      status: "error",
      host,
      detail: err instanceof Error ? err.message : "unknown error",
    };
  }
}
