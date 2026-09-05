import { useTranslations } from "next-intl";

/** Social proof under the hero: the number of brokerages already scanning. */
export function ProofStrip() {
  const t = useTranslations("Proof");
  return (
    <section className="border-t border-border">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-5 py-8 sm:flex-row sm:items-center sm:gap-8 sm:px-8 lg:px-12">
        <p className="display num text-[clamp(2.6rem,5vw,4.4rem)] leading-none text-text" dir="ltr">{t("count")}</p>
        <div>
          <p className="text-lg text-text">{t("line")}</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[.16em] text-text-muted">{t("note")}</p>
        </div>
      </div>
    </section>
  );
}
