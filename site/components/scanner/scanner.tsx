"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlignmentGate, createTargetPlan, focalLength, projectTarget, type FieldOfView, type Orientation, type SpherePlan } from "@/lib/scanner/sphere";
import { deleteFrame, latestSession, roomFrames, saveFrame, saveSession, updateFrameUpload, type Room, type ScanSession } from "@/lib/scanner/db";
import { httpScannerBackend, type FrameMetadata } from "@/lib/scanner/contracts";
import { RoomPreview } from "./room-preview";

const DEFAULT_FOV: FieldOfView = { horizontal: 55, vertical: 72 };
const newRoom = (n: number): Room => ({ id: crypto.randomUUID(), name: `Room ${n}`, status: "capturing", captured: 0, targetCount: 0 });
const newSession = (): ScanSession => { const room = newRoom(1); const now = new Date().toISOString(); return { id: crypto.randomUUID(), createdAt: now, updatedAt: now, activeRoomId: room.id, rooms: [room] }; };

function readOrientation(event: DeviceOrientationEvent): Orientation {
  const compass = (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
  return { yaw: compass ?? event.alpha ?? 0, pitch: Math.max(-90, Math.min(90, (event.beta ?? 90) - 90)), roll: event.gamma ?? 0 };
}

export function Scanner() {
  const video = useRef<HTMLVideoElement>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const gate = useRef(new AlignmentGate());
  const capturing = useRef(false);
  const [session, setSession] = useState<ScanSession>();
  const [orientation, setOrientation] = useState<Orientation>();
  const [plan, setPlan] = useState<SpherePlan>();
  const [permission, setPermission] = useState<"idle" | "ready" | "error">("idle");
  const [message, setMessage] = useState("Tap start and allow camera + motion access");
  const [dwell, setDwell] = useState(0);
  const activeRoom = session?.rooms.find((room) => room.id === session.activeRoomId);
  const target = plan?.targets[activeRoom?.captured ?? 0];
  const updateRoom = useCallback((id: string, change: (room: Room) => Room) => setSession((old) => old ? { ...old, rooms: old.rooms.map((r) => r.id === id ? change(r) : r) } : old), []);

  useEffect(() => { void latestSession().then((saved) => setSession(saved && saved.rooms.some((r) => r.status !== "complete") ? saved : newSession())); }, []);
  useEffect(() => () => cameraStream.current?.getTracks().forEach((track) => track.stop()), []);
  useEffect(() => { if (session) void saveSession(session); }, [session]);

  useEffect(() => {
    const pending = session?.rooms.filter((room) => room.job && room.status === "processing") ?? [];
    if (!pending.length) return;
    const timer = window.setInterval(() => {
      pending.forEach((room) => void httpScannerBackend.getJob(room.job!.id).then((job) => {
        updateRoom(room.id, (current) => ({ ...current, job, status: job.status === "succeeded" ? "complete" : current.status, panoramaUrl: job.privatePreviewUrl ?? current.panoramaUrl }));
      }).catch(() => undefined));
      if (session) void httpScannerBackend.getPreview(session.id).then((preview) => {
        preview.manifest?.nodes.forEach((node) => updateRoom(node.id, (room) => ({ ...room, status: "complete", panoramaUrl: node.panorama })));
      }).catch(() => undefined);
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [session?.rooms, updateRoom]);

  const capture = useCallback(async (pose: Orientation) => {
    if (!video.current || !session || !activeRoom || !target || capturing.current) return;
    capturing.current = true;
    setMessage("Capturing…");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.current.videoWidth; canvas.height = video.current.videoHeight;
      canvas.getContext("2d", { alpha: false })?.drawImage(video.current, 0, 0);
      const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("JPEG encoding failed")), "image/jpeg", 0.95));
      const id = crypto.randomUUID();
      const metadata: FrameMetadata = { id, roomId: activeRoom.id, sessionId: session.id, ...pose, fov: DEFAULT_FOV, timestamp: new Date().toISOString(), checkpoint: { index: target.index, ring: target.ring, yaw: target.yaw, pitch: target.pitch, elevation: target.elevation }, width: canvas.width, height: canvas.height, mimeType: "image/jpeg" };
      await saveFrame({ id, metadata, jpeg });
      updateRoom(activeRoom.id, (room) => ({ ...room, captured: room.captured + 1 }));
      gate.current.reset();
      navigator.vibrate?.(35);
      setMessage("Frame saved privately on this device");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Capture failed"); }
    finally { capturing.current = false; }
  }, [activeRoom, session, target, updateRoom]);

  useEffect(() => {
    if (permission !== "ready") return;
    const onOrientation = (event: DeviceOrientationEvent) => {
      const next = readOrientation(event); setOrientation(next);
      if (!plan) { const created = createTargetPlan(next.yaw, DEFAULT_FOV); setPlan(created); if (activeRoom) updateRoom(activeRoom.id, (room) => ({ ...room, targetCount: created.targets.length })); return; }
      const activeTarget = plan.targets[activeRoom?.captured ?? 0]; if (!activeTarget) return;
      const reading = gate.current.update(projectTarget(next, activeTarget).angularDistance, performance.now()); setDwell(reading.progress);
      if (reading.triggered) void capture(next);
    };
    window.addEventListener("deviceorientation", onOrientation, true);
    return () => window.removeEventListener("deviceorientation", onOrientation, true);
  }, [permission, plan, activeRoom, capture, updateRoom]);

  const start = async () => {
    try {
      const requestMotion = (DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<PermissionState> }).requestPermission;
      if (requestMotion && await requestMotion() !== "granted") throw new Error("Motion access was not granted");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 4096 }, height: { ideal: 3072 } }, audio: false });
      cameraStream.current = stream;
      if (!video.current) return; video.current.srcObject = stream; await video.current.play(); setPermission("ready"); setMessage("Move the dot into the centre and hold still");
    } catch (error) { setPermission("error"); setMessage(error instanceof Error ? error.message : "Camera access failed"); }
  };

  const finishRoom = async () => {
    if (!session || !activeRoom || !activeRoom.captured) return;
    updateRoom(activeRoom.id, (room) => ({ ...room, status: "processing" })); setMessage("Uploading original frames…");
    try {
      await httpScannerBackend.createScan(session.id);
      await Promise.all(session.rooms.map((room, index) => httpScannerBackend.createRoom(session.id, room.id, room.name, index + 1, room.targetCount)));
      const frames = await roomFrames(activeRoom.id); const keys: string[] = [];
      for (const frame of frames) {
        if (frame.upload && "completedAt" in frame.upload) { keys.push(frame.upload.privateObjectKey); continue; }
        let ticket = frame.upload ?? await httpScannerBackend.beginUpload(frame.metadata, frame.jpeg.size);
        await updateFrameUpload(frame, ticket);
        while (ticket.offset < frame.jpeg.size) {
          const result = await httpScannerBackend.uploadPart(ticket, frame.jpeg, { frameId: frame.id, offset: ticket.offset, size: Math.min(5 * 1024 * 1024, frame.jpeg.size - ticket.offset) });
          await updateFrameUpload(frame, result);
          if ("completedAt" in result) { keys.push(result.privateObjectKey); await deleteFrame(frame.id); break; } ticket = result;
        }
      }
      const job = await httpScannerBackend.startJob({ sessionId: session.id, roomId: activeRoom.id, stage: "stitch", inputObjectKeys: keys, preserveInputs: true });
      updateRoom(activeRoom.id, (room) => ({ ...room, job })); setMessage("Room queued for stitching");
    } catch (error) { setMessage(`Saved locally. Upload can resume: ${error instanceof Error ? error.message : "offline"}`); }
  };

  useEffect(() => {
    const resume = () => { if (activeRoom?.status === "processing") void finishRoom(); };
    window.addEventListener("online", resume);
    return () => window.removeEventListener("online", resume);
  }, [activeRoom?.id, activeRoom?.status, session?.id]);

  const addRoom = () => setSession((old) => { if (!old) return old; const room = newRoom(old.rooms.length + 1); setPlan(undefined); gate.current.reset(); return { ...old, activeRoomId: room.id, rooms: [...old.rooms, room] }; });
  const marker = useMemo(() => { if (!orientation || !target || !video.current) return; const view = projectTarget(orientation, target); const f = focalLength(innerWidth, innerHeight, DEFAULT_FOV); return { left: innerWidth / 2 + view.x / view.z * f, top: innerHeight / 2 - view.y / view.z * f, visible: view.inFront }; }, [orientation, target]);

  return <main className="relative h-dvh w-screen overflow-hidden bg-black text-white">
    <video ref={video} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
    <div className="absolute inset-0 bg-[radial-gradient(circle,transparent_35%,rgba(0,0,0,.55))]" />
    {permission === "idle" && <div className="absolute inset-0 z-30 grid place-items-center bg-black px-8 text-center"><div><p className="mb-3 font-mono text-xs uppercase tracking-[.24em] text-white/55">Private mobile capture</p><h1 className="font-serif text-5xl">Scan this room</h1><p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-white/60">Frames stay on this device until you finish a room and start its private upload.</p><button onClick={start} className="mt-8 rounded-full bg-white px-6 py-3 font-medium text-black">Start camera</button></div></div>}
    <div className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70" style={{ background: `conic-gradient(white ${dwell * 360}deg, transparent 0)` }}><div className="absolute inset-1 rounded-full bg-black/50" /></div>
    {marker?.visible && <div className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_20px_white]" style={{ left: marker.left, top: marker.top }} />}
    <header className="absolute inset-x-0 top-0 flex items-center justify-between p-4"><span className="font-mono text-xs uppercase tracking-widest">{activeRoom?.name ?? "Scanner"}</span><span className="rounded-full bg-black/50 px-3 py-2 font-mono text-[10px]">{activeRoom?.captured ?? 0} / {activeRoom?.targetCount ?? "—"}</span></header>
    <footer className="absolute inset-x-0 bottom-0 p-4"><p className="mb-3 text-center text-xs text-white/70">{message}</p><div className="flex justify-center gap-2"><button disabled={!activeRoom?.captured} onClick={finishRoom} className="rounded-full border border-white/30 bg-black/50 px-4 py-2 text-xs disabled:opacity-30">Finish room</button><button onClick={addRoom} className="rounded-full bg-white px-4 py-2 text-xs text-black">Add room</button></div></footer>
    {session && <RoomPreview rooms={session.rooms} />}
  </main>;
}
