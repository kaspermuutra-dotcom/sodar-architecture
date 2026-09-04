"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/motion";

const VALUES: { value: number; suffix: string }[] = [
  { value: 2, suffix: "" },
  { value: 1, suffix: "" },
  { value: 15, suffix: "%" },
  { value: 360, suffix: "°" },
];

/** Four tabular counters that count up once when they enter the viewport. */
export function StatsBand() {
  const t = useTranslations("Stats");
  const items = t.raw("items") as { label: string; note: string }[];
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
        {VALUES.map((s, i) => (
          <div key={i} className="px-5 py-10 sm:px-8 lg:px-12 lg:py-14">
            <p className="display num text-[clamp(3rem,6vw,5.5rem)] leading-none text-text" dir="ltr">
              <span data-count={s.value}>0</span>
              {s.suffix}
            </p>
            <p className="mt-3 text-sm text-text">{items[i]?.label}</p>
            <p className="mt-1 font-mono text-[11px] text-text-muted">{items[i]?.note}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
