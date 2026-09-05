"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { SodarMark } from "@/components/logo";
import { AlignmentGate, createTargetPlan, focalLength, projectTarget, type FieldOfView, type Orientation, type SpherePlan } from "@/lib/scanner/sphere";
import { deleteFrame, latestSession, roomFrames, saveFrame, saveSession, updateFrameUpload, type Room, type ScanSession } from "@/lib/scanner/db";
import { httpScannerBackend, type FrameMetadata } from "@/lib/scanner/contracts";
import { RoomPreview } from "./room-preview";
import { buildZip, type ZipEntry } from "@/lib/scanner/zip";

/**
 * Guided panorama capture. Geometry is the Photo Sphere Android port in
 * lib/scanner/sphere.ts; frames persist in IndexedDB (lib/scanner/db.ts) and,
 * once a room is finished, upload through the scanner API to be stitched.
 * Without a signed-in Supabase session the frames simply stay on the phone.
 *
 * Scope: the free preview captures one ring (equator) per room — about a
 * dozen frames — so a broker finishes two rooms in a couple of minutes. Open
 * /scan?scope=sphere for the full multi-ring sphere.
 */
const DEFAULT_FOV: FieldOfView = { horizontal: 55, vertical: 72 };
const ROOMS_IN_PREVIEW = 2;

type Scope = "ring" | "sphere";
type Phase = "idle" | "capturing" | "roomDone" | "processing" | "done";

const newRoom = (n: number, name: string): Room => ({ id: crypto.randomUUID(), name, status: "capturing", captured: 0, targetCount: 0 });
const newSession = (name: string): ScanSession => {
  const room = newRoom(1, name);
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), createdAt: now, updatedAt: now, activeRoomId: room.id, rooms: [room] };
};

function readOrientation(event: DeviceOrientationEvent): Orientation {
  const compass = (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
  return { yaw: compass ?? event.alpha ?? 0, pitch: Math.max(-90, Math.min(90, (event.beta ?? 90) - 90)), roll: event.gamma ?? 0 };
}

function planFor(startYaw: number, scope: Scope): SpherePlan {
  const full = createTargetPlan(startYaw, DEFAULT_FOV);
  if (scope === "sphere") return full;
  const targets = full.targets.filter((t) => t.ring === 0).map((t, index) => ({ ...t, index }));
  return { targets, rings: [{ start: 0, end: targets.length - 1 }] };
}

export function Scanner() {
  const t = useTranslations("Scanner");
  const roomNames = t.raw("rooms") as string[];
  const roomName = useCallback((n: number) => roomNames[n - 1] ?? `${t("room")} ${n}`, [roomNames, t]);

  const video = useRef<HTMLVideoElement>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const gate = useRef(new AlignmentGate(4, 350));
  const capturing = useRef(false);
  const lastOrientation = useRef<Orientation & { t: number }>(undefined);

  const [scope, setScope] = useState<Scope>("ring");
  const [phase, setPhase] = useState<Phase>("idle");
  const [session, setSession] = useState<ScanSession>();
  const [orientation, setOrientation] = useState<Orientation>();
  const [plan, setPlan] = useState<SpherePlan>();
  const [hasGyro, setHasGyro] = useState<boolean | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [dwell, setDwell] = useState(0);
  const [flash, setFlash] = useState(false);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);

  const activeRoom = session?.rooms.find((room) => room.id === session.activeRoomId);
  const target = plan?.targets[activeRoom?.captured ?? 0];
  const finishedRooms = session?.rooms.filter((r) => r.status !== "capturing").length ?? 0;
  const isMobile = useMemo(() => (typeof navigator !== "undefined" ? /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) : false), []);

  const updateRoom = useCallback((id: string, change: (room: Room) => Room) => setSession((old) => (old ? { ...old, rooms: old.rooms.map((r) => (r.id === id ? change(r) : r)) } : old)), []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("scope") === "sphere") setScope("sphere");
    void latestSession().then((saved) => setSession(saved && saved.rooms.some((r) => r.status !== "complete") ? saved : newSession(roomName(1))));
  }, [roomName]);
  useEffect(() => () => cameraStream.current?.getTracks().forEach((track) => track.stop()), []);
  useEffect(() => {
    if (session) void saveSession(session);
  }, [session]);

  // Poll stitching jobs for rooms that were uploaded.
  useEffect(() => {
    const pending = session?.rooms.filter((room) => room.job && room.status === "processing") ?? [];
    if (!pending.length) return;
    const timer = window.setInterval(() => {
      pending.forEach((room) =>
        void httpScannerBackend
          .getJob(room.job!.id)
          .then((job) => updateRoom(room.id, (current) => ({ ...current, job, status: job.status === "succeeded" ? "complete" : current.status, panoramaUrl: job.privatePreviewUrl ?? current.panoramaUrl })))
          .catch(() => undefined),
      );
      if (session)
        void httpScannerBackend
          .getPreview(session.id)
          .then((preview) => preview.manifest?.nodes.forEach((node) => updateRoom(node.id, (room) => ({ ...room, status: "complete", panoramaUrl: node.panorama }))))
          .catch(() => undefined);
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [session?.rooms, session, updateRoom]);

  const capture = useCallback(
    async (pose: Orientation) => {
      if (!video.current || !session || !activeRoom || !target || capturing.current || video.current.videoWidth === 0) return;
      capturing.current = true;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.current.videoWidth;
        canvas.height = video.current.videoHeight;
        canvas.getContext("2d", { alpha: false })?.drawImage(video.current, 0, 0);
        const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("JPEG encoding failed"))), "image/jpeg", 0.95));
        const id = crypto.randomUUID();
        const metadata: FrameMetadata = { id, roomId: activeRoom.id, sessionId: session.id, ...pose, fov: DEFAULT_FOV, timestamp: new Date().toISOString(), checkpoint: { index: target.index, ring: target.ring, yaw: target.yaw, pitch: target.pitch, elevation: target.elevation }, width: canvas.width, height: canvas.height, mimeType: "image/jpeg" };
        await saveFrame({ id, metadata, jpeg });
        setThumbs((list) => [...list, URL.createObjectURL(jpeg)]);
        updateRoom(activeRoom.id, (room) => ({ ...room, captured: room.captured + 1 }));
        gate.current.reset();
        setFlash(true);
        window.setTimeout(() => setFlash(false), 120);
        try {
          navigator.vibrate?.(25);
        } catch {}
      } catch (err) {
        setMessage(err instanceof Error ? err.message : t("noCamera"));
      } finally {
        capturing.current = false;
      }
    },
    [activeRoom, session, target, updateRoom, t],
  );

  // Orientation → target distance → gate → auto shutter, plus the assistant hint.
  useEffect(() => {
    if (phase !== "capturing") return;
    let seen = false;
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha == null && event.beta == null) return;
      seen = true;
      if (hasGyro !== true) setHasGyro(true);
      const next = readOrientation(event);
      setOrientation(next);
      if (!plan) {
        const created = planFor(next.yaw, scope);
        setPlan(created);
        if (activeRoom) updateRoom(activeRoom.id, (room) => ({ ...room, targetCount: created.targets.length }));
        return;
      }
      const activeTarget = plan.targets[activeRoom?.captured ?? 0];
      if (!activeTarget) return;
      const view = projectTarget(next, activeTarget);
      const now = performance.now();
      const last = lastOrientation.current;
      const speed = last ? (Math.abs(next.yaw - last.yaw) / Math.max(1, now - last.t)) * 1000 : 0;
      lastOrientation.current = { ...next, t: now };
      const reading = gate.current.update(view.angularDistance, now);
      setDwell(reading.progress);
      if (reading.triggered) void capture(next);
      if (reading.aligned) setMessage(t("hold"));
      else if (speed > 60 && speed < 300) setMessage(t("slower"));
      else if (!view.inFront || Math.abs(view.x) > Math.abs(view.y)) setMessage(view.x > 0 ? t("turnRight") : t("turnLeft"));
      else setMessage(view.y > 0 ? t("tiltUp") : t("tiltDown"));
    };
    window.addEventListener("deviceorientation", onOrientation, true);
    const probe = window.setTimeout(() => {
      if (!seen && hasGyro === null) {
        setHasGyro(false);
        setMessage(t("noGyro"));
        if (!plan) {
          const created = planFor(0, scope);
          setPlan(created);
          if (activeRoom) updateRoom(activeRoom.id, (room) => ({ ...room, targetCount: created.targets.length }));
        }
      }
    }, 1500);
    return () => {
      window.removeEventListener("deviceorientation", onOrientation, true);
      window.clearTimeout(probe);
    };
  }, [phase, plan, activeRoom, capture, updateRoom, hasGyro, scope, t]);

  // Ring complete → room done.
  useEffect(() => {
    if (phase === "capturing" && plan && activeRoom && activeRoom.captured >= plan.targets.length) setPhase("roomDone");
  }, [phase, plan, activeRoom]);

  // Preview progress bar (mock while no real stitch job is running).
  useEffect(() => {
    if (phase !== "processing") return;
    setProgress(0);
    const id = window.setInterval(() => setProgress((p) => (p >= 100 ? 100 : p + 2)), 80);
    const done = window.setTimeout(() => setPhase("done"), 4600);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(done);
    };
  }, [phase]);

  const start = async () => {
    setError(null);
    setRequesting(true);
    try {
      const requestMotion = (DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<PermissionState> }).requestPermission;
      if (requestMotion) {
        const granted = await requestMotion().catch(() => "denied");
        if (granted !== "granted") setHasGyro(false);
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 4096 }, height: { ideal: 3072 } }, audio: false });
      cameraStream.current = stream;
      if (video.current) {
        video.current.srcObject = stream;
        await video.current.play();
      }
      setThumbs([]);
      setPlan(undefined);
      gate.current.reset();
      setMessage(t("hold"));
      setPhase("capturing");
    } catch (err) {
      const name = (err as DOMException)?.name;
      setError(name === "NotAllowedError" ? t("denied") : t("noCamera"));
    } finally {
      setRequesting(false);
    }
  };

  const manualCapture = () => {
    const pose = orientation ?? { yaw: (activeRoom?.captured ?? 0) * 30, pitch: 0, roll: 0 };
    void capture(pose);
  };

  /** Upload the finished room's frames and queue stitching; without a signed-in session they stay local. */
  const finishRoom = async () => {
    if (!session || !activeRoom || !activeRoom.captured) return;
    setMessage(t("uploading"));
    let uploaded = false;
    try {
      await httpScannerBackend.createScan(session.id);
      await Promise.all(session.rooms.map((room, index) => httpScannerBackend.createRoom(session.id, room.id, room.name, index + 1, room.targetCount)));
      const frames = await roomFrames(activeRoom.id);
      const keys: string[] = [];
      for (const frame of frames) {
        if (frame.upload && "completedAt" in frame.upload) {
          keys.push(frame.upload.privateObjectKey);
          continue;
        }
        let ticket = frame.upload ?? (await httpScannerBackend.beginUpload(frame.metadata, frame.jpeg.size));
        await updateFrameUpload(frame, ticket);
        while (ticket.offset < frame.jpeg.size) {
          const result = await httpScannerBackend.uploadPart(ticket, frame.jpeg, { frameId: frame.id, offset: ticket.offset, size: Math.min(5 * 1024 * 1024, frame.jpeg.size - ticket.offset) });
          await updateFrameUpload(frame, result);
          if ("completedAt" in result) {
            keys.push(result.privateObjectKey);
            await deleteFrame(frame.id);
            break;
          }
          ticket = result;
        }
      }
      const job = await httpScannerBackend.startJob({ sessionId: session.id, roomId: activeRoom.id, stage: "stitch", inputObjectKeys: keys, preserveInputs: true });
      updateRoom(activeRoom.id, (room) => ({ ...room, job, status: "processing" }));
      uploaded = true;
      setMessage(t("queued"));
    } catch {
      updateRoom(activeRoom.id, (room) => ({ ...room, status: "complete" }));
      setMessage(t("savedLocally"));
    }
    const finished = finishedRooms + 1;
    if (finished >= ROOMS_IN_PREVIEW) {
      cameraStream.current?.getTracks().forEach((track) => track.stop());
      setPhase(uploaded ? "done" : "processing");
    } else {
      setSession((old) => {
        if (!old) return old;
        const room = newRoom(old.rooms.length + 1, roomName(old.rooms.length + 1));
        return { ...old, activeRoomId: room.id, rooms: [...old.rooms, room] };
      });
      setPlan(undefined);
      setThumbs([]);
      gate.current.reset();
      setPhase("capturing");
    }
  };

  const marker = useMemo(() => {
    if (!orientation || !target || typeof window === "undefined") return undefined;
    const view = projectTarget(orientation, target);
    const f = focalLength(window.innerWidth, window.innerHeight, DEFAULT_FOV);
    const z = Math.max(view.z, 0.15);
    return { left: window.innerWidth / 2 + (view.x / z) * f, top: window.innerHeight / 2 - (view.y / z) * f, visible: view.inFront, near: view.angularDistance < 4 };
  }, [orientation, target]);

  /** Download every captured frame plus frames.json (poses, fov) as one zip — the input for `sodar stitch`. */
  const exportFrames = async () => {
    if (!session) return;
    const entries: ZipEntry[] = [];
    const rooms: Array<Record<string, unknown>> = [];
    for (const [ri, room] of session.rooms.entries()) {
      const frames = await roomFrames(room.id);
      const dir = `room-${String(ri + 1).padStart(2, "0")}`;
      const list: Array<Record<string, unknown>> = [];
      for (const [fi, frame] of frames.entries()) {
        const file = `${dir}/frame-${String(fi + 1).padStart(3, "0")}.jpg`;
        entries.push({ name: file, data: new Uint8Array(await frame.jpeg.arrayBuffer()) });
        const m = frame.metadata;
        list.push({ file, yaw: m.yaw, pitch: m.pitch, roll: m.roll, elevation: m.checkpoint.elevation, checkpoint: m.checkpoint, timestamp: m.timestamp, width: m.width, height: m.height });
      }
      rooms.push({ id: room.id, name: room.name, fov: DEFAULT_FOV, targetCount: room.targetCount, frames: list });
    }
    const manifest = { schema: "sodar-frames.v1", sessionId: session.id, exportedAt: new Date().toISOString(), rooms };
    entries.push({ name: "frames.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
    const blob = buildZip(entries);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sodar-scan-${session.id.slice(0, 8)}.zip`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
  };

  const restart = () => {
    setSession(newSession(roomName(1)));
    setPlan(undefined);
    setThumbs([]);
    setPhase("idle");
  };

  const total = plan?.targets.length ?? activeRoom?.targetCount ?? 0;

  return (
    <main className="relative min-h-dvh overflow-hidden bg-bg text-text">
      <video ref={video} playsInline muted autoPlay className={`absolute inset-0 h-full w-full object-cover transition-opacity ${phase === "capturing" || phase === "roomDone" ? "opacity-100" : "opacity-0"}`} />
      {flash ? <div className="pointer-events-none absolute inset-0 z-20 bg-white/80" /> : null}

      <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-4 py-3">
        <span className="flex items-center gap-2">
          <SodarMark size={18} className="text-text" />
          <span className="wordmark text-[.7rem]">Sodar</span>
        </span>
        <Link href="/" className="rounded-full border border-white/25 bg-black/40 px-3 py-1 font-mono text-[11px] text-text backdrop-blur">
          {t("exit")}
        </Link>
      </div>

      {phase === "idle" ? (
        <div className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col justify-end px-6 pb-10 pt-24">
          <p className="eyebrow">
            <span /> {t("eyebrow")}
          </p>
          <h1 className="display mt-4 text-[clamp(2.4rem,9vw,3.6rem)]">{t("title")}</h1>
          <p className="mt-4 text-text-muted">{t("intro")}</p>
          {!isMobile ? <p className="mt-3 font-mono text-[11px] text-text-faint">{t("desktopHint")}</p> : null}
          {error ? <p className="mt-4 rounded-xl border border-border-strong bg-bg-raised p-3 text-sm text-text">{error}</p> : null}
          <button type="button" onClick={start} disabled={requesting || !session} className="button-primary mt-8 w-full justify-center">
            {requesting ? t("requesting") : t("start")} <span aria-hidden>↗</span>
          </button>
          <p className="mt-3 text-center font-mono text-[10px] text-text-faint">{t("privacyNote")}</p>
        </div>
      ) : null}

      {phase === "capturing" || phase === "roomDone" ? (
        <div className="absolute inset-0 z-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle,transparent_35%,rgba(0,0,0,.5))]" />
          <div className="absolute inset-x-8 top-1/2 h-px bg-white/30" />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <svg width="96" height="96" viewBox="0 0 100 100" className="-rotate-90">
              <circle cx="50" cy="50" r="44" stroke="rgba(255,255,255,.45)" strokeWidth="2" fill="none" />
              <circle cx="50" cy="50" r="44" stroke="#f4f2ee" strokeWidth="3" fill="none" strokeDasharray="276" strokeDashoffset={276 * (1 - dwell)} strokeLinecap="round" />
            </svg>
          </div>
          {phase === "capturing" && marker?.visible && hasGyro ? (
            <div className={`pointer-events-none absolute h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${marker.near ? "border-text bg-text/30" : "border-dashed border-white/70"}`} style={{ left: marker.left, top: marker.top }} />
          ) : null}

          <div className="absolute left-4 top-14 font-mono text-[11px] text-text" dir="ltr">
            <span className="num">{String(activeRoom?.captured ?? 0).padStart(2, "0")}</span>
            <span className="text-text-muted">/{total || "—"} {t("frames")}</span>
          </div>
          <div className="absolute right-4 top-14 rounded-full border border-white/25 bg-black/40 px-2.5 py-1 font-mono text-[10px] text-text backdrop-blur">
            {activeRoom?.name}
          </div>

          <div className="absolute inset-x-0 bottom-36 flex gap-1 overflow-x-auto px-4" dir="ltr">
            {thumbs.map((src, i) => (
              <img key={i} src={src} alt="" className="h-10 w-14 shrink-0 rounded object-cover" />
            ))}
          </div>

          <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/15 bg-black/55 p-4 backdrop-blur">
            <p className="font-mono text-[10px] uppercase tracking-[.16em] text-text-muted">{t("assistant")}</p>
            {phase === "roomDone" ? (
              <>
                <p className="mt-1 text-sm text-text">{t("roomDone")}</p>
                <button type="button" onClick={finishRoom} className="button-primary mt-3 w-full justify-center">
                  {finishedRooms + 1 >= ROOMS_IN_PREVIEW ? t("finish") : t("nextRoom")} <span aria-hidden>↗</span>
                </button>
              </>
            ) : hasGyro === false ? (
              <>
                <p className="mt-1 text-sm text-text">{t("noGyro")}</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={manualCapture} className="button-primary flex-1 justify-center">{t("manual")}</button>
                  {(activeRoom?.captured ?? 0) >= 6 ? <button type="button" onClick={() => setPhase("roomDone")} className="button-secondary">{t("finishRoom")}</button> : null}
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-text">{message || t("hold")}</p>
                {(activeRoom?.captured ?? 0) >= 6 ? <button type="button" onClick={() => setPhase("roomDone")} className="button-mini mt-3">{t("finishRoom")}</button> : null}
              </>
            )}
          </div>
        </div>
      ) : null}

      {phase === "processing" || phase === "done" ? (
        <div className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-24">
          <p className="eyebrow">
            <span /> {phase === "done" ? t("done") : t("processingLabel")}
          </p>
          <h2 className="display mt-4 text-[clamp(2.2rem,8vw,3.2rem)]">{phase === "done" ? t("doneTitle") : t("processing")}</h2>
          {phase === "processing" ? (
            <div className="mt-6 h-1 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-text transition-[width] duration-100" style={{ width: `${progress}%` }} />
            </div>
          ) : null}
          <p className="mt-2 font-mono text-[11px] text-text-muted" dir="ltr">
            {session?.rooms.reduce((n, r) => n + r.captured, 0) ?? 0} {t("frames")} · {session?.rooms.length ?? 0} {t("roomsLabel")}
          </p>
          {message ? <p className="mt-3 font-mono text-[11px] text-text-faint">{message}</p> : null}
          {phase === "done" ? (
            <>
              <p className="mt-6 text-text-muted">{t("doneBody")}</p>
              <Link href="/terminal" className="button-primary mt-8 w-full justify-center">
                {t("workspace")} <span aria-hidden>↗</span>
              </Link>
              <button type="button" onClick={exportFrames} className="button-secondary mt-3 w-full justify-center">
                {t("export")} <span aria-hidden>↓</span>
              </button>
              <button type="button" onClick={restart} className="button-secondary mt-3 w-full justify-center">
                {t("again")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {session ? <RoomPreview rooms={session.rooms} /> : null}
    </main>
  );
}
