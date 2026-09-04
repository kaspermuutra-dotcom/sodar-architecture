import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { CtaBanner } from "@/components/cta-banner";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "EnterprisePage" });
  return { title: t("metaTitle"), description: t("metaDesc"), alternates: localeAlternates(locale, "/enterprise") };
}

export default async function EnterprisePage({ params }: Params) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("EnterprisePage");
  const features = t.raw("features") as { title: string; desc: string }[];
  const tiers = t.raw("tiers") as { tier: string; price: string }[];

  return (
    <PageShell>
      <PageHero
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("sub")}
        actions={
          <a href="mailto:sales@sodar.io?subject=Sodar enterprise" className="button-primary">
            {t("talk")} <span aria-hidden>↗</span>
          </a>
        }
      />

      <section className="section-shell border-t border-border">
        <p className="section-kicker">{t("featKicker")}</p>
        <h2 className="section-title mt-7">{t("featTitle")}</h2>
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="card-scan bg-bg p-8 transition-colors hover:bg-bg-raised">
              <h3 className="display text-2xl text-text">{f.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-text-muted">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section-shell border-t border-border">
        <div className="grid gap-12 lg:grid-cols-[1fr_.8fr] lg:items-center">
          <div>
            <p className="section-kicker">{t("priceKicker")}</p>
            <h2 className="section-title mt-7">
              {t("priceTitle1")}
              <br />
              {t("priceTitle2")}
            </h2>
            <p className="mt-7 max-w-xl text-lg text-text-muted">{t("priceBody")}</p>
          </div>
          <div className="rounded-3xl border border-border bg-bg-raised p-8 sm:p-10">
            <p className="text-sm text-text-muted">{t("priceNote")}</p>
            <div className="mt-6 space-y-4 font-mono text-sm">
              {tiers.map((row) => (
                <div key={row.tier} className="flex items-center justify-between gap-4 border-b border-border pb-4">
                  <span className="text-text-muted">{row.tier}</span>
                  <span className="text-text">{row.price}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <CtaBanner eyebrow={t("cta.eyebrow")} title={t("cta.title")} subtitle={t("cta.sub")} ctaLabel={t("cta.label")} ctaHref="/enterprise" />
    </PageShell>
  );
}
