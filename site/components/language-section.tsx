import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/language-switcher";

/** The language switcher as its own beat, not a footer afterthought. */
export function LanguageSection() {
  const t = useTranslations("Language");
  return (
    <section className="section-shell border-t border-border">
      <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-20">
        <div>
          <p className="section-kicker">{t("kicker")}</p>
          <h2 className="section-title mt-7">
            {t("title1")}
            <br />
            {t("title2")}
          </h2>
          <p className="mt-7 max-w-lg text-lg text-text-muted">{t("body")}</p>
        </div>
        <LanguageSwitcher />
      </div>
    </section>
  );
}
