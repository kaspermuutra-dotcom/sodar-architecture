import { getSupabaseEnv } from "./env";

export type SupabaseHealth =
  | { status: "unconfigured" }
  | { status: "ok"; host: string }
  | { status: "error"; host: string; detail: string };

/**
 * Pings the Auth settings endpoint with the publishable key.
 *
 * Deliberately NOT `/rest/v1/` — that root path serves the OpenAPI spec and
 * is restricted to secret keys ("Only secret API keys can be used for this
 * endpoint"), so a perfectly good publishable key fails there. `/auth/v1/
 * settings` returns public project settings, requires a valid key, and needs
 * no tables to exist — so it works against an empty database.
 *
 * The key goes in the `apikey` header only. Sending it as `Authorization:
 * Bearer` invites the gateway to parse it as a JWT, which it is not.
 */
export async function checkSupabase(): Promise<SupabaseHealth> {
  const { url, anonKey, configured } = getSupabaseEnv();
  if (!configured) return { status: "unconfigured" };

  const host = new URL(url!).host;

  try {
    const res = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: anonKey! },
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
