import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { CtaBanner } from "@/components/cta-banner";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "CareersPage" });
  return { title: t("metaTitle"), description: t("metaDesc"), alternates: localeAlternates(locale, "/careers") };
}

export default async function CareersPage({ params }: Params) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("CareersPage");

  return (
    <PageShell>
      <PageHero eyebrow={t("eyebrow")} title={t("title")} subtitle={t("sub")} />

      <section className="section-shell border-t border-border">
        <p className="section-kicker">{t("rolesKicker")}</p>
        <h2 className="section-title mt-6">{t("rolesTitle")}</h2>
        <p className="mt-8 max-w-xl text-lg leading-relaxed text-text-muted">{t("noFit")}</p>
      </section>

      <CtaBanner eyebrow={t("cta.eyebrow")} title={t("cta.title")} subtitle={t("cta.sub")} ctaLabel={t("cta.label")} ctaHref="/careers" />
    </PageShell>
  );
}
