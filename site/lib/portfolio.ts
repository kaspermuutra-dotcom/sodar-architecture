import { PROPERTY_DEMOS } from "@/lib/demo/properties";
import type { Walkthrough } from "@/lib/demo/walkthrough";

/**
 * The portfolio registry: one ordered list behind `/portfolio`, the homepage
 * scans section and every project page. Items sort by `order` (lower first),
 * never by filename or date, so the first client scan stays first as more
 * projects are added.
 *
 * Two kinds of item: a `walkthrough` is a full interactive project with its
 * own page; a `sample` is one of the illustrative listing-type tiles the site
 * already showed (they have no project page).
 */

export type PortfolioItem =
  | {
      kind: "walkthrough";
      order: number;
      slug: string;
      /** Message key under `Portfolio.items` for label/eyebrow copy. */
      labelKey: string;
      title: string;
      client: string;
      image: string;
      /** A distinction shown on the card, e.g. the first client scan. */
      distinction?: "first-client";
      /** Unlisted: the project page stays reachable by URL (review, diagnosis) but is not shown in the portfolio or on the home page. */
      unlisted?: boolean;
      walkthrough: Walkthrough;
    }
  | {
      kind: "sample";
      order: number;
      /** Index into the translated `Portfolio.samples` list. */
      sampleIndex: number;
      image: string;
      clip?: string;
    };

const kaldapealse = PROPERTY_DEMOS.find((demo) => demo.slug === "kaldapealse-tanav-2")!;

export const PORTFOLIO: PortfolioItem[] = [
  {
    kind: "walkthrough",
    order: 0,
    slug: kaldapealse.slug,
    labelKey: "kaldapealse",
    title: kaldapealse.title,
    client: `${kaldapealse.agent.name} · ${kaldapealse.agent.agency}`,
    image: kaldapealse.poster,
    distinction: "first-client",
    // Withdrawn from the public portfolio on 2026-09-11 pending the reconstruction review (see /review/kaldapealse-tanav-2).
    unlisted: true,
    walkthrough: kaldapealse,
  },
  { kind: "sample", order: 10, sampleIndex: 0, image: "/media/scans-window.jpg", clip: "/media/scans-window.mp4" },
  { kind: "sample", order: 11, sampleIndex: 1, image: "/media/scans-orbit.jpg", clip: "/media/scans-orbit.mp4" },
  { kind: "sample", order: 12, sampleIndex: 2, image: "/media/scans-villa.jpg" },
  { kind: "sample", order: 13, sampleIndex: 3, image: "/media/scans-street.jpg" },
].sort((a, b) => a.order - b.order) as PortfolioItem[];

export const PORTFOLIO_WALKTHROUGHS = PORTFOLIO.filter((item): item is Extract<PortfolioItem, { kind: "walkthrough" }> => item.kind === "walkthrough");
/** What the portfolio index and the home page show: everything that is not unlisted. */
export const PORTFOLIO_LISTED = PORTFOLIO.filter((item) => item.kind !== "walkthrough" || !item.unlisted);

export function getPortfolioProject(slug: string) {
  return PORTFOLIO_WALKTHROUGHS.find((item) => item.slug === slug);
}
