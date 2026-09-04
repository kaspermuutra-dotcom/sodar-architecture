"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/motion";

const LINES = [
  "No listing photo has ever walked itself.",
  "Buyers skip what they can't step inside.",
  "So we turned a phone into a scanner,",
  "and a scan into a place.",
];

/** Zobi-style thesis block: four serif lines, each word lit as the reader scrolls past. */
export function Manifesto() {
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
        <p className="section-kicker">Thesis</p>
        <div ref={root}>
          {LINES.map((line, li) => (
            <p key={li} className="display text-[clamp(2rem,4.6vw,4.4rem)] text-text">
              {line.split(" ").map((w, wi) => (
                <span key={wi} data-w className="inline-block">
                  {w}&nbsp;
                </span>
              ))}
            </p>
          ))}
          <p className="mt-10 max-w-xl text-lg leading-relaxed text-text-muted">
            A broker opens sodar.io on their phone, walks each room once while an AI capture assistant coaches the
            shot, and gets back a walkthrough buyers can move through. The first two rooms are free to preview. One
            payment finishes the property. Publishing into the CRM listing is one click.
          </p>
        </div>
      </div>
    </section>
  );
}
