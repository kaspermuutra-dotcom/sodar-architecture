import { Link } from "@/i18n/navigation";

/** One-card teaser for the CRM partner program. */
export function PartnerTeaser() {
  return (
    <section className="section-shell border-t border-border">
      <Link
        href="/partners"
        className="card-scan group grid gap-8 rounded-3xl border border-border bg-bg-raised p-8 transition-colors hover:border-border-strong sm:p-12 lg:grid-cols-[1fr_auto] lg:items-center"
      >
        <div>
          <p className="eyebrow">
            <span />
            For CRM providers
          </p>
          <h2 className="display mt-5 max-w-2xl text-[clamp(2rem,4.4vw,3.6rem)] text-text">
            Distribute Sodar to your broker network. Keep 15%.
          </h2>
          <p className="mt-4 max-w-xl text-text-muted">
            CRM partners make Sodar available to their brokers and receive a 15% margin on qualifying walkthrough
            purchases — no minimum, paid out automatically.
          </p>
        </div>
        <span className="button-secondary shrink-0">
          See the partner program <span aria-hidden>↗</span>
        </span>
      </Link>
    </section>
  );
}
