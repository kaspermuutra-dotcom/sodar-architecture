"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { PreviewRoom } from "./room-preview";
import type { TourLinkRecord } from "@/lib/scanner/contracts";

/**
 * Doorway confirmation. The person opens a room, taps the doorway in the
 * panorama, picks which room it leads to, and confirms. Confirmed links are
 * kept apart from provisional suggestions and the reverse direction is
 * proposed (180° across) but stays provisional until confirmed from the other
 * room.
 */
export function TourEditor({ rooms, links, onSave, onClose }: { rooms: PreviewRoom[]; links: TourLinkRecord[]; onSave: (links: TourLinkRecord[]) => Promise<void>; onClose: () => void }) {
  const t = useTranslations("Scanner.tourEditor");
  const root = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<{ destroy(): void; setPanorama(p: string): Promise<unknown>; addEventListener(name: string, cb: (e: { data: { yaw: number; pitch: number } }) => void): void } | undefined>(undefined);
  const [roomId, setRoomId] = useState(rooms[0]?.id);
  const [pending, setPending] = useState<{ yaw: number; pitch: number } | null>(null);
  const [target, setTarget] = useState<string>("");
  const [draft, setDraft] = useState<TourLinkRecord[]>(links.filter((link) => link.confirmed));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const room = rooms.find((r) => r.id === roomId);

  useEffect(() => {
    if (!root.current || !room) return;
    let cancelled = false;
    void import("@photo-sphere-viewer/core").then((core) => {
      if (cancelled || !root.current) return;
      const viewer = new core.Viewer({ container: root.current, panorama: room.panorama, navbar: ["zoom", "move"], defaultZoomLvl: 10 });
      viewer.addEventListener("click", (event) => {
        const data = (event as unknown as { data: { yaw: number; pitch: number } }).data;
        setPending({ yaw: ((data.yaw * 180) / Math.PI + 360) % 360, pitch: (data.pitch * 180) / Math.PI });
      });
      viewerRef.current = viewer as unknown as typeof viewerRef.current;
    });
    return () => {
      cancelled = true;
      viewerRef.current?.destroy();
      viewerRef.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, room?.panorama]);

  const others = rooms.filter((r) => r.id !== roomId);
  useEffect(() => setTarget(others[0]?.id ?? ""), [roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = () => {
    if (!room || !pending || !target) return;
    const next = draft.filter((link) => !(link.fromRoomId === room.id && link.toRoomId === target));
    next.push({ fromRoomId: room.id, toRoomId: target, yaw: pending.yaw, pitch: pending.pitch, confirmed: true, label: rooms.find((r) => r.id === target)?.name, reverseYaw: (pending.yaw + 180) % 360 });
    setDraft(next);
    setPending(null);
    setMessage(t("linkAdded"));
  };
  const remove = (link: TourLinkRecord) => setDraft(draft.filter((l) => l !== link));
  const save = async () => {
    setBusy(true);
    try {
      await onSave(draft);
      setMessage(t("saved"));
    } catch {
      setMessage(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section role="dialog" aria-modal="true" aria-label={t("title")} className="fixed inset-0 z-40 flex flex-col bg-black text-[#f4f2ee]">
      <div ref={root} className="min-h-0 flex-1" />
      <div className="max-h-[45dvh] overflow-y-auto border-t border-white/15 bg-black/90 p-4 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <label className="field flex-1">
            {t("roomLabel")}
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="field-input mt-1 w-full">
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={onClose} aria-label={t("close")} className="rounded-full border border-white/25 px-3 py-1.5 font-mono text-[11px]">✕</button>
        </div>
        <p className="mt-3 text-sm text-white/75">{pending ? t("pickTarget") : t("tapDoorway")}</p>
        {pending ? (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="field flex-1">
              {t("leadsTo")}
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="field-input mt-1 w-full">
                {others.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <button type="button" onClick={confirm} disabled={!target} className="button-primary">{t("confirm")}</button>
            <button type="button" onClick={() => setPending(null)} className="button-secondary">{t("cancel")}</button>
          </div>
        ) : null}
        <ul className="mt-3 space-y-1 text-xs">
          {draft.filter((link) => link.fromRoomId === roomId).map((link) => (
            <li key={`${link.fromRoomId}-${link.toRoomId}`} className="flex items-center justify-between gap-2 rounded-lg border border-white/15 px-3 py-2">
              <span>→ {rooms.find((r) => r.id === link.toRoomId)?.name} · <span className="font-mono text-white/60" dir="ltr">{Math.round(link.yaw)}°</span> · {t("confirmedTag")}</span>
              <button type="button" onClick={() => remove(link)} className="font-mono text-[11px] underline">{t("remove")}</button>
            </li>
          ))}
          {!draft.some((link) => link.fromRoomId === roomId) ? <li className="text-white/50">{t("noLinks")}</li> : null}
        </ul>
        {message ? <p role="status" className="mt-2 font-mono text-[11px] text-white/60">{message}</p> : null}
        <button type="button" onClick={save} disabled={busy} className="button-primary mt-3 w-full justify-center">{busy ? t("saving") : t("save")}</button>
      </div>
    </section>
  );
}
