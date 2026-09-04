"use client";

/**
 * Single switch every GSAP effect consults. True when the OS asks for reduced
 * motion, or when the page is opened with `?motion=off` — a QA hook so a
 * screenshot/headless run sees final states instead of frozen tweens.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  try {
    return new URLSearchParams(window.location.search).get("motion") === "off";
  } catch {
    return false;
  }
}
