import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** Pricing teaser → /pricing. One-time, per property, quoted after the free preview. */
export function PricingTeaser() {
  const t = useTranslations("PricingTeaser");
  const factors = t.raw("card.factors") as string[];
  return (
    <section id="pricing" className="section-shell border-t border-border">
      <div className="grid gap-12 lg:grid-cols-[1fr_.8fr] lg:items-center">
        <div>
          <p className="section-kicker">{t("kicker")}</p>
          <h2 className="section-title mt-7">
            {t("title1")}
            <br />
            {t("title2")}
          </h2>
          <p className="mt-7 max-w-xl text-lg text-text-muted">{t("body")}</p>
          <Link href="/pricing" className="button-secondary mt-8">
            {t("cta")} <span aria-hidden>↗</span>
          </Link>
        </div>
        <div className="rounded-3xl border border-border-strong bg-bg-raised p-8 sm:p-10">
          <p className="mono-label">{t("card.label")}</p>
          <p className="display mt-4 text-6xl text-text" dir="ltr">{t("card.price")}</p>
          <p className="mt-2 font-mono text-[11px] text-text-muted">{t("card.note")}</p>
          <ul className="my-8 space-y-3 border-y border-border py-7 text-sm">
            {factors.map((x) => (
              <li key={x} className="flex gap-3 text-text-muted">
                <span className="text-text">—</span>
                {x}
              </li>
            ))}
          </ul>
          <Link href="/scan" className="button-primary w-full justify-center">
            {t("card.cta")} <span aria-hidden>↗</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
