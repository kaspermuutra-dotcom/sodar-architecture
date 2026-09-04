"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/motion";

const COLS = 9;
const ROWS = 5;
const COUNT = COLS * ROWS;

/**
 * Hero mosaic — a 9×5 wall of room captures. Tiles fade in from a random
 * order, a white scan-line sweeps across the wall every few seconds and lifts
 * the column it passes, and the whole wall drifts a few pixels against the
 * cursor. Every tile is `/media/rooms/tile-NN.jpg`; a missing file just
 * leaves a dark square, so the layout never breaks while assets are generated.
 */
export function MosaicGrid({ className = "" }: { className?: string }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = root.current!;
      const tiles = Array.from(el.querySelectorAll<HTMLElement>("[data-tile]"));
      const sweep = el.querySelector<HTMLElement>("[data-sweep]");
      const reduced = prefersReducedMotion();

      if (reduced) {
        gsap.set(tiles, { opacity: 1, scale: 1 });
        return;
      }

      gsap.set(tiles, { opacity: 0, scale: 0.9 });
      gsap.to(tiles, {
        opacity: 1,
        scale: 1,
        duration: 1.2,
        ease: "power3.out",
        delay: 0.35,
        stagger: { each: 0.022, from: "random" },
      });

      // Scan sweep: one white line crossing the wall; each tile's `--lit`
      // custom property follows how close the line is to its column.
      const state = { p: -0.15 };
      const sweepTl = gsap.timeline({ repeat: -1, repeatDelay: 2.8, delay: 2.2 });
      sweepTl.to(state, {
        p: 1.15,
        duration: 3.2,
        ease: "power1.inOut",
        onUpdate() {
          const p = state.p;
          if (sweep) {
            gsap.set(sweep, { left: `${p * 100}%`, opacity: p < 0 || p > 1 ? 0 : 1 });
          }
          tiles.forEach((t, i) => {
            const col = (i % COLS + 0.5) / COLS;
            const lit = Math.max(0, 1 - Math.abs(col - p) * 5.5);
            t.style.setProperty("--lit", lit.toFixed(3));
          });
        },
      });

      // Cursor drift — the wall leans a few px against the pointer.
      const xTo = gsap.quickTo(el, "x", { duration: 1.2, ease: "power3.out" });
      const yTo = gsap.quickTo(el, "y", { duration: 1.2, ease: "power3.out" });
      const onMove = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
        const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        xTo(dx * -14);
        yTo(dy * -10);
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      return () => {
        window.removeEventListener("pointermove", onMove);
        sweepTl.kill();
      };
    },
    { scope: root },
  );

  return (
    <div ref={root} className={`relative ${className}`} aria-hidden>
      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: COUNT }).map((_, i) => {
          const n = String((i % COUNT) + 1).padStart(2, "0");
          return (
            <div key={i} data-tile className="tile aspect-square" style={{ ["--lit" as string]: 0 }}>
              <img
                src={`/media/rooms/tile-${n}.jpg`}
                alt=""
                loading={i < 18 ? "eager" : "lazy"}
                decoding="async"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              <span
                className="pointer-events-none absolute inset-0 bg-white"
                style={{ opacity: "calc(var(--lit, 0) * .22)" }}
              />
            </div>
          );
        })}
      </div>
      <div
        data-sweep
        className="pointer-events-none absolute inset-y-0 w-px bg-text opacity-0"
        style={{ boxShadow: "0 0 18px 2px rgba(244,242,238,.55), 0 0 60px 6px rgba(244,242,238,.25)" }}
      />
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(90% 85% at 50% 50%, transparent 62%, rgba(5,5,5,.8) 100%)" }} />
    </div>
  );
}
