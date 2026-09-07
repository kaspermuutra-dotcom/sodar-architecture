"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/motion";
import { LoopVideo } from "@/components/loop-video";
import { FloorPlan } from "@/components/floor-plan";

const ROOM_STILLS = ["/media/rooms/living.jpg", "/media/rooms/kitchen.jpg", "/media/rooms/bedroom.jpg", "/media/rooms/bathroom.jpg", "/media/rooms/study.jpg", "/media/rooms/balcony.jpg"];

/**
 * The product end to end — Capture, Preview, Unlock, Publish — as four calm
 * stacked stages. Each stage fades in once as it enters the viewport; the
 * capture stage's frame counter and the preview reveal run once as well.
 */
export function Pipeline() {
  const t = useTranslations("Pipeline");
  const assist = t.raw("assist") as string[];
  const rooms = t.raw("rooms") as string[];
  const quoteRows = t.raw("quoteRows") as { k: string; v: string }[];

  const sectionRef = useRef<HTMLDivElement>(null);
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
      const stages = section.querySelectorAll<HTMLElement>("[data-stage]");
      const reduced = prefersReducedMotion();

      if (reduced) {
        gsap.set(stages, { opacity: 1, y: 0 });
        if (framesRef.current) framesRef.current.textContent = "12";
        if (ringRef.current) ringRef.current.style.strokeDashoffset = "0";
        if (assistRef.current) assistRef.current.textContent = assist[assist.length - 1];
        gsap.set(previewRef.current, { "--reveal-p": 1 });
        return;
      }

      stages.forEach((stage) => {
        gsap.fromTo(stage, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.8, ease: "power2.out", scrollTrigger: { trigger: stage, start: "top 80%", once: true } });
      });

      const capture = { p: 0 };
      gsap.to(capture, {
        p: 1,
        duration: 3.2,
        ease: "power1.inOut",
        scrollTrigger: { trigger: stages[0], start: "top 70%", once: true },
        onUpdate() {
          const frames = Math.round(capture.p * 12);
          if (framesRef.current) framesRef.current.textContent = String(frames).padStart(2, "0");
          if (ringRef.current) ringRef.current.style.strokeDashoffset = String(276 * (1 - capture.p));
          if (assistRef.current) assistRef.current.textContent = assist[Math.min(assist.length - 1, Math.floor(capture.p * assist.length))];
        },
      });

      gsap.to(previewRef.current, {
        "--reveal-p": 1,
        duration: 1.4,
        ease: "power2.inOut",
        scrollTrigger: { trigger: stages[1], start: "top 70%", once: true },
      });
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
    <section id="pipeline" ref={sectionRef} className="on-ink border-t border-border bg-bg">
      <div className="section-shell">
        <p className="section-kicker">{t("kicker")}</p>
        <h2 className="section-title mt-6">{t("title")}</h2>

        <div className="mt-16 divide-y divide-border border-t border-border">
          <Stage label={t("panels.capture.label")} title={t("panels.capture.title")} body={t("panels.capture.body")}>
            <div className="relative mx-auto aspect-[9/17] w-full max-w-[280px] overflow-hidden rounded-[2rem] border border-border-strong bg-bg-elevated">
              <LoopVideo src="/media/pipeline-capture.mp4" poster="/media/pipeline-capture.jpg" />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,.5),transparent_25%,transparent_70%,rgba(0,0,0,.65))]" />
              <svg className="absolute right-4 top-4 h-12 w-12 -rotate-90" viewBox="0 0 100 100" aria-hidden>
                <circle cx="50" cy="50" r="44" stroke="rgba(255,255,255,.15)" strokeWidth="4" fill="none" />
                <circle ref={ringRef} cx="50" cy="50" r="44" stroke="#f4f2ee" strokeWidth="4" fill="none" strokeDasharray="276" strokeDashoffset="276" strokeLinecap="round" />
              </svg>
              <div className="absolute left-4 top-5 font-mono text-[11px] text-[#f4f2ee]" dir="ltr">
                <span ref={framesRef} className="num">00</span>
                <span className="text-white/60">{t("frames")}</span>
              </div>
              <div className="absolute inset-x-4 bottom-5 rounded-xl border border-white/15 bg-black/55 p-3 backdrop-blur">
                <p className="font-mono text-[10px] uppercase tracking-[.14em] text-white/60">{t("assistantLabel")}</p>
                <p className="mt-1 text-sm text-[#f4f2ee]">
                  <span ref={assistRef}>{assist[0]}</span>
                </p>
              </div>
            </div>
          </Stage>

          <Stage label={t("panels.preview.label")} title={t("panels.preview.title")} body={t("panels.preview.body")}>
            <div ref={previewRef} className="grid w-full max-w-2xl gap-3 sm:grid-cols-[1.1fr_1fr]" style={{ ["--reveal-p" as string]: 0 }}>
              <div className="rounded-xl border border-border bg-bg-raised p-4">
                <p className="mono-label">{t("planLabel")}</p>
                <FloorPlan labels={rooms} ready={[0, 1]} className="mt-3 w-full" />
              </div>
              <div className="grid grid-rows-2 gap-3">
                {rooms.slice(0, 2).map((room, i) => (
                  <div key={room} className="tile rounded-xl border border-border">
                    <img src={ROOM_STILLS[i]} alt="" className="absolute inset-0" style={{ filter: "none" }} />
                    <div className="absolute inset-0" style={{ clipPath: "inset(0 calc((1 - var(--reveal-p, 0)) * 100%) 0 0)" }}>
                      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,.45))]" />
                      <span className="absolute left-2.5 top-2.5 rounded-full border border-white/30 bg-black/50 px-2 py-0.5 font-mono text-[10px] uppercase text-[#f4f2ee]">{t("ready")}</span>
                    </div>
                    <span className="absolute bottom-2 left-2.5 text-[11px] text-white/85">{room}</span>
                  </div>
                ))}
              </div>
            </div>
          </Stage>

          <Stage label={t("panels.unlock.label")} title={t("panels.unlock.title")} body={t("panels.unlock.body")}>
            <div className="w-full max-w-md rounded-2xl border border-border bg-bg-raised p-7">
              <p className="mono-label">{t("quoteLabel")}</p>
              <ul className="mt-5 space-y-2.5 text-sm text-text-muted">
                {quoteRows.map((row) => (
                  <li key={row.k} className="flex justify-between gap-4 border-b border-border pb-2">
                    <span>{row.k}</span>
                    <span className="text-text">{row.v}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex items-end justify-between gap-4">
                <p className="display text-5xl text-text" dir="ltr">€99</p>
                <p className="text-xs text-text-muted">{t("oneTime")}</p>
              </div>
              {paid ? (
                <div className="mt-6 rounded-xl border border-border-strong p-4 text-sm text-text">
                  <p className="mono-label">{t("paidLabel")}</p>
                  <p className="mt-1">{t("paidBody")}</p>
                </div>
              ) : (
                <form onSubmit={handlePay} className="mt-6">
                  <button type="submit" className="button-primary w-full" disabled={processing}>
                    {processing ? t("paying") : t("pay")}
                  </button>
                  <p className="mt-3 text-center text-xs text-text-faint">{t("mockNote")}</p>
                </form>
              )}
            </div>
          </Stage>

          <Stage label={t("panels.publish.label")} title={t("panels.publish.title")} body={t("panels.publish.body")}>
            <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-bg-raised">
              <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
                <span className="text-xs text-text-muted">{t("crmHeader")}</span>
                <button type="button" onClick={() => setPublished((v) => !v)} className="button-mini">
                  {published ? t("publishedBtn") : t("publishBtn")}
                </button>
              </div>
              <div className="grid gap-4 p-5 sm:grid-cols-[1.4fr_1fr]">
                <div className="tile aspect-[16/10] rounded-lg">
                  <img src="/media/rooms/publish.jpg" alt="" style={published ? { filter: "none" } : undefined} />
                  {published ? (
                    <div className="absolute bottom-2.5 right-2.5 rounded-full border border-white/25 bg-black/55 px-2.5 py-1 font-mono text-[10px] text-[#f4f2ee] backdrop-blur">{t("viewerBadge")}</div>
                  ) : (
                    <div className="locked-overlay">
                      <span className="font-mono text-[10px] uppercase tracking-[.14em] text-white/60">{t("photosOnly")}</span>
                    </div>
                  )}
                </div>
                <div className="text-sm">
                  <p className="text-text">84 Kesklinn Ave</p>
                  <p className="mt-1 text-text-muted">{t("listingMeta")}</p>
                  <div className="mt-4 space-y-1.5 text-xs text-text-muted">
                    <p>{t("status")}: {published ? <span className="text-text">{t("statusPublished")}</span> : t("statusReady")}</p>
                    <p>{t("viewer")}: {published ? <span className="text-text">{t("viewerEmbedded")}</span> : "—"}</p>
                    <p>{t("opened")}: {published ? <span className="num text-text">{t("openedValue")}</span> : "—"}</p>
                  </div>
                </div>
              </div>
            </div>
          </Stage>
        </div>
      </div>
    </section>
  );
}

function Stage({ label, title, body, children }: { label: string; title: string; body: string; children: React.ReactNode }) {
  return (
    <div data-stage className="grid gap-10 py-16 lg:grid-cols-[.8fr_1.2fr] lg:items-center lg:gap-16 lg:py-24">
      <div className="max-w-md">
        <p className="eyebrow">{label}</p>
        <h3 className="display mt-5 text-[clamp(1.9rem,3.6vw,3.2rem)] text-text">{title}</h3>
        <p className="mt-5 text-base leading-relaxed text-text-muted">{body}</p>
      </div>
      <div className="grid place-items-center">{children}</div>
    </div>
  );
}
