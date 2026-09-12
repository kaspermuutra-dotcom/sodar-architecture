import type { Walkthrough } from "@/lib/demo/walkthrough";

/**
 * The portfolio registry: one ordered list behind `/portfolio`, the homepage
 * scans section and every project page. Items sort by `order` (lower first),
 * never by filename or date, so the first client scan stays first as more
 * projects are added.
 *
 * Two kinds of item: a `walkthrough` is a full interactive project with its
 * own page — either a hosted `embed` or a locally built `walkthrough`
 * (lib/demo) — and a `sample` is one of the illustrative listing-type tiles
 * the site already showed (they have no project page).
 */

/** An official Matterport Showcase embed: `https://my.matterport.com/show/?m=<modelId>`. */
export type PortfolioEmbed = { provider: "matterport"; modelId: string };

export type PortfolioItem =
  | {
      kind: "walkthrough";
      order: number;
      slug: string;
      /** Message key under `Portfolio.items` for label/eyebrow copy. */
      labelKey: string;
      title: string;
      client: string;
      /** Poster: the card image and the viewer's intro frame. */
      image: string;
      ogImage: string;
      /** Real stills shown as a small gallery under the viewer; `labelKey` under `PropertyDemo.scenes`. */
      gallery: Array<{ labelKey: string; still: string }>;
      indexable: boolean;
      /** A distinction shown on the card, e.g. the first client scan. */
      distinction?: "first-client";
      /** Unlisted: the project page stays reachable by URL (review, diagnosis) but is not shown in the portfolio or on the home page. */
      unlisted?: boolean;
      /**
       * Hosted viewer shown on the project page instead of the locally built walkthrough. The local tour data
       * (`walkthrough`) is kept for the review page, the metadata and the stills.
       */
      embed?: PortfolioEmbed;
      /** Locally built linked 360° tour; absent when the page shows a hosted embed only. */
      walkthrough?: Walkthrough;
    }
  | {
      kind: "sample";
      order: number;
      /** Index into the translated `Portfolio.samples` list. */
      sampleIndex: number;
      image: string;
      clip?: string;
    };

// Kaldapealse tänav 2 — Sodar's first client scan. The page shows the hosted Matterport Showcase model of the
// capture (since 2026-09-12); the poster, social image and gallery stills are the last renders of the local
// reconstruction that was removed the same day (see lib/demo/properties.ts). The version segment (`e1`) is what
// makes the immutable one-year Cache-Control header in next.config.ts safe: new stills → new segment.
const KALDAPEALSE = "/media/portfolio/kaldapealse-tanav-2/e1";

export const PORTFOLIO: PortfolioItem[] = [
  {
    kind: "walkthrough",
    order: 0,
    slug: "kaldapealse-tanav-2",
    labelKey: "kaldapealse",
    title: "Kaldapealse tänav 2",
    client: "Ruslan Gulida · RE/MAX",
    image: `${KALDAPEALSE}/poster.webp`,
    ogImage: `${KALDAPEALSE}/og.jpg`,
    gallery: [
      { labelKey: "street", still: `${KALDAPEALSE}/stills/8c8a7ac5.webp` },
      { labelKey: "terrace", still: `${KALDAPEALSE}/stills/e3e179a3.webp` },
      { labelKey: "stairsBottom", still: `${KALDAPEALSE}/stills/f4c34f0d.webp` },
      { labelKey: "kitchen", still: `${KALDAPEALSE}/stills/fbd51372.webp` },
      { labelKey: "mainRoom", still: `${KALDAPEALSE}/stills/52c0066c.webp` },
      { labelKey: "bathroom", still: `${KALDAPEALSE}/stills/f0cd9cf0.webp` },
      { labelKey: "upperRoom", still: `${KALDAPEALSE}/stills/349d9a99.webp` },
      { labelKey: "upperBathroom", still: `${KALDAPEALSE}/stills/925dd397.webp` },
    ],
    // Public use confirmed for the portfolio (publishing brief, 2026-09-09); withdrawn 2026-09-11 pending the
    // reconstruction review; listed and indexable again since 2026-09-12 with the hosted model.
    indexable: true,
    distinction: "first-client",
    embed: { provider: "matterport", modelId: "98WLexoRstU" },
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
