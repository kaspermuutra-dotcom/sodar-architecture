import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** One-card teaser for the CRM partner program. */
export function PartnerTeaser() {
  const t = useTranslations("Partner");
  return (
    <section className="section-shell border-t border-border">
      <Link
        href="/partners"
        className="card-scan group grid gap-8 rounded-3xl border border-border bg-bg-raised p-8 transition-colors hover:border-border-strong sm:p-12 lg:grid-cols-[1fr_auto] lg:items-center"
      >
        <div>
          <p className="eyebrow">
            <span />
            {t("eyebrow")}
          </p>
          <h2 className="display mt-5 max-w-2xl text-[clamp(2rem,4.4vw,3.6rem)] text-text">{t("title")}</h2>
          <p className="mt-4 max-w-xl text-text-muted">{t("body")}</p>
        </div>
        <span className="button-secondary shrink-0">
          {t("cta")} <span aria-hidden>↗</span>
        </span>
      </Link>
    </section>
  );
}
