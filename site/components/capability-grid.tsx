import { Link } from "@/i18n/navigation";

const CAPABILITIES: [string, string, string][] = [
  ["01", "Guided phone capture", "No rig, no photographer. The camera walks you through each room as a panorama, straight from the browser."],
  ["02", "AI capture assistant", "Live coaching on coverage, position and image quality while you're still inside the property."],
  ["03", "Free two-room preview", "A working walkthrough of the first two rooms before any payment, so you judge the finished quality first."],
  ["04", "One-time property price", "A single quote sized to the property — panoramas, compute, hosting and maintenance included."],
  ["05", "CRM publishing", "Connect your CRM, pick the listing, publish. The walkthrough stays inside the listing through the embedded viewer."],
  ["06", "Approved appearance", "Adjust the viewer's look within the approved settings so it matches the listing it lives in."],
  ["07", "Broker workspace", "Manage properties, watch processing and publication status, and see how many visitors opened the viewer."],
];

/** Seven capabilities, hairline grid, scan-line on hover. */
export function CapabilityGrid() {
  return (
    <section className="section-shell border-t border-border">
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-24">
        <p className="section-kicker">What ships</p>
        <p className="max-w-xl self-end text-lg leading-relaxed text-text-muted">
          Three connected surfaces — a public site, a guided mobile scan, and a broker workspace — behind one walkthrough.
        </p>
      </div>
      <h2 className="section-title mt-7">One scan, seven things a listing gains.</h2>
      <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map(([n, title, desc]) => (
          <div key={title} className="card-scan bg-bg p-8 transition-colors hover:bg-bg-raised sm:p-9">
            <span className="font-mono text-[11px] text-text-faint">{n}</span>
            <h3 className="display mt-8 text-2xl text-text">{title}</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-text-muted">{desc}</p>
          </div>
        ))}
        <Link href="/product" className="card-scan group flex flex-col justify-between bg-bg-raised p-8 transition-colors hover:bg-bg-elevated sm:p-9">
          <span className="font-mono text-[11px] text-text-faint">08</span>
          <div>
            <h3 className="display text-2xl text-text">Scan a property</h3>
            <p className="mt-2.5 text-sm text-text-muted">Two rooms free. Start on your phone.</p>
            <span className="mt-6 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.16em] text-text transition-transform group-hover:translate-x-1">Start <span aria-hidden>→</span></span>
          </div>
        </Link>
      </div>
    </section>
  );
}
