// The two layers every ScanReveal flips between: the flat phone capture and
// the Sodar walkthrough. The revealed layer plays the harbour-view dolly loop
// over its poster still.

import { LoopVideo } from "@/components/loop-video";

const SRC = "/media/hero-scan-loop.jpg";
const LOOP = "/media/hero-scan-loop.mp4";

export function FlatListingPhoto({ label, still = SRC }: { label?: string; still?: string }) {
  return (
    <div className="relative h-full w-full bg-bg-elevated">
      <img src={still} alt="" className="absolute inset-0 h-full w-full object-cover grayscale contrast-[1.05] brightness-[.6]" />
      <div className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40" />
      {label ? <LayerTag>{label}</LayerTag> : null}
    </div>
  );
}

export function SodarWalkthroughFrame({ label, still = SRC, video = still === SRC ? LOOP : undefined }: { label?: string; still?: string; video?: string }) {
  return (
    <div className="relative h-full w-full bg-bg">
      {video ? <LoopVideo src={video} poster={still} /> : <img src={still} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,.2),transparent_30%,transparent_75%,rgba(0,0,0,.35))]" />
      {[
        ["31%", "58%"],
        ["57%", "47%"],
        ["76%", "56%"],
      ].map(([l, t]) => (
        <span key={l} className="absolute block h-2.5 w-2.5 rounded-full border border-white/70 bg-white/30 backdrop-blur" style={{ left: l, top: t }} />
      ))}
      <div className="absolute bottom-3 right-3 rounded-full border border-white/20 bg-black/50 px-2.5 py-1 font-mono text-[10px] text-[#f4f2ee] backdrop-blur">360°</div>
      {label ? <LayerTag accent>{label}</LayerTag> : null}
    </div>
  );
}

function LayerTag({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span className={`absolute left-3 top-3 rounded-full border px-2.5 py-1 font-mono text-[11px] tracking-wide backdrop-blur ${accent ? "border-white/40 bg-black/50 text-[#f4f2ee]" : "border-white/15 bg-black/40 text-white/70"}`}>
      {children}
    </span>
  );
}
