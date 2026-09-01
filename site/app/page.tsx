import { checkSupabase } from "@/lib/supabase/health";

// Run the health check on every request rather than baking it in at build time.
export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  ok: "Supabase connected",
  error: "Supabase unreachable",
  unconfigured: "Supabase not configured",
};

const DOT: Record<string, string> = {
  ok: "#22c55e",
  error: "#ef4444",
  unconfigured: "#a1a1aa",
};

export default async function Home() {
  const health = await checkSupabase();

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1
          style={{
            fontSize: "clamp(2rem, 8vw, 3.5rem)",
            fontWeight: 600,
            letterSpacing: "-0.03em",
            margin: 0,
          }}
        >
          Sodar
        </h1>

        <p
          style={{
            marginTop: "0.75rem",
            opacity: 0.6,
            fontSize: "1rem",
          }}
        >
          sodar.io
        </p>

        <p
          style={{
            marginTop: "2.5rem",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.8125rem",
            opacity: 0.55,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          <span
            aria-hidden
            style={{
              width: "0.5rem",
              height: "0.5rem",
              borderRadius: "50%",
              background: DOT[health.status],
              display: "inline-block",
            }}
          />
          {LABEL[health.status]}
          {health.status !== "unconfigured" ? ` · ${health.host}` : null}
          {health.status === "error" ? ` · ${health.detail}` : null}
        </p>
      </div>
    </main>
  );
}
