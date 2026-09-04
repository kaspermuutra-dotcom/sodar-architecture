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
  const roles = t.raw("roles") as { title: string; team: string; location: string }[];

  return (
    <PageShell>
      <PageHero eyebrow={t("eyebrow")} title={t("title")} subtitle={t("sub")} />

      <section className="section-shell border-t border-border">
        <p className="section-kicker">{t("rolesKicker")}</p>
        <h2 className="section-title mt-7">{t("rolesTitle")}</h2>
        <div className="mt-14 divide-y divide-border border-y border-border">
          {roles.map((r) => (
            <a
              key={r.title}
              href={`mailto:careers@sodar.io?subject=${encodeURIComponent(r.title)}`}
              className="group flex flex-col justify-between gap-2 py-6 sm:flex-row sm:items-center"
            >
              <div>
                <p className="text-lg text-text">{r.title}</p>
                <p className="mt-1 font-mono text-xs text-text-muted">{r.team}</p>
              </div>
              <div className="flex items-center gap-6">
                <span className="text-sm text-text-muted">{r.location}</span>
                <span aria-hidden className="text-text-muted transition-transform group-hover:translate-x-1 group-hover:text-text">↗</span>
              </div>
            </a>
          ))}
        </div>
        <p className="mt-8 text-sm text-text-muted">{t("noFit")}</p>
      </section>

      <CtaBanner eyebrow={t("cta.eyebrow")} title={t("cta.title")} subtitle={t("cta.sub")} ctaLabel={t("cta.label")} ctaHref="/careers" />
    </PageShell>
  );
}
