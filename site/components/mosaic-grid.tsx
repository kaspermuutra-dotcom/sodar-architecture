"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/motion";

const ROWS = 4;
const PER_ROW = 8;
export const MOSAIC_COUNT = ROWS * PER_ROW;

/**
 * Hero wall — four rows of listing photographs that drift slowly from left to
 * right at slightly different speeds. Each row is duplicated so the motion is
 * seamless; the wall fades in once. Tiles are `/media/rooms/tile-NN.jpg`.
 */
export function MosaicGrid({ className = "" }: { className?: string }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = root.current!;
      const rows = el.querySelectorAll<HTMLElement>("[data-row]");
      if (prefersReducedMotion()) {
        gsap.set(rows, { xPercent: -50, opacity: 1 });
        return;
      }
      gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 1.2, ease: "power2.out", delay: 0.2 });
      rows.forEach((row, i) => {
        // Start half-way through the duplicated strip and slide right until the
        // first copy is back on screen; then repeat. 90–120 s per pass.
        gsap.fromTo(row, { xPercent: -50 }, { xPercent: 0, duration: 90 + i * 12, ease: "none", repeat: -1 });
      });
    },
    { scope: root },
  );

  const tile = (n: number) => `/media/rooms/tile-${String(n).padStart(2, "0")}.jpg`;

  return (
    <div ref={root} className={`relative max-w-full overflow-hidden ${className}`} aria-hidden dir="ltr">
      <div className="flex w-full flex-col gap-[3px]">
        {Array.from({ length: ROWS }).map((_, r) => {
          const ids = Array.from({ length: PER_ROW }, (_, k) => r * PER_ROW + k + 1);
          const strip = [...ids, ...ids];
          return (
            <div key={r} data-row className="flex w-max max-w-none gap-[3px] will-change-transform">
              {strip.map((n, k) => (
                <div key={k} className="tile aspect-[4/3] w-[clamp(96px,11vw,150px)] shrink-0">
                  <img
                    src={tile(n)}
                    alt=""
                    loading={r < 2 ? "eager" : "lazy"}
                    decoding="async"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-bg to-transparent sm:w-28" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-bg to-transparent sm:w-28" />
    </div>
  );
}
