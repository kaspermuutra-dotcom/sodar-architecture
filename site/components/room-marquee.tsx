import { useTranslations } from "next-intl";

/** Thin scrolling strip of room names — the site's "always scanning" heartbeat. */
export function RoomMarquee() {
  const t = useTranslations("Marquee");
  const rooms = t.raw("rooms") as string[];
  const items = [...rooms, ...rooms];
  return (
    <div className="relative overflow-hidden border-y border-border py-3" aria-hidden dir="ltr">
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
