"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { AnimatedHeading } from "@/components/animated-heading";
import { MosaicGrid } from "@/components/mosaic-grid";
import { SodarMark } from "@/components/logo";

/** Homepage hero — wordmark, serif headline, and the wall of room captures. */
export function Hero() {
  const t = useTranslations("Hero");

  return (
    <section className="relative">
      <div className="mx-auto grid min-h-[calc(100dvh-72px)] max-w-[1440px] items-center gap-14 px-5 pb-20 pt-14 sm:px-8 lg:grid-cols-[1fr_1fr] lg:gap-20 lg:px-12">
        <div>
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

        <div className="hero-enter hero-enter-2">
          <MosaicGrid className="w-full" />
        </div>
      </div>
    </section>
  );
}
