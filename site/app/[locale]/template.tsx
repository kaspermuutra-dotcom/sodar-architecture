"use client";

import { useRef, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * Route transition: a short fade-in of the new page. `template.tsx` remounts
 * on every navigation within this segment, so this plays once per page change.
 */
export default function LocaleTemplate({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const el = root.current;
    if (!el || prefersReducedMotion()) return;
    gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: "power1.out", clearProps: "opacity" });
  }, []);

  return <div ref={root}>{children}</div>;
}
