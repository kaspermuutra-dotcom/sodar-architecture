"use client";

import { useRef, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * §6 — short (~300–400ms) scan-line wipe on route transitions. `template.tsx`
 * remounts on every navigation within this segment (unlike `layout.tsx`), so
 * this plays once per page change: a solid panel covers the page, an accent
 * line sweeps top-to-bottom marking the edge, then the panel collapses away
 * from the bottom to reveal the new page.
 *
 * Deliberately a single `scaleY` tween (not `clip-path`) so there's only one
 * tween ever touching one property on one element — no risk of two competing
 * tweens leaving the overlay stuck mid-transition over the page.
 */
export default function LocaleTemplate({ children }: { children: ReactNode }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const overlay = overlayRef.current;
    const line = lineRef.current;
    if (!overlay || !line) return;

    if (prefersReducedMotion()) {
      gsap.set(overlay, { display: "none" });
      return;
    }

    gsap.set(overlay, { display: "block", scaleY: 1, transformOrigin: "bottom center" });
    gsap.set(line, { top: "0%" });

    const hide = () => gsap.set(overlay, { display: "none" });
    gsap
      .timeline({ onComplete: hide })
      .to(line, { top: "100%", duration: 0.34, ease: "power2.inOut" }, 0)
      .to(overlay, { scaleY: 0, duration: 0.38, ease: "power2.inOut" }, 0.03);

    // Safety net: a throttled rAF (backgrounded/hidden tab, low-power mode)
    // can stall the timeline mid-wipe. Never leave the page covered.
    const fallback = window.setTimeout(hide, 700);
    return () => window.clearTimeout(fallback);
  }, []);

  return (
    <>
      <div ref={overlayRef} aria-hidden className="pointer-events-none fixed inset-0 z-[999] bg-bg" style={{ display: "none" }}>
        <div
          ref={lineRef}
          className="absolute inset-x-0 h-px bg-accent"
          style={{ boxShadow: "0 0 16px 2px var(--color-accent), 0 0 60px 8px color-mix(in oklab, var(--color-accent) 40%, transparent)" }}
        />
      </div>
      {children}
    </>
  );
}
