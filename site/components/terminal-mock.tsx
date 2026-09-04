"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/motion";
import { SodarMark } from "@/components/logo";

const PROPERTIES: [string, string, string, string][] = [
  ["84 Kesklinn Ave", "Published", "412", "CRM · #48213"],
  ["12 Harbour Res.", "Published", "289", "CRM · #48190"],
  ["7 Nõmme Villa", "Processing", "—", "4 / 6 rooms"],
  ["3 Old Town Loft", "Preview", "—", "2 rooms free"],
  ["19 Pirita Rd", "Capturing", "—", "on phone"],
];

const ROOMS: [string, number][] = [
  ["Living room", 92],
  ["Kitchen", 78],
  ["Primary bedroom", 61],
  ["Bathroom", 34],
  ["Balcony", 21],
];

/**
 * Broker workspace mock — properties, processing / publication status, and
 * the engagement Sodar supports today (how many visitors opened the viewer).
 * Static data, no auth.
 */
export function TerminalMock({ variant = "crop" }: { variant?: "crop" | "full" }) {
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
          <span className="mono-label">Workspace</span>
        </div>
        <span className="eyebrow">
          <span />
          Live preview
        </span>
      </div>

      <div className={`grid gap-px bg-border ${variant === "full" ? "lg:grid-cols-[1.4fr_1fr]" : "lg:grid-cols-[1.3fr_1fr]"}`}>
        <div className="bg-bg-raised p-6">
          <p className="mono-label">Properties</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead>
                <tr className="text-xs text-text-muted">
                  <th className="pb-2 font-normal">Property</th>
                  <th className="pb-2 font-normal">Status</th>
                  <th className="pb-2 font-normal">Viewer opened</th>
                  <th className="pb-2 font-normal">Publication</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[12.5px]">
                {PROPERTIES.map(([name, status, views, pub]) => (
                  <tr key={name} className="border-t border-border">
                    <td className="py-2.5 pr-2 font-sans text-text">{name}</td>
                    <td className="py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${status === "Published" ? "bg-white/[.1] text-text" : "border border-border text-text-muted"}`}>
                        {status}
                      </span>
                    </td>
                    <td className="num py-2.5 text-text-muted">{views}</td>
                    <td className="py-2.5 text-text-muted">{pub}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {variant === "full" ? (
            <div className="mt-8" ref={heatRef}>
              <p className="mono-label">Room engagement · 84 Kesklinn Ave</p>
              <div className="mt-4 space-y-2.5">
                {ROOMS.map(([room, pct]) => (
                  <div key={room} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-xs text-text-muted">{room}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[.06]">
                      <div data-heat-bar className="h-full rounded-full bg-text" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="num w-9 shrink-0 text-right font-mono text-xs text-text-muted">{pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="bg-bg-raised p-6">
          <p className="mono-label">Processing</p>
          <ul className="mt-4 space-y-3">
            {[
              ["7 Nõmme Villa", "Stitching · bedroom", "4 / 6"],
              ["3 Old Town Loft", "Preview ready", "2 / 2"],
              ["19 Pirita Rd", "Capturing on phone", "—"],
            ].map(([name, step, n]) => (
              <li key={name} className="rounded-xl border border-border p-3.5">
                <p className="text-sm text-text">{name}</p>
                <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-text-muted">
                  <span>{step}</span>
                  <span className="text-text">{n}</span>
                </div>
              </li>
            ))}
          </ul>
          {variant === "full" ? (
            <div className="mt-6 rounded-xl border border-border-strong bg-bg p-4">
              <p className="mono-label">This week</p>
              <p className="display mt-1 text-3xl text-text">701 viewer opens</p>
              <p className="mt-1 text-xs text-text-muted">across 2 published walkthroughs</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
