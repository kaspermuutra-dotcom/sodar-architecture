import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { CtaBanner } from "@/components/cta-banner";
import { Link } from "@/i18n/navigation";

export const metadata: Metadata = {
  title: "Pricing — Sodar",
  description: "One-time price per property, quoted after a free two-room preview. Volume pricing for brokerages, a 15% margin for CRM partners.",
};

const TIERS: { name: string; price: string; unit: string; desc: string; features: string[]; cta: string; href: string; highlight?: boolean }[] = [
  {
    name: "Per property",
    price: "From €99",
    unit: "one-time, quoted after the free preview",
    desc: "For brokers scanning listings one at a time.",
    features: ["Guided phone capture + AI assistant", "First two rooms free to preview", "Full walkthrough after one Stripe payment", "CRM publishing & embedded viewer", "Workspace with status & viewer opens"],
    cta: "Scan your first property",
    href: "/product",
  },
  {
    name: "Brokerage",
    price: "Volume",
    unit: "per property, stepping down with volume",
    desc: "For firms publishing dozens of listings a month.",
    features: ["Everything per property", "Firm-wide workspace rollup", "Priority processing queue", "Dedicated CRM setup", "Co-branded viewer"],
    cta: "Talk to sales",
    href: "/enterprise",
    highlight: true,
  },
  {
    name: "CRM partner",
    price: "15%",
    unit: "margin on qualifying purchases",
    desc: "For CRM providers distributing Sodar to their brokers.",
    features: ["Sodar available inside your platform", "Partner dashboard", "Monthly automatic payout", "No minimum volume"],
    cta: "Apply as a partner",
    href: "/partners",
  },
];

const FACTORS: [string, string][] = [
  ["Property size", "Floor area and number of rooms captured."],
  ["Panorama volume", "How many panoramas the scan produced and their resolution."],
  ["Processing", "Stitching, enhancement and the AI compute behind the walkthrough."],
  ["Storage & hosting", "Keeping the walkthrough and its viewer online inside your listing."],
  ["Maintenance", "Ongoing viewer updates and the CRM integration itself."],
  ["Partner margin", "Where a CRM partner distributes Sodar, their margin is included in the quote."],
];

const FAQ: [string, string][] = [
  ["When do I see the price?", "After the free preview. Sodar computes a one-time price for completing the property once the first two rooms are processed."],
  ["Is the preview really free?", "Yes — the first two rooms are processed into a working walkthrough with no payment. You pay only to finish and publish the property."],
  ["Is there a subscription?", "No. Each property is a single one-time payment through Stripe. Nothing renews."],
  ["How does the CRM partner margin get paid?", "Automatically, monthly, on qualifying walkthrough purchases from brokers on the partner's platform."],
];

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <PageShell>
      <PageHero
        eyebrow="Simple by design"
        title="One property. One price. Once."
        subtitle="Preview two rooms free, then pay a single one-time price sized to the property. Volume pricing for brokerages, a standing 15% margin for CRM partners."
      />

      <section className="section-shell pt-0">
        <div className="grid gap-6 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <div key={tier.name} className={`flex flex-col rounded-3xl border p-8 sm:p-10 ${tier.highlight ? "border-border-strong bg-bg-raised" : "border-border bg-bg"}`}>
              {tier.highlight ? (
                <span className="mb-4 inline-flex w-fit items-center rounded-full border border-border-strong px-3 py-1 font-mono text-[10px] uppercase tracking-[.14em] text-text">
                  Most brokerages
                </span>
              ) : null}
              <p className="text-sm text-text-muted">{tier.name}</p>
              <p className="display mt-3 text-5xl text-text">{tier.price}</p>
              <p className="mt-2 font-mono text-[11px] text-text-muted">{tier.unit}</p>
              <p className="mt-5 text-sm leading-relaxed text-text-muted">{tier.desc}</p>
              <ul className="my-8 flex-1 space-y-3 border-y border-border py-7 text-sm">
                {tier.features.map((f) => (
                  <li key={f} className="flex gap-3 text-text-muted">
                    <span className="text-text">—</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link href={tier.href} className={tier.highlight ? "button-primary w-full justify-center" : "button-secondary w-full justify-center"}>
                {tier.cta} <span aria-hidden>↗</span>
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="section-shell border-t border-border">
        <p className="section-kicker">How the quote is built</p>
        <h2 className="section-title mt-7">Priced to the property, not the plan.</h2>
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {FACTORS.map(([title, desc], i) => (
            <div key={title} className="bg-bg p-8">
              <span className="font-mono text-[11px] text-text-faint">0{i + 1}</span>
              <h3 className="display mt-6 text-2xl text-text">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section-shell border-t border-border">
        <p className="section-kicker">Questions</p>
        <h2 className="section-title mt-7">Pricing FAQ.</h2>
        <div className="mt-14 divide-y divide-border border-y border-border">
          {FAQ.map(([q, a]) => (
            <div key={q} className="grid gap-2 py-6 sm:grid-cols-[1fr_1.4fr] sm:gap-8">
              <p className="text-text">{q}</p>
              <p className="text-text-muted">{a}</p>
            </div>
          ))}
        </div>
      </section>

      <CtaBanner
        eyebrow="Early access"
        title="Your next listing deserves more than photos."
        subtitle="We're onboarding a small group of forward-looking brokers first."
        ctaLabel="Request early access"
        ctaHref="/product"
      />
    </PageShell>
  );
}
