"use client";

import { useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/motion";

const ROOMS = ["Living room", "Kitchen", "Primary bedroom", "Bathroom", "Study", "Balcony"];
const TILE = (n: number) => `/media/rooms/tile-${String(n).padStart(2, "0")}.jpg`;

const ASSIST = ["Tilt down 4°", "Hold still…", "Good light. Keep turning", "Overlap 40% — go slower", "Room complete"];

/**
 * The signature section: the whole product, end to end, as a pinned,
 * scroll-scrubbed horizontal sequence.
 *
 *   01 Capture  — phone camera, AI capture assistant coaching the panorama
 *   02 Preview  — first two rooms processed into a working walkthrough, free
 *   03 Unlock   — one-time price computed for the property, paid via Stripe
 *   04 Publish  — connect the CRM, pick the listing, viewer embeds itself
 *
 * One ScrollTrigger owns the horizontal track; the same progress value drives
 * the capture frame counter, assistant messages and the preview reveal.
 */
export function Pipeline() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const framesRef = useRef<HTMLSpanElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const assistRef = useRef<HTMLSpanElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [paid, setPaid] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [published, setPublished] = useState(false);

  useGSAP(
    () => {
      const section = sectionRef.current!;
      const track = trackRef.current!;
      const reduced = prefersReducedMotion();

      if (reduced) {
        gsap.set(track, { xPercent: 0 });
        if (framesRef.current) framesRef.current.textContent = "12";
        gsap.set(previewRef.current, { "--reveal-p": 1 });
        return;
      }

      const distance = () => Math.max(window.innerHeight * 3.2, 2000);
      const st = ScrollTrigger.create({
        trigger: section,
        start: "top top",
        end: () => `+=${distance()}`,
        pin: true,
        scrub: 0.7,
        onUpdate(self) {
          const p = self.progress;
          gsap.set(track, { xPercent: -75 * p });

          // 01 — capture progress
          const cap = gsap.utils.clamp(0, 1, gsap.utils.mapRange(0.0, 0.26, 0, 1, p));
          const frames = Math.round(cap * 12);
          if (framesRef.current) framesRef.current.textContent = String(frames).padStart(2, "0");
          if (ringRef.current) ringRef.current.style.strokeDashoffset = String(276 * (1 - cap));
          if (assistRef.current) {
            const idx = Math.min(ASSIST.length - 1, Math.floor(cap * ASSIST.length));
            assistRef.current.textContent = ASSIST[idx];
          }

          // 02 — preview reveal
          const prev = gsap.utils.clamp(0, 1, gsap.utils.mapRange(0.28, 0.52, 0, 1, p));
          gsap.set(previewRef.current, { "--reveal-p": prev });
        },
      });
      return () => st.kill();
    },
    { scope: sectionRef },
  );

  function handlePay(e: React.FormEvent) {
    e.preventDefault();
    // TODO(phase-2): Stripe Checkout + webhook-driven unlock.
    setProcessing(true);
    window.setTimeout(() => {
      setProcessing(false);
      setPaid(true);
    }, 1100);
  }

  return (
    <section id="pipeline" ref={sectionRef} className="on-ink relative border-t border-border bg-bg">
      <div className="h-screen overflow-hidden">
        <div ref={trackRef} className="flex h-full w-[400vw] will-change-transform">
          {/* 01 — Capture */}
          <Panel index="01" label="Capture" title="Walk the property once." body="Open sodar.io on your phone. The camera guides you room by room while the AI capture assistant corrects coverage, position and light — live, while you're still standing there.">
            <div className="relative mx-auto aspect-[9/17] w-full max-w-[300px] overflow-hidden rounded-[2.2rem] border border-border-strong bg-bg-elevated shadow-[0_40px_120px_rgba(0,0,0,.7)]">
              <img src={TILE(3)} alt="" className="absolute inset-0 h-full w-full object-cover grayscale-[.3] brightness-[.8]" />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,.55),transparent_25%,transparent_70%,rgba(0,0,0,.7))]" />
              {/* horizon + reticle */}
              <div className="absolute inset-x-6 top-1/2 h-px bg-white/30" />
              <div className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/60" />
              <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text" />
              {/* progress ring */}
              <svg className="absolute right-4 top-4 h-14 w-14 -rotate-90" viewBox="0 0 100 100" aria-hidden>
                <circle cx="50" cy="50" r="44" stroke="rgba(255,255,255,.15)" strokeWidth="4" fill="none" />
                <circle ref={ringRef} cx="50" cy="50" r="44" stroke="#f4f2ee" strokeWidth="4" fill="none" strokeDasharray="276" strokeDashoffset="276" strokeLinecap="round" />
              </svg>
              <div className="absolute left-4 top-5 font-mono text-[11px] text-text">
                <span ref={framesRef} className="num">00</span>
                <span className="text-text-muted">/12 frames</span>
              </div>
              <div className="absolute inset-x-4 bottom-5 rounded-2xl border border-white/15 bg-black/55 p-3 backdrop-blur">
                <p className="font-mono text-[10px] uppercase tracking-[.16em] text-text-muted">Capture assistant</p>
                <p className="mt-1 text-sm text-text">
                  <span ref={assistRef}>Tilt down 4°</span>
                </p>
              </div>
            </div>
          </Panel>

          {/* 02 — Preview */}
          <Panel index="02" label="Preview" title="Two rooms, finished, free." body="Sodar processes the first captures into a working walkthrough of the first two rooms. You experience the finished quality before paying anything.">
            <div ref={previewRef} className="grid w-full max-w-2xl grid-cols-3 gap-2" style={{ ["--reveal-p" as string]: 0 }}>
              {ROOMS.map((room, i) => {
                const ready = i < 2;
                return (
                  <div key={room} className="tile aspect-[4/3] rounded-xl border border-border">
                    <img src={TILE(10 + i * 4)} alt="" style={ready ? { filter: "none" } : undefined} />
                    {ready ? (
                      <div className="absolute inset-0" style={{ clipPath: "inset(0 calc((1 - var(--reveal-p, 0)) * 100%) 0 0)" }}>
                        <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,.5))]" />
                        <span className="absolute left-2.5 top-2.5 rounded-full border border-white/30 bg-black/50 px-2 py-0.5 font-mono text-[10px] text-text">READY</span>
                      </div>
                    ) : (
                      <div className="locked-overlay">
                        <span className="font-mono text-[10px] uppercase tracking-[.16em] text-text-muted">Locked</span>
                      </div>
                    )}
                    <span className="absolute bottom-2 left-2.5 text-[11px] text-text/80">{room}</span>
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* 03 — Unlock */}
          <Panel index="03" label="Unlock" title="One price. One payment." body="Sodar quotes a one-time price for the whole property — size, number of panoramas, processing, hosting and maintenance all accounted for. Pay once through Stripe and the remaining rooms are processed.">
            <div className="w-full max-w-md rounded-3xl border border-border-strong bg-bg-raised p-7">
              <p className="mono-label">Quote · 84 Kesklinn Ave</p>
              <ul className="mt-5 space-y-2.5 font-mono text-[12px] text-text-muted">
                {[
                  ["6 rooms · 14 panoramas", "included"],
                  ["Processing & AI compute", "included"],
                  ["Storage & viewer hosting", "12 months"],
                  ["Maintenance", "included"],
                ].map(([k, v]) => (
                  <li key={k} className="flex justify-between border-b border-border pb-2">
                    <span>{k}</span>
                    <span className="text-text">{v}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex items-end justify-between">
                <p className="display text-5xl text-text">€149</p>
                <p className="font-mono text-[11px] text-text-muted">one-time · no subscription</p>
              </div>
              {paid ? (
                <div className="mt-6 rounded-2xl border border-white/25 bg-white/[.05] p-4 text-sm text-text">
                  <p className="font-mono text-[10px] uppercase tracking-[.16em] text-text-muted">Paid</p>
                  <p className="mt-1">Processing the remaining 4 rooms. You&apos;ll be notified when the walkthrough is complete.</p>
                </div>
              ) : (
                <form onSubmit={handlePay} className="mt-6">
                  <button type="submit" className="button-primary w-full justify-center" disabled={processing}>
                    {processing ? "Contacting Stripe…" : "Pay with Stripe"} <span aria-hidden>↗</span>
                  </button>
                  <p className="mt-2 text-center font-mono text-[10px] text-text-faint">Mock checkout — no card is charged.</p>
                </form>
              )}
            </div>
          </Panel>

          {/* 04 — Publish */}
          <Panel index="04" label="Publish" title="Into the listing you already have." body="Connect your CRM, pick the property listing, publish. The walkthrough lives inside the listing through Sodar's embedded viewer — and you can adjust the approved appearance settings any time.">
            <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-border-strong bg-bg-raised">
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <span className="font-mono text-[11px] text-text-muted">Your CRM · Listing #48213</span>
                <button type="button" onClick={() => setPublished((v) => !v)} className="button-mini">
                  {published ? "Published" : "Publish walkthrough"} <span aria-hidden>{published ? "✓" : "↗"}</span>
                </button>
              </div>
              <div className="grid gap-4 p-5 sm:grid-cols-[1.4fr_1fr]">
                <div className="tile aspect-[16/10] rounded-xl">
                  <img src={TILE(22)} alt="" style={published ? { filter: "none" } : undefined} />
                  {published ? (
                    <div className="absolute bottom-2.5 right-2.5 rounded-full border border-white/25 bg-black/55 px-2.5 py-1 font-mono text-[10px] text-text backdrop-blur">
                      Sodar viewer · 360°
                    </div>
                  ) : (
                    <div className="locked-overlay">
                      <span className="font-mono text-[10px] uppercase tracking-[.16em] text-text-muted">Photos only</span>
                    </div>
                  )}
                </div>
                <div className="text-sm">
                  <p className="text-text">84 Kesklinn Ave</p>
                  <p className="mt-1 text-text-muted">3 rooms · 78 m² · €395,000</p>
                  <div className="mt-4 space-y-1.5 font-mono text-[11px] text-text-muted">
                    <p>status: {published ? <span className="text-text">published</span> : "ready"}</p>
                    <p>viewer: {published ? <span className="text-text">embedded</span> : "—"}</p>
                    <p>opened: {published ? <span className="text-text num">128 visitors</span> : "—"}</p>
                  </div>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-6 hidden justify-center gap-2 font-mono text-[10px] uppercase tracking-[.2em] text-text-faint md:flex">
        <span>Scroll</span>
        <span>→</span>
      </div>
    </section>
  );
}

function Panel({ index, label, title, body, children }: { index: string; label: string; title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="grid h-full w-screen grid-rows-[auto_1fr] gap-8 px-5 py-16 sm:px-8 lg:grid-cols-[.8fr_1.2fr] lg:grid-rows-1 lg:items-center lg:px-12">
      <div className="max-w-md">
        <p className="eyebrow">
          <span /> {index} · {label}
        </p>
        <h3 className="display mt-6 text-[clamp(2.2rem,4.6vw,4.4rem)] text-text">{title}</h3>
        <p className="mt-5 text-base leading-relaxed text-text-muted">{body}</p>
      </div>
      <div className="grid place-items-center">{children}</div>
    </div>
  );
}
