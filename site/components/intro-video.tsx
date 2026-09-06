"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * The introduction film — Alven-style product video block. Autoplays muted
 * inline with a poster; tap toggles play/pause. `/media/intro.mp4` is rendered
 * from the pitch-deck film with `deck/export/render.mjs` (see deck/README.md).
 */
export function IntroVideo() {
  const t = useTranslations("Intro");
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [length, setLength] = useState("1:12");

  function toggle() {
    const v = ref.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }

  return (
    <section className="section-shell border-t border-border">
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-24">
        <p className="section-kicker">{t("kicker")}</p>
        <p className="max-w-xl self-end text-lg leading-relaxed text-text-muted">{t("body")}</p>
      </div>
      <h2 className="section-title mt-7">{t("title")}</h2>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        className="group relative mt-12 block w-full overflow-hidden rounded-[2rem] border border-border-strong bg-bg-elevated text-left"
      >
        <video
          ref={ref}
          src="/media/intro.mp4"
          poster="/media/intro-poster.jpg"
          muted
          loop
          autoPlay
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            const d = Math.round(e.currentTarget.duration);
            if (Number.isFinite(d) && d > 0) setLength(`${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")}`);
          }}
          className="aspect-video w-full object-cover"
        />
        <span className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full border border-white/25 bg-black/55 px-3 py-1.5 font-mono text-[11px] text-[#f4f2ee] backdrop-blur">
          <span aria-hidden>{playing ? "❚❚" : "▶"}</span>
          <span>{length}</span>
        </span>
      </button>
    </section>
  );
}
