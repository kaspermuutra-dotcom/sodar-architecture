import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { PageHero } from "@/components/page-hero";
import { CtaBanner } from "@/components/cta-banner";
import { PartnerApplyForm } from "@/components/partner-apply-form";

export const metadata: Metadata = {
  title: "Partners — Sodar",
  description: "CRM platforms earn a standing 15% margin marketing Sodar to their realtor base.",
};

const STEPS: [string, string][] = [
  ["Apply", "Tell us which brokers or agencies run on your platform, and roughly how many active listings."],
  ["Integrate", "A referral link and, optionally, a native in-app entry point for your users."],
  ["Earn", "15% of every listing unlock from a broker who joined through your platform, paid out monthly."],
];

const FAQ: [string, string][] = [
  ["Is there a minimum commitment?", "No. The 15% margin applies from the first unlocked listing — no volume floor."],
  ["Who owns the broker relationship?", "You do. Sodar bills the broker directly and reports your margin; brokers stay your customer."],
  ["Can we co-brand the walkthrough?", "Yes — a partner-tier account can apply a co-branded frame around the embedded walkthrough."],
];

export default async function PartnersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <PageShell>
      <PageHero
        eyebrow="For CRM platforms"
        title="Market Sodar to your brokers. Keep 15%."
        subtitle="A standing margin on every listing your platform's brokers unlock — no minimum, paid out automatically, no engineering lift beyond a referral link."
        actions={<a href="#apply" className="button-primary">Apply as a partner <span>↗</span></a>}
      />

      <section className="section-shell border-t border-border">
        <div className="section-kicker">How it works</div>
        <h2 className="section-title mt-7">Three steps to a standing margin.</h2>
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-border bg-border md:grid-cols-3">
          {STEPS.map(([title, desc], i) => (
            <article key={title} className="bg-bg p-8 sm:p-10">
              <span className="font-mono text-xs text-accent">0{i + 1}</span>
              <h3 className="mt-8 text-2xl tracking-tight">{title}</h3>
              <p className="mt-3 leading-relaxed text-text-muted">{desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="dashboard" className="section-shell border-t border-border">
        <div className="section-kicker">Partner dashboard</div>
        <h2 className="section-title mt-7">Track referred brokers and margin in one place.</h2>
        <div className="mt-14 overflow-hidden rounded-3xl border border-border bg-bg-raised">
          <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {[
              ["Referred brokers", "142"],
              ["Listings unlocked", "3,018"],
              ["Margin this month", "$6,240"],
            ].map(([label, value]) => (
              <div key={label} className="p-8">
                <p className="font-mono text-[11px] uppercase tracking-[.16em] text-text-muted">{label}</p>
                <p className="mt-3 text-4xl tracking-[-.03em]">{value}</p>
              </div>
            ))}
          </div>
          {/* TODO(phase-2): real partner dashboard — gated app, not a public mock. */}
        </div>
      </section>

      <section id="apply" className="section-shell border-t border-border">
        <div className="grid gap-12 lg:grid-cols-[1fr_.9fr] lg:items-start">
          <div>
            <div className="section-kicker">Get started</div>
            <h2 className="section-title mt-7">Apply as a partner.</h2>
            <p className="mt-7 max-w-md text-lg text-text-muted">
              A short application — we review platform fit and typical listing volume before issuing a referral
              link.
            </p>
          </div>
          <PartnerApplyForm />
        </div>
      </section>

      <section className="section-shell border-t border-border">
        <div className="section-kicker">Questions</div>
        <h2 className="section-title mt-7">Partner FAQ.</h2>
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
        eyebrow="Ready when you are"
        title="Give your brokers a reason to publish more."
        subtitle="Apply once — we'll follow up with a referral link and integration notes."
        ctaLabel="Apply as a partner"
        ctaHref="/partners#apply"
      />
    </PageShell>
  );
}
