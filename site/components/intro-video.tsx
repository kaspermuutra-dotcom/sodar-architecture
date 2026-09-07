"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

const fmt = (d: number) => `${Math.floor(d / 60)}:${String(Math.floor(d) % 60).padStart(2, "0")}`;

/**
 * The introduction film. Autoplays muted inline over a poster; a minimal
 * control bar (play, progress, time, sound, fullscreen) appears on hover and
 * stays visible on touch devices. `/media/intro.mp4` is rendered from the
 * pitch-deck film with `deck/export/render.mjs` (see deck/README.md).
 */
export function IntroVideo() {
  const t = useTranslations("Intro");
  const frame = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onTime = () => setTime(v.currentTime);
    const onMeta = () => setLength(v.duration);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    if (Number.isFinite(v.duration) && v.duration > 0) setLength(v.duration);
    // Autoplay is only attempted while the film is on screen; off screen it pauses to save battery.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) v.play().catch(() => setPlaying(false));
        else v.pause();
      },
      { threshold: 0.35 },
    );
    io.observe(v);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      io.disconnect();
    };
  }, []);

  const toggle = useCallback(() => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => undefined);
    else v.pause();
  }, []);

  function toggleMute() {
    const v = ref.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const v = ref.current;
    if (!v || !length) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    v.currentTime = p * length;
  }

  function fullscreen() {
    const el = frame.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  }

  const progress = length ? (time / length) * 100 : 0;

  return (
    <section id="film" className="section-shell border-t border-border">
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end lg:gap-16">
        <div>
          <p className="section-kicker">{t("kicker")}</p>
          <h2 className="section-title mt-6">{t("title")}</h2>
        </div>
        <p className="max-w-lg text-lg leading-relaxed text-text-muted lg:justify-self-end">{t("body")}</p>
      </div>

      <div ref={frame} data-paused={!playing} className="film-frame mt-12 aspect-video w-full border border-border">
        <video
          ref={ref}
          src="/media/intro.mp4"
          poster="/media/intro-poster.jpg"
          muted
          loop
          autoPlay
          playsInline
          preload="metadata"
          onClick={toggle}
          aria-label={t("title")}
        />
        <div className="film-controls" dir="ltr">
          <button type="button" onClick={toggle} aria-label={playing ? t("pause") : t("play")}>
            {playing ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden><rect x="2" y="1.5" width="3" height="9" rx=".5" /><rect x="7" y="1.5" width="3" height="9" rx=".5" /></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden><path d="M3 1.5v9l7.5-4.5z" /></svg>
            )}
          </button>
          <div className="film-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} onClick={seek}>
            <i style={{ width: `${progress}%` }} />
          </div>
          {length > 0 ? (
            <span className="film-time">
              {fmt(time)} / {fmt(length)}
            </span>
          ) : null}
          <button type="button" onClick={toggleMute} aria-label={muted ? t("unmute") : t("mute")}>
            {muted ? (
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden><path d="M2 5.5h2.5L8 3v8L4.5 8.5H2z" fill="currentColor" stroke="none" /><path d="M10 5l3 4M13 5l-3 4" /></svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden><path d="M2 5.5h2.5L8 3v8L4.5 8.5H2z" fill="currentColor" stroke="none" /><path d="M10 4.5a3.5 3.5 0 0 1 0 5M11.8 2.8a6 6 0 0 1 0 8.4" /></svg>
            )}
          </button>
          <button type="button" onClick={fullscreen} aria-label={t("fullscreen")}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden><path d="M1.5 4.5v-3h3M10.5 4.5v-3h-3M1.5 7.5v3h3M10.5 7.5v3h-3" /></svg>
          </button>
        </div>
      </div>
    </section>
  );
}
