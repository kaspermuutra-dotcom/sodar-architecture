"use client";

import { useTranslations } from "next-intl";
import type { AstraCaptureReview } from "@/lib/scanner/astra";
import type { FrameSummary } from "@/lib/scanner/db";
import type { RoomGate } from "@/lib/scanner/quality";

export type ReviewProps = {
  roomName: string;
  gate: RoomGate;
  frames: FrameSummary[];
  thumbs: Map<string, string>;
  review: AstraCaptureReview | undefined;
  reviewBusy: boolean;
  reviewError: string | null;
  reviewAvailable: boolean;
  onReview: () => void;
  onRetake: (frameId: string, checkpoint: number) => void;
  onAddMore: () => void;
  onConfirm: () => void;
  onDiscardRoom: () => void;
  minFrames: number;
};

/** "Checking coverage" / "A few photos need attention": local gates, Astra findings, per-frame retakes, confirm. */
export function ReviewPanel(p: ReviewProps) {
  const t = useTranslations("Scanner.review");
  const soft = p.frames.filter((frame) => frame.findings?.some((f) => f.severity === "retake"));
  const blocking = p.gate.blocking.length > 0;
  const retakeRecommended = p.gate.recommended.length > 0 || p.review?.verdict === "retake" || soft.length > 0;
  return (
    <section className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-8 pt-20 text-text">
      <p className="eyebrow"><span /> {blocking ? t("eyebrowBlocked") : retakeRecommended ? t("eyebrowAttention") : t("eyebrowGood")}</p>
      <h2 className="display mt-3 text-[clamp(1.9rem,7vw,2.8rem)]">{blocking ? t("titleBlocked") : retakeRecommended ? t("titleAttention") : t("titleGood")}</h2>
      <p className="mt-2 text-sm text-text-muted">{p.roomName} · {t("frameCount", { count: p.frames.length })}</p>

      <ul className="mt-4 space-y-2 text-sm">
        {p.gate.blocking.map((code) => <li key={code} className="rounded-xl border border-red-300/40 bg-red-950/30 p-3">⛔ {t.has(`codes.${code}`) ? t(`codes.${code}`, { min: p.minFrames }) : code}</li>)}
        {p.gate.recommended.map((code) => <li key={code} className="rounded-xl border border-white/25 p-3">▲ {t.has(`codes.${code}`) ? t(`codes.${code}`, { min: p.minFrames }) : code}</li>)}
        {p.gate.info.map((code) => <li key={code} className="rounded-xl border border-white/10 p-3 text-text-muted">• {t.has(`codes.${code}`) ? t(`codes.${code}`, { min: p.minFrames }) : code}</li>)}
      </ul>

      <div className="mt-5 rounded-2xl border border-white/15 bg-black/40 p-4">
        <p className="font-mono text-[10px] uppercase tracking-[.14em] text-text-muted">{t("astraTitle")}</p>
        {p.review ? (
          <>
            <p className="mt-2 text-sm">{p.review.summary}</p>
            <p className="mt-2 text-sm text-text-muted">{p.review.guidance}</p>
            {p.review.issues.length ? (
              <ul className="mt-3 space-y-2 text-sm">
                {p.review.issues.map((issue, i) => (
                  <li key={i} className="rounded-xl border border-white/15 p-3">
                    <p className="font-medium">{issue.severity === "critical" ? "⛔ " : issue.severity === "warning" ? "▲ " : "• "}{issue.title}</p>
                    <p className="mt-1 text-xs text-text-muted">{issue.detail}</p>
                    <p className="mt-1 text-xs">→ {issue.instruction}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 font-mono text-[10px] text-text-faint">{t("astraDisclaimer")}</p>
          </>
        ) : (
          <p className="mt-2 text-sm text-text-muted">{p.reviewAvailable ? t("astraBody") : t("astraUnavailable")}</p>
        )}
        {p.reviewError ? <p role="alert" className="mt-2 text-xs text-red-200">{p.reviewError}</p> : null}
        {p.reviewAvailable && !blocking ? (
          <button type="button" onClick={p.onReview} disabled={p.reviewBusy} className="button-secondary mt-3 w-full justify-center">{p.reviewBusy ? t("astraBusy") : p.review ? t("astraAgain") : t("astraRun")}</button>
        ) : null}
      </div>

      {soft.length ? (
        <div className="mt-5">
          <p className="font-mono text-[10px] uppercase tracking-[.14em] text-text-muted">{t("softTitle", { count: soft.length })}</p>
          <ul className="mt-2 grid grid-cols-3 gap-2">
            {soft.slice(0, 12).map((frame) => (
              <li key={frame.id} className="overflow-hidden rounded-xl border border-white/15">
                {p.thumbs.get(frame.id) ? <img src={p.thumbs.get(frame.id)} alt={t("frameAlt", { index: frame.checkpoint + 1 })} className="aspect-[4/3] w-full object-cover" /> : <div className="aspect-[4/3] w-full bg-white/5" />}
                <div className="p-2">
                  <p className="font-mono text-[10px] text-text-muted">#{frame.checkpoint + 1} · {frame.findings?.filter((f) => f.severity === "retake").map((f) => (t.has(`findings.${f.code}`) ? t(`findings.${f.code}`) : f.code)).join(", ")}</p>
                  <button type="button" onClick={() => p.onRetake(frame.id, frame.checkpoint)} className="button-mini mt-2 w-full justify-center">{t("retake")}</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-auto pt-6">
        <button type="button" onClick={p.onAddMore} className="button-secondary w-full justify-center">{t("addMore")}</button>
        {!blocking ? (
          <button type="button" onClick={p.onConfirm} className="button-primary mt-3 w-full justify-center">{retakeRecommended ? t("confirmAnyway") : t("confirm")}</button>
        ) : null}
        {retakeRecommended && !blocking ? <p className="mt-2 text-center text-xs text-text-faint">{t("overrideNote")}</p> : null}
        <button type="button" onClick={p.onDiscardRoom} className="mt-3 w-full text-center font-mono text-[11px] text-text-muted underline">{t("discardRoom")}</button>
      </div>
    </section>
  );
}
