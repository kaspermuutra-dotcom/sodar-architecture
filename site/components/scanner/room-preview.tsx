"use client";

import { useEffect, useRef } from "react";
import type { Room } from "@/lib/scanner/db";

export function RoomPreview({ rooms }: { rooms: Room[] }) {
  const root = useRef<HTMLDivElement>(null);
  const ready = rooms.filter((room) => room.status === "complete" && room.panoramaUrl).slice(0, 2);
  useEffect(() => {
    if (!root.current || ready.length < 2) return;
    let viewer: { destroy(): void } | undefined;
    void Promise.all([import("@photo-sphere-viewer/core"), import("@photo-sphere-viewer/virtual-tour-plugin")]).then(([core, tour]) => {
      if (!root.current) return;
      viewer = new core.Viewer({
        container: root.current,
        panorama: ready[0].panoramaUrl!,
        navbar: ["zoom", "move", "fullscreen"],
        plugins: [[tour.VirtualTourPlugin, { dataMode: "manual", positionMode: "manual", nodes: ready.map((room, index) => ({ id: room.id, panorama: room.panoramaUrl!, name: room.name, links: [{ nodeId: ready[index ? 0 : 1].id, position: { yaw: index ? "180deg" : "0deg", pitch: "0deg" } }] })) }]],
      });
    });
    return () => viewer?.destroy();
  }, [ready.map((room) => `${room.id}:${room.panoramaUrl}`).join("|")]);
  if (ready.length < 2) return null;
  return <section className="absolute inset-0 z-40 bg-black"><div ref={root} className="h-full w-full" /><p className="pointer-events-none absolute left-4 top-4 z-10 rounded-full bg-black/70 px-3 py-2 font-mono text-[10px] uppercase tracking-widest">Connected room preview</p></section>;
}
