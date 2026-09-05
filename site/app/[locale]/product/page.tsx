import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { CtaBanner } from "@/components/cta-banner";
import { ScanReveal } from "@/components/scan-reveal";
import { FlatListingPhoto, SodarWalkthroughFrame } from "@/components/scan-placeholders";
import { CapabilityGrid } from "@/components/capability-grid";
import { Pipeline } from "@/components/pipeline";
import { Link } from "@/i18n/navigation";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "ProductPage" });
  return { title: t("metaTitle"), description: t("metaDesc"), alternates: localeAlternates(locale, "/product") };
}

export default async function ProductPage({ params }: Params) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("ProductPage");
  const stages = t.raw("stages") as { label: string; sub: string; desc: string }[];

  return (
    <PageShell>
      <PageHero
        eyebrow={t("eyebrow")}
        title={t("title")}
        subtitle={t("sub")}
        actions={
          <>
            <Link href="/scan" className="button-primary">
              {t("ctaPrimary")} <span aria-hidden>↗</span>
            </Link>
            <Link href="/terminal" className="button-secondary">
              {t("ctaSecondary")}
            </Link>
          </>
        }
      />

      <section className="section-shell pt-0">
        <ScanReveal
          trigger="scrub"
          durationMs={1200}
          frameClassName="aspect-[16/9] shadow-2xl shadow-black/60"
          flat={<FlatListingPhoto label={t("flatLabel")} />}
          revealed={<SodarWalkthroughFrame label={t("revealedLabel")} />}
        />
      </section>

      <section className="section-shell border-t border-border">
        <p className="section-kicker">{t("stagesKicker")}</p>
        <h2 className="section-title mt-7">{t("stagesTitle")}</h2>
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-border bg-border md:grid-cols-3">
          {stages.map((s, i) => (
            <article key={s.label} className="bg-bg p-8 sm:p-10">
              <span className="font-mono text-xs text-text-faint">0{i + 1}</span>
              <h3 className="display mt-8 text-3xl text-text">{s.label}</h3>
              <p className="mt-1 font-mono text-[11px] text-text-muted">{s.sub}</p>
              <p className="mt-4 leading-relaxed text-text-muted">{s.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <Pipeline />

      <CapabilityGrid />

      <CtaBanner eyebrow={t("cta.eyebrow")} title={t("cta.title")} subtitle={t("cta.sub")} ctaLabel={t("cta.label")} ctaHref="/scan" />
    </PageShell>
  );
}
