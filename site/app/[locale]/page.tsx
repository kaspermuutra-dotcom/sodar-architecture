import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo";
import { Hero } from "@/components/hero";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { RoomMarquee } from "@/components/room-marquee";
import { ProofStrip } from "@/components/proof-strip";
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
        <ProofStrip />
        <RoomMarquee />
        <div className="theme-light">
          <Manifesto />
          <StatsBand />
        </div>
        <Pipeline />
        <div className="theme-light">
          <CapabilityGrid />
          <ImpactStats />
        </div>
        <IntegrationShowcase />
        <TerminalPreviewSection />
        <ScansGrid />
        <div className="theme-light">
          <TrustPillars />
          <PartnerTeaser />
          <PricingTeaser />
          <LanguageSection />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
