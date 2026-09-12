import type { Walkthrough } from "@/lib/demo/walkthrough";

/**
 * Property-specific content for locally built walkthrough projects under
 * `/portfolio/<slug>`: everything about *a house* lives in its curation
 * here; the viewer, rail, floor navigation and manifest builder
 * (`walkthrough.ts`, `components/demo/`) are reusable. Adding a property =
 * one generated JSON (from `scripts/matterport_capture_tour.py`) plus one
 * `WalkthroughCuration` entry passed through `buildWalkthrough`.
 *
 * Kaldapealse tänav 2's local reconstruction (curation, generated data,
 * review page and media versions t1–t4) was removed on 2026-09-12 after the
 * portfolio page switched to the hosted Matterport model; the git history
 * before that date keeps all of it, and the poster, social image and gallery
 * stills it produced live on under `public/media/portfolio/<slug>/e1/`.
 */
export const PROPERTY_DEMOS: Walkthrough[] = [];

export function getPropertyDemo(slug: string): Walkthrough | undefined {
  return PROPERTY_DEMOS.find((demo) => demo.slug === slug);
}
