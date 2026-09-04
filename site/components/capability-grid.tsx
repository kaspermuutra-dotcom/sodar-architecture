import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** Seven capabilities plus a CTA tile, hairline grid, scan-line on hover. */
export function CapabilityGrid() {
  const t = useTranslations("Capabilities");
  const items = t.raw("items") as { title: string; desc: string }[];
  return (
    <section className="section-shell border-t border-border">
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-24">
        <p className="section-kicker">{t("kicker")}</p>
        <p className="max-w-xl self-end text-lg leading-relaxed text-text-muted">{t("intro")}</p>
      </div>
      <h2 className="section-title mt-7">{t("title")}</h2>
      <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => (
          <div key={item.title} className="card-scan bg-bg p-8 transition-colors hover:bg-bg-raised sm:p-9">
            <span className="font-mono text-[11px] text-text-faint">{String(i + 1).padStart(2, "0")}</span>
            <h3 className="display mt-8 text-2xl text-text">{item.title}</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-text-muted">{item.desc}</p>
          </div>
        ))}
        <Link href="/product" className="card-scan group flex flex-col justify-between bg-bg-raised p-8 transition-colors hover:bg-bg-elevated sm:p-9">
          <span className="font-mono text-[11px] text-text-faint">{String(items.length + 1).padStart(2, "0")}</span>
          <div>
            <h3 className="display text-2xl text-text">{t("cta.title")}</h3>
            <p className="mt-2.5 text-sm text-text-muted">{t("cta.desc")}</p>
            <span className="mt-6 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.16em] text-text transition-transform group-hover:translate-x-1">
              {t("cta.start")} <span aria-hidden>→</span>
            </span>
          </div>
        </Link>
      </div>
    </section>
  );
}
