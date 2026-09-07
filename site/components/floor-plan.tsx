/**
 * 2D floor plan of the demo apartment (84 Kesklinn Ave). Pure SVG, drawn in
 * the site's line style: hairline walls, room labels, a dot where each
 * panorama was captured. `ready` rooms are filled; the rest are outlined only.
 */
const ROOMS: { id: string; x: number; y: number; w: number; h: number; dot: [number, number] }[] = [
  { id: "living", x: 8, y: 8, w: 150, h: 104, dot: [86, 66] },
  { id: "kitchen", x: 158, y: 8, w: 96, h: 104, dot: [206, 66] },
  { id: "bedroom", x: 8, y: 112, w: 106, h: 96, dot: [60, 166] },
  { id: "bathroom", x: 114, y: 112, w: 58, h: 60, dot: [143, 150] },
  { id: "study", x: 172, y: 112, w: 82, h: 96, dot: [213, 166] },
  { id: "balcony", x: 114, y: 172, w: 58, h: 36, dot: [156, 198] },
];

export function FloorPlan({ labels, ready = [], className = "" }: { labels: string[]; ready?: number[]; className?: string }) {
  return (
    <svg viewBox="0 0 262 216" className={className} role="img" aria-label="Floor plan" style={{ direction: "ltr" }}>
      <rect x="1" y="1" width="260" height="214" rx="6" fill="var(--color-bg)" stroke="var(--color-border-strong)" strokeWidth="1.5" />
      {ROOMS.map((r, i) => {
        const on = ready.includes(i);
        return (
          <g key={r.id}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={on ? "color-mix(in oklab, var(--color-text) 9%, transparent)" : "transparent"} stroke="var(--color-border-strong)" strokeWidth="1" />
            <text x={r.x + 8} y={r.y + 16} fontSize="8" fill={on ? "var(--color-text)" : "var(--color-text-muted)"} fontFamily="var(--font-sans)">
              {labels[i] ?? r.id}
            </text>
            <circle cx={r.dot[0]} cy={r.dot[1]} r={on ? 3.5 : 2.5} fill={on ? "var(--color-text)" : "transparent"} stroke="var(--color-text)" strokeWidth="1" opacity={on ? 1 : 0.5} />
          </g>
        );
      })}
      {/* door openings */}
      <line x1="158" y1="52" x2="158" y2="70" stroke="var(--color-bg)" strokeWidth="3" />
      <line x1="60" y1="112" x2="76" y2="112" stroke="var(--color-bg)" strokeWidth="3" />
      <line x1="143" y1="112" x2="159" y2="112" stroke="var(--color-bg)" strokeWidth="3" />
      <line x1="213" y1="112" x2="229" y2="112" stroke="var(--color-bg)" strokeWidth="3" />
    </svg>
  );
}
