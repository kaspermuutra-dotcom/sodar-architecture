import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { CtaBanner } from "@/components/cta-banner";
import { IntegrationShowcase } from "@/components/integration-showcase";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "IntegrationsPage" });
  return { title: t("metaTitle"), description: t("metaDesc"), alternates: localeAlternates(locale, "/integrations") };
}

export default async function IntegrationsPage({ params }: Params) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("IntegrationsPage");
  const conns = t.raw("conns") as { name: string; action: string }[];

  return (
    <PageShell>
      <PageHero eyebrow={t("eyebrow")} title={t("title")} subtitle={t("sub")} />

      <IntegrationShowcase />

      <section id="api" className="section-shell border-t border-border">
        <p className="section-kicker">{t("connKicker")}</p>
        <h2 className="section-title mt-7">{t("connTitle")}</h2>
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-border bg-border sm:grid-cols-2">
          {conns.map((c) => (
            <div key={c.name} className="card-scan flex items-center justify-between gap-4 bg-bg p-6">
              <div>
                <p className="text-text">{c.name}</p>
                <p className="mt-1 font-mono text-[11px] text-text-muted">
                  {/* TODO(phase-2): real CRM OAuth / API-key issuance flow. */}
                  {t("notConnected")}
                </p>
              </div>
              <button type="button" disabled title={t("mockTitle")} className="button-mini shrink-0 opacity-60">
                {c.action}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section id="embed" className="section-shell border-t border-border">
        <p className="section-kicker">{t("embedKicker")}</p>
        <h2 className="section-title mt-7">{t("embedTitle")}</h2>
        <p className="mt-7 max-w-xl text-lg text-text-muted">{t("embedBody")}</p>
        <div className="mt-8 overflow-x-auto rounded-2xl border border-border bg-bg-raised p-5" dir="ltr">
          <code className="whitespace-pre font-mono text-sm text-text">
{`<iframe
  src="https://view.sodar.io/l/84-kesklinn-ave"
  width="100%" height="600" loading="lazy"
  title="Sodar walkthrough — 84 Kesklinn Ave">
</iframe>`}
          </code>
        </div>
      </section>

      <CtaBanner eyebrow={t("cta.eyebrow")} title={t("cta.title")} subtitle={t("cta.sub")} ctaLabel={t("cta.label")} ctaHref="/partners" />
    </PageShell>
  );
}
