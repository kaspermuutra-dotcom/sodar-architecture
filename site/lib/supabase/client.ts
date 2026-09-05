import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";
let client: ReturnType<typeof createBrowserClient> | undefined;
export function browserSupabase() {
  const { url, anonKey, configured } = getSupabaseEnv();
  if (!configured) throw new Error("Supabase is not configured");
  return client ??= createBrowserClient(url!, anonKey!);
}
