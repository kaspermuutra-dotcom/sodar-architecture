import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** Seven capabilities plus a CTA tile on a hairline grid. */
export function CapabilityGrid() {
  const t = useTranslations("Capabilities");
  const items = t.raw("items") as { title: string; desc: string }[];
  return (
    <section className="section-shell border-t border-border">
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end lg:gap-16">
        <div>
          <p className="section-kicker">{t("kicker")}</p>
          <h2 className="section-title mt-6">{t("title")}</h2>
        </div>
        <p className="max-w-lg text-lg leading-relaxed text-text-muted lg:justify-self-end">{t("intro")}</p>
      </div>
      <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.title} className="bg-bg p-8 sm:p-9">
            <h3 className="display text-2xl text-text">{item.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-text-muted">{item.desc}</p>
          </div>
        ))}
        <Link href="/scan" className="group flex flex-col justify-end bg-bg-raised p-8 transition-colors hover:bg-bg-elevated sm:p-9 lg:col-span-2">
          <h3 className="display text-2xl text-text">{t("cta.title")}</h3>
          <p className="mt-3 text-sm text-text-muted">{t("cta.desc")}</p>
          <span className="mt-6 text-sm text-text underline-offset-4 group-hover:underline">{t("cta.start")}</span>
        </Link>
      </div>
    </section>
  );
}
