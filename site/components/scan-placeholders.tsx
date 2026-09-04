// The two layers every ScanReveal flips between. Both use the rendered
// apartment still that already ships in /public; the "flat" layer is the
// phone capture (desaturated, vignetted), the "revealed" layer is the Sodar
// walkthrough (full colour, navigation hotspots, viewer chrome).
// TODO(phase-2): swap `SRC` for the Higgsfield-generated capture/walkthrough pair.

const SRC = "/sodar-apartment-hero.png";

export function FlatListingPhoto({ label }: { label?: string }) {
  return (
    <div className="relative h-full w-full bg-bg-elevated">
      <img src={SRC} alt="" className="absolute inset-0 h-full w-full object-cover grayscale contrast-[1.05] brightness-[.55]" />
      <div className="absolute inset-0 bg-[radial-gradient(110%_80%_at_50%_30%,transparent,rgba(0,0,0,.6))]" />
      {/* capture reticle */}
      <div className="absolute inset-x-[18%] top-1/2 h-px -translate-y-1/2 bg-white/25" />
      <div className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40" />
      {label ? <LayerTag>{label}</LayerTag> : null}
    </div>
  );
}

export function SodarWalkthroughFrame({ label }: { label?: string }) {
  return (
    <div className="relative h-full w-full bg-bg">
      <img src={SRC} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,.25),transparent_30%,transparent_70%,rgba(0,0,0,.45))]" />
      {/* navigation hotspots */}
      {[
        ["31%", "58%"],
        ["57%", "47%"],
        ["76%", "56%"],
      ].map(([l, t]) => (
        <span key={l} className="absolute" style={{ left: l, top: t }}>
          <span className="absolute -inset-3 animate-ping rounded-full border border-white/50" style={{ animationDuration: "2.4s" }} />
          <span className="block h-2.5 w-2.5 rounded-full bg-text shadow-[0_0_12px_rgba(244,242,238,.8)]" />
        </span>
      ))}
      {/* viewer chrome */}
      <div className="absolute bottom-3 right-3 flex items-center gap-2 rounded-full border border-white/20 bg-black/50 px-2.5 py-1 font-mono text-[10px] text-text backdrop-blur">
        <span>360°</span>
        <span className="text-text-muted">·</span>
        <span>Living room</span>
      </div>
      {label ? <LayerTag accent>{label}</LayerTag> : null}
    </div>
  );
}

function LayerTag({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={`absolute left-3 top-3 rounded-full border px-2.5 py-1 font-mono text-[11px] tracking-wide backdrop-blur ${
        accent ? "border-white/40 bg-black/50 text-text" : "border-white/15 bg-black/40 text-text-muted"
      }`}
    >
      {children}
    </span>
  );
}
