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
 * Image pipeline: every scene is a cube with a 512 px base level and 1536 px
 * and 3072 px tile levels, all cut from one corrected master per scene, so
 * the base and the tiles only differ in sharpness. The adapter fetches the
 * tiles for the faces in view at the level the viewport needs.
 *
 * Navigation is atomic: a move first warms the browser cache with the
 * destination's six base faces and the tiles that will be visible on
 * arrival (the direction of travel plus the floor), waits for them (with a
 * deadline), and only then cross-fades between two complete scenes. A newer
 * request cancels an older one that is still preloading, so rapid clicks end
 * on the last choice without stale scenes appearing later.
 */

export type VirtualTourHandle = {
  goTo(id: string, options?: { instant?: boolean }): Promise<boolean>;
  getPosition(): { yaw: number; pitch: number } | null;
  /** Current view: yaw/pitch in degrees (yaw = world yaw), field of view in degrees. */
  getView(): TourView | null;
  /** Turn towards a direction (smoothly, or instantly under reduced motion). */
  lookAt(yawDeg: number, pitchDeg: number): void;
};

export type TourView = { yawDeg: number; pitchDeg: number; hFovDeg: number; vFovDeg: number };

/** Cross-fade length between two complete scenes (ms). */
const FADE_MS = 550;
/** Longest wait for the destination's priority tiles before the switch goes ahead regardless. */
const PRELOAD_DEADLINE_MS = 6000;
/** Arrival pitch is the current pitch clamped to a comfortable band (no snapping to the floor or ceiling). */
const PITCH_MIN_DEG = -32;
const PITCH_MAX_DEG = 14;
/** Height of the navbar strip at the bottom of the stage (CSS px) and the clearance above it for half a ring. */
const NAVBAR_PX = 48;
const RING_CLEARANCE_DEG = 12;

/** Lowest pitch that keeps the nearest ring of `scene` inside the view above the navbar (short phone stages would
 * otherwise hide it under the bar, where a tap lands on the caption instead of the ring). */
function pitchForRings(scene: WalkScene, pitchDeg: number, vFovDeg: number, stageHeightPx: number): number {
  if (!scene.links.length) return pitchDeg;
  const nearest = scene.links.reduce((a, b) => (a.distance <= b.distance ? a : b));
  const navbarDeg = (vFovDeg * NAVBAR_PX) / Math.max(stageHeightPx, 200);
  const needed = nearest.pitch + vFovDeg / 2 - navbarDeg - RING_CLEARANCE_DEG; // view pitch at which the ring clears the bar
  return Math.max(PITCH_MIN_DEG - 12, Math.min(pitchDeg, needed));
}
const NO_TONE_MAPPING = 0; // three.js NoToneMapping

/**
 * URLs the viewer will request first after a switch: the base cube plus every tile of the chosen level whose
 * centre lies inside the arrival view (plus a margin) or on the floor face below the horizon. Mirrors the
 * adapter's level choice (faceSize·4/360·hFov ≥ width and faceSize·2/180·vFov ≥ height).
 */
export function priorityAssets(scene: WalkScene, panorama: ReturnType<typeof cubemapPanorama>, view: { yawDeg: number; pitchDeg: number; hFovDeg: number; vFovDeg: number }, size: { width: number; height: number }) {
  const urls: string[] = FACE_NAMES.map((face) => `${scene.faces}/${face}-0.webp`);
  let level = panorama.levels.findIndex((l) => (l.faceSize * 4) / 360 * view.hFovDeg >= size.width && (l.faceSize * 2) / 180 * view.vFovDeg >= size.height);
  if (level === -1) level = panorama.levels.length - 1;
  const nb = panorama.levels[level].nbTiles;
  // view direction in the cube frame: PSV yaw is clockwise from +z... use the same spherical→vector as the adapter
  const dir = sphericalToVector(toRad(view.yawDeg), toRad(view.pitchDeg));
  // the adapter loads a tile as soon as any of its corners is in view: allow half a tile plus a margin
  const limit = toRad(Math.max(view.hFovDeg, view.vFovDeg) / 2 + 90 / nb + 10);
  const floorLimit = toRad(Math.max(view.hFovDeg, view.vFovDeg) / 2 + 90 / nb + 24);
  for (const face of FACE_NAMES) {
    for (let col = 0; col < nb; col++) {
      for (let row = 0; row < nb; row++) {
        const u = ((col + 0.5) / nb) * 2 - 1;
        const v = 1 - ((row + 0.5) / nb) * 2;
        const c = faceVector(face, u, v, panorama.flipTopBottom);
        const angle = Math.acos(Math.max(-1, Math.min(1, c[0] * dir[0] + c[1] * dir[1] + c[2] * dir[2])));
        const floorTile = face === "bottom" && angle <= floorLimit; // the floor is where the rings are: warm it generously
        if (angle <= limit || floorTile) urls.push(panorama.tileUrl(face, col, row, level));
      }
    }
  }
  return urls;
}

/** Unit vector for PSV spherical coordinates: x = −sin(yaw)·cos(pitch), y = sin(pitch), z = cos(yaw)·cos(pitch). */
function sphericalToVector(yaw: number, pitch: number): [number, number, number] {
  return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
}

/** Centre direction of a cube-face texel in the same frame as `sphericalToVector`; consistent for angular tests. */
function faceVector(face: string, u: number, v: number, flipTopBottom: boolean): [number, number, number] {
  let d: [number, number, number];
  switch (face) {
    case "front":
      d = [u, v, 1];
      break;
    case "right":
      d = [-1, v, -u]; // PSV's box: 'left' is the +x face, 'right' the −x face (yaw +90° looks along −x)
      break;
    case "back":
      d = [-u, v, -1];
      break;
    case "left":
      d = [1, v, u];
      break;
    case "top":
      d = flipTopBottom ? [-u, 1, v] : [u, 1, -v];
      break;
    default:
      d = flipTopBottom ? [-u, -1, -v] : [u, -1, v];
  }
  const n = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / n, d[1] / n, d[2] / n];
}

/** Warm the browser cache for a list of same-origin immutable assets; resolves when all settled or the deadline passes. */
async function warmCache(urls: string[], deadlineMs: number): Promise<{ loaded: number; total: number; timedOut: boolean }> {
  let loaded = 0;
  const all = Promise.all(urls.map((u) => fetch(u, { cache: "force-cache" }).then((r) => (r.ok ? r.arrayBuffer().then(() => void loaded++) : undefined)).catch(() => undefined)));
  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), deadlineMs));
  const result = await Promise.race([all.then(() => "done" as const), timeout]);
  return { loaded, total: urls.length, timedOut: result === "timeout" };
}

type Props = {
  scenes: WalkScene[];
  startId: string;
  startYaw?: number;
  label: (scene: WalkScene) => string;
  loadingText: string;
  onSceneChange?: (id: string) => void;
  /** Current view direction as a world yaw in degrees (clockwise, 0 = model +x); throttled to animation frames. */
  onYawChange?: (yawDeg: number) => void;
  /** Full view state (yaw, pitch, field of view) on every change; throttled to animation frames. */
  onViewChange?: (view: TourView) => void;
  /** A floor ring was pressed (before the move completes) — for immediate acknowledgement in the UI. */
  onRingPressed?: (toId: string) => void;
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
    // The base must carry the same flipTopBottom as the tiles: the tiles adapter rotates top/bottom *tiles* from the
    // panorama flag, but hands the base cube to the plain cubemap adapter as given — a bare face map would be drawn
    // unrotated, so the floor would show turned 180° until its tiles arrived (the "floor glitch" after every move).
    baseUrl: { type: "separate" as const, paths: base, flipTopBottom: true },
    levels: usable.map((l) => ({ faceSize: l.faceSize, nbTiles: l.nbTiles })),
    // The export's up/down faces are stored rotated 180° relative to PSV's cube convention; verified in the browser.
    flipTopBottom: true,
    tileUrl: (face: string, col: number, row: number, level: number) => `${scene.faces}/${face}-${indexOf.get(usable[level]?.faceSize ?? 0) ?? level + 1}-${col}-${row}.webp`,
  };
}

/** Horizontal field of view at the default zoom on the 16:10 stage (vertical 66°). */
const DEFAULT_HFOV_DEG = 94;

const PUCK = "/media/portfolio/puck.svg";
const PUCK_HOVER = "/media/portfolio/puck-hover.svg";
const PUCK_ACTIVE = "/media/portfolio/puck-active.svg";

/**
 * A ring lying flat on the floor at the spot the linked sweep occupies — the tap-to-move affordance Matterport
 * users know. `imageLayer` markers are real 3D planes, so perspective foreshortens distant rings naturally. The
 * plane is sized so the drawn ring stays substantial at any distance (the artwork pads a transparent margin, so
 * the tap area is ~1.4× the visible ring and never below ~50 CSS px), and capped so a ring right in front of the
 * visitor does not cover the room.
 */
export function ringSize(distance: number) {
  return Math.max(72, Math.min(190, 300 / Math.max(distance, 0.8)));
}

function floorRing(link: WalkLink, name: string) {
  const size = ringSize(link.distance);
  return {
    id: `go-${link.to}`,
    imageLayer: PUCK,
    position: { yaw: toRad(link.yaw), pitch: toRad(link.pitch) },
    size: { width: size, height: size },
    orientation: "horizontal" as const,
    tooltip: { content: name, position: "top center" },
    zIndex: 5,
    data: { to: link.to, yaw: link.yaw },
  };
}

/** Thin line icons for the navbar (24-grid, 1.5 px strokes) replacing PSV's stock filled glyphs. */
const svg = (body: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const NAVBAR_ICONS = {
  zoomOut: svg('<circle cx="10.5" cy="10.5" r="6.25"/><path d="M15.2 15.2 20 20M7.75 10.5h5.5"/>'),
  zoomIn: svg('<circle cx="10.5" cy="10.5" r="6.25"/><path d="M15.2 15.2 20 20M7.75 10.5h5.5M10.5 7.75v5.5"/>'),
  moveLeft: svg('<path d="M14.25 6.75 9 12l5.25 5.25"/>'),
  moveRight: svg('<path d="M9.75 6.75 15 12l-5.25 5.25"/>'),
  moveUp: svg('<path d="M6.75 14.25 12 9l5.25 5.25"/>'),
  moveDown: svg('<path d="M6.75 9.75 12 15l5.25-5.25"/>'),
  fullscreenIn: svg('<path d="M4 9.25V4h5.25M14.75 4H20v5.25M20 14.75V20h-5.25M9.25 20H4v-5.25"/>'),
  fullscreenOut: svg('<path d="M9.25 4v5.25H4M14.75 4v5.25H20M20 14.75h-5.25V20M4 14.75h5.25V20"/>'),
};

export const VirtualTour = forwardRef<VirtualTourHandle, Props>(function VirtualTour({ scenes, startId, startYaw, label, loadingText, onSceneChange, onYawChange, onViewChange, onRingPressed, onLoadingChange, onError }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const viewer = useRef<ViewerLike | null>(null);
  const plugin = useRef<Plugin | null>(null);
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const callbacks = useRef({ onSceneChange, onYawChange, onViewChange, onRingPressed, onLoadingChange, onError, label });
  callbacks.current = { onSceneChange, onYawChange, onViewChange, onRingPressed, onLoadingChange, onError, label };
  const markersRef = useRef<{ updateMarker(cfg: { id: string; imageLayer: string }): void } | null>(null);
  const viewOf = (v: ViewerLike): TourView => {
    const p = v.getPosition();
    const st = (v as unknown as { state: { hFov: number; vFov: number } }).state;
    return { yawDeg: (p.yaw * 180) / Math.PI, pitchDeg: (p.pitch * 180) / Math.PI, hFovDeg: st.hFov, vFovDeg: st.vFov };
  };
  const navToken = useRef(0);
  const inflight = useRef<Promise<unknown>>(Promise.resolve()); // one PSV transition at a time: a new request waits for the running fade
  const navigate = useRef<(id: string, options?: { instant?: boolean; travelYaw?: number }) => Promise<boolean>>(async () => false);
  navigate.current = async (id, options) => {
    const p = plugin.current;
    const v = viewer.current;
    const scene = scenes.find((s) => s.id === id);
    if (!p || !v || !scene) return false;
    if (p.getCurrentNode()?.id === id) return true; // null while the start node is still loading
    const token = ++navToken.current;
    callbacks.current.onLoadingChange?.(true);
    const instant = options?.instant || prefersReducedMotion();
    const pos = v.getPosition();
    const yawDeg = options?.travelYaw ?? scene.yaw; // face the direction of travel; a jump keeps the scene's curated view
    const stateNow = (v as unknown as { state: { vFov: number; size: { height: number } } }).state;
    const pitchDeg = pitchForRings(scene, Math.max(PITCH_MIN_DEG, Math.min(PITCH_MAX_DEG, (pos.pitch * 180) / Math.PI)), stateNow.vFov, stateNow.size.height);
    try {
      const state = (v as unknown as { state: { hFov: number; vFov: number; size: { width: number; height: number } } }).state;
      const panorama = cubemapPanorama(scene, window.devicePixelRatio || 1, state.size.width);
      // PSV rotates the cube by sphereCorrection.pan about Y, so a viewer yaw ψ shows texture yaw ψ + pan
      const urls = priorityAssets(scene, panorama, { yawDeg: yawDeg + scene.pan, pitchDeg, hFovDeg: state.hFov, vFovDeg: state.vFov }, state.size);
      await Promise.all([warmCache(urls, PRELOAD_DEADLINE_MS), inflight.current.catch(() => undefined)]);
      if (token !== navToken.current) return false; // a newer request took over while this one was preloading
      const run = p.setCurrentNode(id, { effect: instant ? "none" : "fade", rotation: false, speed: instant ? 0 : FADE_MS, showLoader: false, rotateTo: { yaw: toRad(yawDeg), pitch: toRad(pitchDeg) } });
      inflight.current = run;
      await run;
      return token === navToken.current;
    } catch {
      return false;
    } finally {
      if (token === navToken.current) callbacks.current.onLoadingChange?.(false);
    }
  };

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
        adapter: [tiles.CubemapTilesAdapter, { baseBlur: false, showErrorTile: false, antialias: true }], // the base is the master's own 512 px reduction: sharp, never blurred
        navbar: ["zoom", "move", "caption", "fullscreen"],
        keyboard: "fullscreen",
        mousewheel: true,
        touchmoveTwoFingers: false, // one finger looks around once the viewer is active; two fingers pinch-zoom
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
              preload: false, // navigate() warms exactly what the arrival view needs; the plugin's own preloads would abort noisily on every move
              linksOnCompass: false,
              transitionOptions: { showLoader: false, speed: FADE_MS, effect: reduced ? "none" : "fade", rotation: false },
              // The plugin's own 3D arrow cluster stays registered (it drives preloading and transitions) but is hidden;
              // navigation happens through the floor rings below.
              arrowStyle: { style: { display: "none" } },
            },
          ],
        ],
      }) as unknown as ViewerLike;
      viewer.current = v;
      if (process.env.NODE_ENV !== "production") (window as unknown as { __psv?: unknown }).__psv = v; // inspection hook for QA scripts
      // PSV's "fade" ramps the tone-mapping exposure to 5× mid-transition (a white flash); with tone mapping off the
      // exposure is ignored and the transition is a plain opacity cross-fade between the two scenes.
      const three = (v as unknown as { renderer?: { renderer?: { toneMapping: number } } }).renderer?.renderer;
      if (three) three.toneMapping = NO_TONE_MAPPING;
      // Swap the stock navbar glyphs for the thin line set. The fullscreen button re-renders its icon on toggle,
      // so its config gets the new pair as well.
      const navbar = (v as unknown as { navbar: { getButton(id: string, warn?: boolean): { container: HTMLElement; config: { icon?: string; iconActive?: string } } | undefined } }).navbar;
      for (const id of ["zoomOut", "zoomIn", "moveLeft", "moveRight", "moveUp", "moveDown"] as const) {
        const b = navbar.getButton(id, false);
        if (b) b.container.innerHTML = NAVBAR_ICONS[id];
      }
      const fs = navbar.getButton("fullscreen", false);
      if (fs) {
        fs.config.icon = NAVBAR_ICONS.fullscreenIn;
        fs.config.iconActive = NAVBAR_ICONS.fullscreenOut;
        fs.container.innerHTML = NAVBAR_ICONS.fullscreenIn;
      }
      const p = v.getPlugin(tour.VirtualTourPlugin) as Plugin;
      plugin.current = p;
      type MarkerEv = { marker: { id: string; data?: { to?: string; yaw?: number } } };
      const mk = v.getPlugin(markers.MarkersPlugin) as { addEventListener(type: string, cb: (e: MarkerEv) => void): void; updateMarker(cfg: { id: string; imageLayer: string }): void; getMarkers(): Array<{ id: string; config: { imageLayer?: string } }> };
      markersRef.current = mk;
      const setRing = (id: string, image: string) => {
        try {
          mk.updateMarker({ id, imageLayer: image });
        } catch {
          /* marker gone (scene changed) */
        }
      };
      mk.addEventListener("enter-marker", (e) => setRing(e.marker.id, PUCK_HOVER));
      mk.addEventListener("leave-marker", (e) => setRing(e.marker.id, PUCK));
      mk.addEventListener("select-marker", (e) => {
        const to = e.marker.data?.to;
        const link = e.marker.data?.yaw;
        if (!to) return;
        setRing(e.marker.id, PUCK_ACTIVE); // pressed/loading state while the destination preloads
        callbacks.current.onRingPressed?.(to);
        void navigate.current(to, { travelYaw: link });
      });
      v.addEventListener("ready", () => {
        if (cancelled) return;
        setReady(true);
        const first = scenes.find((s) => s.id === (start?.id ?? startId));
        const st = (v as unknown as { state: { vFov: number; size: { height: number } } }).state;
        if (first) {
          const pos = v.getPosition();
          const want = pitchForRings(first, (pos.pitch * 180) / Math.PI, st.vFov, st.size.height);
          if (want < (pos.pitch * 180) / Math.PI - 0.5) (v as unknown as { rotate(o: { yaw: number; pitch: number }): void }).rotate({ yaw: pos.yaw, pitch: toRad(want) });
        }
      }, { once: true });
      let yawFrame = 0;
      const reportView = () => {
        if (yawFrame) return;
        yawFrame = requestAnimationFrame(() => {
          yawFrame = 0;
          if (!viewer.current) return;
          const view = viewOf(v);
          callbacks.current.onYawChange?.(view.yawDeg);
          callbacks.current.onViewChange?.(view);
        });
      };
      v.addEventListener("position-updated", reportView);
      v.addEventListener("zoom-updated", reportView);
      v.addEventListener("panorama-load", () => callbacks.current.onLoadingChange?.(true));
      v.addEventListener("panorama-loaded", () => {
        callbacks.current.onLoadingChange?.(false);
        callbacks.current.onError?.(null);
        setBackdrop(null);
        const pos = v.getPosition?.();
        if (pos) {
          const view = viewOf(v);
          callbacks.current.onYawChange?.(view.yawDeg); // the plan's view cone and the edge hints before the first drag
          callbacks.current.onViewChange?.(view);
        }
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
      goTo(id, options) {
        // a jump from the rail, the plan or "from here": arrive facing the link direction when the scenes are linked
        const from = plugin.current?.getCurrentNode()?.id;
        const link = from ? scenes.find((s) => s.id === from)?.links.find((l) => l.to === id) : undefined;
        return navigate.current(id, { instant: options?.instant, travelYaw: link?.yaw });
      },
      getPosition() {
        return viewer.current?.getPosition() ?? null;
      },
      getView() {
        return viewer.current ? viewOf(viewer.current) : null;
      },
      lookAt(yawDeg, pitchDeg) {
        const v = viewer.current as unknown as { animate(o: { yaw: number; pitch: number; speed: string }): void; rotate(o: { yaw: number; pitch: number }): void } | null;
        if (!v) return;
        if (prefersReducedMotion()) v.rotate({ yaw: toRad(yawDeg), pitch: toRad(pitchDeg) });
        else v.animate({ yaw: toRad(yawDeg), pitch: toRad(pitchDeg), speed: "40rpm" });
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
