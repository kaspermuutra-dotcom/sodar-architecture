import { ScanReveal } from "@/components/scan-reveal";
import { SodarMark } from "@/components/logo";

// TODO(phase-2): real CRM logos once the launch-priority list is confirmed.
/** Alven-style "just add Sodar to your CRM": the same listing, before and after publishing. */
export function IntegrationShowcase() {
  return (
    <section id="crm" className="section-shell border-t border-border">
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-24">
        <p className="section-kicker">Lives where you already work</p>
        <p className="max-w-xl self-end text-lg leading-relaxed text-text-muted">
          Connect the CRM you already use. Choose the listing. Publish. The walkthrough appears inside it through an
          embedded viewer or iframe — nothing to copy, nothing to host.
        </p>
      </div>
      <h2 className="section-title mt-7">Just add Sodar to your CRM.</h2>

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
  return (
    <div className="flex h-full w-full flex-col bg-bg-raised">
      <div className="flex items-center justify-between border-b border-border px-6 py-3.5">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        </div>
        <p className="font-mono text-[11px] text-text-muted">Your CRM · Listings</p>
        <span className="h-7 w-7 rounded-full bg-white/10" />
      </div>
      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-6 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-bg p-4">
            <div className="tile aspect-[4/3] rounded-lg">
              <img src={`/media/rooms/tile-${String(5 + i * 7).padStart(2, "0")}.jpg`} alt="" style={withSodarCard && i === 0 ? { filter: "none" } : undefined} />
              {withSodarCard && i === 0 ? (
                <span className="absolute bottom-2 right-2 rounded-full border border-white/25 bg-black/55 px-2 py-0.5 font-mono text-[10px] text-text">360°</span>
              ) : null}
            </div>
            <p className="mt-3 text-sm text-text">{["84 Kesklinn Ave", "12 Harbour Res.", "7 Nõmme Villa"][i]}</p>
            <p className="mt-1 text-xs text-text-muted">{["3 rooms · €395,000", "2 rooms · €260,000", "6 rooms · €890,000"][i]}</p>
            {i === 0 && withSodarCard ? (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/25 bg-white/[.06] px-2.5 py-2">
                <SodarMark size={14} className="text-text" />
                <span className="font-mono text-[10px] text-text">Walkthrough published</span>
              </div>
            ) : (
              <div className="mt-3 flex h-[34px] items-center justify-center rounded-lg border border-dashed border-white/15 font-mono text-[10px] text-text-faint">
                {i === 0 ? "+ add walkthrough" : ""}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
