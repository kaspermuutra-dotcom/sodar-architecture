import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/page-shell";

const DOCS: Record<string, { title: string; updated: string; sections: [string, string][] }> = {
  privacy: {
    title: "Privacy Policy",
    updated: "Draft — phase 1",
    sections: [
      ["What we collect", "Listing photos, floor plans, addresses you submit, and usage data from anyone who views a published walkthrough."],
      ["How it's used", "Solely to render, host, and serve your walkthrough, and to power the Terminal analytics shown to the submitting broker."],
      ["Who it's shared with", "Sub-processors that render and host the walkthrough, and Stripe for payment — never sold, never used for unrelated advertising."],
      ["Your rights", "Export or delete your listing data at any time from account settings once the gated app ships."],
    ],
  },
  terms: {
    title: "Terms of Service",
    updated: "Draft — phase 1",
    sections: [
      ["Using Sodar", "You submit listing photos and metadata you have the right to use; Sodar renders and hosts a walkthrough from them."],
      ["Payment", "Unlocking a walkthrough is a one-time charge per listing, billed through Stripe."],
      ["Ownership", "You retain ownership of submitted photos and the resulting render; Sodar retains ownership of the pipeline itself."],
      ["Acceptable use", "No submitting a listing you don't have rights to represent, and no reverse-engineering the rendering pipeline."],
    ],
  },
  "data-processing": {
    title: "Data Processing Addendum",
    updated: "Draft — phase 1",
    sections: [
      ["Scope", "Applies to listing photos, floor plans, and engagement data processed on a broker's behalf."],
      ["Sub-processors", "Rendering, hosting, and payment providers are listed here once contracts are finalized."],
      ["Data location", "Storage region will be documented here alongside the infrastructure decision."],
      ["Breach notification", "Affected brokers will be notified per applicable law once the formal incident process ships."],
    ],
  },
  cookies: {
    title: "Cookie Policy",
    updated: "Draft — phase 1",
    sections: [
      ["Essential cookies", "Session and locale preference — required for the site to function."],
      ["Analytics", "Aggregate, privacy-respecting usage analytics on the marketing site only, not on embedded walkthroughs."],
      ["Third-party cookies", "None on the marketing site today. Payment provider cookies apply only at checkout."],
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(DOCS).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const doc = DOCS[slug];
  return { title: doc ? `${doc.title} — Sodar` : "Sodar" };
}

export default async function LegalPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const doc = DOCS[slug];
  if (!doc) notFound();

  return (
    <PageShell>
      <section className="mx-auto max-w-3xl px-5 pb-24 pt-20 sm:px-8 sm:pt-28 lg:px-12">
        <p className="font-mono text-xs uppercase tracking-[.16em] text-text-muted">{doc.updated}</p>
        <h1 className="mt-4 text-[clamp(2.4rem,5vw,3.6rem)] font-medium leading-[1] tracking-[-.04em]">{doc.title}</h1>
        <p className="mt-6 text-text-muted">
          This is a phase-1 structural placeholder, not final legal copy.{" "}
          {/* TODO(phase-2): replace with counsel-reviewed legal text before launch. */}
        </p>
        <div className="mt-12 space-y-10 border-t border-border pt-10">
          {doc.sections.map(([title, body]) => (
            <div key={title}>
              <h2 className="text-xl tracking-tight">{title}</h2>
              <p className="mt-2.5 leading-relaxed text-text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
