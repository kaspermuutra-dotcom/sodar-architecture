const BEFORE = ["Book a photographer", "Wait 2–3 days", "Flat photos", "Buyers scroll past", "Nothing measured"];
const AFTER = ["One phone, one walk", "Preview in minutes", "Immersive walkthrough", "Buyers step inside", "Every viewer opened, counted"];

/** Before / after — the Alven "roles collapse" chart, adapted to listing prep. */
export function ImpactStats() {
  return (
    <section className="section-shell pt-0">
      <div className="relative overflow-hidden rounded-[2rem] border border-border bg-bg-raised px-7 py-12 sm:px-12 sm:py-16 lg:px-20 lg:py-24">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -right-4 -top-4 h-44 w-44 rounded-full border border-white/10" />
        <p className="section-kicker">Illustrative · not measured yet</p>
        <h2 className="display mt-8 max-w-2xl text-[clamp(2.6rem,5.4vw,4.8rem)] text-text">The difference a scan makes.</h2>
        <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <div className="rounded-2xl border border-border p-6">
            <p className="mono-label">Before</p>
            <ul className="mt-4 space-y-2.5">
              {BEFORE.map((b) => (
                <li key={b} className="flex items-center gap-3 text-sm text-text-muted line-through decoration-white/30">
                  <span className="h-1 w-1 rounded-full bg-text-faint" /> {b}
                </li>
              ))}
            </ul>
          </div>
          <p className="display text-center text-5xl text-text-faint">→</p>
          <div className="rounded-2xl border border-border-strong bg-bg p-6">
            <p className="mono-label text-text">After · with Sodar</p>
            <ul className="mt-4 space-y-2.5">
              {AFTER.map((a) => (
                <li key={a} className="flex items-center gap-3 text-sm text-text">
                  <span className="h-1 w-1 rounded-full bg-text" /> {a}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
