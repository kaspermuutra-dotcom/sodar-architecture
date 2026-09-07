import { useTranslations } from "next-intl";

/** One quiet line under the hero. */
export function ProofStrip() {
  const t = useTranslations("Proof");
  return (
    <section className="border-t border-border">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-5 py-7 sm:flex-row sm:items-baseline sm:justify-between sm:px-8 lg:px-12">
        <p className="text-base text-text">{t("line")}</p>
        <p className="section-kicker">{t("note")}</p>
      </div>
    </section>
  );
}
