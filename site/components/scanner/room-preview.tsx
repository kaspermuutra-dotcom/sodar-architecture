"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toPsvNodes, type TourManifest } from "@/lib/scanner/tour";

export type PreviewRoom = { id: string; name: string; panorama: string; panoramaAi?: string | null };

/**
 * Photo Sphere Viewer walkthrough. Single room → plain viewer; several rooms →
 * virtual tour using the manifest's links (confirmed and provisional). A
 * toggle switches between the captured panorama and the AI-completed version
 * where one exists, always with the disclosure visible.
 */
export function RoomPreview({ tour, rooms, open, onClose, label, initialNodeId }: { tour: TourManifest | null; rooms: PreviewRoom[]; open: boolean; onClose: () => void; label: string; initialNodeId?: string }) {
  const t = useTranslations("Scanner.preview");
  const root = useRef<HTMLDivElement>(null);
  const [showAi, setShowAi] = useState(false);
  const [current, setCurrent] = useState<string | undefined>(initialNodeId);
  const ready = rooms.filter((room) => room.panorama);
  const hasAi = ready.some((room) => room.panoramaAi);
  const key = ready.map((room) => `${room.id}:${showAi ? room.panoramaAi ?? room.panorama : room.panorama}`).join("|") + (tour?.links.length ?? 0);

  useEffect(() => {
    if (!open || !root.current || ready.length < 1) return;
    let viewer: { destroy(): void; getPlugin?(plugin: unknown): unknown } | undefined;
    let cancelled = false;
    const pick = (room: PreviewRoom) => (showAi && room.panoramaAi ? room.panoramaAi : room.panorama);
    void Promise.all([import("@photo-sphere-viewer/core"), import("@photo-sphere-viewer/virtual-tour-plugin")]).then(([core, tourPlugin]) => {
      if (cancelled || !root.current) return;
      const plugins: unknown[] = [];
      const start = ready.find((room) => room.id === (current ?? initialNodeId)) ?? ready[0];
      if (ready.length >= 2) {
        const nodes = tour
          ? toPsvNodes(tour).filter((node) => ready.some((room) => room.id === node.id)).map((node) => ({ ...node, panorama: pick(ready.find((room) => room.id === node.id)!), links: node.links.filter((link) => ready.some((room) => room.id === link.nodeId)) }))
          : ready.map((room, index) => ({ id: room.id, panorama: pick(room), name: room.name, links: [{ nodeId: ready[(index + 1) % ready.length].id, position: { yaw: "90deg", pitch: "-6deg" } }] }));
        plugins.push([tourPlugin.VirtualTourPlugin, { dataMode: "manual", positionMode: "manual", nodes, startNodeId: start.id, transitionOptions: { showLoader: true, speed: "20rpm", effect: "fade", rotation: true } }]);
      }
      viewer = new core.Viewer({
        container: root.current,
        panorama: ready.length >= 2 ? undefined : pick(start),
        navbar: ["zoom", "move", "fullscreen"],
        defaultZoomLvl: 20,
        loadingTxt: t("loading"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plugins: plugins as any,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plugin = (viewer as any).getPlugin?.(tourPlugin.VirtualTourPlugin) as { addEventListener?: (name: string, cb: (e: { node: { id: string } }) => void) => void } | undefined;
      plugin?.addEventListener?.("node-changed", (e) => setCurrent(e.node.id));
    });
    return () => {
      cancelled = true;
      viewer?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  if (!open || ready.length < 1) return null;
  const currentRoom = ready.find((room) => room.id === current) ?? ready[0];
  const provisional = tour?.links.some((link) => link.from === currentRoom.id && !link.confirmed);
  return (
    <section role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-40 bg-black">
      <div ref={root} className="h-full w-full" />
      <p className="pointer-events-none absolute left-4 top-4 z-10 rounded-full bg-black/70 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-[#f4f2ee]">{label} · {currentRoom.name}</p>
      <button type="button" onClick={onClose} aria-label={t("close")} className="absolute right-4 top-4 z-10 rounded-full border border-white/25 bg-black/60 px-3 py-1.5 font-mono text-[11px] text-[#f4f2ee] backdrop-blur">✕</button>
      <div className="pointer-events-none absolute inset-x-4 bottom-14 z-10 flex flex-col items-center gap-2">
        {hasAi ? (
          <div className="pointer-events-auto flex rounded-full border border-white/25 bg-black/70 p-1 font-mono text-[11px] text-[#f4f2ee] backdrop-blur" role="group" aria-label={t("versionGroup")}>
            <button type="button" onClick={() => setShowAi(false)} aria-pressed={!showAi} className={`rounded-full px-3 py-1.5 ${!showAi ? "bg-[#f4f2ee] text-black" : ""}`}>{t("captured")}</button>
            <button type="button" onClick={() => setShowAi(true)} aria-pressed={showAi} className={`rounded-full px-3 py-1.5 ${showAi ? "bg-[#f4f2ee] text-black" : ""}`}>{t("aiCompleted")}</button>
          </div>
        ) : null}
        {showAi && currentRoom.panoramaAi ? <p className="rounded-xl bg-black/70 px-3 py-2 text-center text-xs text-white/85">{t("aiDisclosure")}</p> : <p className="rounded-xl bg-black/70 px-3 py-2 text-center text-xs text-white/70">{t("capturedDisclosure")}</p>}
        {provisional ? <p className="rounded-xl bg-black/70 px-3 py-2 text-center text-xs text-white/70">{t("provisionalLinks")}</p> : null}
      </div>
    </section>
  );
}
