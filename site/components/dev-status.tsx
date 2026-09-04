import { checkSupabase } from "@/lib/supabase/health";

const DOT: Record<string, string> = {
  ok: "var(--color-accent)",
  error: "#ef4444",
  unconfigured: "var(--color-text-muted)",
};
const LABEL: Record<string, string> = {
  ok: "supabase",
  error: "supabase down",
  unconfigured: "supabase not configured",
};

// Dev-only build signal. TODO(phase-2): drop from production layout, or gate on
// an internal flag.
export async function DevStatus() {
  const health = await checkSupabase();
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-text-muted">
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: DOT[health.status] }}
      />
      {LABEL[health.status]}
      {health.status === "ok" ? ` · ${health.host}` : null}
    </span>
  );
}
