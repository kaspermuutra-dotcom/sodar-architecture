"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { CaptureMode } from "@/lib/scanner/plan";

/** Four short cards, about twenty seconds in total, tailored to the chosen mode. Skippable. */
export function Tutorial({ mode, onDone }: { mode: CaptureMode; onDone: () => void }) {
  const t = useTranslations("Scanner.tutorial");
  const steps = (t.raw(mode) as Array<{ title: string; body: string }>) ?? [];
  const [index, setIndex] = useState(0);
  const [reduced, setReduced] = useState(false);
  useEffect(() => setReduced(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false), []);
  useEffect(() => {
    if (reduced) return;
    const id = window.setTimeout(() => setIndex((i) => Math.min(steps.length - 1, i + 1)), 5_000);
    return () => window.clearTimeout(id);
  }, [index, steps.length, reduced]);
  const step = steps[index];
  if (!step) return null;
  return (
    <section aria-live="polite" className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col justify-end px-6 pb-10 pt-24">
      <p className="eyebrow"><span /> {t("eyebrow")}</p>
      <p className="mt-6 font-mono text-[11px] text-text-faint" dir="ltr">{index + 1} / {steps.length}</p>
      <h2 className="display mt-2 text-[clamp(2rem,8vw,3rem)]">{step.title}</h2>
      <p className="mt-4 text-text-muted">{step.body}</p>
      <div className="mt-6 flex gap-1" aria-hidden>
        {steps.map((_, i) => <span key={i} className={`h-1 flex-1 rounded-full ${i <= index ? "bg-text" : "bg-white/15"}`} />)}
      </div>
      <div className="mt-6 flex gap-2">
        {index > 0 ? <button type="button" onClick={() => setIndex(index - 1)} className="button-secondary">{t("back")}</button> : null}
        {index < steps.length - 1 ? (
          <button type="button" onClick={() => setIndex(index + 1)} className="button-primary flex-1 justify-center">{t("next")}</button>
        ) : (
          <button type="button" onClick={onDone} className="button-primary flex-1 justify-center">{t("start")}</button>
        )}
      </div>
      <button type="button" onClick={onDone} className="mt-3 w-full text-center font-mono text-[11px] text-text-muted underline">{t("skip")}</button>
    </section>
  );
}
