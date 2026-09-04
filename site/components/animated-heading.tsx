"use client";

import { useRef, type ElementType, type Ref } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/motion";
import { SplitText } from "@/components/split-text";

/**
 * §6 motion rule: headlines stagger word-by-word into view on scroll, one
 * direction, `power2.out` — no bounce/elastic easing anywhere on the site.
 */
export function AnimatedHeading({
  lines,
  as: Tag = "h2",
  className = "",
  wordClassName = "",
}: {
  lines: string[];
  as?: ElementType;
  className?: string;
  wordClassName?: string;
}) {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = root.current!;
      const words = el.querySelectorAll("[data-split-word]");
      if (prefersReducedMotion()) {
        gsap.set(words, { opacity: 1, y: 0 });
        return;
      }
      gsap.set(words, { opacity: 0, y: "110%" });
      gsap.to(words, {
        opacity: 1,
        y: "0%",
        duration: 0.9,
        ease: "power2.out",
        stagger: 0.035,
        scrollTrigger: { trigger: el, start: "top 85%", once: true },
      });
    },
    { scope: root },
  );

  return (
    <Tag ref={root as Ref<never>} className={className}>
      <SplitText lines={lines} wordClassName={wordClassName} />
    </Tag>
  );
}
