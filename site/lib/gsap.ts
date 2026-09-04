"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// Single place plugins are registered. Import { gsap, ScrollTrigger } from here.
// gsap/SplitText is bundled and free in gsap 3.13+, but the brief asks for a
// hand-rolled splitter (see components/split-text.tsx) so it stays predictable.
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export { gsap, ScrollTrigger };
