"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { AnimatedHeading } from "@/components/animated-heading";
import { MosaicGrid } from "@/components/mosaic-grid";
import { SodarMark } from "@/components/logo";

/**
 * Homepage hero — wordmark, serif headline, and the drifting wall of listing
 * photographs. On large screens the wall sits to the right of the copy; on
 * small screens it becomes a full-bleed band under it.
 */
export function Hero() {
  const t = useTranslations("Hero");

  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid min-h-[calc(100dvh-72px)] max-w-[1440px] items-center gap-12 px-5 pb-16 pt-14 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10 lg:px-12">
        <div className="relative z-10 min-w-0">
          <p className="hero-enter hero-enter-1 flex items-center gap-4">
            <SodarMark size={20} className="text-text" />
            <span className="wordmark">Sodar</span>
          </p>
          <AnimatedHeading as="h1" lines={[t("headline1"), t("headline2")]} className="display mt-10 text-[clamp(2.6rem,4.4vw,5rem)]" />
          <p className="hero-enter hero-enter-3 mt-8 max-w-md text-lg leading-relaxed text-text-muted">{t("sub")}</p>
          <div className="hero-enter hero-enter-4 mt-10 flex flex-wrap gap-3">
            <Link href="/scan" target="_blank" rel="noopener noreferrer" className="button-primary">
              {t("ctaPrimary")}
            </Link>
            <a href="#film" className="button-secondary">
              {t("ctaSecondary")}
            </a>
          </div>
        </div>

        <div className="hero-enter hero-enter-2 -mx-5 min-w-0 sm:-mx-8 lg:mx-0">
          <MosaicGrid className="w-full min-w-0" />
        </div>
      </div>
    </section>
  );
}
