const PILLARS: [string, string, string][] = [
  ["01", "Camera permission, explicit", "Sodar asks for the device camera only when you start a scan and uses it only for that capture."],
  ["02", "AI disclosure", "Every published walkthrough carries a clear, visible label that it is an AI-processed reconstruction."],
  ["03", "Security", "Built toward SOC 2 and GDPR from day one — encrypted storage, scoped CRM credentials, audit logs per property."],
  ["04", "Broker data ownership", "Captures, walkthroughs and engagement data belong to the broker. Disconnecting Sodar exports everything."],
];

/** Four-pillar trust block. */
export function TrustPillars() {
  return (
    <section id="security" className="section-shell border-t border-border">
      <p className="section-kicker">Built to be trusted with listings</p>
      <h2 className="section-title mt-7">Compliance isn&apos;t an afterthought.</h2>
      <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-border bg-border sm:grid-cols-2">
        {PILLARS.map(([n, title, desc]) => (
          <div key={title} className="bg-bg p-8">
            <span className="font-mono text-[11px] text-text-faint">{n}</span>
            <h3 className="display mt-6 text-2xl text-text">{title}</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-text-muted">{desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
