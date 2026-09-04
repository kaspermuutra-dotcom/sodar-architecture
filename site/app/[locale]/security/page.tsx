import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { TrustPillars } from "@/components/trust-pillars";
import { CtaBanner } from "@/components/cta-banner";
import { Link } from "@/i18n/navigation";

export const metadata: Metadata = {
  title: "Security & compliance — Sodar",
  description: "Data handling, AI disclosure, and compliance posture for the Sodar pipeline.",
};

const DETAILS: [string, string][] = [
  ["Storage", "Listing photos and rendered assets are encrypted at rest and in transit; access is scoped per broker account."],
  ["AI disclosure", "Every public walkthrough carries a visible label identifying it as an AI-rendered reconstruction."],
  ["Data retention", "Photos and renders are retained for the life of the listing plus a fixed grace period, then purged on request."],
  ["Access control", "API keys and CRM connections are scoped to the minimum permissions the integration needs."],
  ["Sub-processors", "Third-party rendering and payment providers are listed in the Data Processing addendum."],
  ["Incident response", "A documented process for reporting and disclosing security incidents to affected brokers."],
];

export default async function SecurityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <PageShell>
      <PageHero
        eyebrow="Trust & compliance"
        title="Built to be trusted with someone else's listing."
        subtitle="Sodar is designed toward SOC 2 and GDPR from day one — this page is the working summary; formal reports and DPAs are available on request."
      />

      <TrustPillars />

      <section className="section-shell border-t border-border">
        <div className="section-kicker">In detail</div>
        <h2 className="section-title mt-7">How data actually moves.</h2>
        <div className="mt-14 divide-y divide-border border-y border-border">
          {DETAILS.map(([title, desc]) => (
            <div key={title} className="grid gap-2 py-6 sm:grid-cols-[1fr_1.6fr] sm:gap-8">
              <p className="text-text">{title}</p>
              <p className="text-text-muted">{desc}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-sm text-text-muted">
          See also: <Link href="/legal/privacy" className="text-accent hover:underline">Privacy Policy</Link>,{" "}
          <Link href="/legal/data-processing" className="text-accent hover:underline">Data Processing Addendum</Link>.
        </p>
      </section>

      <CtaBanner
        eyebrow="Questions for security review"
        title="Need a security questionnaire answered?"
        subtitle="Reach out and we'll return a completed questionnaire or SOC 2 status directly."
        ctaLabel="Contact security"
        ctaHref="/security"
      />
    </PageShell>
  );
}
