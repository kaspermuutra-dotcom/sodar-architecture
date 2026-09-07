"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Lazy Gaussian-splat viewer (gsplat, MIT). Streams the .ply/.splat with a
 * progress bar so a 100 MB model shows something long before it is complete,
 * and releases the WebGL context on close. The URL is a short-lived signed URL
 * from SODAR storage; nothing is cached across sessions beyond the browser's
 * own HTTP cache.
 */
export function SplatViewer({ url, format, label, disclosure, onClose }: { url: string; format: "ply" | "splat"; label: string; disclosure?: string; onClose: () => void }) {
  const t = useTranslations("Scanner.viewer");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let frame = 0;
    let renderer: { dispose(): void; render(scene: unknown, camera: unknown): void } | undefined;
    let controls: { update(): void; dispose(): void } | undefined;
    (async () => {
      try {
        const SPLAT = await import("gsplat");
        if (disposed || !canvasRef.current) return;
        const scene = new SPLAT.Scene();
        const camera = new SPLAT.Camera();
        renderer = new SPLAT.WebGLRenderer(canvasRef.current);
        controls = new SPLAT.OrbitControls(camera, canvasRef.current);
        const onProgress = (p: number) => !disposed && setProgress(Math.max(0, Math.min(1, p)));
        if (format === "ply") await SPLAT.PLYLoader.LoadAsync(url, scene, onProgress);
        else await SPLAT.Loader.LoadAsync(url, scene, onProgress);
        if (disposed) return;
        setReady(true);
        const loop = () => {
          controls?.update();
          renderer?.render(scene, camera);
          frame = requestAnimationFrame(loop);
        };
        loop();
      } catch {
        if (!disposed) setError(t("loadFailed"));
      }
    })();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      controls?.dispose();
      renderer?.dispose();
    };
  }, [url, format, t]);

  return (
    <section role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-40 bg-black">
      <canvas ref={canvasRef} className="h-full w-full touch-none" />
      <p className="pointer-events-none absolute left-4 top-4 z-10 rounded-full bg-black/70 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-[#f4f2ee]">{label}</p>
      <button type="button" onClick={onClose} aria-label={t("close")} className="absolute right-4 top-4 z-10 rounded-full border border-white/25 bg-black/60 px-3 py-1.5 font-mono text-[11px] text-[#f4f2ee] backdrop-blur">✕</button>
      {!ready && !error ? (
        <div className="pointer-events-none absolute inset-x-6 top-1/2 z-10 -translate-y-1/2 text-center text-[#f4f2ee]">
          <p className="text-sm">{t("loading")}</p>
          <div className="mx-auto mt-3 h-1 w-full max-w-xs overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <div className="h-full bg-[#f4f2ee] transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="mt-2 font-mono text-[11px] text-white/60" dir="ltr">{Math.round(progress * 100)}%</p>
        </div>
      ) : null}
      {error ? <p role="alert" className="absolute inset-x-6 top-1/2 z-10 -translate-y-1/2 text-center text-sm text-[#f4f2ee]">{error}</p> : null}
      {disclosure ? <p className="pointer-events-none absolute inset-x-4 bottom-4 z-10 rounded-xl bg-black/70 p-3 text-center text-xs text-white/80">{disclosure}</p> : null}
      <p className="pointer-events-none absolute bottom-16 left-1/2 z-10 -translate-x-1/2 font-mono text-[10px] text-white/50">{t("hint")}</p>
    </section>
  );
}
