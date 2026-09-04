import type { ReactNode } from "react";
import { AnimatedHeading } from "@/components/animated-heading";

export function PageHero({ eyebrow, title, subtitle, actions }: { eyebrow: string; title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <section className="relative mx-auto max-w-[1440px] px-5 pb-14 pt-20 sm:px-8 sm:pt-28 lg:px-12">
      <div className="hairgrid pointer-events-none absolute inset-0 opacity-30" aria-hidden />
      <div className="relative z-10 max-w-3xl">
        <p className="eyebrow">
          <span /> {eyebrow}
        </p>
        <AnimatedHeading as="h1" lines={[title]} className="display mt-6 text-[clamp(2.8rem,6.4vw,6.2rem)]" />
        {subtitle ? <p className="mt-6 max-w-xl text-lg leading-relaxed text-text-muted">{subtitle}</p> : null}
        {actions ? <div className="mt-8 flex flex-wrap gap-3">{actions}</div> : null}
      </div>
    </section>
  );
}
