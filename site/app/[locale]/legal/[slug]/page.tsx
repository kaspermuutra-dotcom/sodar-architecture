import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo";
import { PageShell } from "@/components/page-shell";
import { ContactForm } from "@/components/contact-form";
import { PRIVACY_EMAIL } from "@/lib/company";

const DOCS: Record<string, { updated: string; final: boolean; sections: [string, string][] }> = {
  privacy: {
    updated: "Updated 7 September 2026",
    final: true,
    sections: [
      ["Who we are", "Sodar Technologies OÜ, Tallinn, Estonia, operates sodar.io. We are the controller for the personal data described here."],
      ["What we collect", "Account details (name, email, company, job title), the room captures you make with your phone camera, property addresses and listing metadata you attach, payment records handled by Stripe, messages you send us through the contact forms, and basic usage data such as how many visitors open a published walkthrough."],
      ["Camera and sensors", "The camera and motion sensors are used only while you are actively scanning, only after you grant permission in your browser, and never in the background. In the public preview scanner, frames stay on your device."],
      ["Why we process it", "To capture, process and host your walkthrough, to quote and take a one-time payment, to publish into the CRM you connect, to answer the messages you send us, and to show you engagement in your workspace. Legal basis: performance of our contract with you and, for analytics and correspondence, our legitimate interest in running the service."],
      ["Who sees it", "Sub-processors that process and host walkthroughs, Stripe for payment, Formspree for delivering contact-form messages, and the CRM or portal you explicitly connect. We never sell personal data and never use captures for advertising or to train models without your agreement."],
      ["Retention", "Captures and walkthroughs are kept for the life of the listing plus 90 days, then deleted. Account data is kept while your account exists. Contact-form messages are kept for as long as needed to resolve your request. You can export or delete everything from the workspace or by writing to us."],
      ["Your rights", "Under the GDPR you can access, correct, export, restrict or delete your data and object to processing. You can also complain to the Estonian Data Protection Inspectorate (AKI)."],
      ["Contact", `For anything about your data, write to ${PRIVACY_EMAIL} or use the form below.`],
    ],
  },
  terms: {
    updated: "Draft",
    final: false,
    sections: [
      ["Using Sodar", "You submit listing photos and metadata you have the right to use; Sodar renders and hosts a walkthrough from them."],
      ["Payment", "Unlocking a walkthrough is a one-time charge per listing, billed through Stripe."],
      ["Ownership", "You retain ownership of submitted photos and the resulting render; Sodar retains ownership of the pipeline itself."],
      ["Acceptable use", "No submitting a listing you do not have rights to represent, and no reverse-engineering the rendering pipeline."],
    ],
  },
  "data-processing": {
    updated: "Draft",
    final: false,
    sections: [
      ["Scope", "Applies to listing photos, floor plans, and engagement data processed on a broker's behalf."],
      ["Sub-processors", "Rendering, hosting, and payment providers are listed here once contracts are finalised."],
      ["Data location", "Storage region will be documented here alongside the infrastructure decision."],
      ["Breach notification", "Affected brokers will be notified per applicable law once the formal incident process ships."],
    ],
  },
  cookies: {
    updated: "Draft",
    final: false,
    sections: [
      ["Essential cookies", "Session and locale preference, required for the site to function."],
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
        <p className="section-kicker">{doc.final ? doc.updated : t("updated")}</p>
        <h1 className="display mt-5 text-[clamp(2.4rem,5vw,3.6rem)]">{t(`titles.${slug}`)}</h1>
        {!doc.final ? <p className="mt-6 text-text-muted">{t("notice")}</p> : null}
        {locale !== "en" ? <p className="mt-4 text-xs text-text-faint">{t("englishOnly")}</p> : null}
        <div className="mt-12 space-y-10 border-t border-border pt-10" lang="en" dir="ltr">
          {doc.sections.map(([title, body]) => (
            <div key={title}>
              <h2 className="text-xl tracking-tight">{title}</h2>
              <p className="mt-3 leading-relaxed text-text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>
      {slug === "privacy" ? (
        <section id="privacy-contact" className="section-shell border-t border-border">
          <ContactForm audience="privacy" />
        </section>
      ) : null}
    </PageShell>
  );
}
