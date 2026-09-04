import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { CtaBanner } from "@/components/cta-banner";
import { TerminalMock } from "@/components/terminal-mock";

export const metadata: Metadata = {
  title: "Workspace preview — Sodar",
  description: "A public, unauthenticated preview of the broker workspace. No real data.",
};

/**
 * Public PREVIEW only. The real workspace is a gated app (phase 2).
 * TODO(phase-2): replace with the authenticated workspace; this route stays
 * as the public marketing preview once that ships.
 */
export default async function TerminalPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <PageShell>
      <PageHero
        eyebrow="Public preview · no login, no real data"
        title="Every property, its status, and who opened it."
        subtitle="This is a static preview of the workspace every broker gets — properties, processing and publication status, and how many visitors opened each walkthrough viewer."
      />

      <section className="section-shell pt-0">
        <TerminalMock variant="full" />
      </section>

      <CtaBanner
        eyebrow="Yours once you publish"
        title="Your workspace starts empty — until your first scan."
        subtitle="Scan a property to see real numbers replace this preview."
        ctaLabel="Scan your first property"
        ctaHref="/product"
      />
    </PageShell>
  );
}
