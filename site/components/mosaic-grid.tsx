"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/motion";

const COLS = 9;
const ROWS = 5;
const COUNT = COLS * ROWS;

/**
 * Hero mosaic — a 9×5 wall of room captures that fades in once. Every tile is
 * `/media/rooms/tile-NN.jpg`; a missing file leaves a dark square, so the
 * layout never breaks while assets are generated.
 */
export function MosaicGrid({ className = "" }: { className?: string }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = root.current!;
      const tiles = el.querySelectorAll<HTMLElement>("[data-tile]");
      if (prefersReducedMotion()) {
        gsap.set(tiles, { opacity: 1 });
        return;
      }
      gsap.set(tiles, { opacity: 0 });
      gsap.to(tiles, { opacity: 1, duration: 1, ease: "power2.out", delay: 0.3, stagger: { each: 0.018, from: "random" } });
    },
    { scope: root },
  );

  return (
    <div ref={root} className={`relative ${className}`} aria-hidden>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
        {Array.from({ length: COUNT }).map((_, i) => {
          const n = String((i % COUNT) + 1).padStart(2, "0");
          return (
            <div key={i} data-tile className="tile aspect-square">
              <img
                src={`/media/rooms/tile-${n}.jpg`}
                alt=""
                loading={i < 18 ? "eager" : "lazy"}
                decoding="async"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(90% 85% at 50% 50%, transparent 66%, rgba(5,5,5,.75) 100%)" }} />
    </div>
  );
}
