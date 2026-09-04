import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { CtaBanner } from "@/components/cta-banner";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "AboutPage" });
  return { title: t("metaTitle"), description: t("metaDesc"), alternates: localeAlternates(locale, "/about") };
}

export default async function AboutPage({ params }: Params) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("AboutPage");
  const thesis = t.raw("thesis") as string[];
  const values = t.raw("values") as { title: string; desc: string }[];

  return (
    <PageShell>
      <PageHero eyebrow={t("eyebrow")} title={t("title")} subtitle={t("sub")} />

      <section className="section-shell border-t border-border">
        <p className="section-kicker">{t("thesisKicker")}</p>
        <h2 className="section-title mt-7">{t("thesisTitle")}</h2>
        <div className="mt-10 max-w-2xl space-y-5 text-lg leading-relaxed text-text-muted">
          {thesis.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      </section>

      <section className="section-shell border-t border-border">
        <p className="section-kicker">{t("valuesKicker")}</p>
        <h2 className="section-title mt-7">{t("valuesTitle")}</h2>
        <div className="mt-14 grid gap-8 sm:grid-cols-3">
          {values.map((v) => (
            <div key={v.title}>
              <h3 className="display text-2xl text-text">{v.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-text-muted">{v.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <CtaBanner eyebrow={t("cta.eyebrow")} title={t("cta.title")} subtitle={t("cta.sub")} ctaLabel={t("cta.label")} ctaHref="/careers" />
    </PageShell>
  );
}
