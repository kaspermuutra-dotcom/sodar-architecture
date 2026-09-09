import { normalizeYaw, validateTour, type TourManifest, type TourProblem } from "@/lib/scanner/tour";

/**
 * Linked 360° walkthrough built from a Matterport Capture export.
 *
 * Two inputs meet here: the *generated* file written by
 * `scripts/matterport_capture_tour.py` (sweep poses, floors, candidate links
 * derived from positions) and a *curated* description (labels, floor zones,
 * checkpoints, link corrections). `buildWalkthrough` merges them into the
 * repository's `tour.v1` manifest so the scanner's validator and Photo Sphere
 * Viewer adapter apply unchanged.
 *
 * Angles: every panorama is rotated into the model frame in the viewer
 * (`sphereCorrection.pan = heading`), so link yaws are world headings —
 * clockwise-positive, 0° along the model's +x axis — and a visitor keeps
 * facing the direction of travel when a hotspot swaps the panorama.
 */

export type WalkFloor = "exterior" | "ground" | "upper";
export const WALK_FLOORS: readonly WalkFloor[] = ["exterior", "ground", "upper"];

/** Cube face names as written by scripts/matterport_capture_faces.py (Photo Sphere Viewer's cubemap naming). */
export const FACE_NAMES = ["left", "front", "right", "back", "top", "bottom"] as const;
export type FaceName = (typeof FACE_NAMES)[number];
/** Tile levels above the 512 px base: level 1 = 1536 px faces in 2×2 tiles, level 2 = 3072 px faces in 4×4 tiles. */
export const TILE_LEVELS: ReadonlyArray<{ faceSize: number; nbTiles: number }> = [
  { faceSize: 1536, nbTiles: 2 },
  { faceSize: 3072, nbTiles: 4 },
];

export type GeneratedSweep = {
  id: string;
  sweep: string;
  parent: string | null;
  floor: number;
  p: [number, number, number];
  heading: number;
  time: number | null;
  status: string | null;
  faces: "skybox" | "512";
};
export type GeneratedLink = { from: string; to: string; yaw: number; pitch: number; distance: number };
export type GeneratedTour = {
  source: string;
  floors: Array<{ index: number | null; name: string | null }>;
  nodes: GeneratedSweep[];
  candidateLinks: GeneratedLink[];
  excluded: Array<{ sweep: string | null; status: string | null; reason: string }>;
  removedRecords: number;
};

export type SceneCuration = {
  /** Key under `PropertyDemo.scenes` in the messages files. */
  labelKey: string;
  /** Disambiguates repeated labels ("Garden 2"). */
  variant?: number;
  floor: WalkFloor;
  /** Initial view: face this scene id. Falls back to `yaw`, then the first link. */
  lookAt?: string;
  /** Initial view as a world yaw in degrees. */
  yaw?: number;
};

export type LinkEdit = { from: string; to: string; yaw?: number; pitch?: number };

export type WalkthroughCuration = {
  slug: string;
  title: string;
  agent: { name: string; agency: string };
  mediaBase: string;
  startNodeId: string;
  /** Every included sweep, keyed by node id. Generated sweeps absent from this map are excluded with a reason. */
  scenes: Record<string, SceneCuration>;
  /** Sweeps deliberately left out, with the reason shown in the report. */
  exclude: Record<string, string>;
  /** Candidate links to remove (both directions). */
  dropLinks: Array<[string, string]>;
  /** Links to add (both directions, angles computed from the poses unless given). */
  addLinks: LinkEdit[];
  /** Per-direction angle corrections for links whose computed hotspot misses the doorway. */
  adjustLinks: LinkEdit[];
  checkpoints: Array<{ id: string; nodeId: string; labelKey: string; floor: WalkFloor }>;
  /** Entry scene per floor for the floor selector. */
  floorEntry: Record<WalkFloor, string>;
  /** Real stills (rectilinear crops of scenes) shown as a small gallery. */
  gallery: Array<{ nodeId: string; labelKey: string }>;
  poster: string;
  ogImage: string;
  indexable: boolean;
  /** Generated plan transform (plan.json); images are resolved under `<mediaBase>/plan/`. */
  plan: GeneratedPlan;
};

export type WalkLink = { to: string; yaw: number; pitch: number; distance: number };

/** Top-down plan renders (from the scan's depth data) and the world→pixel transform, from scripts/matterport_capture_floorplan.py. */
export type PlanLevel = {
  image: string;
  /** World x of the image's left edge and world y of its top edge (metres, model frame). */
  originX: number;
  originY: number;
  width: number;
  height: number;
};
export type WalkthroughPlan = {
  metresPerPixel: number;
  levels: Record<WalkFloor, PlanLevel>;
};
type GeneratedPlanLevel = { originX: number; originY: number; width: number; height: number };
export type GeneratedPlan = { metresPerPixel: number; levels: { outside: GeneratedPlanLevel; ground: GeneratedPlanLevel; upper: GeneratedPlanLevel }; floorZ: Record<string, number>; source: string };

export type WalkScene = {
  id: string;
  sweep: string;
  labelKey: string;
  variant?: number;
  floor: WalkFloor;
  /** Directory of this scene's cube faces: `<face>-0.webp` base, `<face>-<level>-<col>-<row>.webp` tiles. */
  faces: string;
  levels: ReadonlyArray<{ faceSize: number; nbTiles: number }>;
  preview: string;
  thumbnail: string;
  /** Rotation applied to the panorama so yaw 0 is the model's +x axis (degrees). */
  pan: number;
  /** Initial world yaw in degrees. */
  yaw: number;
  position: [number, number, number];
  links: WalkLink[];
};

export type Walkthrough = {
  slug: string;
  title: string;
  agent: { name: string; agency: string };
  startNodeId: string;
  scenes: WalkScene[];
  checkpoints: WalkthroughCuration["checkpoints"];
  floorEntry: Record<WalkFloor, string>;
  gallery: Array<{ nodeId: string; labelKey: string; still: string }>;
  poster: string;
  ogImage: string;
  indexable: boolean;
  plan: WalkthroughPlan;
  /** Sweeps in the export that are not part of the tour, with the reason. */
  excluded: Array<{ sweep: string; reason: string }>;
  /** `tour.v1` view of the same graph for validation and the PSV adapter. */
  tour: TourManifest;
  provenance: string;
};

/** Camera height above the floor assumed for placing floor rings (handheld capture at eye level). */
export const EYE_HEIGHT_M = 1.4;

/**
 * World yaw (clockwise-positive, 0 = +x) of the hotspot in `a` pointing at `b`, the pitch of the spot on the
 * floor where `b` stands (a ring drawn there reads like Matterport's), and the horizontal distance.
 */
export function worldLink(a: GeneratedSweep, b: GeneratedSweep): { yaw: number; pitch: number; distance: number } {
  const dx = b.p[0] - a.p[0];
  const dy = b.p[1] - a.p[1];
  const dz = b.p[2] - a.p[2];
  const distance = Math.hypot(dx, dy);
  const theta = (Math.atan2(dy, dx) * 180) / Math.PI;
  // The target's floor is EYE_HEIGHT_M below the target camera; on stairs dz lifts the spot onto the treads.
  const pitch = Math.max(-40, Math.min(12, (Math.atan2(dz - EYE_HEIGHT_M, Math.max(distance, 0.4)) * 180) / Math.PI));
  return { yaw: normalizeYaw(-theta), pitch: Math.round(pitch * 10) / 10, distance: Math.round(distance * 100) / 100 };
}

export function buildWalkthrough(generated: GeneratedTour, curation: WalkthroughCuration): Walkthrough {
  const byId = new Map(generated.nodes.map((n) => [n.id, n]));
  const included = generated.nodes.filter((n) => curation.scenes[n.id] && !curation.exclude[n.id]);
  const ids = new Set(included.map((n) => n.id));
  const pair = (a: string, b: string) => `${a}>${b}`;

  const links = new Map<string, WalkLink & { from: string }>();
  const put = (from: string, to: string, edit?: LinkEdit) => {
    const a = byId.get(from);
    const b = byId.get(to);
    if (!a || !b || !ids.has(from) || !ids.has(to) || from === to) return;
    const base = worldLink(a, b);
    links.set(pair(from, to), { from, to, yaw: edit?.yaw ?? base.yaw, pitch: edit?.pitch ?? base.pitch, distance: base.distance });
  };
  for (const link of generated.candidateLinks) put(link.from, link.to);
  for (const [a, b] of curation.dropLinks) {
    links.delete(pair(a, b));
    links.delete(pair(b, a));
  }
  for (const edit of curation.addLinks) {
    put(edit.from, edit.to, edit);
    put(edit.to, edit.from);
  }
  for (const edit of curation.adjustLinks) {
    const existing = links.get(pair(edit.from, edit.to));
    if (existing) links.set(pair(edit.from, edit.to), { ...existing, yaw: edit.yaw ?? existing.yaw, pitch: edit.pitch ?? existing.pitch });
  }

  const scenes: WalkScene[] = included.map((n) => {
    const cur = curation.scenes[n.id];
    const own = [...links.values()].filter((l) => l.from === n.id).sort((a, b) => a.distance - b.distance);
    let yaw = cur.yaw;
    if (yaw === undefined && cur.lookAt && byId.has(cur.lookAt)) yaw = worldLink(n, byId.get(cur.lookAt)!).yaw;
    if (yaw === undefined) yaw = own[0]?.yaw ?? 0;
    return {
      id: n.id,
      sweep: n.sweep,
      labelKey: cur.labelKey,
      variant: cur.variant,
      floor: cur.floor,
      faces: `${curation.mediaBase}/faces/${n.id}`,
      levels: TILE_LEVELS,
      preview: `${curation.mediaBase}/pano/${n.id}.preview.webp`,
      thumbnail: `${curation.mediaBase}/thumb/${n.id}.webp`,
      pan: n.heading,
      yaw: normalizeYaw(yaw),
      position: n.p,
      links: own.map(({ to, yaw: y, pitch, distance }) => ({ to, yaw: y, pitch, distance })),
    };
  });

  const excluded = [
    ...generated.excluded.map((e) => ({ sweep: e.sweep ?? "?", reason: e.reason })),
    ...generated.nodes.filter((n) => !ids.has(n.id)).map((n) => ({ sweep: n.sweep, reason: curation.exclude[n.id] ?? "not curated into the tour" })),
  ];

  const tour: TourManifest = {
    schema_version: "tour.v1",
    scanId: curation.slug,
    propertyName: curation.title,
    startNodeId: curation.startNodeId,
    floors: WALK_FLOORS.map((floor) => ({ id: floor, label: floor, roomIds: scenes.filter((s) => s.floor === floor).map((s) => s.id) })),
    nodes: scenes.map((s) => ({ id: s.id, name: s.variant ? `${s.labelKey} ${s.variant}` : s.labelKey, floor: s.floor, panorama: `${s.faces}/front-0.webp`, panoramaProvenance: "captured", thumbnail: s.thumbnail, splat: null })),
    links: scenes.flatMap((s) => s.links.map((l) => ({ from: s.id, to: l.to, yaw: l.yaw, pitch: l.pitch, confirmed: true }))),
    generatedAt: "2026-09-09T00:00:00.000Z",
    disclosure: { aiCompletedRooms: [], generativeWorlds: [] },
  };

  return {
    slug: curation.slug,
    title: curation.title,
    agent: curation.agent,
    startNodeId: curation.startNodeId,
    scenes,
    checkpoints: curation.checkpoints,
    floorEntry: curation.floorEntry,
    gallery: curation.gallery.map((g) => ({ ...g, still: `${curation.mediaBase}/stills/${g.nodeId}.webp` })),
    poster: curation.poster,
    ogImage: curation.ogImage,
    indexable: curation.indexable,
    plan: {
      metresPerPixel: curation.plan.metresPerPixel,
      levels: {
        exterior: { image: `${curation.mediaBase}/plan/outside.webp`, ...curation.plan.levels.outside },
        ground: { image: `${curation.mediaBase}/plan/ground.webp`, ...curation.plan.levels.ground },
        upper: { image: `${curation.mediaBase}/plan/upper.webp`, ...curation.plan.levels.upper },
      },
    },
    excluded,
    tour,
    provenance: generated.source,
  };
}

export type WalkthroughProblem = TourProblem | { code: "bad_floor" | "bad_checkpoint" | "bad_floor_entry" | "one_way_link" | "bad_gallery"; nodeId?: string; detail?: string };

/** Structural checks beyond `validateTour`: floors, checkpoints, floor entries, symmetric links, gallery references. Asset existence is checked in the test with the filesystem. */
export function validateWalkthrough(walk: Walkthrough): WalkthroughProblem[] {
  const problems: WalkthroughProblem[] = [...validateTour(walk.tour)];
  const ids = new Set(walk.scenes.map((s) => s.id));
  for (const scene of walk.scenes) {
    if (!WALK_FLOORS.includes(scene.floor)) problems.push({ code: "bad_floor", nodeId: scene.id, detail: String(scene.floor) });
    for (const link of scene.links) {
      const back = walk.scenes.find((s) => s.id === link.to)?.links.some((l) => l.to === scene.id);
      if (!back) problems.push({ code: "one_way_link", detail: `${scene.id}>${link.to}` });
    }
  }
  for (const cp of walk.checkpoints) {
    if (!ids.has(cp.nodeId)) problems.push({ code: "bad_checkpoint", nodeId: cp.nodeId, detail: cp.id });
    else if (walk.scenes.find((s) => s.id === cp.nodeId)!.floor !== cp.floor) problems.push({ code: "bad_checkpoint", nodeId: cp.nodeId, detail: `${cp.id}: floor mismatch` });
  }
  for (const floor of WALK_FLOORS) {
    const entry = walk.floorEntry[floor];
    if (!ids.has(entry) || walk.scenes.find((s) => s.id === entry)!.floor !== floor) problems.push({ code: "bad_floor_entry", nodeId: entry, detail: floor });
  }
  for (const g of walk.gallery) if (!ids.has(g.nodeId)) problems.push({ code: "bad_gallery", nodeId: g.nodeId });
  return problems;
}

/** Shortest hop path between two scenes (used to keep floor changes on the stairs). */
export function scenePath(walk: Walkthrough, from: string, to: string): string[] | null {
  const prev = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === to) break;
    for (const link of walk.scenes.find((s) => s.id === id)?.links ?? []) {
      if (!prev.has(link.to)) {
        prev.set(link.to, id);
        queue.push(link.to);
      }
    }
  }
  if (!prev.has(to)) return null;
  const path: string[] = [];
  for (let cur: string | null = to; cur !== null; cur = prev.get(cur) ?? null) path.unshift(cur);
  return path;
}
