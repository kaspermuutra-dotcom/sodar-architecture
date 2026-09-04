import { Link } from "@/i18n/navigation";

const FACTORS = ["Property size", "Panoramas captured", "Processing & AI compute", "Storage & viewer hosting", "Ongoing maintenance"];

/** Pricing teaser → /pricing. One-time, per property, quoted after the free preview. */
export function PricingTeaser() {
  return (
    <section id="pricing" className="section-shell border-t border-border">
      <div className="grid gap-12 lg:grid-cols-[1fr_.8fr] lg:items-center">
        <div>
          <p className="section-kicker">Simple by design</p>
          <h2 className="section-title mt-7">
            One property.
            <br />
            One price. Once.
          </h2>
          <p className="mt-7 max-w-xl text-lg text-text-muted">
            Preview the first two rooms free. Then Sodar quotes a single one-time price for finishing the property — no
            subscription, no annual contract.
          </p>
          <Link href="/pricing" className="button-secondary mt-8">
            How the price is computed <span aria-hidden>↗</span>
          </Link>
        </div>
        <div className="rounded-3xl border border-border-strong bg-bg-raised p-8 sm:p-10">
          <p className="mono-label">Typical 3-room apartment</p>
          <p className="display mt-4 text-6xl text-text">€99–149</p>
          <p className="mt-2 font-mono text-[11px] text-text-muted">one-time · quoted after the free preview</p>
          <ul className="my-8 space-y-3 border-y border-border py-7 text-sm">
            {FACTORS.map((x) => (
              <li key={x} className="flex gap-3 text-text-muted">
                <span className="text-text">—</span>
                {x}
              </li>
            ))}
          </ul>
          <Link href="/product" className="button-primary w-full justify-center">
            Scan a property <span aria-hidden>↗</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
