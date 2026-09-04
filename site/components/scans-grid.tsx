const CATEGORIES: [string, string, number][] = [
  ["Apartment", "3 rooms · Kesklinn", 2],
  ["New construction", "4 rooms · Ülemiste", 9],
  ["Villa", "6 rooms · Pirita", 16],
  ["Rental", "1 room · Kalamaja", 27],
];

const TILE = (n: number) => `/media/rooms/tile-${String(n).padStart(2, "0")}.jpg`;

/** Four recent walkthroughs — one per listing type; the hover scan-line reveals colour. */
export function ScansGrid() {
  return (
    <section className="section-shell border-t border-border">
      <p className="section-kicker">This week&apos;s scans</p>
      <h2 className="section-title mt-7">Every kind of listing scans the same way.</h2>
      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {CATEGORIES.map(([label, meta, n]) => (
          <div key={label} className="group">
            <div className="tile card-scan aspect-[3/4] rounded-2xl border border-border">
              <img src={TILE(n)} alt="" />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_55%,rgba(0,0,0,.65))]" />
              <span className="absolute bottom-3 left-3 rounded-full border border-white/25 bg-black/50 px-2 py-0.5 font-mono text-[10px] text-text backdrop-blur">360°</span>
            </div>
            <p className="mt-3 text-sm text-text">{label}</p>
            <p className="font-mono text-xs text-text-muted">{meta}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
