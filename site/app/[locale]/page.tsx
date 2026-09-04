import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo";
import { Hero } from "@/components/hero";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { RoomMarquee } from "@/components/room-marquee";
import { Manifesto } from "@/components/manifesto";
import { StatsBand } from "@/components/stats-band";
import { Pipeline } from "@/components/pipeline";
import { CapabilityGrid } from "@/components/capability-grid";
import { IntegrationShowcase } from "@/components/integration-showcase";
import { ImpactStats } from "@/components/impact-stats";
import { TerminalPreviewSection } from "@/components/terminal-preview-section";
import { ScansGrid } from "@/components/scans-grid";
import { TrustPillars } from "@/components/trust-pillars";
import { PartnerTeaser } from "@/components/partner-teaser";
import { PricingTeaser } from "@/components/pricing-teaser";
import { LanguageSection } from "@/components/language-section";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: localeAlternates(locale, "/") };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <RoomMarquee />
        <Manifesto />
        <StatsBand />
        <Pipeline />
        <CapabilityGrid />
        <IntegrationShowcase />
        <ImpactStats />
        <TerminalPreviewSection />
        <ScansGrid />
        <TrustPillars />
        <PartnerTeaser />
        <PricingTeaser />
        <LanguageSection />
      </main>
      <SiteFooter />
    </>
  );
}
