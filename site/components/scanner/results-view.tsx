"use client";

import { useTranslations } from "next-intl";
import type { Room, ScanSession } from "@/lib/scanner/db";
import type { PublicArtifact, RoomView } from "@/lib/scanner/contracts";
import { customerStage, type JobStatus } from "@/lib/reconstruction/contract";

export type ResultsProps = {
  session: ScanSession;
  views: Record<string, RoomView | undefined>;
  savedRemotely: boolean;
  signedIn: boolean;
  onOpenPreview: (roomId?: string) => void;
  onOpenSplat: (artifact: PublicArtifact, room: Room) => void;
  onStartProcessing: (room: Room) => void;
  onAddRoom: () => void;
  onExport: () => void;
  onEditTour: () => void;
  onDelete: () => void;
  onRestart: () => void;
  onSignIn: () => void;
  onSaveNow: () => void;
  onCompletePanorama: (room: Room) => void;
  aiFillAvailable: boolean;
  busy: string | null;
  message: string | null;
};

const STAGE_KEY: Record<ReturnType<typeof customerStage>, string> = { preparing: "stagePreparing", saving: "stageSaving", building: "stageBuilding", ready: "stageReady", attention: "stageAttention", stopped: "stageStopped" };

/** "Your room is ready": per-room status, panorama versions, 3D outputs, downloads, tour, deletion. */
export function ResultsView(p: ResultsProps) {
  const t = useTranslations("Scanner.results");
  const rooms = p.session.rooms.filter((room) => room.captured > 0);
  const anyPanorama = rooms.some((room) => room.panoramaUrl);
  return (
    <section className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-20 text-text">
      <p className="eyebrow"><span /> {t("eyebrow")}</p>
      <h2 className="display mt-3 text-[clamp(1.9rem,7vw,2.8rem)]">{t("title", { count: rooms.length })}</h2>
      <p className="mt-2 text-sm text-text-muted">{p.savedRemotely ? t("savedRemote") : p.signedIn ? t("notSavedYet") : t("savedLocalOnly")}</p>
      {p.message ? <p role="status" className="mt-3 rounded-xl border border-white/15 p-3 text-sm">{p.message}</p> : null}

      <ul className="mt-5 space-y-3">
        {rooms.map((room) => {
          const view = p.views[room.id];
          const status = (view?.status ?? "none") as JobStatus | "none";
          const splats = (view?.artifacts ?? []).filter((a) => (a.type === "kiri_gaussian_splat" || a.type === "marble_gaussian_splat") && /\.(ply|splat)$/i.test(a.name) && a.url);
          const downloads = (view?.artifacts ?? []).filter((a) => a.url);
          const failed = view?.jobs.filter((job) => job.status === "failed" || job.status === "expired") ?? [];
          return (
            <li key={room.id} className="rounded-2xl border border-white/15 bg-black/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-medium">{room.name}</p>
                  <p className="font-mono text-[11px] text-text-muted" dir="ltr">{t("frameCount", { count: room.captured })} · {room.mode === "full3d" ? t("modeFull") : t("modeQuick")}</p>
                </div>
                {room.panoramaUrl ? <img src={room.panoramaUrl} alt="" className="h-12 w-24 rounded-lg object-cover" /> : null}
              </div>

              <div className="mt-3 rounded-xl border border-white/10 p-3">
                <p className="font-mono text-[10px] uppercase tracking-[.14em] text-text-muted">{t("panoramaTitle")}</p>
                <p className="mt-1 text-sm">{room.panoramaUrl ? (room.panoramaAiUrl ? t("panoramaBoth") : t("panoramaCaptured")) : t("panoramaPending")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {room.panoramaUrl ? <button type="button" onClick={() => p.onOpenPreview(room.id)} className="button-mini">{t("openPanorama")}</button> : null}
                  {room.panoramaUrl && !room.panoramaAiUrl && p.aiFillAvailable ? <button type="button" disabled={p.busy === room.id} onClick={() => p.onCompletePanorama(room)} className="button-mini">{p.busy === room.id ? t("completing") : t("completeCeilingFloor")}</button> : null}
                </div>
                {room.panoramaAiUrl ? <p className="mt-2 text-xs text-text-faint">{t("aiNote")}</p> : null}
              </div>

              <div className="mt-3 rounded-xl border border-white/10 p-3">
                <p className="font-mono text-[10px] uppercase tracking-[.14em] text-text-muted">{t("threeDTitle")}</p>
                {status === "none" ? (
                  <>
                    <p className="mt-1 text-sm text-text-muted">{room.mode === "full3d" ? t("threeDNotStarted") : t("threeDQuickHint")}</p>
                    {p.signedIn && p.savedRemotely ? <button type="button" onClick={() => p.onStartProcessing(room)} className="button-mini mt-2">{t("start3d")}</button> : null}
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-sm">{t(STAGE_KEY[customerStage(status)])}</p>
                    {status !== "ready" && status !== "failed" && status !== "partially_ready" ? <p className="mt-1 text-xs text-text-muted">{t("leaveHint")}</p> : null}
                    <ul className="mt-2 space-y-1">
                      {(view?.jobs ?? []).map((job) => (
                        <li key={job.id} className="flex items-center justify-between font-mono text-[11px] text-text-muted" dir="ltr">
                          <span>{job.provider === "kiri" ? t("kiriLabel") : t("marbleLabel")}</span>
                          <span>{t(STAGE_KEY[customerStage(job.status as JobStatus)])}{job.failureCode ? ` · ${t.has(`failures.${job.failureCode}`) ? t(`failures.${job.failureCode}`) : t("failures.generic")}` : ""}</span>
                        </li>
                      ))}
                    </ul>
                    {splats.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {splats.map((artifact) => <button key={artifact.id} type="button" onClick={() => p.onOpenSplat(artifact, room)} className="button-mini">{artifact.provider === "marble" ? t("openMarble") : t("openKiri")}</button>)}
                      </div>
                    ) : null}
                    {failed.length && failed.length === view?.jobs.length ? <button type="button" onClick={() => p.onStartProcessing(room)} className="button-mini mt-2">{t("tryAgain")}</button> : null}
                  </>
                )}
                {(view?.artifacts ?? []).some((a) => a.provider === "marble") ? <p className="mt-2 text-xs text-text-faint">{t("marbleNote")}</p> : null}
                {(view?.artifacts ?? []).some((a) => a.provider === "kiri") ? <p className="mt-2 text-xs text-text-faint">{t("kiriNote")}</p> : null}
              </div>

              {downloads.length ? (
                <details className="mt-3 rounded-xl border border-white/10 p-3">
                  <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[.14em] text-text-muted">{t("downloads", { count: downloads.length })}</summary>
                  <ul className="mt-2 space-y-1 text-xs">
                    {downloads.map((artifact) => (
                      <li key={artifact.id} className="flex items-center justify-between gap-2" dir="ltr">
                        <span className="truncate">{t.has(`artifactTypes.${artifact.type}`) ? t(`artifactTypes.${artifact.type}`) : artifact.type} · {artifact.aiGenerated ? t("aiTag") : t("capturedTag")} · {(artifact.byteSize / 1_048_576).toFixed(1)} MB</span>
                        <a href={artifact.url!} download className="shrink-0 underline">{t("download")}</a>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[10px] text-text-faint">{t("linksExpire")}</p>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="mt-6 space-y-2">
        {anyPanorama && rooms.length >= 2 ? <button type="button" onClick={() => p.onOpenPreview()} className="button-primary w-full justify-center">{t("openTour")}</button> : null}
        {p.savedRemotely && rooms.length >= 2 ? <button type="button" onClick={p.onEditTour} className="button-secondary w-full justify-center">{t("editDoorways")}</button> : null}
        {!p.signedIn ? <button type="button" onClick={p.onSignIn} className="button-secondary w-full justify-center">{t("signInToSave")}</button> : !p.savedRemotely ? <button type="button" onClick={p.onSaveNow} className="button-secondary w-full justify-center">{t("saveNow")}</button> : null}
        <button type="button" onClick={p.onAddRoom} className="button-secondary w-full justify-center">{t("addRoom")}</button>
        <button type="button" onClick={p.onExport} className="button-secondary w-full justify-center">{t("exportOriginals")}</button>
        <button type="button" onClick={p.onRestart} className="button-secondary w-full justify-center">{t("newProperty")}</button>
        {p.savedRemotely ? <button type="button" onClick={p.onDelete} className="mt-2 w-full text-center font-mono text-[11px] text-text-muted underline">{t("deleteEverything")}</button> : null}
      </div>
      <p className="mt-6 text-center text-[11px] text-text-faint">{t("privacyFooter")}</p>
    </section>
  );
}
