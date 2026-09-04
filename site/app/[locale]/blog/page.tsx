import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { ScanReveal } from "@/components/scan-reveal";
import { FlatListingPhoto, SodarWalkthroughFrame } from "@/components/scan-placeholders";

export const metadata: Metadata = {
  title: "Field notes — Sodar",
  description: "Case studies from brokers and brokerages scanning listings with Sodar.",
};

const POSTS: [string, string, string][] = [
  ["How a 4-agent Tallinn brokerage cut listing prep to 12 minutes", "Case study", "6 min read"],
  ["What we changed after the first 500 walkthroughs", "Product notes", "4 min read"],
  ["Reading a Terminal heatmap: what room engagement actually tells you", "Guide", "5 min read"],
  ["Why the preview locks at 50%, not 20% or 80%", "Product notes", "3 min read"],
];

export default async function BlogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <PageShell>
      <PageHero
        eyebrow="Field notes"
        title="Case studies, not press releases."
        subtitle="What actually happens when a listing gets scanned — written by the team building the pipeline."
      />

      <section className="section-shell border-t border-border pt-0">
        <div className="grid gap-8 sm:grid-cols-2">
          {POSTS.map(([title, tag, read], i) => (
            <article key={title} className="group">
              <ScanReveal
                trigger="hover"
                durationMs={900}
                frameClassName="aspect-[16/10]"
                flat={<FlatListingPhoto />}
                revealed={<SodarWalkthroughFrame />}
                direction={i % 2 === 0 ? "down" : "right"}
              />
              <p className="mt-4 font-mono text-[11px] uppercase tracking-[.16em] text-accent">{tag}</p>
              <h2 className="mt-2 text-2xl tracking-tight text-text group-hover:text-accent">{title}</h2>
              <p className="mt-2 text-sm text-text-muted">{read}</p>
            </article>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
