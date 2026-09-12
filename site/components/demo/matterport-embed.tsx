"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { SodarBadge } from "@/components/demo/sodar-badge";

type Props = {
  /** Matterport Showcase model id (the `m` parameter of the share URL). */
  modelId: string;
  /** Property title, used for the frame's accessible name. */
  title: string;
  /** Poster shown before the visitor starts the walkthrough (an existing still; nothing is fetched from Matterport for it). */
  poster: string;
};

/** How long the poster stays over the frame after it has loaded, covering the player's loading screen. */
const LOADING_COVER_MS = 4500;

/** Showcase interface languages Matterport accepts in the `lang` parameter; other site locales fall back to English. */
const SHOWCASE_LANGS = new Set(["en", "de", "es", "fr", "it", "nl", "pt", "pl", "sv", "tr"]);

/**
 * The official Showcase player URL. `play=1` starts the model once the visitor has pressed Start, so there is one
 * click, not two; `title=0` hides Matterport's title/About panel in the top-left (the Matterport logo stays).
 */
export function matterportShowcaseUrl(modelId: string, locale?: string) {
  const params = new URLSearchParams({ m: modelId, play: "1", title: "0" });
  if (locale && SHOWCASE_LANGS.has(locale)) params.set("lang", locale);
  return `https://my.matterport.com/show/?${params.toString()}`;
}

type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FullscreenDocument = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };

/**
 * The hosted Matterport walkthrough inside the same square-cornered stage as
 * the local viewer: the poster with one "Start walkthrough" action, then the
 * Showcase iframe filling the stage, with the Sodar badge, a fullscreen
 * control and Close over it. Fullscreen is requested on the stage (not the
 * iframe) so the badge stays visible; Matterport's own fullscreen button
 * keeps working through `allowFullScreen`. The imagery is streamed by
 * Matterport — nothing is downloaded, resized or re-stitched here. `title=0` hides the top-left title/About
 * panel. The Sodar panel sits top-left as an opaque block over the player's logo (decided by the owner on
 * 2026-09-12 despite Matterport's Services Agreement 18(f)(iii), which forbids obscuring its marks); nothing is
 * injected into the frame.
 */
export function MatterportEmbed({ modelId, title, poster }: Props) {
  const t = useTranslations("MatterportEmbed");
  const tDemo = useTranslations("PropertyDemo");
  const locale = useLocale();
  const stage = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  // The player's own loading screen carries a "Powered by Matterport" mark; the poster stays over the frame until the
  // frame has loaded and the usual loading time has passed.
  const [covered, setCovered] = useState(true);

  useEffect(() => {
    const doc = document as FullscreenDocument;
    setFullscreenSupported(Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled));
    const sync = () => setFullscreen(Boolean(doc.fullscreenElement || doc.webkitFullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  const exitFullscreen = useCallback(async () => {
    const doc = document as FullscreenDocument;
    try {
      if (doc.fullscreenElement) await document.exitFullscreen();
      else if (doc.webkitFullscreenElement) await doc.webkitExitFullscreen?.();
    } catch {
      /* the browser refused; the state listener stays in sync */
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (fullscreen) return exitFullscreen();
    const el = stage.current as FullscreenElement | null;
    if (!el) return;
    try {
      if (el.requestFullscreen) await el.requestFullscreen();
      else await el.webkitRequestFullscreen?.();
    } catch {
      /* not permitted here (e.g. an iOS phone); Matterport's own control still works where the platform allows it */
    }
  }, [fullscreen, exitFullscreen]);

  const close = useCallback(() => {
    void exitFullscreen();
    setStarted(false);
    setCovered(true);
  }, [exitFullscreen]);

  const onFrameLoad = useCallback(() => {
    const timer = window.setTimeout(() => setCovered(false), LOADING_COVER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const src = matterportShowcaseUrl(modelId, locale);

  return (
    <div>
      <div ref={stage} className="demo-stage demo-embed" data-scene={started ? "tour" : "intro"}>
        {started ? (
          <>
            {/* No `allowfullscreen`: the player's own fullscreen would show the bare frame without the Sodar panel;
                fullscreen is taken on the stage instead (button top-right), which keeps every overlay in place. */}
            <iframe src={src} title={t("frameTitle", { title })} className="absolute inset-0 h-full w-full border-0" allow="autoplay; web-share; xr-spatial-tracking" referrerPolicy="strict-origin-when-cross-origin" onLoad={onFrameLoad} />
            {covered ? (
              <div className="demo-poster-cover" aria-hidden="true">
                <img src={poster} alt="" width={1280} height={800} className="absolute inset-0 h-full w-full object-cover" decoding="async" />
                <p className="demo-loading" role="status">
                  <span className="demo-spinner" aria-hidden />
                  <span>{tDemo("loadingShort")}</span>
                </p>
              </div>
            ) : null}
            <SodarBadge cover />
            <div className="demo-topbar">
              {fullscreenSupported ? (
                <button type="button" className="demo-close" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? t("exitFullscreen") : t("fullscreen")} title={fullscreen ? t("exitFullscreen") : t("fullscreen")} aria-pressed={fullscreen}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {fullscreen ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
                  </svg>
                </button>
              ) : null}
              <button type="button" className="demo-close" onClick={close} aria-label={tDemo("close")} title={tDemo("close")}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          </>
        ) : (
          <div className="absolute inset-0">
            <img src={poster} alt="" width={1280} height={800} className="absolute inset-0 h-full w-full object-cover" decoding="async" fetchPriority="high" />
            <div className="absolute inset-0 flex flex-col items-center justify-end gap-3 bg-gradient-to-t from-black/70 via-black/10 to-transparent p-6 text-center sm:p-8">
              <p className="font-mono text-[10px] uppercase tracking-[.16em] text-[#f4f2ee]/75">{tDemo("introLabel")}</p>
              <button type="button" onClick={() => setStarted(true)} className="button-primary bg-[#f4f2ee] text-black hover:bg-white">
                {tDemo("start")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* No separate "hosted on" line: the player carries Matterport's own logo, which is left untouched. */}
      <p className="mt-3 text-xs text-text-muted">{t("hint")}</p>
    </div>
  );
}
