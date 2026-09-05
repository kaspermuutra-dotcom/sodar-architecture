import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo";
import { Scanner } from "@/components/scanner/scanner";

type Params = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Scanner" });
  return { title: t("metaTitle"), description: t("intro"), alternates: localeAlternates(locale, "/scan"), robots: { index: false } };
}

/** Full-screen guided capture. No site chrome — this is the phone product surface. */
export default async function ScanPage({ params }: Params) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Scanner />;
}
