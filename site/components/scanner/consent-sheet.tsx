"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { ProviderId, ReconstructionEstimate } from "@/lib/scanner/contracts";

/**
 * Explicit confirmation before any paid reconstruction: which providers run,
 * what they produce, expected credit use, the generative disclosure for
 * Marble, and the daily limit. Nothing is submitted until the person taps
 * Start; refreshing afterwards reconnects to the same job.
 */
export function ConsentSheet({ estimate, loading, error, onStart, onClose }: { estimate: ReconstructionEstimate | null; loading: boolean; error: string | null; onStart: (providers: ProviderId[], options: { wantMesh: boolean }) => void; onClose: () => void }) {
  const t = useTranslations("Scanner.consent");
  const [selected, setSelected] = useState<Record<ProviderId, boolean>>({ kiri: true, marble: true });
  const [wantMesh, setWantMesh] = useState(false);
  const [agree, setAgree] = useState(false);
  useEffect(() => {
    if (!estimate) return;
    setSelected({ kiri: estimate.providers.some((p) => p.provider === "kiri" && p.available), marble: estimate.providers.some((p) => p.provider === "marble" && p.available) });
  }, [estimate]);
  const available = estimate?.providers.filter((p) => p.available) ?? [];
  const chosen = (Object.keys(selected) as ProviderId[]).filter((id) => selected[id] && available.some((p) => p.provider === id));
  const limitReached = estimate ? estimate.limits.usedToday >= estimate.limits.dailyJobsPerUser : false;
  const marbleCredits = estimate?.providers.find((p) => p.provider === "marble")?.estimatedCredits ?? null;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="consent-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
      <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/15 bg-bg-raised p-5 text-text shadow-2xl">
        <h2 id="consent-title" className="display text-2xl">{t("title")}</h2>
        <p className="mt-2 text-sm text-text-muted">{t("body")}</p>
        {loading ? <p className="mt-4 font-mono text-[11px] text-text-muted">{t("checking")}</p> : null}
        {error ? <p role="alert" className="mt-4 rounded-xl border border-border-strong p-3 text-sm">{error}</p> : null}
        {estimate ? (
          <div className="mt-4 space-y-3">
            <p className="font-mono text-[11px] text-text-faint" dir="ltr">{t("photos", { count: estimate.room.frameCount })}</p>
            {estimate.providers.map((p) => (
              <label key={p.provider} className={`block rounded-xl border p-3 ${p.available ? "border-white/20" : "border-white/10 opacity-60"}`}>
                <span className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1 h-5 w-5" disabled={!p.available} checked={Boolean(selected[p.provider]) && p.available} onChange={(e) => setSelected({ ...selected, [p.provider]: e.target.checked })} />
                  <span className="flex-1">
                    <span className="block text-sm font-medium">{t(`${p.provider}.name`)}</span>
                    <span className="mt-0.5 block text-xs text-text-muted">{t(`${p.provider}.outputs`)}</span>
                    <span className="mt-1 block text-xs text-text-muted">{p.disclosure === "generative_completion" ? t("generativeDisclosure") : t("faithfulDisclosure")}</span>
                    {!p.available ? <span className="mt-1 block font-mono text-[11px] text-text-faint">{t.has(`unavailable.${p.reason ?? "disabled"}`) ? t(`unavailable.${p.reason ?? "disabled"}`) : t("unavailable.disabled")}</span> : p.estimatedCredits !== null ? <span className="mt-1 block font-mono text-[11px] text-text-faint" dir="ltr">{t("credits", { count: p.estimatedCredits })}</span> : <span className="mt-1 block font-mono text-[11px] text-text-faint">{t("creditsUnknown")}</span>}
                  </span>
                </span>
              </label>
            ))}
            {available.some((p) => p.provider === "kiri") ? (
              <label className="flex items-center gap-3 text-sm">
                <input type="checkbox" className="h-5 w-5" checked={wantMesh} onChange={(e) => setWantMesh(e.target.checked)} />
                {t("meshOption")}
              </label>
            ) : null}
            <p className="font-mono text-[11px] text-text-faint" dir="ltr">{t("dailyLimit", { used: estimate.limits.usedToday, limit: estimate.limits.dailyJobsPerUser })}</p>
            {marbleCredits !== null && selected.marble ? <p className="text-xs text-text-muted">{t("marbleNote")}</p> : null}
            <p className="text-xs text-text-muted">{t("retention")}</p>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 h-5 w-5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              {t("agree")}
            </label>
          </div>
        ) : null}
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="button-secondary flex-1 justify-center">{t("notNow")}</button>
          <button type="button" disabled={!agree || !chosen.length || limitReached || loading} onClick={() => onStart(chosen, { wantMesh })} className="button-primary flex-1 justify-center">{t("start")}</button>
        </div>
        {limitReached ? <p className="mt-3 text-center text-xs text-text-muted">{t("limitReached")}</p> : null}
      </div>
    </div>
  );
}
