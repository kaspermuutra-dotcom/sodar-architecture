import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo";
import { PageShell } from "@/components/page-shell";
import { ContactForm } from "@/components/contact-form";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Contact" });
  return { title: t("metaTitle"), description: t("sub"), alternates: localeAlternates(locale, "/contact") };
}

export default async function ContactPage({ params }: Params) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <PageShell>
      <section className="section-shell">
        <ContactForm />
      </section>
    </PageShell>
  );
}
