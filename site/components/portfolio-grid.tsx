import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LoopVideo } from "@/components/loop-video";
import { PORTFOLIO_LISTED } from "@/lib/portfolio";

type Props = {
  /** Homepage variant: section chrome with a link to the full portfolio. On `/portfolio` the page supplies its own heading. */
  variant?: "home" | "index";
};

/**
 * The portfolio grid — the same ordered registry everywhere. The first
 * client scan is a real project card that links to its page; the sample
 * tiles keep their existing stills/clips and copy.
 */
export function PortfolioGrid({ variant = "index" }: Props) {
  const t = useTranslations("Portfolio");
  const samples = t.raw("samples") as { label: string; meta: string }[];

  const grid = (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {PORTFOLIO_LISTED.map((item) =>
        item.kind === "walkthrough" ? (
          <Link key={item.slug} href={`/portfolio/${item.slug}`} className="group block sm:col-span-2" aria-label={`${t(`items.${item.labelKey}.eyebrow`)} — ${item.title}`}>
            <div className="tile aspect-[3/4] border border-border sm:aspect-[3/2]">
              <img src={item.image} alt="" width={1600} height={1000} loading="lazy" decoding="async" />
            </div>
            <p className="section-kicker mt-4">{t(`items.${item.labelKey}.eyebrow`)}</p>
            <p className="display mt-2 text-2xl text-text">{item.title}</p>
            <p className="mt-1 text-sm text-text-muted">{item.client}</p>
            <p className="mt-1 text-xs text-text-muted">{t(`items.${item.labelKey}.type`)}</p>
            <span className="button-mini mt-4 group-hover:border-text">{t(`items.${item.labelKey}.cta`)}</span>
          </Link>
        ) : (
          <div key={`sample-${item.sampleIndex}`}>
            <div className="tile aspect-[3/4] border border-border">
              {item.clip ? <LoopVideo src={item.clip} poster={item.image} /> : <img src={item.image} alt="" />}
            </div>
            <p className="mt-4 text-sm text-text">{samples[item.sampleIndex]?.label}</p>
            <p className="mt-1 text-xs text-text-muted">{samples[item.sampleIndex]?.meta}</p>
          </div>
        ),
      )}
    </div>
  );

  if (variant === "home") {
    return (
      <section className="section-shell border-t border-border">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="section-kicker">{t("kicker")}</p>
            <h2 className="section-title mt-6">{t("homeTitle")}</h2>
          </div>
          <Link href="/portfolio" className="button-secondary">
            {t("viewAll")}
          </Link>
        </div>
        <div className="mt-14">{grid}</div>
      </section>
    );
  }
  return grid;
}
