import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** One-card teaser for the CRM partner program. */
export function PartnerTeaser() {
  const t = useTranslations("Partner");
  return (
    <section className="section-shell border-t border-border">
      <div className="grid gap-8 rounded-2xl border border-border bg-bg-raised p-8 sm:p-12 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h2 className="display mt-5 max-w-2xl text-[clamp(1.9rem,3.6vw,3.2rem)] text-text">{t("title")}</h2>
          <p className="mt-4 max-w-xl text-text-muted">{t("body")}</p>
        </div>
        <Link href="/partners" className="button-secondary shrink-0">
          {t("cta")}
        </Link>
      </div>
    </section>
  );
}
