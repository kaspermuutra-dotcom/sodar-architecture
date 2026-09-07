import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { TerminalMock } from "@/components/terminal-mock";

/** Cropped workspace preview + CTA to the public /terminal preview page. */
export function TerminalPreviewSection() {
  const t = useTranslations("Workspace");
  return (
    <section className="section-shell border-t border-border">
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end lg:gap-16">
        <div>
          <p className="section-kicker">{t("kicker")}</p>
          <h2 className="section-title mt-6">{t("title")}</h2>
        </div>
        <p className="max-w-lg text-lg leading-relaxed text-text-muted lg:justify-self-end">{t("intro")}</p>
      </div>

      <div className="relative mt-14 max-h-[440px] overflow-hidden rounded-2xl">
        <TerminalMock />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg to-transparent" />
      </div>
      <div className="mt-8 flex justify-center">
        <Link href="/terminal" className="button-secondary">
          {t("cta")}
        </Link>
      </div>
    </section>
  );
}
