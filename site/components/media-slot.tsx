// Placeholder stand-in for every §7 /public/media/*.mp4 slot named in the
// build brief. Renders a dark panel with a slow SVG scan-line sweep — the
// brief's explicitly-sanctioned stand-in "where no video exists yet".
//
// The intended final path is threaded through as `src` and stamped on the
// DOM (data-media-src) so the swap is a one-line change, not a markup
// rewrite: replace the placeholder body with
//   <video src={src} autoPlay muted loop playsInline className="h-full w-full object-cover" />
// TODO(phase-2): swap in the Higgsfield-rendered asset at `src` once approved.
export function MediaSlot({
  src,
  label,
  className = "",
}: {
  src: string;
  label?: string;
  className?: string;
}) {
  return (
    <div
      data-media-src={src}
      className={`relative isolate flex h-full w-full items-center justify-center overflow-hidden bg-[linear-gradient(160deg,#15181a_0%,#0b0d0f_60%,#050607_100%)] ${className}`}
    >
      <svg
        aria-hidden
        viewBox="0 0 400 240"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full opacity-70"
      >
        <defs>
          <linearGradient id={`scanfade-${src}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0" />
            <stop offset="50%" stopColor="var(--color-accent)" stopOpacity=".9" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="400" height="1.5" fill={`url(#scanfade-${src})`}>
          <animate attributeName="y" values="0;238;0" dur="6s" repeatCount="indefinite" />
        </rect>
        {Array.from({ length: 6 }).map((_, i) => (
          <line
            key={i}
            x1="0"
            x2="400"
            y1={i * 40}
            y2={i * 40}
            stroke="var(--color-ink-border)"
            strokeWidth="1"
          />
        ))}
      </svg>
      {label ? (
        <span className="absolute bottom-3 left-3 rounded-full border border-ink-border bg-black/40 px-2.5 py-1 font-mono text-[10px] tracking-wide text-ink-muted">
          {label}
        </span>
      ) : null}
    </div>
  );
}
