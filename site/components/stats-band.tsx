"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/motion";

const STATS: { value: number; suffix: string; prefix?: string; label: string; note: string }[] = [
  { value: 2, suffix: "", label: "rooms free", note: "Working preview before any payment" },
  { value: 1, suffix: "", label: "one-time price", note: "Sized to the property. No subscription" },
  { value: 15, suffix: "%", label: "partner margin", note: "For CRMs distributing Sodar" },
  { value: 360, suffix: "°", label: "per room", note: "Panorama capture guided live by AI" },
];

/** Four tabular counters that count up once when they enter the viewport. */
export function StatsBand() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const nums = root.current!.querySelectorAll<HTMLElement>("[data-count]");
      const reduced = prefersReducedMotion();
      nums.forEach((n) => {
        const target = Number(n.dataset.count);
        if (reduced) {
          n.textContent = String(target);
          return;
        }
        const obj = { v: 0 };
        gsap.to(obj, {
          v: target,
          duration: 1.6,
          ease: "power3.out",
          scrollTrigger: { trigger: n, start: "top 85%", once: true },
          onUpdate: () => {
            n.textContent = String(Math.round(obj.v));
          },
        });
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className="border-t border-border">
      <div className="mx-auto grid max-w-[1440px] divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        {STATS.map((s) => (
          <div key={s.label} className="px-5 py-10 sm:px-8 lg:px-12 lg:py-14">
            <p className="display num text-[clamp(3rem,6vw,5.5rem)] leading-none text-text">
              {s.prefix}
              <span data-count={s.value}>0</span>
              {s.suffix}
            </p>
            <p className="mt-3 text-sm text-text">{s.label}</p>
            <p className="mt-1 font-mono text-[11px] text-text-muted">{s.note}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
