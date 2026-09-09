import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROPERTY_DEMOS } from "./properties";
import { FACE_NAMES, WALK_FLOORS, buildWalkthrough, scenePath, validateWalkthrough, worldLink, type GeneratedTour, type WalkthroughCuration } from "./walkthrough";

const PUBLIC = join(__dirname, "..", "..", "public");

describe("walkthrough integrity (every configured property)", () => {
  for (const walk of PROPERTY_DEMOS) {
    describe(walk.slug, () => {
      it("has unique scene ids, valid floors, symmetric links and no dangling references", () => {
        expect(validateWalkthrough(walk)).toEqual([]);
        expect(new Set(walk.scenes.map((s) => s.id)).size).toBe(walk.scenes.length);
        for (const s of walk.scenes) expect(WALK_FLOORS).toContain(s.floor);
      });

      it("reaches every scene from the start (no isolated sweeps)", () => {
        for (const s of walk.scenes) expect(scenePath(walk, walk.startNodeId, s.id), `unreachable ${s.id}`).not.toBeNull();
      });

      it("ships every cube face level, tile, preview, thumbnail, poster and gallery still", () => {
        for (const s of walk.scenes) {
          for (const file of [s.preview, s.thumbnail]) expect(existsSync(join(PUBLIC, file)), file).toBe(true);
          for (const face of FACE_NAMES) {
            expect(existsSync(join(PUBLIC, `${s.faces}/${face}-0.webp`)), `${s.id} ${face} base`).toBe(true);
            s.levels.forEach((level, i) => {
              for (let col = 0; col < level.nbTiles; col++) for (let row = 0; row < level.nbTiles; row++) expect(existsSync(join(PUBLIC, `${s.faces}/${face}-${i + 1}-${col}-${row}.webp`)), `${s.id} ${face} L${i + 1} ${col},${row}`).toBe(true);
            });
          }
        }
        for (const g of walk.gallery) expect(existsSync(join(PUBLIC, g.still)), g.still).toBe(true);
        expect(existsSync(join(PUBLIC, walk.poster))).toBe(true);
        expect(existsSync(join(PUBLIC, walk.ogImage))).toBe(true);
      });

      it("keeps floor changes on the stairs and exterior→interior on the entrance", () => {
        const byId = new Map(walk.scenes.map((s) => [s.id, s]));
        const crossings = walk.scenes.flatMap((s) => s.links.filter((l) => byId.get(l.to)!.floor !== s.floor).map((l) => [s.id, l.to] as const));
        // Each crossing must be one of the curated passages (stairs, front door): never more than a few, never a plain wall.
        expect(crossings.length).toBeGreaterThan(0);
        expect(crossings.length).toBeLessThanOrEqual(6);
        const groundToUpper = crossings.filter(([a, b]) => byId.get(a)!.floor === "ground" && byId.get(b)!.floor === "upper");
        expect(groundToUpper.map(([a]) => byId.get(a)!.labelKey)).toEqual(["stairsBottom"]);
        const outsideToInside = crossings.filter(([a, b]) => byId.get(a)!.floor === "exterior" && byId.get(b)!.floor !== "exterior");
        expect(outsideToInside.map(([a]) => byId.get(a)!.labelKey)).toEqual(["threshold"]);
        // The scripted opening route exists: street → … → entrance → hall.
        const route = scenePath(walk, walk.startNodeId, walk.floorEntry.ground)!;
        expect(route.map((id) => byId.get(id)!.floor)).toEqual([...route.map((id) => byId.get(id)!.floor)].sort((a, b) => (a === "exterior" ? -1 : 0) - (b === "exterior" ? -1 : 0)));
      });

      it("has checkpoints on every floor and gallery stills for real scenes", () => {
        for (const floor of WALK_FLOORS) expect(walk.checkpoints.some((c) => c.floor === floor), floor).toBe(true);
        expect(walk.gallery.length).toBeGreaterThan(0);
      });

      it("documents every excluded sweep with a reason", () => {
        for (const e of walk.excluded) expect(e.reason.length).toBeGreaterThan(10);
      });
    });
  }
});

describe("buildWalkthrough", () => {
  const a = { id: "a", sweep: "a".repeat(32), parent: null, floor: 1, p: [0, 0, 0] as [number, number, number], heading: 90, time: 1, status: "success", faces: "skybox" as const };
  const b = { ...a, id: "b", sweep: "b".repeat(32), p: [2, 0, 0] as [number, number, number], heading: 0 };
  const c = { ...a, id: "c", sweep: "c".repeat(32), p: [2, 2, 1.5] as [number, number, number], floor: 2 };
  const generated: GeneratedTour = { source: "test", floors: [], nodes: [a, b, c], candidateLinks: [{ from: "a", to: "b", yaw: 0, pitch: 0, distance: 2 }, { from: "b", to: "a", yaw: 0, pitch: 0, distance: 2 }], excluded: [], removedRecords: 0 };
  const curation: WalkthroughCuration = {
    slug: "t", title: "T", agent: { name: "n", agency: "g" }, mediaBase: "/m", startNodeId: "a",
    scenes: { a: { labelKey: "x", floor: "ground", lookAt: "b" }, b: { labelKey: "x", floor: "ground" }, c: { labelKey: "x", floor: "upper" } },
    exclude: {}, dropLinks: [], addLinks: [{ from: "b", to: "c" }], adjustLinks: [{ from: "a", to: "b", pitch: -5 }],
    checkpoints: [{ id: "k", nodeId: "a", labelKey: "k", floor: "ground" }], floorEntry: { exterior: "a", ground: "a", upper: "c" }, gallery: [], poster: "/p", ogImage: "/o", indexable: false,
  };

  it("computes world-frame link yaws from positions and applies edits symmetrically", () => {
    expect(worldLink(a, b).yaw).toBe(0); // b is along +x
    expect(worldLink(b, a).yaw).toBe(180);
    const walk = buildWalkthrough(generated, curation);
    const A = walk.scenes.find((s) => s.id === "a")!;
    expect(A.links).toEqual([{ to: "b", yaw: 0, pitch: -5, distance: 2 }]);
    expect(A.yaw).toBe(0);
    expect(A.pan).toBe(90);
    const B = walk.scenes.find((s) => s.id === "b")!;
    expect(B.links.map((l) => l.to).sort()).toEqual(["a", "c"]);
    expect(B.links.find((l) => l.to === "c")!.pitch).toBeGreaterThan(B.links.find((l) => l.to === "a")!.pitch); // climbing: ring sits higher than a flat-floor ring
    expect(walk.scenes.find((s) => s.id === "c")!.links.map((l) => l.to)).toEqual(["b"]);
  });

  it("reports curation problems", () => {
    const walk = buildWalkthrough(generated, { ...curation, floorEntry: { ...curation.floorEntry, exterior: "zzz" }, checkpoints: [{ id: "k", nodeId: "c", labelKey: "k", floor: "ground" }] });
    const codes = validateWalkthrough(walk).map((p) => p.code);
    expect(codes).toContain("bad_floor_entry");
    expect(codes).toContain("bad_checkpoint");
  });

  it("lists sweeps dropped from the tour with their reason", () => {
    const walk = buildWalkthrough(generated, { ...curation, exclude: { c: "duplicate" }, addLinks: [], floorEntry: { exterior: "a", ground: "a", upper: "a" } });
    expect(walk.scenes.map((s) => s.id)).toEqual(["a", "b"]);
    expect(walk.excluded).toEqual([{ sweep: "c".repeat(32), reason: "duplicate" }]);
  });
});
