"use client";

import { useTranslations } from "next-intl";
import type { ScanSession } from "@/lib/scanner/db";

/** Found an unfinished scan on this phone: continue it, or start over (kept recoverable for a while). */
export function ResumeDialog({ session, frames, onContinue, onStartOver }: { session: ScanSession; frames: number; onContinue: () => void; onStartOver: () => void }) {
  const t = useTranslations("Scanner.resume");
  const rooms = session.rooms.length;
  const when = new Date(session.updatedAt);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="resume-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-bg-raised p-5 text-text shadow-2xl">
        <h2 id="resume-title" className="display text-2xl">{t("title")}</h2>
        <p className="mt-2 text-sm text-text-muted">{t("body", { rooms, frames })}</p>
        <p className="mt-1 font-mono text-[11px] text-text-faint" dir="ltr">{when.toLocaleString()}</p>
        <div className="mt-5 flex flex-col gap-2">
          <button type="button" onClick={onContinue} className="button-primary w-full justify-center">{t("continue")}</button>
          <button type="button" onClick={onStartOver} className="button-secondary w-full justify-center">{t("startOver")}</button>
        </div>
        <p className="mt-3 text-center text-xs text-text-faint">{t("startOverNote")}</p>
      </div>
    </div>
  );
}
