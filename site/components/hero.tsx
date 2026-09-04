"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { AnimatedHeading } from "@/components/animated-heading";
import { MosaicGrid } from "@/components/mosaic-grid";
import { SodarMark } from "@/components/logo";

/** Homepage hero — wordmark, serif headline, and the mosaic wall of room captures. */
export function Hero() {
  const t = useTranslations("Hero");
  const status = t.raw("status") as string[];
  const [line, setLine] = useState(0);
  const tick = useRef<number | null>(null);

  useEffect(() => {
    tick.current = window.setInterval(() => setLine((l) => (l + 1) % status.length), 2600);
    return () => {
      if (tick.current) window.clearInterval(tick.current);
    };
  }, [status.length]);

  return (
    <section className="relative isolate overflow-hidden">
      <div className="hairgrid pointer-events-none absolute inset-0 opacity-40" aria-hidden />
      <div className="relative mx-auto grid min-h-[calc(100dvh-72px)] max-w-[1440px] items-center gap-14 px-5 pb-16 pt-12 sm:px-8 lg:grid-cols-[1fr_1fr] lg:gap-16 lg:px-12">
        <div className="relative z-10">
          <p className="hero-enter hero-enter-1 flex items-center gap-4">
            <SodarMark size={20} className="text-text" />
            <span className="wordmark">Sodar</span>
          </p>
          <AnimatedHeading as="h1" lines={[t("headline1"), t("headline2")]} className="display mt-8 text-[clamp(2.7rem,4.4vw,5.4rem)]" />
          <p className="hero-enter hero-enter-3 mt-8 max-w-md text-lg leading-relaxed text-text-muted">{t("sub")}</p>
          <div className="hero-enter hero-enter-4 mt-9 flex flex-wrap gap-3">
            <Link href="/scan" target="_blank" rel="noopener noreferrer" className="button-primary">
              {t("ctaPrimary")} <span aria-hidden>↗</span>
            </Link>
            <a href="#pipeline" className="button-secondary">
              {t("ctaSecondary")}
            </a>
          </div>

          <div className="hero-enter hero-enter-5 mt-14 flex items-center gap-3 font-mono text-[11px] tracking-wide text-text-faint" dir="ltr">
            <span className="h-1.5 w-1.5 rounded-full bg-text shadow-[0_0_10px_rgba(244,242,238,.7)]" />
            <span className="ticker text-text-muted" aria-live="polite">{status[line]}</span>
            <span className="blink">▍</span>
          </div>
        </div>

        <div className="hero-enter hero-enter-2 relative">
          <MosaicGrid className="w-full" />
        </div>
      </div>
    </section>
  );
}
