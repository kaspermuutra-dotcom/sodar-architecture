"use client";

import { useRef, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/motion";

type Trigger = "inview" | "scrub" | "hover" | "loop";
type Direction = "down" | "right";

/**
 * ScanReveal — the one motif the whole site is built from.
 *
 * A scan-line sweeps across the frame; behind it, the `flat` layer is clipped
 * away to expose the `revealed` layer underneath — the "flat listing photo →
 * Sodar walkthrough" reveal. Every other animated section is a variation of
 * this (different trigger, direction, speed), never a different style.
 *
 * Driven by one CSS custom property `--scan-p` (0 → 1): CSS does the clipping
 * and line position, GSAP only animates the number.
 */
export function ScanReveal({
  flat,
  revealed,
  trigger = "inview",
  direction = "down",
  durationMs = 1200,
  className = "",
  frameClassName = "",
}: {
  flat: ReactNode;
  revealed: ReactNode;
  trigger?: Trigger;
  direction?: Direction;
  durationMs?: number;
  className?: string;
  frameClassName?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const isDown = direction === "down";

  useGSAP(
    () => {
      const el = root.current!;
      if (prefersReducedMotion()) {
        gsap.set(el, { "--scan-p": 1 });
        return;
      }

      const dur = durationMs / 1000;
      gsap.set(el, { "--scan-p": 0 });

      if (trigger === "scrub") {
        gsap.to(el, {
          "--scan-p": 1,
          ease: "none",
          scrollTrigger: { trigger: el, start: "top 78%", end: "bottom 30%", scrub: true },
        });
      } else if (trigger === "inview") {
        gsap.to(el, {
          "--scan-p": 1,
          duration: dur,
          ease: "power2.inOut",
          scrollTrigger: { trigger: el, start: "top 75%", once: true },
        });
      } else if (trigger === "loop") {
        gsap.to(el, {
          "--scan-p": 1,
          duration: dur,
          ease: "power1.inOut",
          repeat: -1,
          yoyo: true,
          repeatDelay: 0.6,
        });
      } else {
        const to = (v: number) =>
          gsap.to(el, { "--scan-p": v, duration: dur * 0.6, ease: "power2.out" });
        el.addEventListener("pointerenter", () => to(1));
        el.addEventListener("pointerleave", () => to(0));
      }
    },
    { scope: root, dependencies: [trigger, direction, durationMs] },
  );

  const flatClip = isDown
    ? "inset(calc(var(--scan-p, 0) * 100%) 0 0 0)"
    : "inset(0 0 0 calc(var(--scan-p, 0) * 100%))";
  const lineOpacity = "calc(1 - max(0, (var(--scan-p, 0) - 0.98) * 50))";

  return (
    <div
      ref={root}
      data-scan-reveal
      className={`relative isolate overflow-hidden rounded-xl border border-ink-border bg-ink-raised ${frameClassName} ${className}`}
      style={{ ["--scan-p" as string]: 0 }}
    >
      <div className="absolute inset-0">{revealed}</div>

      {/* trailing sweep glow inside the revealed area */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 mix-blend-screen"
        style={{
          background: isDown
            ? "linear-gradient(180deg, color-mix(in oklab, var(--color-accent) 22%, transparent) 0%, transparent 14%)"
            : "linear-gradient(90deg, color-mix(in oklab, var(--color-accent) 22%, transparent) 0%, transparent 14%)",
          clipPath: isDown
            ? "inset(0 0 calc((1 - var(--scan-p, 0)) * 100%) 0)"
            : "inset(0 calc((1 - var(--scan-p, 0)) * 100%) 0 0)",
        }}
      />

      {/* flat layer, clipped away as the scan passes */}
      <div className="absolute inset-0" style={{ clipPath: flatClip }}>
        {flat}
      </div>

      {/* the scan line */}
      <div
        aria-hidden
        className="pointer-events-none absolute bg-accent"
        style={
          isDown
            ? {
                left: 0,
                right: 0,
                top: "calc(var(--scan-p, 0) * 100%)",
                height: "2px",
                opacity: lineOpacity,
                boxShadow:
                  "0 0 12px 1px var(--color-accent), 0 0 40px 4px color-mix(in oklab, var(--color-accent) 45%, transparent)",
              }
            : {
                top: 0,
                bottom: 0,
                left: "calc(var(--scan-p, 0) * 100%)",
                width: "2px",
                opacity: lineOpacity,
                boxShadow:
                  "0 0 12px 1px var(--color-accent), 0 0 40px 4px color-mix(in oklab, var(--color-accent) 45%, transparent)",
              }
        }
      />
    </div>
  );
}
