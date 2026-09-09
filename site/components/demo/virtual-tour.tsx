"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { FACE_NAMES, type WalkLink, type WalkScene } from "@/lib/demo/walkthrough";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * Reusable linked-panorama viewer on Photo Sphere Viewer's cubemap-tiles
 * adapter + the virtual-tour plugin. It knows nothing about a specific
 * property: it takes scenes with world-aligned link yaws (lib/demo/walkthrough.ts),
 * rotates each panorama into the model frame with `sphereCorrection`, and
 * reports scene changes.
 *
 * Image pipeline: every scene is a cube with a 512 px base level (loaded
 * first, blurred by the adapter until tiles arrive), then 1536 px and
 * 3072 px tile levels that the adapter fetches only for the faces/tiles in
 * view and the zoom level in use. Linked scenes are preloaded by the plugin
 * (base level), visited textures stay in PSV's cache, and the renderer draws
 * at the device pixel ratio.
 */

export type VirtualTourHandle = {
  goTo(id: string, options?: { instant?: boolean }): Promise<boolean>;
  getPosition(): { yaw: number; pitch: number } | null;
};

type Props = {
  scenes: WalkScene[];
  startId: string;
  startYaw?: number;
  label: (scene: WalkScene) => string;
  loadingText: string;
  onSceneChange?: (id: string) => void;
  /** Current view direction as a world yaw in degrees (clockwise, 0 = model +x); throttled to animation frames. */
  onYawChange?: (yawDeg: number) => void;
  onLoadingChange?: (loading: boolean) => void;
  onError?: (id: string | null) => void;
};

type Plugin = {
  setCurrentNode(id: string, options?: Record<string, unknown>): Promise<boolean>;
  getCurrentNode(): { id: string } | null;
  addEventListener(type: "node-changed", cb: (e: { node: { id: string } }) => void): void;
};
type ViewerLike = {
  destroy(): void;
  getPlugin(p: unknown): unknown;
  getPosition(): { yaw: number; pitch: number };
  addEventListener(type: string, cb: (e: unknown) => void, opts?: { once?: boolean }): void;
};

const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Cubemap-tiles panorama descriptor for one scene (see scripts/matterport_capture_faces.py for the layout).
 *
 * The adapter chooses a level by comparing `faceSize·4/360·hFov` with the viewer's CSS width, so on a
 * high-density display it would settle for a level that is one DPR step too small. `pixelRatio` scales
 * that choice: levels whose face size cannot cover `width × DPR` at the default view are left out, so a
 * Retina desktop goes straight from the 512 px base to the 3072 px level while a 1× display still uses
 * 1536 px until it zooms in. Level indices in `tileUrl` stay tied to the level's face size, not its position.
 */
export function cubemapPanorama(scene: WalkScene, pixelRatio = 1, cssWidth = 0) {
  const base = Object.fromEntries(FACE_NAMES.map((face) => [face, `${scene.faces}/${face}-0.webp`]));
  const need = cssWidth * Math.min(Math.max(pixelRatio, 1), 2);
  const usable = scene.levels.filter((l, i) => i === scene.levels.length - 1 || (l.faceSize * 4) / 360 * DEFAULT_HFOV_DEG >= need);
  const indexOf = new Map(scene.levels.map((l, i) => [l.faceSize, i + 1]));
  return {
    baseUrl: base,
    levels: usable.map((l) => ({ faceSize: l.faceSize, nbTiles: l.nbTiles })),
    // The export's up/down faces are stored rotated 180° relative to PSV's cube convention; verified in the browser.
    flipTopBottom: true,
    tileUrl: (face: string, col: number, row: number, level: number) => `${scene.faces}/${face}-${indexOf.get(usable[level]?.faceSize ?? 0) ?? level + 1}-${col}-${row}.webp`,
  };
}

/** Horizontal field of view at the default zoom on the 16:10 stage (vertical 66°). */
const DEFAULT_HFOV_DEG = 94;

const PUCK = "/media/portfolio/puck.svg";

/**
 * A ring lying flat on the floor at the spot the linked sweep occupies — the tap-to-move affordance Matterport
 * users know. `imageLayer` markers are real 3D planes, so perspective foreshortens distant rings naturally; the
 * size scales with distance so nearby rings do not dominate the view.
 */
function floorRing(link: WalkLink, name: string) {
  const size = Math.max(44, Math.min(104, 150 / Math.max(link.distance, 1)));
  return {
    id: `go-${link.to}`,
    imageLayer: PUCK,
    position: { yaw: toRad(link.yaw), pitch: toRad(link.pitch) },
    size: { width: size, height: size },
    orientation: "horizontal" as const,
    tooltip: { content: name, position: "top center" },
    zIndex: 5,
    data: { to: link.to },
  };
}

export const VirtualTour = forwardRef<VirtualTourHandle, Props>(function VirtualTour({ scenes, startId, startYaw, label, loadingText, onSceneChange, onYawChange, onLoadingChange, onError }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const viewer = useRef<ViewerLike | null>(null);
  const plugin = useRef<Plugin | null>(null);
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const callbacks = useRef({ onSceneChange, onYawChange, onLoadingChange, onError, label });
  callbacks.current = { onSceneChange, onYawChange, onLoadingChange, onError, label };

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let cancelled = false;
    const start = scenes.find((s) => s.id === startId) ?? scenes[0];
    setBackdrop(start?.preview ?? null);
    callbacks.current.onLoadingChange?.(true);

    void Promise.all([import("@photo-sphere-viewer/core"), import("@photo-sphere-viewer/cubemap-tiles-adapter"), import("@photo-sphere-viewer/virtual-tour-plugin"), import("@photo-sphere-viewer/markers-plugin")]).then(([core, tiles, tour, markers]) => {
      if (cancelled || !root.current) return;
      const reduced = prefersReducedMotion();
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = root.current.clientWidth;
      const nodes = scenes.map((s) => ({
        id: s.id,
        panorama: cubemapPanorama(s, dpr, cssWidth),
        name: callbacks.current.label(s),
        caption: callbacks.current.label(s),
        thumbnail: s.thumbnail,
        sphereCorrection: { pan: toRad(s.pan) },
        links: s.links.map((l) => ({ nodeId: l.to, position: { yaw: toRad(l.yaw), pitch: toRad(l.pitch) }, name: callbacks.current.label(scenes.find((t) => t.id === l.to) ?? s) })),
        // Matterport-style floor rings: one flat image layer per link, lying on the floor where the next sweep stands.
        markers: s.links.map((l) => floorRing(l, callbacks.current.label(scenes.find((t) => t.id === l.to) ?? s))),
        data: { yaw: s.yaw },
      }));
      const v = new core.Viewer({
        container: root.current,
        adapter: [tiles.CubemapTilesAdapter, { baseBlur: true, showErrorTile: false, antialias: true }],
        navbar: ["zoom", "move", "caption", "fullscreen"],
        keyboard: "fullscreen",
        mousewheel: true,
        touchmoveTwoFingers: true,
        defaultYaw: toRad(startYaw ?? start?.yaw ?? 0),
        defaultPitch: toRad(-6), // a touch below level: the facade stays framed and the nearest floor rings are in view
        // PSV's fov is vertical. Default ≈ 66° vertical (≈ 94° horizontal on the 16:10 stage, close to Matterport's
        // default framing, and wide enough that the nearest floor rings are in the first frame); zooming in stops at 30°,
        // which on a 900 px-tall Retina stage is ~30 px/deg — the ~27 px/deg limit of the source frames.
        defaultZoomLvl: 40,
        minFov: 30,
        maxFov: 90,
        loadingTxt: loadingText,
        lang: { zoom: "Zoom", move: "Move", fullscreen: "Fullscreen", zoomIn: "Zoom in", zoomOut: "Zoom out", moveUp: "Look up", moveDown: "Look down", moveLeft: "Look left", moveRight: "Look right" },
        plugins: [
          markers.MarkersPlugin,
          [
            tour.VirtualTourPlugin,
            {
              dataMode: "client",
              positionMode: "manual",
              nodes,
              startNodeId: start?.id,
              preload: true,
              linksOnCompass: false,
              transitionOptions: (toNode: { data?: { yaw?: number } }) => ({ showLoader: true, speed: reduced ? "0.01rpm" : "16rpm", effect: reduced ? "none" : "fade", rotation: !reduced, ...(reduced && toNode.data?.yaw !== undefined ? { rotateTo: { yaw: toRad(toNode.data.yaw), pitch: toRad(-10) } } : {}) }),
              // The plugin's own 3D arrow cluster stays registered (it drives preloading and transitions) but is hidden;
              // navigation happens through the floor rings below.
              arrowStyle: { style: { display: "none" } },
            },
          ],
        ],
      }) as unknown as ViewerLike;
      viewer.current = v;
      if (process.env.NODE_ENV !== "production") (window as unknown as { __psv?: unknown }).__psv = v; // inspection hook for QA scripts
      const p = v.getPlugin(tour.VirtualTourPlugin) as Plugin;
      plugin.current = p;
      const mk = v.getPlugin(markers.MarkersPlugin) as { addEventListener(type: "select-marker", cb: (e: { marker: { data?: { to?: string } } }) => void): void };
      mk.addEventListener("select-marker", (e) => {
        const to = e.marker.data?.to;
        if (to) void p.setCurrentNode(to);
      });
      v.addEventListener("ready", () => {
        if (!cancelled) setReady(true);
      }, { once: true });
      let yawFrame = 0;
      v.addEventListener("position-updated", (e) => {
        const pos = (e as { position?: { yaw: number } }).position;
        if (!pos || yawFrame) return;
        yawFrame = requestAnimationFrame(() => {
          yawFrame = 0;
          callbacks.current.onYawChange?.((pos.yaw * 180) / Math.PI);
        });
      });
      v.addEventListener("panorama-load", () => callbacks.current.onLoadingChange?.(true));
      v.addEventListener("panorama-loaded", () => {
        callbacks.current.onLoadingChange?.(false);
        callbacks.current.onError?.(null);
        setBackdrop(null);
        const pos = v.getPosition?.();
        if (pos) callbacks.current.onYawChange?.((pos.yaw * 180) / Math.PI); // the plan's view cone before the first drag
      });
      v.addEventListener("panorama-error", () => {
        callbacks.current.onLoadingChange?.(false);
        callbacks.current.onError?.(p.getCurrentNode?.()?.id ?? null);
      });
      p.addEventListener("node-changed", (e) => {
        const scene = scenes.find((s) => s.id === e.node.id);
        if (scene) setBackdrop(scene.preview);
        callbacks.current.onSceneChange?.(e.node.id);
      });
    });

    return () => {
      cancelled = true;
      plugin.current = null;
      viewer.current?.destroy();
      viewer.current = null;
    };
    // The scene graph is static for the life of the viewer; remounting on startId would reload everything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes]);

  useImperativeHandle(
    ref,
    () => ({
      async goTo(id, options) {
        const p = plugin.current;
        const scene = scenes.find((s) => s.id === id);
        if (!p || !scene) return false;
        if (p.getCurrentNode()?.id === id) return true; // null while the start node is still loading
        try {
          const instant = options?.instant || prefersReducedMotion();
          await p.setCurrentNode(id, instant ? { effect: "none", rotation: false, speed: "0.01rpm", rotateTo: { yaw: toRad(scene.yaw), pitch: toRad(-10) } } : { effect: "fade", rotation: false, speed: "16rpm", rotateTo: { yaw: toRad(scene.yaw), pitch: toRad(-10) } });
          return true;
        } catch {
          return false;
        }
      },
      getPosition() {
        return viewer.current?.getPosition() ?? null;
      },
    }),
    [scenes],
  );

  return (
    <div className="absolute inset-0 bg-black">
      {backdrop ? <img src={backdrop} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-md" /> : null}
      <div ref={root} className={`demo-psv absolute inset-0 transition-opacity duration-500 ${ready ? "opacity-100" : "opacity-0"}`} />
    </div>
  );
});
