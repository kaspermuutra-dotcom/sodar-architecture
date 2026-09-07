"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Native SPZ viewer for Marble worlds, built on Spark (`@sparkjsdev/spark`,
 * World Labs' open-source three.js Gaussian-splat renderer, MIT). The SPZ is
 * streamed from SODAR's private storage with a byte-level progress bar, decoded
 * by Spark's own loader (no PLY conversion, no third-party conversion step),
 * and rendered with orbit controls. three.js and Spark are loaded lazily and
 * released on close. Nothing about the world leaves the browser.
 */
export function SpzViewer({ url, byteSize, label, disclosure, onClose }: { url: string; byteSize?: number; label: string; disclosure?: string; onClose: () => void }) {
  const t = useTranslations("Scanner.viewer");
  const host = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let frame = 0;
    let cleanup: (() => void) | undefined;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`download ${response.status}`);
        const total = Number(response.headers.get("content-length") ?? byteSize ?? 0);
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          if (total) setProgress(Math.min(0.95, received / total));
        }
        const bytes = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        if (disposed || !host.current) return;
        const [THREE, { OrbitControls }, Spark] = await Promise.all([import("three"), import("three/examples/jsm/controls/OrbitControls.js"), import("@sparkjsdev/spark")]);
        if (disposed || !host.current) return;
        const element = host.current;
        const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(element.clientWidth, element.clientHeight);
        element.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(65, element.clientWidth / Math.max(1, element.clientHeight), 0.05, 500);
        camera.position.set(0, 0.2, 0.1);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.target.set(0, 0, -1.5);
        const spark = new Spark.SparkRenderer({ renderer });
        scene.add(spark);
        const splat = new Spark.SplatMesh({
          fileBytes: bytes,
          fileName: "world.spz",
          onLoad: () => {
            if (disposed) return;
            setProgress(1);
            setReady(true);
          },
        });
        // Splat files follow the OpenCV camera convention (Y down, Z forward); flip to three.js Y-up.
        splat.rotation.x = Math.PI;
        scene.add(splat);
        const onResize = () => {
          renderer.setSize(element.clientWidth, element.clientHeight);
          camera.aspect = element.clientWidth / Math.max(1, element.clientHeight);
          camera.updateProjectionMatrix();
        };
        window.addEventListener("resize", onResize);
        const loop = () => {
          controls.update();
          renderer.render(scene, camera);
          frame = requestAnimationFrame(loop);
        };
        loop();
        cleanup = () => {
          window.removeEventListener("resize", onResize);
          cancelAnimationFrame(frame);
          controls.dispose();
          splat.dispose();
          renderer.dispose();
          renderer.forceContextLoss();
          renderer.domElement.remove();
        };
      } catch (err) {
        if (!disposed && !(err instanceof DOMException && err.name === "AbortError")) setError(t("loadFailed"));
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
      cleanup?.();
    };
  }, [url, byteSize, t]);

  return (
    <section role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-40 bg-black">
      <div ref={host} className="h-full w-full touch-none" />
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
