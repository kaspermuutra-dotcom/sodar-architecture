import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { CtaBanner } from "@/components/cta-banner";

export const metadata: Metadata = {
  title: "About — Sodar",
  description: "Why Sodar exists: the case for treating a listing as a place, not a photo gallery.",
};

const VALUES: [string, string][] = [
  ["Scan, don't stage", "The real property is the source of truth. Our job is to render it faithfully, not invent a fantasy version."],
  ["The broker owns the data", "Photos, renders, and engagement data belong to the broker who submitted them — always exportable, never locked in."],
  ["Disclosure by default", "An AI-rendered space should say so. Every public walkthrough is labeled, no exceptions."],
];

export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <PageShell>
      <PageHero
        eyebrow="Company"
        title="A listing photo is a promise. We make it walkable."
        subtitle="Sodar started from one observation: buyers scroll past flat photos, but they linger inside a space they can actually move through. We build the pipeline that turns the first into the second."
      />

      <section className="section-shell border-t border-border">
        <div className="section-kicker">Thesis</div>
        <h2 className="section-title mt-7">Orientation sells listings.</h2>
        <div className="mt-10 max-w-2xl space-y-5 text-lg leading-relaxed text-text-muted">
          <p>
            A buyer scrolling a listing portal makes a keep/skip decision in seconds, based on photos that give no
            sense of flow between rooms. A walkthrough answers the question a photo can&apos;t: what does it feel like
            to actually be there.
          </p>
          <p>
            Sodar exists to make that walkthrough cheap enough and fast enough that it becomes the default for every
            listing, not a luxury reserved for the top of the market.
          </p>
        </div>
      </section>

      <section className="section-shell border-t border-border">
        <div className="section-kicker">What we hold to</div>
        <h2 className="section-title mt-7">Three things we won&apos;t trade away.</h2>
        <div className="mt-14 grid gap-8 sm:grid-cols-3">
          {VALUES.map(([title, desc]) => (
            <div key={title}>
              <h3 className="text-lg tracking-tight text-text">{title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-text-muted">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <CtaBanner
        eyebrow="Join us"
        title="We're a small team, onboarding early."
        subtitle="If the thesis resonates, we're hiring — or just talk to us about your listings."
        ctaLabel="See open roles"
        ctaHref="/careers"
      />
    </PageShell>
  );
}
