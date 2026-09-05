import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { CtaBanner } from "@/components/cta-banner";
import { TerminalMock } from "@/components/terminal-mock";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "WorkspacePage" });
  return { title: t("metaTitle"), description: t("metaDesc"), alternates: localeAlternates(locale, "/terminal") };
}

/**
 * Public PREVIEW only. The real workspace is a gated app (phase 2).
 * TODO(phase-2): replace with the authenticated workspace; this route stays
 * as the public marketing preview once that ships.
 */
export default async function TerminalPage({ params }: Params) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("WorkspacePage");

  return (
    <PageShell>
      <PageHero eyebrow={t("eyebrow")} title={t("title")} subtitle={t("sub")} />
      <section className="section-shell pt-0">
        <TerminalMock variant="full" />
      </section>
      <CtaBanner eyebrow={t("cta.eyebrow")} title={t("cta.title")} subtitle={t("cta.sub")} ctaLabel={t("cta.label")} ctaHref="/scan" />
    </PageShell>
  );
}
