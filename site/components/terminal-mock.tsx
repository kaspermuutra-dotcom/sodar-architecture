"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/motion";
import { SodarMark } from "@/components/logo";

const ROOM_PCT = [92, 78, 61, 34, 21];

type Row = { name: string; status: "published" | "processing" | "preview" | "capturing"; views: string; pub: string };

/**
 * Broker workspace mock — properties, processing / publication status, and
 * the engagement Sodar supports today (how many visitors opened the viewer).
 * Static data, no auth.
 */
export function TerminalMock({ variant = "crop" }: { variant?: "crop" | "full" }) {
  const t = useTranslations("Workspace.mock");
  const cols = t.raw("cols") as string[];
  const rows = t.raw("rows") as Row[];
  const rooms = t.raw("rooms") as string[];
  const jobs = t.raw("jobs") as { name: string; step: string; n: string }[];
  const heatRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const bars = heatRef.current?.querySelectorAll("[data-heat-bar]");
      if (!bars?.length) return;
      gsap.set(bars, { scaleX: 0, transformOrigin: "left center" });
      gsap.to(bars, { scaleX: 1, duration: 1, ease: "power2.out", stagger: 0.08, scrollTrigger: { trigger: heatRef.current, start: "top 80%", once: true } });
    },
    { scope: heatRef },
  );

  return (
    <div className="overflow-hidden rounded-[1.75rem] border border-border-strong bg-bg-raised">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <SodarMark size={18} className="text-text" />
          <span className="mono-label">{t("title")}</span>
        </div>
        <span className="eyebrow">
          <span />
          {t("live")}
        </span>
      </div>

      <div className={`grid gap-px bg-border ${variant === "full" ? "lg:grid-cols-[1.4fr_1fr]" : "lg:grid-cols-[1.3fr_1fr]"}`}>
        <div className="bg-bg-raised p-6">
          <p className="mono-label">{t("properties")}</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[420px] text-start text-sm">
              <thead>
                <tr className="text-xs text-text-muted">
                  {cols.map((c) => (
                    <th key={c} className="pb-2 text-start font-normal">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono text-[12.5px]">
                {rows.map((r) => (
                  <tr key={r.name} className="border-t border-border">
                    <td className="py-2.5 pe-2 font-sans text-text">{r.name}</td>
                    <td className="py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${r.status === "published" ? "bg-white/[.1] text-text" : "border border-border text-text-muted"}`}>
                        {t(`statuses.${r.status}`)}
                      </span>
                    </td>
                    <td className="num py-2.5 text-text-muted">{r.views}</td>
                    <td className="py-2.5 text-text-muted">{r.pub}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {variant === "full" ? (
            <div className="mt-8" ref={heatRef}>
              <p className="mono-label">{t("engagement")}</p>
              <div className="mt-4 space-y-2.5">
                {rooms.map((room, i) => (
                  <div key={room} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-xs text-text-muted">{room}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[.06]">
                      <div data-heat-bar className="h-full rounded-full bg-text" style={{ width: `${ROOM_PCT[i]}%` }} />
                    </div>
                    <span className="num w-9 shrink-0 text-end font-mono text-xs text-text-muted">{ROOM_PCT[i]}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="bg-bg-raised p-6">
          <p className="mono-label">{t("processing")}</p>
          <ul className="mt-4 space-y-3">
            {jobs.map((j) => (
              <li key={j.name} className="rounded-xl border border-border p-3.5">
                <p className="text-sm text-text">{j.name}</p>
                <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-text-muted">
                  <span>{j.step}</span>
                  <span className="text-text">{j.n}</span>
                </div>
              </li>
            ))}
          </ul>
          {variant === "full" ? (
            <div className="mt-6 rounded-xl border border-border-strong bg-bg p-4">
              <p className="mono-label">{t("week")}</p>
              <p className="display mt-1 text-3xl text-text">{t("weekTitle")}</p>
              <p className="mt-1 text-xs text-text-muted">{t("weekSub")}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
