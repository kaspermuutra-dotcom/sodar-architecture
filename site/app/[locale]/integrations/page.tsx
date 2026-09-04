import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { CtaBanner } from "@/components/cta-banner";
import { IntegrationShowcase } from "@/components/integration-showcase";

export const metadata: Metadata = {
  title: "Integrations — Sodar",
  description: "Connect a CRM or grant API access so new listings auto-embed their Sodar walkthrough.",
};

const CRMS: [string, string][] = [
  ["Generic CRM OAuth", "Connect"],
  ["City24 MLS feed", "Connect"],
  ["Custom REST API", "Generate key"],
  ["Zapier / webhook", "Coming soon"],
];

export default async function IntegrationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <PageShell>
      <PageHero
        eyebrow="Integration hub"
        title="Connect once. Every listing after that is automatic."
        subtitle="OAuth into your CRM, or grant Sodar scoped API access — new listings scan, render, and embed without a second click."
      />

      <IntegrationShowcase />

      <section id="api" className="section-shell border-t border-border">
        <div className="section-kicker">Connections</div>
        <h2 className="section-title mt-7">Pick how Sodar reaches your listings.</h2>
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-border bg-border sm:grid-cols-2">
          {CRMS.map(([name, action]) => (
            <div key={name} className="card-scan flex items-center justify-between gap-4 bg-bg p-6">
              <div>
                <p className="text-text">{name}</p>
                <p className="mt-1 font-mono text-[11px] text-text-muted">
                  {/* TODO(phase-2): real CRM OAuth / API-key issuance flow. */}
                  status: not connected
                </p>
              </div>
              <button
                type="button"
                disabled
                title="Mock connection — wired in phase 2"
                className="button-mini shrink-0 opacity-60"
              >
                {action}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section id="embed" className="section-shell border-t border-border">
        <div className="section-kicker">No CRM? No problem</div>
        <h2 className="section-title mt-7">One iframe, dropped anywhere.</h2>
        <p className="mt-7 max-w-xl text-lg text-text-muted">
          Every unlocked walkthrough gets a stable embed URL. Paste it into any listing portal that accepts a
          custom iframe.
        </p>
        <div className="mt-8 overflow-x-auto rounded-2xl border border-border bg-bg-raised p-5">
          <code className="whitespace-pre font-mono text-sm text-accent">
{`<iframe
  src="https://view.sodar.io/l/84-kesklinn-ave"
  width="100%" height="600" loading="lazy"
  title="Sodar walkthrough — 84 Kesklinn Ave">
</iframe>`}
          </code>
        </div>
      </section>

      <CtaBanner
        eyebrow="Bring your CRM"
        title="Sodar fits the tools you already use."
        subtitle="Talk to us about a launch-priority integration, or start with the generic embed today."
        ctaLabel="Explore the partner program"
        ctaHref="/partners"
      />
    </PageShell>
  );
}
