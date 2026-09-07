import { describe, expect, it } from "vitest";
import { buildTour, mergeLinks, provisionalLinks, toPsvNodes, validateTour } from "./tour";

const rooms = [
  { id: "a", name: "Living", ordinal: 1, panorama: "https://x/a.jpg", panoramaProvenance: "captured" as const },
  { id: "b", name: "Kitchen", ordinal: 2, panorama: "https://x/b.jpg", panoramaProvenance: "mixed" as const, generativeWorld: true },
  { id: "c", name: "Hall", ordinal: 3, floor: "upper", panorama: "https://x/c.jpg", panoramaProvenance: "captured" as const },
];

describe("tour manifest", () => {
  it("suggests reciprocal provisional links between rooms in capture order", () => {
    const links = provisionalLinks(["a", "b", "c"]);
    expect(links).toHaveLength(4);
    expect(links.every((l) => !l.confirmed)).toBe(true);
    expect(links.find((l) => l.fromRoomId === "b" && l.toRoomId === "a")?.yaw).toBe(180);
  });
  it("confirmed links replace provisional ones for the same pair and are preserved as confirmed", () => {
    const merged = mergeLinks(provisionalLinks(["a", "b"]), [{ fromRoomId: "a", toRoomId: "b", yaw: 42, pitch: -3, confirmed: true }]);
    expect(merged).toHaveLength(2);
    expect(merged.find((l) => l.fromRoomId === "a")).toMatchObject({ yaw: 42, confirmed: true });
    expect(merged.find((l) => l.fromRoomId === "b")).toMatchObject({ confirmed: false });
  });
  it("builds a tour.v1 manifest with floors, disclosure and normalized angles", () => {
    const tour = buildTour({ scanId: "s", rooms, links: [{ fromRoomId: "a", toRoomId: "b", yaw: 400, pitch: 120, confirmed: true }, { fromRoomId: "a", toRoomId: "zzz", yaw: 0, pitch: 0, confirmed: true }] })!;
    expect(tour.schema_version).toBe("tour.v1");
    expect(tour.startNodeId).toBe("a");
    expect(tour.floors.map((f) => f.id)).toEqual(["ground", "upper"]);
    expect(tour.links).toHaveLength(1);
    expect(tour.links[0]).toMatchObject({ yaw: 40, pitch: 89, confirmed: true, label: "Kitchen" });
    expect(tour.disclosure).toEqual({ aiCompletedRooms: ["b"], generativeWorlds: ["b"] });
    expect(buildTour({ scanId: "s", rooms: [], links: [] })).toBeNull();
  });
  it("validates reachability, dangling links, self links and angles", () => {
    const tour = buildTour({ scanId: "s", rooms, links: mergeLinks(provisionalLinks(["a", "b", "c"]), []) })!;
    expect(validateTour(tour)).toEqual([]);
    const broken = { ...tour, links: [{ from: "a", to: "b", yaw: 0, pitch: 0, confirmed: false }], startNodeId: "a" };
    expect(validateTour(broken).map((p) => p.code)).toContain("unreachable");
    expect(validateTour({ ...tour, links: [...tour.links, { from: "a", to: "a", yaw: 0, pitch: 0, confirmed: true }] }).map((p) => p.code)).toContain("self_link");
    expect(validateTour({ ...tour, links: [...tour.links, { from: "a", to: "q", yaw: 0, pitch: 0, confirmed: true }] }).map((p) => p.code)).toContain("dangling_link");
    expect(validateTour({ ...tour, links: [{ from: "a", to: "b", yaw: 361, pitch: 0, confirmed: true }] }).map((p) => p.code)).toContain("bad_angle");
    expect(validateTour({ ...tour, startNodeId: "nope" }).map((p) => p.code)).toContain("bad_start");
    expect(validateTour({ ...tour, nodes: [] })).toEqual([{ code: "no_nodes" }]);
  });
  it("converts to Photo Sphere Viewer nodes with confirmed flags on links", () => {
    const tour = buildTour({ scanId: "s", rooms, links: mergeLinks(provisionalLinks(["a", "b", "c"]), [{ fromRoomId: "a", toRoomId: "b", yaw: 10, pitch: -5, confirmed: true }]) })!;
    const nodes = toPsvNodes(tour);
    expect(nodes[0].links[0]).toMatchObject({ nodeId: "b", position: { yaw: "10deg", pitch: "-5deg" }, data: { confirmed: true } });
  });
});
