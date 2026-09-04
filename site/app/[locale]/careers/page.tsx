import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { CtaBanner } from "@/components/cta-banner";

export const metadata: Metadata = {
  title: "Careers — Sodar",
  description: "Open roles at Sodar.",
};

const ROLES: [string, string, string][] = [
  ["Spatial ML Engineer", "Reconstruction", "Remote / Tallinn"],
  ["Founding Frontend Engineer", "Product", "Remote / Tallinn"],
  ["Broker Success Lead", "Go-to-market", "Tallinn"],
];

export default async function CareersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <PageShell>
      <PageHero
        eyebrow="Careers"
        title="Help every listing render properly."
        subtitle="Small team, early stage, real customers already scanning listings. We're hiring across reconstruction, product, and go-to-market."
      />

      <section className="section-shell border-t border-border">
        <div className="section-kicker">Open roles</div>
        <h2 className="section-title mt-7">Currently hiring.</h2>
        <div className="mt-14 divide-y divide-border border-y border-border">
          {ROLES.map(([title, team, location]) => (
            <a
              key={title}
              href={`mailto:careers@sodar.io?subject=${encodeURIComponent(title)}`}
              className="group flex flex-col justify-between gap-2 py-6 transition-colors hover:text-accent sm:flex-row sm:items-center"
            >
              <div>
                <p className="text-lg text-text group-hover:text-accent">{title}</p>
                <p className="mt-1 font-mono text-xs text-text-muted">{team}</p>
              </div>
              <div className="flex items-center gap-6">
                <span className="text-sm text-text-muted">{location}</span>
                <span aria-hidden className="text-text-muted transition-transform group-hover:translate-x-1 group-hover:text-accent">↗</span>
              </div>
            </a>
          ))}
        </div>
        <p className="mt-8 text-sm text-text-muted">Don&apos;t see a fit? Write to careers@sodar.io anyway.</p>
      </section>

      <CtaBanner
        eyebrow="No open role yet?"
        title="We're small enough that one email reaches a founder."
        subtitle="Tell us what you'd want to work on."
        ctaLabel="Email careers@sodar.io"
        ctaHref="/careers"
      />
    </PageShell>
  );
}
