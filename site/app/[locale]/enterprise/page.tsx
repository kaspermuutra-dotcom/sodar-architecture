import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { CtaBanner } from "@/components/cta-banner";

export const metadata: Metadata = {
  title: "Enterprise — Sodar",
  description: "Team seats, bulk listing scans, and shared Terminal rollups for brokerages.",
};

const FEATURES: [string, string][] = [
  ["Team seats", "Every agent gets their own Terminal; a firm-wide rollup sits above it for managers."],
  ["Bulk scanning", "Batch-submit a whole portfolio of listings instead of one at a time."],
  ["Volume pricing", "Per-listing price steps down as your firm's monthly volume grows."],
  ["Dedicated CRM setup", "We handle the OAuth / API wiring for your firm's specific CRM stack."],
  ["Co-branding", "Apply your brokerage's mark to every embedded walkthrough."],
  ["Priority render queue", "Enterprise listings render ahead of the self-serve queue."],
];

export default async function EnterprisePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <PageShell>
      <PageHero
        eyebrow="For brokerages"
        title="One Terminal for every agent on your team."
        subtitle="Bulk scanning, volume pricing, and a firm-wide engagement rollup — built for brokerages publishing dozens of listings a month."
        actions={<a href="mailto:sales@sodar.io?subject=Sodar enterprise" className="button-primary">Talk to sales <span>↗</span></a>}
      />

      <section className="section-shell border-t border-border">
        <div className="section-kicker">Built for teams</div>
        <h2 className="section-title mt-7">Everything self-serve, plus the parts a firm needs.</h2>
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([title, desc]) => (
            <div key={title} className="card-scan bg-bg p-8 transition-colors hover:bg-bg-raised">
              <h3 className="text-lg tracking-tight">{title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-text-muted">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section-shell border-t border-border">
        <div className="grid gap-12 lg:grid-cols-[1fr_.8fr] lg:items-center">
          <div>
            <div className="section-kicker">Pricing that scales down</div>
            <h2 className="section-title mt-7">
              Volume pricing,
              <br />
              one contract.
            </h2>
            <p className="mt-7 max-w-xl text-lg text-text-muted">
              Custom per-listing rate based on monthly volume, plus a flat seat fee per agent. Talk to sales for a
              quote sized to your firm.
            </p>
          </div>
          <div className="rounded-3xl border border-border bg-bg-raised p-8 sm:p-10">
            <p className="text-sm text-text-muted">Illustrative, per listing</p>
            <div className="mt-6 space-y-4 font-mono text-sm">
              {[
                ["1–20 listings / mo", "$49"],
                ["21–100 listings / mo", "$39"],
                ["100+ listings / mo", "Custom"],
              ].map(([tier, price]) => (
                <div key={tier} className="flex items-center justify-between border-b border-border pb-4">
                  <span className="text-text-muted">{tier}</span>
                  <span className="text-text">{price}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <CtaBanner
        eyebrow="Enterprise"
        title="Bring your whole firm's listings online."
        subtitle="We'll set up your CRM connection and seat structure together."
        ctaLabel="Talk to sales"
        ctaHref="/enterprise"
      />
    </PageShell>
  );
}
