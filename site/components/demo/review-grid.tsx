"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { WalkScene } from "@/lib/demo/walkthrough";

type ReviewScene = {
  level: string;
  views: Array<{ yaw: number; ref: string; cur: string }>;
  crops: Array<{ name: string; ref: string; cur: string }>;
  status: "needs-review" | "pass" | "rejected" | string;
  note: string;
};
type Review = { media: string; scenes: Record<string, ReviewScene> };

const STATUS: Record<string, { label: string; cls: string }> = {
  pass: { label: "Pass", cls: "bg-emerald-600 text-white" },
  "needs-review": { label: "Needs review", cls: "bg-amber-500 text-black" },
  rejected: { label: "Rejected", cls: "bg-red-600 text-white" },
};

/** All checkpoints as a grid: reference preview vs current master, six direction buttons, floor/ceiling/doorway crops. */
export function ReviewGrid({ scenes, review, base }: { scenes: WalkScene[]; review: Review; base: string }) {
  const t = useTranslations("PropertyDemo");
  const [yawIndex, setYawIndex] = useState(0);
  const [showCrops, setShowCrops] = useState(false);
  const counts = Object.values(review.scenes).reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {});
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-mono uppercase tracking-[.14em] text-text-faint">Direction</span>
        <div role="group" aria-label="Direction" className="flex rounded-full border border-border p-1 font-mono text-[10px] uppercase tracking-[.14em]">
          {[0, 60, 120, 180, 240, 300].map((yaw, i) => (
            <button key={yaw} type="button" onClick={() => setYawIndex(i)} aria-pressed={i === yawIndex} className={`rounded-full px-3 py-1.5 ${i === yawIndex ? "bg-text text-bg" : "text-text-muted hover:text-text"}`}>
              {yaw}°
            </button>
          ))}
        </div>
        <button type="button" className="button-mini" onClick={() => setShowCrops((v) => !v)} aria-pressed={showCrops}>
          {showCrops ? "Hide crops" : "Show floor / ceiling / doorway crops"}
        </button>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[.14em] text-text-faint">
          {Object.entries(counts).map(([k, v]) => `${STATUS[k]?.label ?? k}: ${v}`).join(" · ")}
        </span>
      </div>
      <ol className="mt-6 grid gap-8">
        {scenes.map((scene) => {
          const r = review.scenes[scene.id];
          if (!r) return null;
          const v = r.views[yawIndex];
          const label = scene.variant ? `${t(`scenes.${scene.labelKey}`)} ${scene.variant}` : t(`scenes.${scene.labelKey}`);
          const st = STATUS[r.status] ?? { label: r.status, cls: "bg-border text-text" };
          return (
            <li key={scene.id} id={scene.id} className="border-t border-border pt-5">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 className="text-lg text-text">{label}</h2>
                <span className="font-mono text-[10px] uppercase tracking-[.14em] text-text-faint">
                  {scene.id} · {t(`zone.${scene.floor}`)}
                </span>
                <span className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[.14em] ${st.cls}`}>{st.label}</span>
                {r.note ? <span className="text-xs text-text-muted">{r.note}</span> : null}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <figure>
                  <img src={`${base}/${v.ref}`} alt="" width={720} height={450} loading="lazy" decoding="async" className="w-full" />
                  <figcaption className="mt-1 font-mono text-[10px] uppercase tracking-[.14em] text-text-faint">Reference preview · yaw {v.yaw}° · pitch −8° · 72°</figcaption>
                </figure>
                <figure>
                  <img src={`${base}/${v.cur}`} alt="" width={720} height={450} loading="lazy" decoding="async" className="w-full" />
                  <figcaption className="mt-1 font-mono text-[10px] uppercase tracking-[.14em] text-text-faint">Current master · same view</figcaption>
                </figure>
              </div>
              {showCrops ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {r.crops.map((c) => (
                    <figure key={c.name} className="grid gap-1">
                      <img src={`${base}/${c.ref}`} alt="" width={720} height={450} loading="lazy" decoding="async" className="w-full" />
                      <img src={`${base}/${c.cur}`} alt="" width={720} height={450} loading="lazy" decoding="async" className="w-full" />
                      <figcaption className="font-mono text-[10px] uppercase tracking-[.14em] text-text-faint">{c.name}: reference (top) · current (bottom)</figcaption>
                    </figure>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
