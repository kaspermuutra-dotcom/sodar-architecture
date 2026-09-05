"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { SodarMark } from "@/components/logo";
import { AlignmentGate } from "@/lib/scanner/gate";
import { createPlan, angularDistance, yawDelta, normalizeDegrees, type SphereTargetPlan } from "@/lib/scanner/plan";
import { requestOrientationPermission, subscribeOrientation, type Orientation } from "@/lib/scanner/orientation";

type Phase = "idle" | "requesting" | "capturing" | "roomDone" | "processing" | "done";
type Frame = { url: string; yaw: number; elevation: number };

const PX_PER_DEGREE = 9;
const ROOMS_IN_PREVIEW = 2;

/**
 * Guided panorama capture in the browser. Mirrors the Photo Sphere Android
 * flow: a ring of yaw targets, the next target drawn relative to where the
 * phone points, and an alignment gate that fires the shutter once the camera
 * settles on it. Frames stay in memory on the device — this is the capture
 * half of the product; stitching happens server-side in the real pipeline.
 */
export function Scanner() {
  const t = useTranslations("Scanner");
  const roomNames = t.raw("rooms") as string[];

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const gateRef = useRef(new AlignmentGate());
  const orientationRef = useRef<Orientation | null>(null);
  const lastRef = useRef<Orientation | null>(null);
  const rafRef = useRef<number | null>(null);
  const planRef = useRef<SphereTargetPlan>(createPlan(0, "ring"));

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasGyro, setHasGyro] = useState<boolean | null>(null);
  const [room, setRoom] = useState(0);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [allFrames, setAllFrames] = useState<Frame[][]>([]);
  const [hint, setHint] = useState<string>("");
  const [targetPos, setTargetPos] = useState<{ x: number; y: number; dist: number } | null>(null);
  const [dwell, setDwell] = useState(0);
  const [flash, setFlash] = useState(false);
  const [progress, setProgress] = useState(0);

  const total = planRef.current.targets.length;
  const isMobile = useMemo(() => (typeof navigator !== "undefined" ? /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) : false), []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  const captureFrame = useCallback(
    (yaw: number, elevation: number) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.videoWidth === 0) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const url = canvas.toDataURL("image/jpeg", 0.9);
      setFrames((f) => [...f, { url, yaw, elevation }]);
      setFlash(true);
      window.setTimeout(() => setFlash(false), 120);
      try {
        navigator.vibrate?.(20);
      } catch {}
    },
    [],
  );

  // Main loop: compare orientation to the next target, drive the gate.
  useEffect(() => {
    if (phase !== "capturing" || hasGyro === false) return;
    const tick = () => {
      const o = orientationRef.current;
      const idx = frames.length;
      const target = planRef.current.targets[idx];
      if (o && target) {
        const dYaw = yawDelta(o.yaw, target.yaw);
        const dEl = target.elevation - o.elevation;
        const dist = angularDistance(o.yaw, o.elevation, target);
        setTargetPos({ x: Math.max(-160, Math.min(160, dYaw * PX_PER_DEGREE)), y: Math.max(-160, Math.min(160, -dEl * PX_PER_DEGREE)), dist });
        const last = lastRef.current;
        const speed = last ? Math.abs(yawDelta(last.yaw, o.yaw)) / Math.max(1, o.t - last.t) * 1000 : 0;
        lastRef.current = o;
        const reading = gateRef.current.update(dist, performance.now());
        setDwell(reading.dwellProgress);
        if (reading.isTriggered) {
          captureFrame(o.yaw, o.elevation);
          gateRef.current.reset();
        }
        if (reading.isAligned) setHint(t("hold"));
        else if (speed > 60) setHint(t("slower"));
        else if (Math.abs(dYaw) > Math.abs(dEl)) setHint(dYaw > 0 ? t("turnRight") : t("turnLeft"));
        else setHint(dEl > 0 ? t("tiltUp") : t("tiltDown"));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [phase, frames.length, hasGyro, captureFrame, t]);

  // Room complete when the ring is full.
  useEffect(() => {
    if (phase === "capturing" && frames.length >= total) setPhase("roomDone");
  }, [frames.length, phase, total]);

  // Fake processing bar for the preview state.
  useEffect(() => {
    if (phase !== "processing") return;
    setProgress(0);
    const id = window.setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          window.clearInterval(id);
          setPhase("done");
          return 100;
        }
        return p + 2;
      });
    }, 80);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => () => stopStream(), [stopStream]);

  async function start() {
    setError(null);
    setPhase("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (e) {
      const name = (e as DOMException)?.name;
      setError(name === "NotAllowedError" ? t("denied") : t("noCamera"));
      setPhase("idle");
      return;
    }
    const status = await requestOrientationPermission();
    if (status !== "ok") {
      setHasGyro(false);
    } else {
      let got = false;
      const unsub = subscribeOrientation((o) => {
        orientationRef.current = o;
        if (!got) {
          got = true;
          setHasGyro(true);
          // Start the ring where the phone is pointing now, like the Android app.
          planRef.current = createPlan(normalizeDegrees(o.yaw), "ring");
        }
      });
      window.setTimeout(() => {
        if (!got) setHasGyro(false);
      }, 1500);
      (window as unknown as { __sodarUnsub?: () => void }).__sodarUnsub = unsub;
    }
    setFrames([]);
    gateRef.current.reset();
    setPhase("capturing");
  }

  function manualCapture() {
    const o = orientationRef.current;
    captureFrame(o?.yaw ?? frames.length * 30, o?.elevation ?? 0);
  }

  function finishRoom() {
    setAllFrames((a) => [...a, frames]);
    if (room + 1 >= ROOMS_IN_PREVIEW) {
      stopStream();
      setPhase("processing");
    } else {
      setRoom((r) => r + 1);
      setFrames([]);
      gateRef.current.reset();
      const o = orientationRef.current;
      planRef.current = createPlan(normalizeDegrees(o?.yaw ?? 0), "ring");
      setPhase("capturing");
    }
  }

  const roomName = roomNames[room] ?? `${t("room")} ${room + 1}`;

  return (
    <div className="relative min-h-dvh bg-bg text-text">
      <canvas ref={canvasRef} className="hidden" />

      {/* top bar */}
      <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-4 py-3">
        <span className="flex items-center gap-2">
          <SodarMark size={18} className="text-text" />
          <span className="wordmark text-[.7rem]">Sodar</span>
        </span>
        <Link href="/" onClick={stopStream} className="rounded-full border border-white/25 bg-black/40 px-3 py-1 font-mono text-[11px] text-text backdrop-blur">
          {t("exit")}
        </Link>
      </div>

      {/* viewfinder (kept mounted so the stream can attach before capture starts) */}
      <video ref={videoRef} playsInline muted autoPlay className={`absolute inset-0 h-full w-full object-cover ${phase === "capturing" || phase === "roomDone" ? "opacity-100" : "opacity-0"}`} />
      {flash ? <div className="pointer-events-none absolute inset-0 z-20 bg-white/80" /> : null}

      {phase === "idle" || phase === "requesting" ? (
        <div className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col justify-end px-6 pb-10 pt-24">
          <p className="eyebrow">
            <span /> {t("eyebrow")}
          </p>
          <h1 className="display mt-4 text-[clamp(2.4rem,9vw,3.6rem)]">{t("title")}</h1>
          <p className="mt-4 text-text-muted">{t("intro")}</p>
          {!isMobile ? <p className="mt-3 font-mono text-[11px] text-text-faint">{t("desktopHint")}</p> : null}
          {error ? <p className="mt-4 rounded-xl border border-border-strong bg-bg-raised p-3 text-sm text-text">{error}</p> : null}
          <button type="button" onClick={start} disabled={phase === "requesting"} className="button-primary mt-8 w-full justify-center">
            {phase === "requesting" ? t("requesting") : t("start")} <span aria-hidden>↗</span>
          </button>
          <p className="mt-3 text-center font-mono text-[10px] text-text-faint">{t("privacyNote")}</p>
        </div>
      ) : null}

      {phase === "capturing" || phase === "roomDone" ? (
        <div className="absolute inset-0 z-10">
          {/* horizon + reticle */}
          <div className="absolute inset-x-8 top-1/2 h-px bg-white/30" />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <svg width="96" height="96" viewBox="0 0 100 100" className="-rotate-90">
              <circle cx="50" cy="50" r="44" stroke="rgba(255,255,255,.45)" strokeWidth="2" fill="none" />
              <circle cx="50" cy="50" r="44" stroke="#f4f2ee" strokeWidth="3" fill="none" strokeDasharray="276" strokeDashoffset={276 * (1 - dwell)} strokeLinecap="round" />
            </svg>
          </div>
          {/* next target, positioned relative to the reticle */}
          {phase === "capturing" && targetPos && hasGyro ? (
            <div className="absolute left-1/2 top-1/2" style={{ transform: `translate(calc(-50% + ${targetPos.x}px), calc(-50% + ${targetPos.y}px))` }}>
              <div className={`h-12 w-12 rounded-full border-2 ${targetPos.dist < 4 ? "border-text bg-text/30" : "border-white/70 border-dashed"}`} />
            </div>
          ) : null}

          {/* HUD */}
          <div className="absolute left-4 top-14 font-mono text-[11px] text-text" dir="ltr">
            <span className="num">{String(frames.length).padStart(2, "0")}</span>
            <span className="text-text-muted">/{total} {t("frames")}</span>
          </div>
          <div className="absolute right-4 top-14 rounded-full border border-white/25 bg-black/40 px-2.5 py-1 font-mono text-[10px] text-text backdrop-blur">
            {roomName}
          </div>

          {/* thumbnails */}
          <div className="absolute inset-x-0 bottom-36 flex gap-1 overflow-x-auto px-4" dir="ltr">
            {frames.map((f, i) => (
              <img key={i} src={f.url} alt="" className="h-10 w-14 shrink-0 rounded object-cover" />
            ))}
          </div>

          {/* assistant */}
          <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/15 bg-black/55 p-4 backdrop-blur">
            <p className="font-mono text-[10px] uppercase tracking-[.16em] text-text-muted">{t("assistant")}</p>
            {phase === "roomDone" ? (
              <>
                <p className="mt-1 text-sm text-text">{t("roomDone")}</p>
                <button type="button" onClick={finishRoom} className="button-primary mt-3 w-full justify-center">
                  {room + 1 >= ROOMS_IN_PREVIEW ? t("finish") : t("nextRoom")} <span aria-hidden>↗</span>
                </button>
              </>
            ) : hasGyro === false ? (
              <>
                <p className="mt-1 text-sm text-text">{t("noGyro")}</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={manualCapture} className="button-primary flex-1 justify-center">{t("manual")}</button>
                  {frames.length >= 6 ? <button type="button" onClick={() => setPhase("roomDone")} className="button-secondary">{t("finishRoom")}</button> : null}
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-text">{hint || t("hold")}</p>
                {frames.length >= 6 ? (
                  <button type="button" onClick={() => setPhase("roomDone")} className="button-mini mt-3">{t("finishRoom")}</button>
                ) : null}
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
          <div className="mt-6 h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-text transition-[width] duration-100" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 font-mono text-[11px] text-text-muted" dir="ltr">
            {allFrames.reduce((n, r) => n + r.length, 0)} {t("frames")} · {allFrames.length} {t("roomsLabel")}
          </p>
          {phase === "done" ? (
            <>
              <p className="mt-6 text-text-muted">{t("doneBody")}</p>
              <div className="mt-4 grid grid-cols-4 gap-1">
                {allFrames.flat().slice(0, 8).map((f, i) => (
                  <img key={i} src={f.url} alt="" className="aspect-[4/3] w-full rounded object-cover" />
                ))}
              </div>
              <Link href="/terminal" className="button-primary mt-8 w-full justify-center">
                {t("workspace")} <span aria-hidden>↗</span>
              </Link>
              <button type="button" onClick={() => { setAllFrames([]); setRoom(0); setPhase("idle"); }} className="button-secondary mt-3 w-full justify-center">
                {t("again")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
