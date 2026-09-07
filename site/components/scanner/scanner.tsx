"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { SodarMark } from "@/components/logo";
import { AlignmentGate, focalLength, projectTarget, type FieldOfView, type Orientation } from "@/lib/scanner/sphere";
import { coverageGaps, minimumFrames, nextTargetIndex, planFor, planProgress, PLAN_LIMITS, type CaptureMode, type CapturePlan, type PlanTarget, type RoomSize } from "@/lib/scanner/plan";
import { checkFrame, checkRoom, computeMetrics, qualityScore, toGray, worst, type Gray, type FrameMetrics, type RoomGate } from "@/lib/scanner/quality";
import { deleteFrame, deleteRoomFrames, deleteSession, getFrame, roomFrames, roomFrameSummaries, saveFrame, saveSession, sessionFrameCount, unfinishedSession, type FrameSummary, type Room, type ScanSession } from "@/lib/scanner/db";
import { BackendError, httpScannerBackend, sessionToken, type FrameMetadata, type ProviderId, type PublicArtifact, type ReconstructionEstimate, type RoomView, type TourLinkRecord } from "@/lib/scanner/contracts";
import { describeTrack, deviceSummary, grabStill, lockExposure, openRearCamera, prepareTrack, previewAndGray } from "@/lib/scanner/camera";
import { buildZip, type ZipEntry } from "@/lib/scanner/zip";
import { maxStitchWidth, stitchFrames } from "@/lib/scanner/stitch";
import { loadPanorama, savePanorama, sessionPanoramas, deletePanorama } from "@/lib/scanner/panoramas";
import { aiFillEnabled, aiFillPanorama } from "@/lib/scanner/ai-fill";
import { reviewCapture, type AstraCaptureReview } from "@/lib/scanner/astra";
import { uploadRoom } from "@/lib/scanner/upload";
import { configureTelemetry, stopwatch, track } from "@/lib/scanner/telemetry";
import { buildTour, mergeLinks, provisionalLinks, type TourManifest } from "@/lib/scanner/tour";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { useOrientation } from "./use-orientation";
import { CaptureOverlay } from "./capture-overlay";
import { ReviewPanel } from "./review-panel";
import { ResultsView } from "./results-view";
import { ConsentSheet } from "./consent-sheet";
import { ResumeDialog } from "./resume-dialog";
import { SignInSheet } from "./sign-in-sheet";
import { Tutorial } from "./tutorial";
import { RoomPreview, type PreviewRoom } from "./room-preview";
import { TourEditor } from "./tour-editor";
import { SplatViewer } from "./splat-viewer";
import { SpzViewer } from "./spz-viewer";

/**
 * Guided property scanner.
 *
 * welcome → mode → permissions (camera + motion) → tutorial → people →
 * capturing (pause / move / retake) → checking (local gates + on-device
 * panorama) → review (Astra, retakes) → saving (sign-in, resumable upload,
 * panorama artifacts) → consent (paid reconstruction) → results (status,
 * panorama versions, 3D viewers, tour, downloads, deletion).
 *
 * Every frame is in IndexedDB before it counts; the session is saved on every
 * change so a reload, lock screen or call resumes where it stopped.
 */
const DEFAULT_FOV: FieldOfView = { horizontal: 55, vertical: 72 };
const PREVIEW_WIDTH = 2048;
const ROOM_POLL_MS = 8_000;

type Phase = "loading" | "welcome" | "mode" | "permissions" | "tutorial" | "people" | "capturing" | "checking" | "review" | "saving" | "results";

const newRoom = (name: string, mode: CaptureMode, size: RoomSize): Room => ({ id: crypto.randomUUID(), name, status: "capturing", captured: 0, targetCount: 0, mode, size });
const newSession = (name: string, mode: CaptureMode, size: RoomSize): ScanSession => {
  const room = newRoom(name, mode, size);
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), createdAt: now, updatedAt: now, activeRoomId: room.id, mode, rooms: [room], phase: "mode" };
};

export function Scanner() {
  const t = useTranslations("Scanner");
  const locale = useLocale();
  const roomNames = t.raw("rooms") as string[];
  const roomName = useCallback((n: number) => roomNames[n - 1] ?? `${t("room")} ${n}`, [roomNames, t]);
  const supabaseConfigured = getSupabaseEnv().configured;

  // --- refs (things that must not trigger renders) ---
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const gate = useRef(new AlignmentGate(4, 350));
  const capturing = useRef(false);
  const previousFrame = useRef<{ metrics: FrameMetrics; gray: Gray; orientation: Orientation; timestamp: number } | undefined>(undefined);
  const thumbUrls = useRef(new Map<string, string>());
  const panoramaUrls = useRef<string[]>([]);
  const rejectTimer = useRef<number | undefined>(undefined);
  const captureTimer = useRef<(() => number) | undefined>(undefined);

  // --- state ---
  const [phase, setPhase] = useState<Phase>("loading");
  const [session, setSession] = useState<ScanSession>();
  const [resumable, setResumable] = useState<{ session: ScanSession; frames: number } | null>(null);
  const [mode, setMode] = useState<CaptureMode>("full3d");
  const [size, setSize] = useState<RoomSize>("normal");
  const [plan, setPlan] = useState<CapturePlan>();
  const [capturedIndexes, setCapturedIndexes] = useState<Set<number>>(new Set());
  const [frames, setFrames] = useState<FrameSummary[]>([]);
  const [thumbVersion, setThumbVersion] = useState(0);
  const [dwell, setDwell] = useState(0);
  const [message, setMessage] = useState("");
  const [lastRejected, setLastRejected] = useState<string | null>(null);
  const [flash, setFlash] = useState<"ok" | "bad" | null>(null);
  const [paused, setPaused] = useState(false);
  const [needsMove, setNeedsMove] = useState(false);
  const [retake, setRetake] = useState<{ frameId: string; checkpoint: number } | null>(null);
  const [cameraInfo, setCameraInfo] = useState<{ label: string; width: number; height: number; exposureLocked: boolean } | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [roomGate, setRoomGate] = useState<RoomGate>({ ok: true, blocking: [], recommended: [], info: [] });
  const [astraReview, setAstraReview] = useState<AstraCaptureReview>();
  const [astraBusy, setAstraBusy] = useState(false);
  const [astraError, setAstraError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [consent, setConsent] = useState<{ room: Room; estimate: ReconstructionEstimate | null; loading: boolean; error: string | null } | null>(null);
  const [views, setViews] = useState<Record<string, RoomView | undefined>>({});
  const [preview, setPreview] = useState<{ open: boolean; roomId?: string }>({ open: false });
  const [splat, setSplat] = useState<{ artifact: PublicArtifact; room: Room } | null>(null);
  const [tourEditor, setTourEditor] = useState(false);
  const [tour, setTour] = useState<TourManifest | null>(null);
  const [links, setLinks] = useState<TourLinkRecord[]>([]);
  const [resultsMessage, setResultsMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [demo, setDemo] = useState(false);

  const orientationHook = useOrientation(phase === "capturing" || phase === "permissions");
  const { orientation, motion, requestPermission, reset: resetOrientation, latest, latestSpeed } = orientationHook;
  const hasGyro = motion === "granted" ? true : motion === "unavailable" || motion === "denied" ? false : null;

  const activeRoom = session?.rooms.find((room) => room.id === session.activeRoomId);
  const activeMode: CaptureMode = activeRoom?.mode ?? session?.mode ?? mode;
  const nextIndex = plan ? (retake ? retake.checkpoint : nextTargetIndex(plan, capturedIndexes)) : undefined;
  const target: PlanTarget | undefined = plan && nextIndex !== undefined ? plan.targets[nextIndex] : undefined;
  const station = plan && target ? plan.stations[target.station] : undefined;
  const isMobile = useMemo(() => (typeof navigator !== "undefined" ? /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) : false), []);
  const savedRemotely = Boolean(session?.serverKnown);

  const updateRoom = useCallback((id: string, change: (room: Room) => Room) => setSession((old) => (old ? { ...old, rooms: old.rooms.map((room) => (room.id === id ? change(room) : room)) } : old)), []);
  const thumbsMap = useMemo(() => new Map(thumbUrls.current), [thumbVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------ boot
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "1") setDemo(true);
    if (params.get("mode") === "quick") setMode("quick");
    configureTelemetry(sessionToken);
    if (supabaseConfigured) {
      void sessionToken().then((token) => setSignedIn(Boolean(token)));
      void import("@/lib/supabase/client").then(({ browserSupabase }) => browserSupabase().auth.onAuthStateChange((_event: string, s: unknown) => setSignedIn(Boolean(s))));
    }
    void unfinishedSession()
      .then(async (saved) => {
        if (saved && params.get("demo") !== "1") setResumable({ session: saved, frames: await sessionFrameCount(saved.id).catch(() => 0) });
      })
      .finally(() => setPhase("welcome"));
    return () => {
      stopCamera();
      for (const url of thumbUrls.current.values()) URL.revokeObjectURL(url);
      for (const url of panoramaUrls.current) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (session) void saveSession({ ...session, phase });
  }, [session, phase]);

  // Frames for the active room (metadata only) + thumbnails as object URLs.
  const refreshFrames = useCallback(async (roomId: string) => {
    const list = await roomFrames(roomId);
    for (const frame of list) {
      if (!thumbUrls.current.has(frame.id) && frame.thumb) thumbUrls.current.set(frame.id, URL.createObjectURL(frame.thumb));
    }
    setThumbVersion((v) => v + 1);
    setFrames(list.map((frame) => ({ id: frame.id, checkpoint: frame.metadata.checkpoint.index, timestamp: frame.metadata.timestamp, score: frame.quality?.score, findings: frame.quality?.findings, uploaded: Boolean(frame.upload && "completedAt" in frame.upload), retakeOf: frame.retakeOf, yaw: frame.metadata.yaw, pitch: frame.metadata.pitch })));
    setCapturedIndexes(new Set(list.map((frame) => frame.metadata.checkpoint.index)));
    return list;
  }, []);

  const attachPanoramas = useCallback(async (s: ScanSession) => {
    try {
      const stored = await sessionPanoramas(s.id);
      for (const sp of stored) {
        const room = s.rooms.find((r) => r.id === sp.roomId);
        if (!room) continue;
        room.panoramaUrl = URL.createObjectURL(sp.panorama);
        panoramaUrls.current.push(room.panoramaUrl);
        if (sp.filledPanorama) {
          room.panoramaAiUrl = URL.createObjectURL(sp.filledPanorama);
          panoramaUrls.current.push(room.panoramaAiUrl);
        }
      }
    } catch {}
    return s;
  }, []);

  // ------------------------------------------------------------------ camera
  const stopCamera = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    trackRef.current = null;
  };

  const openCamera = async (): Promise<boolean> => {
    setPermissionError(null);
    setRequesting(true);
    try {
      const motionState = await requestPermission();
      if (motionState === "denied") track("permission_denied", { kind: "motion" });
      const s = await openRearCamera();
      stream.current = s;
      const videoTrack = s.getVideoTracks()[0];
      trackRef.current = videoTrack;
      await prepareTrack(videoTrack);
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      setCameraInfo({ ...describeTrack(videoTrack, false), label: videoTrack.label.slice(0, 60) });
      return true;
    } catch (err) {
      const name = (err as DOMException)?.name;
      track("permission_denied", { kind: "camera", reason: name ?? "unknown" });
      setPermissionError(name === "NotAllowedError" || name === "SecurityError" ? t("denied") : name === "NotFoundError" || name === "OverconstrainedError" ? t("noCamera") : t("cameraBusy"));
      return false;
    } finally {
      setRequesting(false);
    }
  };

  // ------------------------------------------------------------------ flow: start
  const beginNewSession = (chosenMode: CaptureMode, chosenSize: RoomSize) => {
    const s = newSession(roomName(1), chosenMode, chosenSize);
    setSession(s);
    setMode(chosenMode);
    setSize(chosenSize);
    setPlan(undefined);
    setCapturedIndexes(new Set());
    setFrames([]);
    setViews({});
    setTour(null);
    setResumable(null);
    setPhase("permissions");
  };

  const continueSession = async () => {
    if (!resumable) return;
    const s = await attachPanoramas(resumable.session);
    setSession(s);
    setMode(s.mode ?? "full3d");
    const room = s.rooms.find((r) => r.id === s.activeRoomId);
    const list = room ? await refreshFrames(room.id) : [];
    setResumable(null);
    track("session_resumed", { rooms: s.rooms.length, frames: resumable.frames }, { sessionId: s.id });
    if (room && room.planStartYaw !== undefined) setPlan(planFor(room.mode ?? s.mode ?? "full3d", room.planStartYaw, DEFAULT_FOV, { size: room.size }));
    if (!room || room.status === "complete" || room.status === "processing" || room.status === "uploaded") setPhase("results");
    else if (room.status === "review") {
      computeGate(room, list.length, list.filter((f) => f.quality?.findings?.some((x) => x.severity === "retake")).length);
      setPhase("review");
    } else if (room.status === "confirmed" || room.status === "uploading") setPhase("saving");
    else setPhase("permissions");
  };

  const startOver = async () => {
    if (!resumable) return;
    // Recoverable: the old session's frames stay until the next "start over"; only the session record is superseded.
    await saveSession({ ...resumable.session, phase: "abandoned", rooms: resumable.session.rooms.map((room) => ({ ...room, status: room.captured ? "complete" : "failed" })) });
    track("session_reset", {}, { sessionId: resumable.session.id });
    setResumable(null);
    setPhase("welcome");
  };

  const enterPermissions = async () => {
    const ok = await openCamera();
    if (!ok) return;
  };

  const afterPermissions = () => {
    if (session && session.rooms.some((room) => room.captured > 0)) startCapturing();
    else setPhase("tutorial");
  };

  const startCapturing = () => {
    if (!activeRoom) return;
    gate.current = new AlignmentGate(activeMode === "full3d" ? 5 : 4, activeMode === "full3d" ? 300 : 350);
    resetOrientation();
    previousFrame.current = undefined;
    setPaused(false);
    setNeedsMove(false);
    setLastRejected(null);
    setMessage(t("hold"));
    if (!captureTimer.current) captureTimer.current = stopwatch();
    if (!activeRoom.captured) track("capture_started", { mode: activeMode, size: activeRoom.size ?? "normal", ...deviceSummary() }, { sessionId: session?.id, roomId: activeRoom.id });
    setPhase("capturing");
  };

  // Plan once the first heading is known (or immediately without sensors).
  useEffect(() => {
    if (phase !== "capturing" || plan || !activeRoom) return;
    const yaw = orientation?.yaw ?? (hasGyro === false ? 0 : undefined);
    if (yaw === undefined) return;
    const created = planFor(activeMode, activeRoom.planStartYaw ?? yaw, DEFAULT_FOV, { size: activeRoom.size ?? size });
    setPlan(created);
    updateRoom(activeRoom.id, (room) => ({ ...room, targetCount: created.targets.length, planStartYaw: room.planStartYaw ?? yaw, mode: activeMode }));
    if (created.mode === "full3d" && !activeRoom.captured) setNeedsMove(true);
  }, [phase, plan, orientation?.yaw, hasGyro, activeRoom, activeMode, size, updateRoom]);

  // Lock exposure once the first frame of a room is taken so the rest match.
  const lockedFor = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== "capturing" || !activeRoom || activeRoom.captured < 1 || lockedFor.current === activeRoom.id || !trackRef.current) return;
    lockedFor.current = activeRoom.id;
    void lockExposure(trackRef.current).then((locked) => setCameraInfo((info) => (info ? { ...info, exposureLocked: locked } : info)));
  }, [phase, activeRoom]);

  // ------------------------------------------------------------------ capture
  const capture = useCallback(
    async (pose: Orientation, manual = false) => {
      if (!video.current || !session || !activeRoom || !target || capturing.current || video.current.videoWidth === 0 || !trackRef.current) return;
      capturing.current = true;
      const timestamp = Date.now();
      try {
        const { thumbnail, rgba, graySize } = previewAndGray(video.current);
        const gray = toGray(rgba, graySize, graySize);
        const metrics = computeMetrics(gray);
        const still = await grabStill(trackRef.current, video.current);
        const findings = checkFrame({ metrics, width: still.width, height: still.height, mimeType: still.blob.type || "image/jpeg", previous: previousFrame.current, gray, orientation: pose, timestamp, angularSpeed: latestSpeed.current, mode: activeMode });
        const severity = worst(findings);
        if (severity === "blocking" && !manual) {
          const first = findings.find((f) => f.severity === "blocking")!;
          setLastRejected(t.has(`rejected.${first.code}`) ? t(`rejected.${first.code}`) : t("rejected.generic"));
          window.clearTimeout(rejectTimer.current);
          rejectTimer.current = window.setTimeout(() => setLastRejected(null), 2_500);
          setFlash("bad");
          window.setTimeout(() => setFlash(null), 160);
          track("frame_rejected", { code: first.code, value: first.value ?? null }, { sessionId: session.id, roomId: activeRoom.id });
          gate.current.reset();
          return;
        }
        const id = crypto.randomUUID();
        const score = qualityScore(metrics, findings);
        const metadata: FrameMetadata = { id, roomId: activeRoom.id, sessionId: session.id, ...pose, fov: DEFAULT_FOV, timestamp: new Date(timestamp).toISOString(), checkpoint: { index: target.index, ring: target.ring, yaw: target.yaw, pitch: target.pitch, elevation: target.elevation }, width: still.width, height: still.height, mimeType: "image/jpeg", captureMode: activeMode, stationIndex: target.station, qualityScore: score, source: still.source };
        const thumb = await thumbnail;
        await saveFrame({ id, metadata, jpeg: still.blob, thumb, quality: { metrics, findings, score }, retakeOf: retake?.frameId });
        if (retake) {
          await deleteFrame(retake.frameId).catch(() => undefined);
          const old = thumbUrls.current.get(retake.frameId);
          if (old) URL.revokeObjectURL(old);
          thumbUrls.current.delete(retake.frameId);
          track("retake_requested", { checkpoint: retake.checkpoint, completed: true }, { sessionId: session.id, roomId: activeRoom.id });
        }
        thumbUrls.current.set(id, URL.createObjectURL(thumb));
        setThumbVersion((v) => v + 1);
        previousFrame.current = { metrics, gray, orientation: pose, timestamp };
        setCapturedIndexes((set) => new Set([...set, target.index]));
        setFrames((list) => [...list.filter((f) => f.id !== retake?.frameId), { id, checkpoint: target.index, timestamp: metadata.timestamp, score, findings, uploaded: false, retakeOf: retake?.frameId, yaw: pose.yaw, pitch: pose.pitch }]);
        updateRoom(activeRoom.id, (room) => ({ ...room, captured: retake ? room.captured : room.captured + 1, camera: cameraInfo ? { deviceLabel: cameraInfo.label, width: still.width, height: still.height, exposureLocked: cameraInfo.exposureLocked, focusMode: null, torch: false, zoom: null, facing: null } : room.camera }));
        track("frame_accepted", { checkpoint: target.index, score, severity, width: still.width, height: still.height, source: still.source }, { sessionId: session.id, roomId: activeRoom.id });
        gate.current.reset();
        setFlash("ok");
        window.setTimeout(() => setFlash(null), 120);
        try {
          navigator.vibrate?.(severity === "retake" ? [20, 40, 20] : 25);
        } catch {}
        if (severity === "retake") {
          const soft = findings.find((f) => f.severity === "retake")!;
          setLastRejected(t.has(`soft.${soft.code}`) ? t(`soft.${soft.code}`) : t("soft.generic"));
          window.clearTimeout(rejectTimer.current);
          rejectTimer.current = window.setTimeout(() => setLastRejected(null), 2_000);
        }
        if (retake) {
          setRetake(null);
          setPhase("review");
          return;
        }
        const following = plan?.targets[nextTargetIndex(plan, new Set([...capturedIndexes, target.index])) ?? -1];
        if (following?.move) setNeedsMove(true);
      } catch (err) {
        setMessage(err instanceof Error && err.name === "QuotaExceededError" ? t("storageFull") : t("captureFailed"));
      } finally {
        capturing.current = false;
      }
    },
    [activeRoom, activeMode, cameraInfo, capturedIndexes, latestSpeed, plan, retake, session, t, target, updateRoom],
  );

  // Alignment loop: 60 ms tick reading the latest orientation (no per-event React renders).
  useEffect(() => {
    if (phase !== "capturing" || paused || needsMove || !plan || !target) return;
    const tick = () => {
      const next = latest.current;
      if (!next) return;
      const view = projectTarget(next, target);
      const now = performance.now();
      const speed = latestSpeed.current;
      const reading = gate.current.update(speed > 70 ? Number.POSITIVE_INFINITY : view.angularDistance, now);
      setDwell(reading.progress);
      if (reading.triggered) void capture(next);
      if (reading.aligned) setMessage(t("hold"));
      else if (speed > 70) setMessage(t("slower"));
      else if (!view.inFront || Math.abs(view.x) > Math.abs(view.y)) setMessage(view.x > 0 ? t("turnRight") : t("turnLeft"));
      else setMessage(view.y > 0 ? t("tiltUp") : t("tiltDown"));
    };
    const id = window.setInterval(tick, 60);
    return () => window.clearInterval(id);
  }, [phase, paused, needsMove, plan, target, capture, latest, latestSpeed, t]);

  // Pause automatically when the page is hidden (call, lock screen) and keep the camera alive.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && phase === "capturing") setPaused(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [phase]);

  // Room complete when every planned target is captured (retake mode excluded).
  useEffect(() => {
    if (phase === "capturing" && plan && !retake && nextIndex === undefined && capturedIndexes.size > 0) void finishRoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, plan, nextIndex, retake]);

  const manualCapture = () => {
    const pose = latest.current ?? { yaw: target?.yaw ?? 0, pitch: target?.pitch ?? 0, roll: 0 };
    void capture(pose, true);
  };

  const marker = useMemo(() => {
    if (!orientation || !target || typeof window === "undefined") return undefined;
    const view = projectTarget(orientation, target);
    const f = focalLength(window.innerWidth, window.innerHeight, DEFAULT_FOV);
    const z = Math.max(view.z, 0.15);
    return { left: Math.max(24, Math.min(window.innerWidth - 24, window.innerWidth / 2 + (view.x / z) * f)), top: Math.max(120, Math.min(window.innerHeight - 200, window.innerHeight / 2 - (view.y / z) * f)), visible: view.inFront, near: view.angularDistance < 5 };
  }, [orientation, target]);

  // ------------------------------------------------------------------ checking / review
  const computeGate = useCallback(
    (room: Room, frameCount: number, retakeCount: number) => {
      const p = plan;
      const captured = frames.map((f) => ({ yaw: f.yaw, elevation: -f.pitch }));
      const gaps = p ? coverageGaps(p, captured) : { missingHorizonSectors: [], ceiling: false, floor: false };
      const progress = p ? planProgress(p, capturedIndexes) : { missing: [], total: 0 };
      const gateResult = checkRoom({ mode: room.mode ?? activeMode, frameCount, minFrames: minimumFrames(room.mode ?? activeMode), maxFrames: PLAN_LIMITS.full3dMax, retakeCount, missingTargets: progress.missing.length, totalTargets: progress.total, missingHorizonSectors: gaps.missingHorizonSectors.length, supportedFormats: true });
      setRoomGate(gateResult);
      updateRoom(room.id, (r) => ({ ...r, gate: { blocking: gateResult.blocking, recommended: gateResult.recommended, info: gateResult.info } }));
      return gateResult;
    },
    [plan, frames, capturedIndexes, activeMode, updateRoom],
  );

  /** Stitches the on-device preview panorama for a room (quick: all frames; full 3D: the first interior station). */
  const stitchRoom = useCallback(
    async (room: Room, sessionId: string, width = PREVIEW_WIDTH) => {
      const all = await roomFrames(room.id);
      const interior = all.filter((f) => f.metadata.stationIndex !== undefined && plan?.stations[f.metadata.stationIndex]?.kind === "interior");
      const firstInterior = interior.length ? interior.filter((f) => f.metadata.stationIndex === interior[0].metadata.stationIndex) : [];
      const chosen = room.mode === "full3d" && firstInterior.length >= 6 ? firstInterior : all;
      if (chosen.length < 2) return undefined;
      setProgressText(t("stitching"));
      const stop = stopwatch();
      const out = await stitchFrames(
        chosen.map((f) => ({ blob: f.jpeg, yaw: f.metadata.yaw, elevation: -f.metadata.pitch, roll: f.metadata.roll })),
        { fov: DEFAULT_FOV, width: Math.min(width, maxStitchWidth()), onProgress: (d, n) => setProgressText(`${t("stitching")} ${d}/${n}`) },
      );
      await savePanorama({ roomId: room.id, sessionId, panorama: out.panorama, mask: out.mask, coverage: out.coverage, width: out.width, height: out.height, filled: false, createdAt: new Date().toISOString() });
      const url = URL.createObjectURL(out.panorama);
      panoramaUrls.current.push(url);
      updateRoom(room.id, (r) => ({ ...r, panoramaUrl: url }));
      track("panorama_stitched", { frames: out.frames, coverage: out.coverage, width: out.width, durationMs: stop(), measured: out.durationMs }, { sessionId, roomId: room.id });
      setProgressText(null);
      return out;
    },
    [plan, t, updateRoom],
  );

  const finishRoom = async () => {
    if (!session || !activeRoom) return;
    setPhase("checking");
    setPaused(true);
    const list = await refreshFrames(activeRoom.id);
    const retakeCount = list.filter((f) => f.quality?.findings?.some((x) => x.severity === "retake")).length;
    computeGate(activeRoom, list.length, retakeCount);
    track("room_completed", { frames: list.length, retakeCandidates: retakeCount, durationMs: captureTimer.current?.() ?? null, mode: activeMode }, { sessionId: session.id, roomId: activeRoom.id });
    captureTimer.current = undefined;
    try {
      if (list.length >= 2) await stitchRoom(activeRoom, session.id);
    } catch (err) {
      setProgressText(null);
      setResultsMessage(err instanceof Error && /WebGL/i.test(err.message) ? t("noWebgl") : t("stitchFailed"));
    }
    updateRoom(activeRoom.id, (room) => ({ ...room, status: "review" }));
    setPhase("review");
  };

  const runAstra = async () => {
    if (!activeRoom || !session) return;
    setAstraBusy(true);
    setAstraError(null);
    track("quality_review_requested", { frames: frames.length }, { sessionId: session.id, roomId: activeRoom.id });
    try {
      const list = await roomFrames(activeRoom.id);
      // Sample: the four weakest frames plus four evenly spaced ones, thumbnails only.
      const byScore = [...list].sort((a, b) => (a.quality?.score ?? 1) - (b.quality?.score ?? 1)).slice(0, 4);
      const spaced = list.filter((_, i) => i % Math.max(1, Math.floor(list.length / 4)) === 0).slice(0, 4);
      const sample = [...new Map([...byScore, ...spaced].map((f) => [f.id, f])).values()].slice(0, 8);
      const images = await Promise.all(sample.map((f) => blobToDataUrl(f.thumb ?? f.jpeg)));
      const localFindings = [...new Set(list.flatMap((f) => f.quality?.findings?.filter((x) => x.severity !== "info").map((x) => x.code) ?? []))].slice(0, 12);
      const review = await reviewCapture({ roomName: activeRoom.name, captured: list.length, targetCount: plan?.targets.length ?? activeRoom.targetCount, images, captureMode: activeMode, localFindings, locale });
      setAstraReview(review);
      updateRoom(activeRoom.id, (room) => ({ ...room, review }));
    } catch (err) {
      setAstraError(err instanceof Error && /sign in|authentication/i.test(err.message) ? t("review.signInForAstra") : t("review.astraFailed"));
    } finally {
      setAstraBusy(false);
    }
  };

  const retakeFrame = (frameId: string, checkpoint: number) => {
    if (!session || !activeRoom) return;
    track("retake_requested", { checkpoint, completed: false }, { sessionId: session.id, roomId: activeRoom.id });
    setRetake({ frameId, checkpoint });
    setAstraReview(undefined);
    startCapturing();
  };

  const addMoreFrames = () => {
    setRetake(null);
    setAstraReview(undefined);
    startCapturing();
  };

  const discardRoom = async () => {
    if (!session || !activeRoom) return;
    if (!window.confirm(t("review.discardConfirm"))) return;
    await deleteRoomFrames(activeRoom.id);
    await deletePanorama(activeRoom.id).catch(() => undefined);
    setSession((old) => {
      if (!old) return old;
      const rooms = old.rooms.filter((r) => r.id !== activeRoom.id);
      const room = newRoom(roomName(rooms.length + 1), activeMode, size);
      return { ...old, rooms: [...rooms, room], activeRoomId: room.id };
    });
    setPlan(undefined);
    setCapturedIndexes(new Set());
    setFrames([]);
    setAstraReview(undefined);
    startCapturing();
  };

  const confirmRoom = () => {
    if (!session || !activeRoom) return;
    updateRoom(activeRoom.id, (room) => ({ ...room, status: "confirmed", confirmedAt: new Date().toISOString(), reviewOverridden: roomGate.recommended.length > 0 || astraReview?.verdict === "retake" }));
    stopCamera();
    setPhase("saving");
  };

  // ------------------------------------------------------------------ saving
  const [saveState, setSaveState] = useState<{ done: number; total: number; failed: number } | null>(null);

  const saveRoom = useCallback(
    async (room: Room, s: ScanSession): Promise<boolean> => {
      setBusy("saving");
      setResultsMessage(null);
      const stop = stopwatch();
      try {
        await httpScannerBackend.createScan(s.id, s.propertyName);
        for (const [index, r] of s.rooms.entries()) await httpScannerBackend.createRoom(s.id, r.id, r.name, index + 1, r.targetCount, r.mode ?? s.mode);
        updateRoom(room.id, (r) => ({ ...r, status: "uploading" }));
        track(room.uploaded ? "upload_resumed" : "upload_started", { frames: room.captured }, { sessionId: s.id, roomId: room.id });
        const result = await uploadRoom(room.id, { concurrency: 3, onProgress: (p) => setSaveState({ done: p.done, total: p.total, failed: p.failed }) });
        updateRoom(room.id, (r) => ({ ...r, uploaded: result.keys.length }));
        const stored = await loadPanorama(room.id);
        if (stored && !stored.uploaded?.original) {
          await httpScannerBackend.uploadPanorama(s.id, room.id, "stitched_original", stored.panorama, { width: stored.width, height: stored.height, coverage: stored.coverage });
          await httpScannerBackend.uploadPanorama(s.id, room.id, "coverage_mask", stored.mask, { width: stored.width, height: stored.height, coverage: stored.coverage });
          if (stored.filledPanorama) await httpScannerBackend.uploadPanorama(s.id, room.id, "ai_completed", stored.filledPanorama, { width: stored.width, height: stored.height, coverage: 1 });
          await savePanorama({ ...stored, uploaded: { original: new Date().toISOString(), mask: new Date().toISOString(), filled: stored.filledPanorama ? new Date().toISOString() : undefined } });
        }
        if (result.failed.length) {
          setResultsMessage(t("saving.partial", { failed: result.failed.length }));
          updateRoom(room.id, (r) => ({ ...r, status: "confirmed" }));
          return false;
        }
        updateRoom(room.id, (r) => ({ ...r, status: "uploaded" }));
        setSession((old) => (old ? { ...old, serverKnown: true } : old));
        track("room_completed", { uploaded: result.keys.length, uploadMs: stop() }, { sessionId: s.id, roomId: room.id });
        return true;
      } catch (err) {
        if (err instanceof BackendError && err.code === "authentication_required") {
          setSignInOpen(true);
        } else if (err instanceof BackendError && err.code === "backend_unconfigured") {
          setResultsMessage(t("saving.unavailable"));
        } else setResultsMessage(t("saving.failed"));
        updateRoom(room.id, (r) => ({ ...r, status: "confirmed" }));
        return false;
      } finally {
        setBusy(null);
        setSaveState(null);
      }
    },
    [t, updateRoom],
  );

  // Entering "saving": ask for sign-in if needed, otherwise upload straight away.
  useEffect(() => {
    if (phase !== "saving" || !session || !activeRoom || busy) return;
    if (!supabaseConfigured) {
      updateRoom(activeRoom.id, (r) => ({ ...r, status: "complete" }));
      setPhase("results");
      return;
    }
    if (!signedIn) {
      setSignInOpen(true);
      return;
    }
    if (activeRoom.status === "uploaded") return;
    void saveRoom(activeRoom, session).then((ok) => {
      if (ok) openConsent(activeRoom);
      else setPhase("results");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, signedIn, activeRoom?.status, busy]);

  const skipSaving = () => {
    setSignInOpen(false);
    if (activeRoom) updateRoom(activeRoom.id, (r) => ({ ...r, status: r.status === "confirmed" ? "complete" : r.status }));
    setPhase("results");
  };

  // ------------------------------------------------------------------ reconstruction
  const openConsent = async (room: Room) => {
    setConsent({ room, estimate: null, loading: true, error: null });
    try {
      const estimate = await httpScannerBackend.estimate(room.id);
      setConsent({ room, estimate, loading: false, error: null });
    } catch (err) {
      setConsent({ room, estimate: null, loading: false, error: err instanceof BackendError && err.code === "backend_unconfigured" ? t("consent.notAvailable") : t("consent.estimateFailed") });
    }
    setPhase("results");
  };

  const startReconstruction = async (providers: ProviderId[], options: { wantMesh: boolean }) => {
    if (!consent || !session) return;
    const room = consent.room;
    setConsent(null);
    setBusy(room.id);
    try {
      const result = await httpScannerBackend.startReconstruction(session.id, room.id, providers, options);
      track("reconstruction_submitted", { providers: providers.join(","), jobs: result.jobs.length }, { sessionId: session.id, roomId: room.id });
      updateRoom(room.id, (r) => ({ ...r, status: "processing", jobs: Object.fromEntries(result.jobs.map((job) => [job.provider, { id: job.id, status: job.status, updatedAt: job.updatedAt }])) }));
      setSession((old) => (old ? { ...old, consent: { aiProcessing: new Date().toISOString(), paid: new Date().toISOString() } } : old));
      if (result.skipped.length) setResultsMessage(t("consent.skipped", { reasons: result.skipped.map((s) => (t.has(`consent.unavailable.${s.reason}`) ? t(`consent.unavailable.${s.reason}`) : s.reason)).join(", ") }));
      await refreshView(room.id);
    } catch (err) {
      setResultsMessage(err instanceof BackendError && t.has(`consent.errors.${err.code}`) ? t(`consent.errors.${err.code}`) : t("consent.startFailed"));
    } finally {
      setBusy(null);
    }
  };

  const refreshView = useCallback(async (roomId: string) => {
    try {
      const view = await httpScannerBackend.roomView(roomId);
      setViews((old) => {
        const previous = old[roomId];
        for (const job of view.jobs) {
          const before = previous?.jobs.find((j) => j.id === job.id)?.status;
          if (before && before !== job.status) track("provider_status_changed", { provider: job.provider, from: before, to: job.status }, { roomId });
          if (before && before !== job.status && job.status === "ready") track("processing_completed", { provider: job.provider }, { roomId });
          if (before && before !== job.status && (job.status === "failed" || job.status === "expired")) track("processing_failed", { provider: job.provider, code: job.failureCode }, { roomId });
        }
        return { ...old, [roomId]: view };
      });
      updateRoom(roomId, (room) => ({ ...room, status: view.status === "ready" || view.status === "partially_ready" ? "complete" : view.status === "failed" || view.status === "expired" ? "failed" : view.jobs.length ? "processing" : room.status }));
    } catch {}
  }, [updateRoom]);

  // Poll room views while any job is active and the page is visible.
  useEffect(() => {
    if (phase !== "results" || !session || !signedIn || !savedRemotely) return;
    const roomsToPoll = session.rooms.filter((room) => room.status === "processing" || room.status === "uploaded" || (room.jobs && Object.keys(room.jobs).length));
    if (!roomsToPoll.length) return;
    let cancelled = false;
    const run = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      roomsToPoll.forEach((room) => void refreshView(room.id));
    };
    run();
    const id = window.setInterval(run, ROOM_POLL_MS);
    document.addEventListener("visibilitychange", run);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", run);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, signedIn, savedRemotely, session?.rooms.map((r) => `${r.id}:${r.status}`).join("|")]);

  // ------------------------------------------------------------------ results actions
  const completePanorama = async (room: Room) => {
    if (!session) return;
    setBusy(room.id);
    setProgressText(t("filling"));
    try {
      const stored = await loadPanorama(room.id);
      if (!stored) return;
      const filled = await aiFillPanorama(stored.panorama, stored.mask, Math.max(2048, stored.width));
      await savePanorama({ ...stored, filled: true, filledPanorama: filled.panorama, filledAt: new Date().toISOString() });
      const url = URL.createObjectURL(filled.panorama);
      panoramaUrls.current.push(url);
      updateRoom(room.id, (r) => ({ ...r, panoramaAiUrl: url }));
      if (savedRemotely) await httpScannerBackend.uploadPanorama(session.id, room.id, "ai_completed", filled.panorama, { width: filled.width, height: filled.height, coverage: 1 }).catch(() => undefined);
    } catch (err) {
      setResultsMessage(err instanceof Error && /sign in|authentication/i.test(err.message) ? t("results.signInForFill") : t("results.fillFailed"));
    } finally {
      setBusy(null);
      setProgressText(null);
    }
  };

  const addRoom = () => {
    if (!session) return;
    const room = newRoom(roomName(session.rooms.length + 1), activeMode, size);
    setSession({ ...session, rooms: [...session.rooms, room], activeRoomId: room.id });
    setPlan(undefined);
    setCapturedIndexes(new Set());
    setFrames([]);
    setAstraReview(undefined);
    setRetake(null);
    setPhase("mode");
  };

  const exportFrames = async () => {
    if (!session) return;
    setBusy("export");
    try {
      const entries: ZipEntry[] = [];
      const rooms: Array<Record<string, unknown>> = [];
      for (const [ri, room] of session.rooms.entries()) {
        const list = await roomFrames(room.id);
        const dir = `room-${String(ri + 1).padStart(2, "0")}`;
        const files: Array<Record<string, unknown>> = [];
        for (const [fi, frame] of list.entries()) {
          const file = `${dir}/frame-${String(fi + 1).padStart(3, "0")}.jpg`;
          entries.push({ name: file, data: new Uint8Array(await frame.jpeg.arrayBuffer()) });
          const m = frame.metadata;
          files.push({ file, yaw: m.yaw, pitch: m.pitch, roll: m.roll, elevation: m.checkpoint.elevation, checkpoint: m.checkpoint, station: m.stationIndex, timestamp: m.timestamp, width: m.width, height: m.height, quality: frame.quality?.score });
        }
        rooms.push({ id: room.id, name: room.name, mode: room.mode, fov: DEFAULT_FOV, targetCount: room.targetCount, frames: files });
        const pano = await loadPanorama(room.id);
        if (pano) {
          entries.push({ name: `${dir}/panorama-original.jpg`, data: new Uint8Array(await pano.panorama.arrayBuffer()) }, { name: `${dir}/coverage-mask.png`, data: new Uint8Array(await pano.mask.arrayBuffer()) });
          if (pano.filledPanorama) entries.push({ name: `${dir}/panorama-ai-completed.jpg`, data: new Uint8Array(await pano.filledPanorama.arrayBuffer()) });
        }
      }
      const manifest = { schema: "sodar-frames.v2", sessionId: session.id, exportedAt: new Date().toISOString(), device: deviceSummary(), rooms, provenance: { "panorama-original.jpg": "captured", "panorama-ai-completed.jpg": "ai_generated_completion", "coverage-mask.png": "white = not captured" } };
      entries.push({ name: "frames.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
      const url = URL.createObjectURL(buildZip(entries));
      const a = document.createElement("a");
      a.href = url;
      a.download = `sodar-scan-${session.id.slice(0, 8)}.zip`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } finally {
      setBusy(null);
    }
  };

  const restart = () => {
    if (session && session.rooms.some((room) => room.captured > 0) && !window.confirm(t("results.restartConfirm"))) return;
    for (const url of panoramaUrls.current) URL.revokeObjectURL(url);
    panoramaUrls.current = [];
    for (const url of thumbUrls.current.values()) URL.revokeObjectURL(url);
    thumbUrls.current.clear();
    setSession(undefined);
    setPlan(undefined);
    setFrames([]);
    setCapturedIndexes(new Set());
    setViews({});
    setTour(null);
    setResultsMessage(null);
    setPhase("welcome");
  };

  const deleteEverything = async () => {
    if (!session) return;
    setBusy("delete");
    try {
      if (savedRemotely) await httpScannerBackend.deleteScan(session.id);
      for (const room of session.rooms) {
        await deleteRoomFrames(room.id);
        await deletePanorama(room.id).catch(() => undefined);
      }
      await deleteSession(session.id);
      setConfirmDelete(false);
      setResultsMessage(t("results.deleted"));
      restart();
    } catch {
      setResultsMessage(t("results.deleteFailed"));
    } finally {
      setBusy(null);
    }
  };

  const loadTour = useCallback(async () => {
    if (!session) return;
    if (savedRemotely && signedIn) {
      try {
        const remote = await httpScannerBackend.getLinks(session.id);
        setLinks(remote);
      } catch {}
    }
    const rooms = session.rooms.filter((room) => room.panoramaUrl);
    const confirmed = (links.length ? links : session.links ?? []).filter((l) => l.confirmed);
    setTour(buildTour({ scanId: session.id, propertyName: session.propertyName, rooms: rooms.map((room, i) => ({ id: room.id, name: room.name, ordinal: i + 1, floor: room.floor, panorama: room.panoramaUrl!, panoramaProvenance: "captured" })), links: mergeLinks(provisionalLinks(rooms.map((r) => r.id)), confirmed) }));
  }, [session, savedRemotely, signedIn, links]);

  useEffect(() => {
    if (phase === "results") void loadTour();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, session?.rooms.map((r) => r.panoramaUrl).join("|"), links.length]);

  const saveLinks = async (next: TourLinkRecord[]) => {
    if (!session) return;
    setSession({ ...session, links: next.map((l) => ({ fromRoomId: l.fromRoomId, toRoomId: l.toRoomId, yaw: l.yaw, pitch: l.pitch, confirmed: true })) });
    const saved = savedRemotely ? await httpScannerBackend.saveLinks(session.id, next) : next;
    setLinks(saved);
  };

  // ------------------------------------------------------------------ demo (?demo=1): stitch the bundled room without a camera
  useEffect(() => {
    if (!demo || phase !== "welcome" || session) return;
    let cancelled = false;
    (async () => {
      const s = newSession(roomName(1), "quick", "normal");
      setSession(s);
      setProgressText(t("stitching"));
      const manifest = (await fetch("/media/demo-frames/frames.json").then((r) => r.json())) as { fov: { horizontal: number; vertical: number }; frames: Array<{ file: string; yaw: number; elevation: number; roll: number }> };
      const room = s.rooms[0];
      let index = 0;
      for (const f of manifest.frames) {
        const jpeg = await fetch(`/media/demo-frames/${f.file}`).then((r) => r.blob());
        const id = crypto.randomUUID();
        const metadata: FrameMetadata = { id, roomId: room.id, sessionId: s.id, yaw: f.yaw, pitch: -f.elevation, roll: f.roll, fov: manifest.fov, timestamp: new Date().toISOString(), checkpoint: { index, ring: 0, yaw: f.yaw, pitch: -f.elevation, elevation: f.elevation }, width: 480, height: 640, mimeType: "image/jpeg", captureMode: "quick" };
        await saveFrame({ id, metadata, jpeg });
        index++;
      }
      if (cancelled) return;
      const done = { ...room, captured: manifest.frames.length, targetCount: manifest.frames.length, status: "complete" as const };
      setSession({ ...s, rooms: [done] });
      await stitchRoom(done, s.id);
      if (cancelled) return;
      setPhase("results");
      setPreview({ open: true, roomId: done.id });
    })().catch(() => setResultsMessage(t("stitchFailed")));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, phase]);

  // ------------------------------------------------------------------ render
  const previewRooms: PreviewRoom[] = (session?.rooms ?? []).filter((room) => room.panoramaUrl).map((room) => ({ id: room.id, name: room.name, panorama: room.panoramaUrl!, panoramaAi: room.panoramaAiUrl ?? null }));
  const showVideo = phase === "permissions" || phase === "capturing" || phase === "checking";
  const canFinish = capturedIndexes.size >= (retake ? 0 : Math.min(minimumFrames(activeMode), 6));

  return (
    <main className="relative min-h-dvh overflow-hidden bg-bg text-text">
      <video ref={video} playsInline muted autoPlay className={`absolute inset-0 h-full w-full object-cover transition-opacity ${showVideo ? "opacity-100" : "opacity-0"}`} aria-hidden />
      {flash ? <div className={`pointer-events-none absolute inset-0 z-20 ${flash === "ok" ? "bg-white/80" : "bg-red-500/40"}`} /> : null}

      <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-4 py-3">
        <span className="flex items-center gap-2">
          <SodarMark size={18} className="text-text" />
          <span className="wordmark text-[.7rem]">Sodar</span>
        </span>
        <Link href="/" className="rounded-full border border-white/25 bg-black/40 px-3 py-1.5 font-mono text-[11px] text-text backdrop-blur" onClick={() => stopCamera()}>{t("exit")}</Link>
      </div>

      {phase === "loading" ? <p className="relative z-10 flex min-h-dvh items-center justify-center font-mono text-[11px] text-text-muted">{t("loading")}</p> : null}

      {phase === "welcome" ? (
        <div className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col justify-end px-6 pb-10 pt-24">
          <p className="eyebrow"><span /> {t("eyebrow")}</p>
          <h1 className="display mt-4 text-[clamp(2.4rem,9vw,3.6rem)]">{t("title")}</h1>
          <p className="mt-4 text-text-muted">{t("intro")}</p>
          <ol className="mt-4 space-y-1 text-sm text-text-muted">
            {(t.raw("steps") as string[]).map((step, i) => <li key={i} className="flex gap-3"><span className="font-mono text-[11px] text-text-faint">{String(i + 1).padStart(2, "0")}</span>{step}</li>)}
          </ol>
          {!isMobile ? <p className="mt-3 font-mono text-[11px] text-text-faint">{t("desktopHint")} <a href="?demo=1" className="underline">{t("demoLink")}</a></p> : null}
          {progressText ? <p className="mt-3 font-mono text-[11px] text-text-muted">{progressText}</p> : null}
          <button type="button" onClick={() => setPhase("mode")} disabled={demo} className="button-primary mt-8 w-full justify-center">{t("start")}</button>
          <p className="mt-3 text-center font-mono text-[10px] text-text-faint">{t("privacyNote")}</p>
        </div>
      ) : null}

      {phase === "mode" ? (
        <div className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col justify-end px-6 pb-10 pt-24">
          <p className="eyebrow"><span /> {session ? t("mode.eyebrowNextRoom", { name: activeRoom?.name ?? "" }) : t("mode.eyebrow")}</p>
          <h2 className="display mt-4 text-[clamp(2rem,8vw,3rem)]">{t("mode.title")}</h2>
          <div className="mt-6 space-y-3" role="radiogroup" aria-label={t("mode.title")}>
            {(["full3d", "quick"] as CaptureMode[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`w-full rounded-2xl border p-4 text-left ${mode === m ? "border-text bg-white/5" : "border-white/20"}`}>
                <span className="block text-base font-medium">{t(`mode.${m}.name`)}{m === "full3d" ? <span className="ml-2 rounded-full border border-white/25 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">{t("mode.recommended")}</span> : null}</span>
                <span className="mt-1 block text-sm text-text-muted">{t(`mode.${m}.body`)}</span>
                <span className="mt-2 block font-mono text-[11px] text-text-faint">{t(`mode.${m}.meta`)}</span>
              </button>
            ))}
          </div>
          {mode === "full3d" ? (
            <div className="mt-4 flex gap-2" role="radiogroup" aria-label={t("mode.sizeLabel")}>
              {(["normal", "large"] as RoomSize[]).map((s) => (
                <button key={s} type="button" role="radio" aria-checked={size === s} onClick={() => setSize(s)} className={`flex-1 rounded-xl border px-3 py-3 text-sm ${size === s ? "border-text bg-white/5" : "border-white/20"}`}>{t(`mode.size.${s}`)}</button>
              ))}
            </div>
          ) : null}
          <button type="button" onClick={() => (session ? (updateRoom(session.activeRoomId, (r) => ({ ...r, mode, size })), setPhase("permissions")) : beginNewSession(mode, size))} className="button-primary mt-6 w-full justify-center">{t("mode.continue")}</button>
        </div>
      ) : null}

      {phase === "permissions" ? (
        <div className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col justify-end px-6 pb-10 pt-24">
          <div className="rounded-2xl border border-white/15 bg-black/60 p-5 backdrop-blur">
            <p className="eyebrow"><span /> {t("permissions.eyebrow")}</p>
            <h2 className="display mt-3 text-[clamp(1.8rem,7vw,2.6rem)]">{stream.current ? t("permissions.confirmTitle") : t("permissions.title")}</h2>
            <p className="mt-3 text-sm text-text-muted">{stream.current ? t("permissions.confirmBody") : t("permissions.body")}</p>
            {cameraInfo ? <p className="mt-2 font-mono text-[11px] text-text-faint" dir="ltr">{cameraInfo.label || t("permissions.rearCamera")} · {cameraInfo.width}×{cameraInfo.height}{/ultra|0\.5/i.test(cameraInfo.label) ? ` · ${t("permissions.ultraWideWarning")}` : ""}</p> : null}
            {motion === "denied" || motion === "unavailable" ? <p className="mt-2 text-xs text-text-muted">{t("permissions.noMotion")}</p> : null}
            {permissionError ? <p role="alert" className="mt-3 rounded-xl border border-border-strong bg-bg-raised p-3 text-sm">{permissionError}</p> : null}
            {!stream.current ? (
              <button type="button" onClick={enterPermissions} disabled={requesting} className="button-primary mt-5 w-full justify-center">{requesting ? t("requesting") : t("permissions.allow")}</button>
            ) : (
              <div className="mt-5 flex gap-2">
                <button type="button" onClick={() => { stopCamera(); setCameraInfo(null); void enterPermissions(); }} className="button-secondary flex-1 justify-center">{t("permissions.retryCamera")}</button>
                <button type="button" onClick={afterPermissions} className="button-primary flex-1 justify-center">{t("permissions.looksRight")}</button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {phase === "tutorial" ? <Tutorial mode={activeMode} onDone={() => setPhase("people")} /> : null}

      {phase === "people" ? (
        <div className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col justify-end px-6 pb-10 pt-24">
          <p className="eyebrow"><span /> {t("people.eyebrow")}</p>
          <h2 className="display mt-4 text-[clamp(2rem,8vw,3rem)]">{t("people.title")}</h2>
          <p className="mt-4 text-text-muted">{t("people.body")}</p>
          <ul className="mt-4 space-y-1 text-sm text-text-muted">{(t.raw("people.checklist") as string[]).map((item, i) => <li key={i}>• {item}</li>)}</ul>
          <button type="button" onClick={startCapturing} className="button-primary mt-8 w-full justify-center">{t("people.ready")}</button>
        </div>
      ) : null}

      {phase === "capturing" ? (
        <CaptureOverlay
          plan={plan}
          target={target}
          captured={capturedIndexes.size}
          capturedIndexes={capturedIndexes}
          marker={marker}
          dwell={dwell}
          hasGyro={hasGyro}
          message={message}
          roomName={activeRoom?.name ?? ""}
          paused={paused}
          needsMove={needsMove}
          station={station && plan ? { label: station.label, height: station.height, kind: station.kind, index: station.index, total: plan.stations.length } : undefined}
          retakeMode={Boolean(retake)}
          onPause={() => setPaused(true)}
          onResume={() => { setPaused(false); gate.current.reset(); }}
          onInPosition={() => { setNeedsMove(false); gate.current.reset(); }}
          onManualCapture={manualCapture}
          onFinish={() => (retake ? (setRetake(null), setPhase("review")) : void finishRoom())}
          canFinish={canFinish}
          thumbs={frames.map((f) => thumbsMap.get(f.id)).filter((u): u is string => Boolean(u))}
          lastRejected={lastRejected}
          compassYaw={orientation?.yaw}
        />
      ) : null}

      {phase === "checking" ? (
        <div className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-24">
          <p className="eyebrow"><span /> {t("checking.eyebrow")}</p>
          <h2 className="display mt-4 text-[clamp(2rem,8vw,3rem)]">{t("checking.title")}</h2>
          <p className="mt-3 font-mono text-[11px] text-text-muted">{progressText ?? t("checking.body")}</p>
        </div>
      ) : null}

      {phase === "review" && activeRoom ? (
        <ReviewPanel
          roomName={activeRoom.name}
          gate={roomGate}
          frames={frames}
          thumbs={thumbsMap}
          review={astraReview ?? activeRoom.review}
          reviewBusy={astraBusy}
          reviewError={astraError}
          reviewAvailable={Boolean(process.env.NEXT_PUBLIC_ASTRA_AVAILABLE !== "0")}
          onReview={runAstra}
          onRetake={retakeFrame}
          onAddMore={addMoreFrames}
          onConfirm={confirmRoom}
          onDiscardRoom={discardRoom}
          minFrames={minimumFrames(activeMode)}
        />
      ) : null}

      {phase === "saving" ? (
        <div className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-24">
          <p className="eyebrow"><span /> {t("saving.eyebrow")}</p>
          <h2 className="display mt-4 text-[clamp(2rem,8vw,3rem)]">{t("saving.title")}</h2>
          <p className="mt-3 text-text-muted">{t("saving.body")}</p>
          {saveState ? (
            <>
              <div className="mt-6 h-1 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={saveState.total} aria-valuenow={saveState.done}>
                <div className="h-full bg-text transition-[width] duration-200" style={{ width: `${saveState.total ? (saveState.done / saveState.total) * 100 : 0}%` }} />
              </div>
              <p className="mt-2 font-mono text-[11px] text-text-muted" dir="ltr">{saveState.done}/{saveState.total} {t("frames")}{saveState.failed ? ` · ${saveState.failed} ${t("saving.retrying")}` : ""}</p>
            </>
          ) : null}
          {resultsMessage ? <p role="status" className="mt-3 rounded-xl border border-white/15 p-3 text-sm">{resultsMessage}</p> : null}
          {!signedIn && supabaseConfigured ? (
            <div className="mt-6 flex gap-2">
              <button type="button" onClick={skipSaving} className="button-secondary flex-1 justify-center">{t("saving.keepLocal")}</button>
              <button type="button" onClick={() => setSignInOpen(true)} className="button-primary flex-1 justify-center">{t("saving.signIn")}</button>
            </div>
          ) : null}
          {!busy && signedIn && activeRoom?.status === "confirmed" && resultsMessage ? (
            <div className="mt-6 flex gap-2">
              <button type="button" onClick={skipSaving} className="button-secondary flex-1 justify-center">{t("saving.keepLocal")}</button>
              <button type="button" onClick={() => session && void saveRoom(activeRoom, session).then((ok) => (ok ? openConsent(activeRoom) : undefined))} className="button-primary flex-1 justify-center">{t("saving.retry")}</button>
            </div>
          ) : null}
          <p className="mt-6 text-center text-[11px] text-text-faint">{t("saving.leaveNote")}</p>
        </div>
      ) : null}

      {phase === "results" && session ? (
        <ResultsView
          session={session}
          views={views}
          savedRemotely={savedRemotely}
          signedIn={signedIn}
          onOpenPreview={(roomId) => setPreview({ open: true, roomId })}
          onOpenSplat={(artifact, room) => setSplat({ artifact, room })}
          onStartProcessing={(room) => void openConsent(room)}
          onAddRoom={addRoom}
          onExport={() => void exportFrames()}
          onEditTour={() => setTourEditor(true)}
          onDelete={() => setConfirmDelete(true)}
          onRestart={restart}
          onSignIn={() => setSignInOpen(true)}
          onSaveNow={() => { const room = session.rooms.find((r) => r.status !== "uploaded" && r.status !== "processing" && r.captured > 0); if (room) void saveRoom(room, session).then((ok) => (ok ? openConsent(room) : undefined)); }}
          onCompletePanorama={(room) => void completePanorama(room)}
          aiFillAvailable={aiFillEnabled() || signedIn}
          busy={busy}
          message={progressText ?? resultsMessage}
        />
      ) : null}

      {confirmDelete && session ? (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-bg-raised p-5">
            <h2 className="display text-2xl">{t("results.deleteTitle")}</h2>
            <p className="mt-2 text-sm text-text-muted">{t("results.deleteBody")}</p>
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} className="button-secondary flex-1 justify-center">{t("results.keep")}</button>
              <button type="button" onClick={() => void deleteEverything()} disabled={busy === "delete"} className="button-primary flex-1 justify-center">{t("results.deleteConfirm")}</button>
            </div>
          </div>
        </div>
      ) : null}

      {resumable && phase === "welcome" && !demo ? <ResumeDialog session={resumable.session} frames={resumable.frames} onContinue={() => void continueSession()} onStartOver={() => void startOver()} /> : null}
      <SignInSheet open={signInOpen} onClose={() => (phase === "saving" ? skipSaving() : setSignInOpen(false))} onSignedIn={() => { setSignedIn(true); setSignInOpen(false); }} />
      {consent ? <ConsentSheet estimate={consent.estimate} loading={consent.loading} error={consent.error} onStart={(providers, options) => void startReconstruction(providers, options)} onClose={() => setConsent(null)} /> : null}
      {session ? <RoomPreview tour={tour} rooms={preview.roomId ? previewRooms.filter((r) => r.id === preview.roomId).concat(previewRooms.filter((r) => r.id !== preview.roomId)) : previewRooms} open={preview.open} onClose={() => setPreview({ open: false })} label={t("previewLabel")} initialNodeId={preview.roomId} /> : null}
      {tourEditor && session ? <TourEditor rooms={previewRooms} links={links.length ? links : (session.links ?? []).map((l) => ({ ...l }))} onSave={saveLinks} onClose={() => setTourEditor(false)} /> : null}
      {splat && splat.artifact.url && /\.spz$/i.test(splat.artifact.name) ? <SpzViewer url={splat.artifact.url} byteSize={splat.artifact.byteSize} label={`${splat.room.name} · ${t("results.marbleLabel")}`} disclosure={t("results.marbleNote")} onClose={() => setSplat(null)} /> : null}
      {splat && splat.artifact.url && !/\.spz$/i.test(splat.artifact.name) ? <SplatViewer url={splat.artifact.url} format={/\.splat$/i.test(splat.artifact.name) ? "splat" : "ply"} label={`${splat.room.name} · ${splat.artifact.provider === "marble" ? t("results.marbleLabel") : t("results.kiriLabel")}`} disclosure={splat.artifact.provider === "marble" ? t("results.marbleNote") : t("results.kiriNote")} onClose={() => setSplat(null)} /> : null}
    </main>
  );
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
