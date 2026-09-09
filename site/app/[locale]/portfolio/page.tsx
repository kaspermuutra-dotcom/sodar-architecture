import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { PortfolioGrid } from "@/components/portfolio-grid";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Portfolio" });
  return { title: t("metaTitle"), description: t("metaDesc"), alternates: localeAlternates(locale, "/portfolio"), openGraph: { title: t("metaTitle"), description: t("metaDesc"), images: ["/media/portfolio/kaldapealse-tanav-2/t1/og.jpg"] } };
}

/** Portfolio index: every project in registry order, the first client scan first. */
export default async function PortfolioPage({ params }: Params) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Portfolio");
  return (
    <PageShell>
      <PageHero eyebrow={t("kicker")} title={t("title")} subtitle={t("sub")} />
      <section className="section-shell pt-0">
        <PortfolioGrid variant="index" />
      </section>
    </PageShell>
  );
}
