import generatedKaldapealse from "@/lib/demo/kaldapealse-tanav-2.sweeps.json";
import planKaldapealse from "@/lib/demo/kaldapealse-tanav-2.plan.json";
import { buildWalkthrough, type GeneratedTour, type Walkthrough, type WalkthroughCuration } from "@/lib/demo/walkthrough";

/**
 * Property-specific content for the walkthrough projects under
 * `/portfolio/<slug>`. Everything about *this house* lives in its curation
 * below; the viewer, rail, floor navigation and manifest builder are
 * reusable. Adding a second property = one more generated JSON (from
 * `scripts/matterport_capture_tour.py`) plus one more curation entry.
 *
 * Kaldapealse tänav 2 — curated on 2026-09-09 after inspecting all 41
 * candidate panoramas with their computed hotspot directions overlaid:
 * • the four `low_overlap` re-shots sit within 0.5 m of a successfully
 *   aligned sweep and carry weaker poses, so they are left out;
 * • candidate links that only "connect" through a wall, a window or the
 *   closed terrace glazing are dropped;
 * • links the distance rule missed (the 7 m street gap, the stair crossing,
 *   the kitchen→main-room opening, the dining↔kitchen opening, the garden
 *   loop closure) are added by hand; every addition was checked against the
 *   panorama so the arrow lands on the doorway or path.
 * Room names are only used where the imagery makes the function plain
 * (kitchen island and hob, bathroom fixtures); other rooms stay neutral.
 */

// Version segment: bump (t1 → t2) whenever the tiles are regenerated; the CDN caches this path immutably.
const M = "/media/portfolio/kaldapealse-tanav-2/t1";

const kaldapealseCuration: WalkthroughCuration = {
  slug: "kaldapealse-tanav-2",
  title: "Kaldapealse tänav 2",
  agent: { name: "Ruslan Gulida", agency: "RE/MAX" },
  mediaBase: M,
  // Opening viewpoint (chosen visually, 2026-09-09): the front-garden sweep facing the entrance — the whole
  // facade with its round windows, the steps and the path in one balanced frame, with the first floor ring on
  // the path toward the door. The street sweeps stay one ring behind for context.
  startNodeId: "f761f98a",
  scenes: {
    // outside — street, front garden, entrance
    "8c8a7ac5": { labelKey: "street", variant: 1, floor: "exterior", lookAt: "e1d8e3b2" },
    e1d8e3b2: { labelKey: "street", variant: 2, floor: "exterior", lookAt: "f761f98a" },
    f761f98a: { labelKey: "frontGarden", floor: "exterior", yaw: 44 },
    "9708a1e8": { labelKey: "entranceSteps", floor: "exterior", lookAt: "6adf3a13" },
    "6adf3a13": { labelKey: "frontDoor", floor: "exterior", lookAt: "67139777" },
    "67139777": { labelKey: "threshold", floor: "exterior", lookAt: "9960ad3a" },
    // outside — garden loop and terrace
    "93016101": { labelKey: "garden", variant: 1, floor: "exterior", lookAt: "9f0410de" },
    "9f0410de": { labelKey: "garden", variant: 2, floor: "exterior", lookAt: "93016101" },
    "5aaa75c2": { labelKey: "garden", variant: 3, floor: "exterior", lookAt: "836ae58d" },
    "836ae58d": { labelKey: "garden", variant: 4, floor: "exterior", lookAt: "a7cbb55f" },
    a7cbb55f: { labelKey: "garden", variant: 5, floor: "exterior", lookAt: "c80691fc" },
    c80691fc: { labelKey: "garden", variant: 6, floor: "exterior", lookAt: "31e18ff1" },
    "31e18ff1": { labelKey: "backGarden", floor: "exterior", lookAt: "64c45ade" },
    "64c45ade": { labelKey: "terrace", variant: 1, floor: "exterior", lookAt: "6933932f" },
    "6933932f": { labelKey: "terrace", variant: 2, floor: "exterior", lookAt: "e3e179a3" },
    e3e179a3: { labelKey: "terrace", variant: 3, floor: "exterior", lookAt: "6933932f" },
    // ground floor
    "9960ad3a": { labelKey: "hallway", variant: 1, floor: "ground", lookAt: "6075ef93" },
    "6075ef93": { labelKey: "hallway", variant: 2, floor: "ground", lookAt: "80b0056a" },
    "80b0056a": { labelKey: "hallway", variant: 3, floor: "ground", lookAt: "f85e95a3" },
    f85e95a3: { labelKey: "hallway", variant: 4, floor: "ground", lookAt: "fbd51372" },
    f4c34f0d: { labelKey: "stairsBottom", floor: "ground", lookAt: "453f34b1" },
    fbd51372: { labelKey: "kitchen", variant: 1, floor: "ground", lookAt: "f4e36aa6" },
    f4e36aa6: { labelKey: "kitchen", variant: 2, floor: "ground", lookAt: "8a5134b6" },
    "795122f1": { labelKey: "kitchen", variant: 3, floor: "ground", lookAt: "f0cd9cf0" },
    "95b353d9": { labelKey: "kitchen", variant: 4, floor: "ground", lookAt: "bf2609e1" },
    f0cd9cf0: { labelKey: "bathroom", floor: "ground", lookAt: "795122f1" },
    "8a5134b6": { labelKey: "mainRoom", variant: 1, floor: "ground", lookAt: "52c0066c" },
    "52c0066c": { labelKey: "mainRoom", variant: 2, floor: "ground", lookAt: "8a5134b6" },
    "437a3f0f": { labelKey: "room", variant: 1, floor: "ground", lookAt: "6075ef93" },
    bf2609e1: { labelKey: "room", variant: 2, floor: "ground", lookAt: "95b353d9" },
    // upper floor
    "453f34b1": { labelKey: "stairs", floor: "upper", lookAt: "917be4db" },
    "917be4db": { labelKey: "upperLanding", floor: "upper", lookAt: "b37eec57" },
    "30833d82": { labelKey: "upperRoom", variant: 1, floor: "upper", lookAt: "349d9a99" },
    "289e49f7": { labelKey: "upperRoom", variant: 2, floor: "upper", lookAt: "30833d82" },
    "349d9a99": { labelKey: "upperRoom", variant: 3, floor: "upper", lookAt: "30833d82" },
    b37eec57: { labelKey: "upperBathroom", variant: 1, floor: "upper", lookAt: "925dd397" },
    "925dd397": { labelKey: "upperBathroom", variant: 2, floor: "upper", lookAt: "b37eec57" },
  },
  exclude: {
    e4b461ee: "low_overlap re-shot 0.21 m from kitchen sweep fbd51372; weaker pose, no processed skybox",
    f228f9e5: "low_overlap re-shot 0.21 m from bathroom sweep f0cd9cf0; weaker pose, no processed skybox",
    aa5000b8: "low_overlap re-shot 0.40 m from kitchen sweep f4e36aa6; weaker pose, no processed skybox",
    d80bd505: "low_overlap re-shot 0.47 m from room sweep bf2609e1; weaker pose, no processed skybox",
  },
  dropLinks: [
    ["437a3f0f", "a7cbb55f"], // room window ↔ garden
    ["52c0066c", "e3e179a3"], // main room ↔ terrace through closed glazing
    ["8a5134b6", "6933932f"], // main room ↔ terrace through closed glazing
    ["795122f1", "6933932f"], // kitchen window ↔ terrace
    ["93016101", "f4c34f0d"], // garden ↔ stair hall through the wall
  ],
  addLinks: [
    { from: "8c8a7ac5", to: "e1d8e3b2" }, // along the street to the gate (7.3 m)
    { from: "f4c34f0d", to: "453f34b1" }, // up the stairs (floor change)
    { from: "f4e36aa6", to: "8a5134b6" }, // kitchen → main room through the wide opening
    { from: "795122f1", to: "f0cd9cf0" }, // kitchen → bathroom door
    { from: "8a5134b6", to: "52c0066c" }, // across the main room
    { from: "f85e95a3", to: "fbd51372" }, // hall → kitchen doorway
    { from: "95b353d9", to: "fbd51372" }, // dining end → kitchen island
    { from: "c80691fc", to: "31e18ff1" }, // garden path along the hedge
  ],
  adjustLinks: [
    // First ring: lifted from the foot of the steps so it sits inside the opening frame (default pitch −6°).
    { from: "f761f98a", to: "9708a1e8", pitch: -30 },
  ],
  checkpoints: [
    { id: "outside", nodeId: "f761f98a", labelKey: "outside", floor: "exterior" },
    { id: "entrance", nodeId: "6adf3a13", labelKey: "entrance", floor: "exterior" },
    { id: "terrace", nodeId: "6933932f", labelKey: "terrace", floor: "exterior" },
    { id: "hallway", nodeId: "6075ef93", labelKey: "hallway", floor: "ground" },
    { id: "kitchen", nodeId: "fbd51372", labelKey: "kitchen", floor: "ground" },
    { id: "main-room", nodeId: "8a5134b6", labelKey: "mainRoom", floor: "ground" },
    { id: "stairs", nodeId: "f4c34f0d", labelKey: "stairs", floor: "ground" },
    { id: "upper-landing", nodeId: "917be4db", labelKey: "upperLanding", floor: "upper" },
    { id: "upper-room", nodeId: "30833d82", labelKey: "upperRoom", floor: "upper" },
  ],
  floorEntry: { exterior: "f761f98a", ground: "6075ef93", upper: "917be4db" },
  gallery: [
    { nodeId: "8c8a7ac5", labelKey: "street" },
    { nodeId: "e3e179a3", labelKey: "terrace" },
    { nodeId: "f4c34f0d", labelKey: "stairsBottom" },
    { nodeId: "fbd51372", labelKey: "kitchen" },
    { nodeId: "52c0066c", labelKey: "mainRoom" },
    { nodeId: "f0cd9cf0", labelKey: "bathroom" },
    { nodeId: "349d9a99", labelKey: "upperRoom" },
    { nodeId: "925dd397", labelKey: "upperBathroom" },
  ],
  poster: `${M}/poster.webp`,
  ogImage: `${M}/og.jpg`,
  // Public use confirmed for the portfolio (publishing brief, 2026-09-09).
  indexable: true,
  plan: planKaldapealse,
};

export const PROPERTY_DEMOS: Walkthrough[] = [buildWalkthrough(generatedKaldapealse as GeneratedTour, kaldapealseCuration)];

export function getPropertyDemo(slug: string): Walkthrough | undefined {
  return PROPERTY_DEMOS.find((demo) => demo.slug === slug);
}
