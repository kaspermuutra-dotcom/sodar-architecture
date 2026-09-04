import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { CtaBanner } from "@/components/cta-banner";
import { ScanReveal } from "@/components/scan-reveal";
import { FlatListingPhoto, SodarWalkthroughFrame } from "@/components/scan-placeholders";
import { CapabilityGrid } from "@/components/capability-grid";
import { Pipeline } from "@/components/pipeline";
import { Link } from "@/i18n/navigation";

export const metadata: Metadata = {
  title: "Product — Sodar",
  description: "How a guided phone scan becomes an immersive, listing-ready walkthrough.",
};

const STAGES: [string, string, string][] = [
  ["Capture", "Phone · browser · camera permission", "Each room is captured as a panorama with live coaching from the AI capture assistant."],
  ["Process", "Stitching · enhancement · linking", "Panoramas are stitched, cleaned and linked into a single walkthrough. The first two rooms come back free."],
  ["Publish", "CRM · embedded viewer · appearance", "Connect your CRM, pick the listing, publish. The viewer lives inside the listing; you tune its approved appearance."],
];

export default async function ProductPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <PageShell>
      <PageHero
        eyebrow="The product"
        title="A phone, one walk, a place buyers can step inside."
        subtitle="Sodar turns guided property scans into immersive, listing-ready walkthroughs — captured on the phone you already carry, published into the CRM you already use."
        actions={
          <>
            <Link href="/pricing" className="button-primary">
              Scan your first property <span aria-hidden>↗</span>
            </Link>
            <Link href="/terminal" className="button-secondary">
              See the workspace
            </Link>
          </>
        }
      />

      <section className="section-shell pt-0">
        <ScanReveal
          trigger="scrub"
          durationMs={1200}
          frameClassName="aspect-[16/9] shadow-2xl shadow-black/60"
          flat={<FlatListingPhoto label="Phone capture" />}
          revealed={<SodarWalkthroughFrame label="Sodar walkthrough" />}
        />
      </section>

      <section className="section-shell border-t border-border">
        <p className="section-kicker">From a walk to a walkthrough</p>
        <h2 className="section-title mt-7">Three stages, one pipeline.</h2>
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-border bg-border md:grid-cols-3">
          {STAGES.map(([label, sub, desc], i) => (
            <article key={label} className="bg-bg p-8 sm:p-10">
              <span className="font-mono text-xs text-text-faint">0{i + 1}</span>
              <h3 className="display mt-8 text-3xl text-text">{label}</h3>
              <p className="mt-1 font-mono text-[11px] text-text-muted">{sub}</p>
              <p className="mt-4 leading-relaxed text-text-muted">{desc}</p>
            </article>
          ))}
        </div>
      </section>

      <Pipeline />

      <CapabilityGrid />

      <CtaBanner
        eyebrow="Try it on a real property"
        title="Preview two rooms free. Pay once for the rest."
        subtitle="Open sodar.io on your phone and start a scan — no card until you unlock the full walkthrough."
        ctaLabel="Scan your first property"
        ctaHref="/pricing"
      />
    </PageShell>
  );
}
