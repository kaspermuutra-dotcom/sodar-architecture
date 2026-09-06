"use client";

import { useEffect, useRef } from "react";
import type { Room } from "@/lib/scanner/db";

/**
 * Photo Sphere Viewer preview of the rooms stitched so far. One room shows a
 * plain viewer; two or more become a virtual tour with hotspots between them.
 * Panorama URLs are object URLs of the on-device panoramas (or signed preview
 * URLs once the backend has stitched originals).
 */
export function RoomPreview({ rooms, open, onClose, label }: { rooms: Room[]; open: boolean; onClose: () => void; label: string }) {
  const root = useRef<HTMLDivElement>(null);
  const ready = rooms.filter((room) => room.panoramaUrl);
  const key = ready.map((room) => `${room.id}:${room.panoramaUrl}`).join("|");

  useEffect(() => {
    if (!open || !root.current || ready.length < 1) return;
    let viewer: { destroy(): void } | undefined;
    let cancelled = false;
    void Promise.all([import("@photo-sphere-viewer/core"), import("@photo-sphere-viewer/virtual-tour-plugin")]).then(([core, tour]) => {
      if (cancelled || !root.current) return;
      const plugins: unknown[] = [];
      if (ready.length >= 2) {
        plugins.push([
          tour.VirtualTourPlugin,
          {
            dataMode: "manual",
            positionMode: "manual",
            nodes: ready.map((room, index) => ({
              id: room.id,
              panorama: room.panoramaUrl!,
              name: room.name,
              links: [{ nodeId: ready[(index + 1) % ready.length].id, position: { yaw: "90deg", pitch: "-6deg" } }],
            })),
          },
        ]);
      }
      viewer = new core.Viewer({
        container: root.current,
        panorama: ready[0].panoramaUrl!,
        navbar: ["zoom", "move", "fullscreen"],
        defaultZoomLvl: 20,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plugins: plugins as any,
      });
    });
    return () => {
      cancelled = true;
      viewer?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  if (!open || ready.length < 1) return null;
  return (
    <section className="fixed inset-0 z-40 bg-black">
      <div ref={root} className="h-full w-full" />
      <p className="pointer-events-none absolute left-4 top-4 z-10 rounded-full bg-black/70 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-[#f4f2ee]">{label}</p>
      <button type="button" onClick={onClose} className="absolute right-4 top-4 z-10 rounded-full border border-white/25 bg-black/60 px-3 py-1.5 font-mono text-[11px] text-[#f4f2ee] backdrop-blur">
        ✕
      </button>
    </section>
  );
}
