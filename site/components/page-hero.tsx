import type { ReactNode } from "react";
import { AnimatedHeading } from "@/components/animated-heading";

export function PageHero({ eyebrow, title, subtitle, actions }: { eyebrow: string; title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <section className="mx-auto max-w-[1440px] px-5 pb-16 pt-20 sm:px-8 sm:pt-28 lg:px-12">
      <div className="max-w-3xl">
        <p className="eyebrow">{eyebrow}</p>
        <AnimatedHeading as="h1" lines={[title]} className="display mt-6 text-[clamp(2.6rem,5.4vw,5rem)]" />
        {subtitle ? <p className="mt-7 max-w-xl text-lg leading-relaxed text-text-muted">{subtitle}</p> : null}
        {actions ? <div className="mt-9 flex flex-wrap gap-3">{actions}</div> : null}
      </div>
    </section>
  );
}
