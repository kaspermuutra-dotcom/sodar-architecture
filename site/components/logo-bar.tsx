// TODO(phase-2): swap for real brokerage/MLS logos once launch partners are confirmed.
const MARKS = ["KV Kesklinn", "Uus Maa", "Domus Group", "Pindi", "1Partner", "City24 MLS"];

/** §5.3 — grayscale, low-contrast logo bar. */
export function LogoBar() {
  return (
    <section className="border-y border-border bg-bg-raised/40">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-center gap-x-12 gap-y-6 px-5 py-10 sm:px-8 lg:px-12">
        {MARKS.map((name) => (
          <span key={name} className="text-sm tracking-tight text-text-muted opacity-50 grayscale transition-opacity hover:opacity-80">
            {name}
          </span>
        ))}
      </div>
    </section>
  );
}
