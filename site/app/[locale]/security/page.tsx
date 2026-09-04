import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { TrustPillars } from "@/components/trust-pillars";
import { CtaBanner } from "@/components/cta-banner";
import { Link } from "@/i18n/navigation";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "SecurityPage" });
  return { title: t("metaTitle"), description: t("metaDesc"), alternates: localeAlternates(locale, "/security") };
}

export default async function SecurityPage({ params }: Params) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("SecurityPage");
  const details = t.raw("details") as { title: string; desc: string }[];

  return (
    <PageShell>
      <PageHero eyebrow={t("eyebrow")} title={t("title")} subtitle={t("sub")} />

      <TrustPillars />

      <section className="section-shell border-t border-border">
        <p className="section-kicker">{t("detailKicker")}</p>
        <h2 className="section-title mt-7">{t("detailTitle")}</h2>
        <div className="mt-14 divide-y divide-border border-y border-border">
          {details.map((d) => (
            <div key={d.title} className="grid gap-2 py-6 sm:grid-cols-[1fr_1.6fr] sm:gap-8">
              <p className="text-text">{d.title}</p>
              <p className="text-text-muted">{d.desc}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-sm text-text-muted">
          {t("seeAlso")}{" "}
          <Link href="/legal/privacy" className="text-text hover:underline">{t("privacy")}</Link>,{" "}
          <Link href="/legal/data-processing" className="text-text hover:underline">{t("dpa")}</Link>.
        </p>
      </section>

      <CtaBanner eyebrow={t("cta.eyebrow")} title={t("cta.title")} subtitle={t("cta.sub")} ctaLabel={t("cta.label")} ctaHref="/security" />
    </PageShell>
  );
}
