"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useGSAP } from "@gsap/react";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/motion";
import { LoopVideo } from "@/components/loop-video";

const TILE = (n: number) => `/media/rooms/tile-${String(n).padStart(2, "0")}.jpg`;

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
  const t = useTranslations("Pipeline");
  const assist = t.raw("assist") as string[];
  const rooms = t.raw("rooms") as string[];
  const quoteRows = t.raw("quoteRows") as { k: string; v: string }[];

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
      const rtl = document.documentElement.dir === "rtl";

      if (prefersReducedMotion()) {
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
          gsap.set(track, { xPercent: (rtl ? 75 : -75) * p });

          const cap = gsap.utils.clamp(0, 1, gsap.utils.mapRange(0.0, 0.26, 0, 1, p));
          const frames = Math.round(cap * 12);
          if (framesRef.current) framesRef.current.textContent = String(frames).padStart(2, "0");
          if (ringRef.current) ringRef.current.style.strokeDashoffset = String(276 * (1 - cap));
          if (assistRef.current) {
            const idx = Math.min(assist.length - 1, Math.floor(cap * assist.length));
            assistRef.current.textContent = assist[idx];
          }

          const prev = gsap.utils.clamp(0, 1, gsap.utils.mapRange(0.28, 0.52, 0, 1, p));
          gsap.set(previewRef.current, { "--reveal-p": prev });
        },
      });
      return () => st.kill();
    },
    { scope: sectionRef, dependencies: [assist] },
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
          <Panel index="01" label={t("panels.capture.label")} title={t("panels.capture.title")} body={t("panels.capture.body")}>
            <div className="relative mx-auto aspect-[9/17] w-full max-w-[300px] overflow-hidden rounded-[2.2rem] border border-border-strong bg-bg-elevated shadow-[0_40px_120px_rgba(0,0,0,.7)]">
              <LoopVideo src="/media/pipeline-capture.mp4" poster={TILE(3)} className="grayscale-[.2] brightness-[.85]" />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,.55),transparent_25%,transparent_70%,rgba(0,0,0,.7))]" />
              <div className="absolute inset-x-6 top-1/2 h-px bg-white/30" />
              <div className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/60" />
              <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text" />
              <svg className="absolute right-4 top-4 h-14 w-14 -rotate-90" viewBox="0 0 100 100" aria-hidden>
                <circle cx="50" cy="50" r="44" stroke="rgba(255,255,255,.15)" strokeWidth="4" fill="none" />
                <circle ref={ringRef} cx="50" cy="50" r="44" stroke="#f4f2ee" strokeWidth="4" fill="none" strokeDasharray="276" strokeDashoffset="276" strokeLinecap="round" />
              </svg>
              <div className="absolute left-4 top-5 font-mono text-[11px] text-text" dir="ltr">
                <span ref={framesRef} className="num">00</span>
                <span className="text-text-muted">{t("frames")}</span>
              </div>
              <div className="absolute inset-x-4 bottom-5 rounded-2xl border border-white/15 bg-black/55 p-3 backdrop-blur">
                <p className="font-mono text-[10px] uppercase tracking-[.16em] text-text-muted">{t("assistantLabel")}</p>
                <p className="mt-1 text-sm text-text">
                  <span ref={assistRef}>{assist[0]}</span>
                </p>
              </div>
            </div>
          </Panel>

          {/* 02 — Preview */}
          <Panel index="02" label={t("panels.preview.label")} title={t("panels.preview.title")} body={t("panels.preview.body")}>
            <div ref={previewRef} className="grid w-full max-w-2xl grid-cols-3 gap-2" style={{ ["--reveal-p" as string]: 0 }}>
              {rooms.map((room, i) => {
                const ready = i < 2;
                return (
                  <div key={room} className="tile aspect-[4/3] rounded-xl border border-border">
                    <img src={TILE(10 + i * 4)} alt="" style={ready ? { filter: "none" } : undefined} />
                    {ready ? (
                      <div className="absolute inset-0" style={{ clipPath: "inset(0 calc((1 - var(--reveal-p, 0)) * 100%) 0 0)" }}>
                        <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,.5))]" />
                        <span className="absolute left-2.5 top-2.5 rounded-full border border-white/30 bg-black/50 px-2 py-0.5 font-mono text-[10px] uppercase text-text">{t("ready")}</span>
                      </div>
                    ) : (
                      <div className="locked-overlay">
                        <span className="font-mono text-[10px] uppercase tracking-[.16em] text-text-muted">{t("locked")}</span>
                      </div>
                    )}
                    <span className="absolute bottom-2 left-2.5 text-[11px] text-text/80">{room}</span>
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* 03 — Unlock */}
          <Panel index="03" label={t("panels.unlock.label")} title={t("panels.unlock.title")} body={t("panels.unlock.body")}>
            <div className="w-full max-w-md rounded-3xl border border-border-strong bg-bg-raised p-7">
              <p className="mono-label">{t("quoteLabel")}</p>
              <ul className="mt-5 space-y-2.5 font-mono text-[12px] text-text-muted">
                {quoteRows.map((row) => (
                  <li key={row.k} className="flex justify-between gap-4 border-b border-border pb-2">
                    <span>{row.k}</span>
                    <span className="text-text">{row.v}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex items-end justify-between gap-4">
                <p className="display text-5xl text-text" dir="ltr">€149</p>
                <p className="font-mono text-[11px] text-text-muted">{t("oneTime")}</p>
              </div>
              {paid ? (
                <div className="mt-6 rounded-2xl border border-white/25 bg-white/[.05] p-4 text-sm text-text">
                  <p className="font-mono text-[10px] uppercase tracking-[.16em] text-text-muted">{t("paidLabel")}</p>
                  <p className="mt-1">{t("paidBody")}</p>
                </div>
              ) : (
                <form onSubmit={handlePay} className="mt-6">
                  <button type="submit" className="button-primary w-full justify-center" disabled={processing}>
                    {processing ? t("paying") : t("pay")} <span aria-hidden>↗</span>
                  </button>
                  <p className="mt-2 text-center font-mono text-[10px] text-text-faint">{t("mockNote")}</p>
                </form>
              )}
            </div>
          </Panel>

          {/* 04 — Publish */}
          <Panel index="04" label={t("panels.publish.label")} title={t("panels.publish.title")} body={t("panels.publish.body")}>
            <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-border-strong bg-bg-raised">
              <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
                <span className="font-mono text-[11px] text-text-muted">{t("crmHeader")}</span>
                <button type="button" onClick={() => setPublished((v) => !v)} className="button-mini">
                  {published ? t("publishedBtn") : t("publishBtn")} <span aria-hidden>{published ? "✓" : "↗"}</span>
                </button>
              </div>
              <div className="grid gap-4 p-5 sm:grid-cols-[1.4fr_1fr]">
                <div className="tile aspect-[16/10] rounded-xl">
                  <img src={TILE(22)} alt="" style={published ? { filter: "none" } : undefined} />
                  {published ? (
                    <div className="absolute bottom-2.5 right-2.5 rounded-full border border-white/25 bg-black/55 px-2.5 py-1 font-mono text-[10px] text-text backdrop-blur">{t("viewerBadge")}</div>
                  ) : (
                    <div className="locked-overlay">
                      <span className="font-mono text-[10px] uppercase tracking-[.16em] text-text-muted">{t("photosOnly")}</span>
                    </div>
                  )}
                </div>
                <div className="text-sm">
                  <p className="text-text">84 Kesklinn Ave</p>
                  <p className="mt-1 text-text-muted">{t("listingMeta")}</p>
                  <div className="mt-4 space-y-1.5 font-mono text-[11px] text-text-muted">
                    <p>{t("status")}: {published ? <span className="text-text">{t("statusPublished")}</span> : t("statusReady")}</p>
                    <p>{t("viewer")}: {published ? <span className="text-text">{t("viewerEmbedded")}</span> : "—"}</p>
                    <p>{t("opened")}: {published ? <span className="num text-text">{t("openedValue")}</span> : "—"}</p>
                  </div>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-6 hidden justify-center gap-2 font-mono text-[10px] uppercase tracking-[.2em] text-text-faint md:flex">
        <span>{t("scroll")}</span>
        <span className="rtl:rotate-180">→</span>
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
