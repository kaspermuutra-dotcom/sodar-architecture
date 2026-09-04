import { useTranslations } from "next-intl";

/** Four-pillar trust block. */
export function TrustPillars() {
  const t = useTranslations("Trust");
  const items = t.raw("items") as { title: string; desc: string }[];
  return (
    <section id="security" className="section-shell border-t border-border">
      <p className="section-kicker">{t("kicker")}</p>
      <h2 className="section-title mt-7">{t("title")}</h2>
      <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-border bg-border sm:grid-cols-2">
        {items.map((item, i) => (
          <div key={item.title} className="bg-bg p-8">
            <span className="font-mono text-[11px] text-text-faint">{String(i + 1).padStart(2, "0")}</span>
            <h3 className="display mt-6 text-2xl text-text">{item.title}</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-text-muted">{item.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
