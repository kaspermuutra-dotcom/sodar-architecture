import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo";
import { PageShell } from "@/components/page-shell";
import { ContactForm } from "@/components/contact-form";

const DOCS: Record<string, { title: string; updated: string; sections: [string, string][] }> = {
  privacy: {
    title: "Privacy Policy",
    updated: "Updated 5 September 2026",
    sections: [
      ["Who we are", "Sodar Technologies OÜ, Tallinn, Estonia, operates sodar.io. We are the controller for the personal data described here."],
      ["What we collect", "Account details (name, email, company), the room captures you make with your phone camera, property addresses and listing metadata you attach, payment records handled by Stripe, and basic usage data such as how many visitors open a published walkthrough."],
      ["Camera and sensors", "The camera and motion sensors are used only while you are actively scanning, only after you grant permission in your browser, and never in the background. In the public preview scanner, frames stay on your device."],
      ["Why we process it", "To capture, process and host your walkthrough, to quote and take a one-time payment, to publish into the CRM you connect, and to show you engagement in your workspace. Legal basis: performance of our contract with you and, for analytics, our legitimate interest in running the service."],
      ["Who sees it", "Sub-processors that process and host walkthroughs, Stripe for payment, and the CRM or portal you explicitly connect. We never sell personal data and never use captures for advertising or to train models without your agreement."],
      ["Retention", "Captures and walkthroughs are kept for the life of the listing plus 90 days, then deleted. Account data is kept while your account exists. You can export or delete everything from the workspace or by writing to us."],
      ["Your rights", "Under the GDPR you can access, correct, export, restrict or delete your data and object to processing. You can also complain to the Estonian Data Protection Inspectorate (AKI)."],
      ["Contact", "For anything about your data, write to privacy@sodar.io."],
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

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const doc = DOCS[slug];
  if (!doc) return { title: "Sodar" };
  const t = await getTranslations({ locale, namespace: "LegalPage" });
  return { title: `${t(`titles.${slug}`)} — Sodar`, alternates: localeAlternates(locale, `/legal/${slug}`) };
}

export default async function LegalPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const doc = DOCS[slug];
  if (!doc) notFound();
  const t = await getTranslations("LegalPage");

  return (
    <PageShell>
      <section className="mx-auto max-w-3xl px-5 pb-24 pt-20 sm:px-8 sm:pt-28 lg:px-12">
        <p className="font-mono text-xs uppercase tracking-[.16em] text-text-muted">{slug === "privacy" ? doc.updated : t("updated")}</p>
        <h1 className="display mt-4 text-[clamp(2.4rem,5vw,3.6rem)]">{t(`titles.${slug}`)}</h1>
        {slug !== "privacy" ? (
          <p className="mt-6 text-text-muted">
            {t("notice")}
            {/* TODO(phase-2): replace with counsel-reviewed legal text before launch. */}
          </p>
        ) : null}
        {locale !== "en" ? <p className="mt-3 font-mono text-[11px] text-text-faint">{t("englishOnly")}</p> : null}
        <div className="mt-12 space-y-10 border-t border-border pt-10" lang="en" dir="ltr">
          {doc.sections.map(([title, body]) => (
            <div key={title}>
              <h2 className="text-xl tracking-tight">{title}</h2>
              <p className="mt-2.5 leading-relaxed text-text-muted">{body}</p>
            </div>
          ))}
        </div>
        {slug === "privacy" ? (
          <p className="mt-10 border-t border-border pt-6 text-sm text-text-muted">
            {t("privacyContact")}{" "}
            <a href="mailto:privacy@sodar.io" className="text-text hover:underline" dir="ltr">privacy@sodar.io</a>
          </p>
        ) : null}
      </section>
      <section className="section-shell border-t border-border pt-16">
        <ContactForm />
      </section>
    </PageShell>
  );
}
