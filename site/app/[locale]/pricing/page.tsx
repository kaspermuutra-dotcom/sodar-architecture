import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { CtaBanner } from "@/components/cta-banner";
import { Link } from "@/i18n/navigation";

type Params = { params: Promise<{ locale: string }> };
type Tier = { name: string; price: string; unit: string; desc: string; features: string[]; cta: string };
const TIER_HREFS = ["/product", "/enterprise", "/partners"];

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "PricingPage" });
  return { title: t("metaTitle"), description: t("metaDesc"), alternates: localeAlternates(locale, "/pricing") };
}

export default async function PricingPage({ params }: Params) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("PricingPage");
  const tiers = t.raw("tiers") as Tier[];
  const factors = t.raw("factors") as { title: string; desc: string }[];
  const faq = t.raw("faq") as { q: string; a: string }[];

  return (
    <PageShell>
      <PageHero eyebrow={t("eyebrow")} title={t("title")} subtitle={t("sub")} />

      <section className="section-shell pt-0">
        <div className="grid gap-6 lg:grid-cols-3">
          {tiers.map((tier, i) => {
            const highlight = i === 1;
            return (
              <div key={tier.name} className={`flex flex-col rounded-3xl border p-8 sm:p-10 ${highlight ? "border-border-strong bg-bg-raised" : "border-border bg-bg"}`}>
                {highlight ? (
                  <span className="mb-4 inline-flex w-fit items-center rounded-full border border-border-strong px-3 py-1 font-mono text-[10px] uppercase tracking-[.14em] text-text">{t("badge")}</span>
                ) : null}
                <p className="text-sm text-text-muted">{tier.name}</p>
                <p className="display mt-3 text-5xl text-text">{tier.price}</p>
                <p className="mt-2 font-mono text-[11px] text-text-muted">{tier.unit}</p>
                <p className="mt-5 text-sm leading-relaxed text-text-muted">{tier.desc}</p>
                <ul className="my-8 flex-1 space-y-3 border-y border-border py-7 text-sm">
                  {tier.features.map((f) => (
                    <li key={f} className="flex gap-3 text-text-muted">
                      <span className="text-text">—</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href={TIER_HREFS[i] ?? "/product"} className={highlight ? "button-primary w-full justify-center" : "button-secondary w-full justify-center"}>
                  {tier.cta} <span aria-hidden>↗</span>
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section-shell border-t border-border">
        <p className="section-kicker">{t("factorsKicker")}</p>
        <h2 className="section-title mt-7">{t("factorsTitle")}</h2>
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {factors.map((f, i) => (
            <div key={f.title} className="bg-bg p-8">
              <span className="font-mono text-[11px] text-text-faint">0{i + 1}</span>
              <h3 className="display mt-6 text-2xl text-text">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">{f.desc}</p>
            </div>
          ))}
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

      <CtaBanner eyebrow={t("cta.eyebrow")} title={t("cta.title")} subtitle={t("cta.sub")} ctaLabel={t("cta.label")} ctaHref="/product" />
    </PageShell>
  );
}
