import { useTranslations } from "next-intl";
import { ScanReveal } from "@/components/scan-reveal";
import { SodarMark } from "@/components/logo";

// TODO(phase-2): real CRM logos once the launch-priority list is confirmed.
/** Alven-style "just add Sodar to your CRM": the same listing, before and after publishing. */
export function IntegrationShowcase() {
  const t = useTranslations("Integration");
  return (
    <section id="crm" className="section-shell border-t border-border">
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end lg:gap-16">
        <div>
          <p className="section-kicker">{t("kicker")}</p>
          <h2 className="section-title mt-6">{t("title")}</h2>
        </div>
        <p className="max-w-lg text-lg leading-relaxed text-text-muted lg:justify-self-end">{t("intro")}</p>
      </div>

      <div className="mt-14">
        <ScanReveal
          trigger="scrub"
          direction="right"
          durationMs={1000}
          frameClassName="aspect-[16/9] max-h-[600px]"
          flat={<CrmMock withSodarCard={false} />}
          revealed={<CrmMock withSodarCard />}
        />
      </div>
    </section>
  );
}

function CrmMock({ withSodarCard }: { withSodarCard: boolean }) {
  const t = useTranslations("Integration");
  const listings = t.raw("listings") as { name: string; meta: string }[];
  const stills = ["/media/rooms/crm-1.jpg", "/media/rooms/crm-2.jpg", "/media/rooms/crm-3.jpg"];
  return (
    <div className="flex h-full w-full flex-col bg-bg-raised">
      <div className="flex items-center justify-between border-b border-border px-6 py-3.5">
        <p className="text-xs text-text-muted">{t("crmHeader")}</p>
        <SodarMark size={14} className="text-text-muted" />
      </div>
      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-6 sm:grid-cols-3">
        {listings.map((l, i) => (
          <div key={l.name} className="rounded-lg border border-border bg-bg p-4">
            <div className="tile aspect-[4/3] rounded-lg">
              <img src={stills[i] ?? stills[0]} alt="" style={withSodarCard && i === 0 ? { filter: "none" } : undefined} />
              {withSodarCard && i === 0 ? (
                <span className="absolute bottom-2 right-2 rounded-full border border-white/25 bg-black/55 px-2 py-0.5 font-mono text-[10px] text-text">360°</span>
              ) : null}
            </div>
            <p className="mt-3 text-sm text-text">{l.name}</p>
            <p className="mt-1 text-xs text-text-muted">{l.meta}</p>
            {i === 0 && withSodarCard ? (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/25 bg-white/[.06] px-2.5 py-2">
                <SodarMark size={14} className="text-text" />
                <span className="text-[11px] text-text">{t("published")}</span>
              </div>
            ) : (
              <div className="mt-3 flex h-[34px] items-center justify-center rounded-lg border border-dashed border-white/15 font-mono text-[10px] text-text-faint">
                {i === 0 ? t("addWalkthrough") : ""}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
