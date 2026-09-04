import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { CtaBanner } from "@/components/cta-banner";
import { PartnerApplyForm } from "@/components/partner-apply-form";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "PartnersPage" });
  return { title: t("metaTitle"), description: t("metaDesc"), alternates: localeAlternates(locale, "/partners") };
}

export default async function PartnersPage({ params }: Params) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("PartnersPage");
  const steps = t.raw("steps") as { title: string; desc: string }[];
  const dash = t.raw("dash") as { label: string; value: string }[];
  const faq = t.raw("faq") as { q: string; a: string }[];

  return (
    <PageShell>
      <PageHero
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("sub")}
        actions={
          <a href="#apply" className="button-primary">
            {t("apply")} <span aria-hidden>↗</span>
          </a>
        }
      />

      <section className="section-shell border-t border-border">
        <p className="section-kicker">{t("stepsKicker")}</p>
        <h2 className="section-title mt-7">{t("stepsTitle")}</h2>
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-border bg-border md:grid-cols-3">
          {steps.map((s, i) => (
            <article key={s.title} className="bg-bg p-8 sm:p-10">
              <span className="font-mono text-xs text-text-faint">0{i + 1}</span>
              <h3 className="display mt-8 text-3xl text-text">{s.title}</h3>
              <p className="mt-3 leading-relaxed text-text-muted">{s.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="dashboard" className="section-shell border-t border-border">
        <p className="section-kicker">{t("dashKicker")}</p>
        <h2 className="section-title mt-7">{t("dashTitle")}</h2>
        <div className="mt-14 overflow-hidden rounded-3xl border border-border bg-bg-raised">
          <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {dash.map((d) => (
              <div key={d.label} className="p-8">
                <p className="mono-label">{d.label}</p>
                <p className="display mt-3 text-4xl text-text" dir="ltr">{d.value}</p>
              </div>
            ))}
          </div>
          {/* TODO(phase-2): real partner dashboard — gated app, not a public mock. */}
        </div>
      </section>

      <section id="apply" className="section-shell border-t border-border">
        <div className="grid gap-12 lg:grid-cols-[1fr_.9fr] lg:items-start">
          <div>
            <p className="section-kicker">{t("applyKicker")}</p>
            <h2 className="section-title mt-7">{t("applyTitle")}</h2>
            <p className="mt-7 max-w-md text-lg text-text-muted">{t("applyBody")}</p>
          </div>
          <PartnerApplyForm />
        </div>
      </section>

      <section className="section-shell border-t border-border">
        <p className="section-kicker">{t("faqKicker")}</p>
        <h2 className="section-title mt-7">{t("faqTitle")}</h2>
        <div className="mt-14 divide-y divide-border border-y border-border">
          {faq.map((item) => (
            <div key={item.q} className="grid gap-2 py-6 sm:grid-cols-[1fr_1.4fr] sm:gap-8">
              <p className="text-text">{item.q}</p>
              <p className="text-text-muted">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      <CtaBanner eyebrow={t("cta.eyebrow")} title={t("cta.title")} subtitle={t("cta.sub")} ctaLabel={t("cta.label")} ctaHref="/partners#apply" />
    </PageShell>
  );
}
