import { useTranslations } from "next-intl";

/** Before / after — listing preparation without and with Sodar. */
export function ImpactStats() {
  const t = useTranslations("Impact");
  const before = t.raw("before") as string[];
  const after = t.raw("after") as string[];
  return (
    <section className="section-shell pt-0">
      <div className="rounded-2xl border border-border bg-bg-raised px-7 py-12 sm:px-12 sm:py-16 lg:px-20 lg:py-20">
        <p className="section-kicker">{t("kicker")}</p>
        <h2 className="display mt-6 max-w-2xl text-[clamp(2.1rem,4.2vw,4rem)] text-text">{t("title")}</h2>
        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-border p-6">
            <p className="mono-label">{t("beforeLabel")}</p>
            <ul className="mt-5 space-y-3">
              {before.map((b) => (
                <li key={b} className="text-sm text-text-muted">{b}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-border-strong bg-bg p-6">
            <p className="mono-label text-text">{t("afterLabel")}</p>
            <ul className="mt-5 space-y-3">
              {after.map((a) => (
                <li key={a} className="text-sm text-text">{a}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
