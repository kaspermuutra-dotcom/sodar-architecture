const ROOMS = ["Living room", "Kitchen", "Primary bedroom", "Bathroom", "Hallway", "Balcony", "Study", "Dining", "Guest room", "Entrance", "Terrace", "Garage"];

/** Thin scrolling strip of room names — the site's "always scanning" heartbeat. */
export function RoomMarquee() {
  const items = [...ROOMS, ...ROOMS];
  return (
    <div className="relative overflow-hidden border-y border-border py-3" aria-hidden>
      <div className="marquee gap-10 whitespace-nowrap font-mono text-[11px] uppercase tracking-[.2em] text-text-faint">
        {items.map((r, i) => (
          <span key={i} className="flex items-center gap-10">
            <span>{r}</span>
            <span className="h-1 w-1 rounded-full bg-text-faint" />
          </span>
        ))}
      </div>
    </div>
  );
}
