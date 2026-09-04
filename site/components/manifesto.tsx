"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/motion";

/** Zobi-style thesis block: serif lines, each word lit as the reader scrolls past. */
export function Manifesto() {
  const t = useTranslations("Manifesto");
  const lines = t.raw("lines") as string[];
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const words = root.current!.querySelectorAll<HTMLElement>("[data-w]");
      if (prefersReducedMotion()) {
        gsap.set(words, { opacity: 1 });
        return;
      }
      gsap.set(words, { opacity: 0.16 });
      gsap.to(words, {
        opacity: 1,
        ease: "none",
        stagger: 0.06,
        scrollTrigger: { trigger: root.current, start: "top 75%", end: "bottom 45%", scrub: 0.4 },
      });
    },
    { scope: root },
  );

  return (
    <section className="section-shell border-t border-border">
      <div className="grid gap-10 lg:grid-cols-[1fr_3fr]">
        <p className="section-kicker">{t("kicker")}</p>
        <div ref={root}>
          {lines.map((line, li) => (
            <p key={li} className="display text-[clamp(2rem,4.6vw,4.4rem)] text-text">
              {line.split(" ").map((w, wi) => (
                <span key={wi} data-w className="inline-block">
                  {w}&nbsp;
                </span>
              ))}
            </p>
          ))}
          <p className="mt-10 max-w-xl text-lg leading-relaxed text-text-muted">{t("body")}</p>
        </div>
      </div>
    </section>
  );
}
