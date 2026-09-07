"use client";

import { useTranslations } from "next-intl";
import type { PlanTarget, CapturePlan } from "@/lib/scanner/plan";

export type Marker = { left: number; top: number; visible: boolean; near: boolean } | undefined;

export type OverlayProps = {
  plan: CapturePlan | undefined;
  target: PlanTarget | undefined;
  captured: number;
  capturedIndexes: Set<number>;
  marker: Marker;
  dwell: number;
  hasGyro: boolean | null;
  message: string;
  roomName: string;
  paused: boolean;
  needsMove: boolean;
  station?: { label: string; height: "chest" | "low"; kind: string; index: number; total: number };
  retakeMode: boolean;
  onPause: () => void;
  onResume: () => void;
  onInPosition: () => void;
  onManualCapture: () => void;
  onFinish: () => void;
  canFinish: boolean;
  thumbs: string[];
  lastRejected?: string | null;
  compassYaw?: number;
};

/**
 * The viewfinder chrome: next-target marker, dwell ring, a compact coverage
 * strip (sectors of the horizon already covered), station instructions for
 * the full 3D scan, and the assistant line. Every directional cue also has
 * text, colour is never the only signal, and controls are thumb-sized.
 */
export function CaptureOverlay(p: OverlayProps) {
  const t = useTranslations("Scanner");
  const total = p.plan?.targets.length ?? 0;
  const sectors = Array.from({ length: 12 }, (_, i) => i);
  const coveredSectors = new Set<number>();
  if (p.plan) for (const target of p.plan.targets) if (p.capturedIndexes.has(target.index) && Math.abs(target.elevation) < 30) coveredSectors.add(Math.floor((((target.yaw % 360) + 360) % 360) / 30));
  const heading = p.compassYaw === undefined ? undefined : Math.floor((((p.compassYaw % 360) + 360) % 360) / 30);

  return (
    <div className="absolute inset-0 z-10" aria-live="polite">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,transparent_35%,rgba(0,0,0,.55))]" />
      <div className="pointer-events-none absolute inset-x-8 top-1/2 h-px bg-white/30" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <svg width="96" height="96" viewBox="0 0 100 100" className="-rotate-90" aria-hidden>
          <circle cx="50" cy="50" r="44" stroke="rgba(255,255,255,.45)" strokeWidth="2" fill="none" />
          <circle cx="50" cy="50" r="44" stroke="#f4f2ee" strokeWidth="3" fill="none" strokeDasharray="276" strokeDashoffset={276 * (1 - p.dwell)} strokeLinecap="round" />
        </svg>
      </div>
      {!p.paused && !p.needsMove && p.marker?.visible && p.hasGyro ? (
        <div className={`pointer-events-none absolute flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 ${p.marker.near ? "border-text bg-text/30" : "border-dashed border-white/80"}`} style={{ left: p.marker.left, top: p.marker.top }} aria-hidden>
          <span className="font-mono text-[10px] text-white">{(p.target?.index ?? 0) + 1}</span>
        </div>
      ) : null}
      {!p.paused && !p.needsMove && p.marker && !p.marker.visible && p.hasGyro ? (
        <div className="pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 font-mono text-[11px] text-white" aria-hidden>{p.message}</div>
      ) : null}

      <div className="absolute left-4 top-14 font-mono text-[11px] text-text" dir="ltr">
        <span className="num">{String(p.captured).padStart(2, "0")}</span>
        <span className="text-text-muted">/{total || "—"} {t("frames")}</span>
      </div>
      <div className="absolute right-4 top-14 max-w-[45%] truncate rounded-full border border-white/25 bg-black/40 px-2.5 py-1 font-mono text-[10px] text-text backdrop-blur">{p.roomName}</div>

      {/* coverage strip: 12 horizon sectors, filled when captured; the current heading is outlined */}
      <div className="absolute inset-x-4 top-[5.6rem] flex gap-[3px]" role="img" aria-label={t("coverageLabel", { done: coveredSectors.size, total: 12 })} dir="ltr">
        {sectors.map((s) => <span key={s} className={`h-1.5 flex-1 rounded-full ${coveredSectors.has(s) ? "bg-text" : "bg-white/20"} ${heading === s ? "outline outline-1 outline-white" : ""}`} />)}
      </div>

      {p.station && p.plan?.mode === "full3d" ? (
        <div className="absolute inset-x-4 top-[6.6rem] flex items-center justify-between font-mono text-[10px] text-text-muted" dir="ltr">
          <span>{t("stationLabel", { index: p.station.index + 1, total: p.station.total })}</span>
          <span>{p.station.height === "low" ? t("heightLow") : t("heightChest")}</span>
        </div>
      ) : null}

      <div className="absolute inset-x-0 bottom-[10.5rem] flex gap-1 overflow-x-auto px-4" dir="ltr" aria-hidden>
        {p.thumbs.slice(-14).map((src, i) => <img key={i} src={src} alt="" className="h-10 w-14 shrink-0 rounded object-cover" />)}
      </div>

      <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/15 bg-black/60 p-4 backdrop-blur">
        <p className="font-mono text-[10px] uppercase tracking-[.16em] text-text-muted">{p.retakeMode ? t("retakeMode") : t("assistant")}</p>
        {p.paused ? (
          <>
            <p className="mt-1 text-sm text-text">{t("pausedBody")}</p>
            <button type="button" onClick={p.onResume} className="button-primary mt-3 w-full justify-center">{t("resume")}</button>
          </>
        ) : p.needsMove ? (
          <>
            <p className="mt-1 text-sm text-text">{t("moveInstruction", { station: p.station?.label ?? "" })}</p>
            <p className="mt-1 text-xs text-text-muted">{p.station?.kind === "doorway" ? t("moveDoorway") : p.station?.kind === "interior" ? t("moveInterior") : p.station?.height === "low" ? t("movePerimeterLow") : t("movePerimeter")}</p>
            <button type="button" onClick={p.onInPosition} className="button-primary mt-3 w-full justify-center">{t("inPosition")}</button>
          </>
        ) : (
          <>
            <p className="mt-1 min-h-[1.25rem] text-sm text-text">{p.lastRejected ?? p.message}</p>
            {p.hasGyro === false ? <p className="mt-1 text-xs text-text-muted">{t("noGyro")}</p> : null}
          </>
        )}
        <div className="mt-3 flex gap-2">
          {!p.paused ? <button type="button" onClick={p.onPause} className="button-secondary min-h-11 flex-1 justify-center">{t("pause")}</button> : null}
          {!p.paused && !p.needsMove ? <button type="button" onClick={p.onManualCapture} aria-label={t("manual")} className="button-secondary min-h-11 flex-1 justify-center">{t("manual")}</button> : null}
          {p.canFinish && !p.paused ? <button type="button" onClick={p.onFinish} className="button-primary min-h-11 flex-1 justify-center">{p.retakeMode ? t("backToReview") : t("finishRoom")}</button> : null}
        </div>
      </div>
    </div>
  );
}
