import { useTranslations } from "next-intl";

/** Four-pillar trust block. */
export function TrustPillars() {
  const t = useTranslations("Trust");
  const items = t.raw("items") as { title: string; desc: string }[];
  return (
    <section id="security" className="section-shell border-t border-border">
      <p className="section-kicker">{t("kicker")}</p>
      <h2 className="section-title mt-6">{t("title")}</h2>
      <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.title} className="bg-bg p-8">
            <h3 className="display text-2xl text-text">{item.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-text-muted">{item.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
