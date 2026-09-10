import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROPERTY_DEMOS } from "@/lib/demo/properties";
import { FACE_NAMES, TILE_LEVELS } from "@/lib/demo/walkthrough";

/**
 * Media integrity for the published walkthrough: every face and tile exists with the right pixel size, tile paths
 * carry the sweep and the level, and the pipeline's own QA manifest (scripts/matterport_capture_qa.py) reports
 * base/tile consistency and neighbour colour differences inside the accepted bounds.
 */
const PUBLIC = join(process.cwd(), "public");
const walk = PROPERTY_DEMOS[0];
const mediaBase = walk.scenes[0].faces.replace(/\/faces\/[^/]+$/, "");
const mediaDir = join(PUBLIC, mediaBase);

/** Pixel size of a WebP file from its container header (VP8, VP8L or VP8X). */
function webpSize(file: string): [number, number] {
  const b = readFileSync(file);
  expect(b.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(b.subarray(8, 12).toString("ascii")).toBe("WEBP");
  const chunk = b.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
  }
  return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
}

describe("walkthrough media", () => {
  it("has every base face and tile at the declared size, with sweep and level in every path", () => {
    const seen = new Set<string>();
    for (const scene of walk.scenes) {
      for (const face of FACE_NAMES) {
        const base = `${scene.faces}/${face}-0.webp`;
        expect(existsSync(join(PUBLIC, base)), base).toBe(true);
        expect(webpSize(join(PUBLIC, base))).toEqual([512, 512]);
        TILE_LEVELS.forEach((level, i) => {
          const tile = level.faceSize / level.nbTiles;
          for (let col = 0; col < level.nbTiles; col++) {
            for (let row = 0; row < level.nbTiles; row++) {
              const url = `${scene.faces}/${face}-${i + 1}-${col}-${row}.webp`;
              expect(url.includes(scene.id) && url.includes(`-${i + 1}-`), url).toBe(true);
              expect(seen.has(url), `duplicate tile path ${url}`).toBe(false);
              seen.add(url);
              expect(existsSync(join(PUBLIC, url)), url).toBe(true);
              expect(webpSize(join(PUBLIC, url)), url).toEqual([tile, tile]);
            }
          }
        });
      }
    }
    expect(seen.size).toBe(walk.scenes.length * FACE_NAMES.length * TILE_LEVELS.reduce((n, l) => n + l.nbTiles * l.nbTiles, 0));
  });

  it("matches the pipeline QA manifest: same master at every level, consistent orientation, bounded neighbour colour differences", () => {
    const qaPath = join(mediaDir, "qa.json");
    expect(existsSync(qaPath), "qa.json (run scripts/matterport_capture_qa.py)").toBe(true);
    const qa = JSON.parse(readFileSync(qaPath, "utf8")) as {
      version: string;
      sweeps: Record<string, { baseVsLevel1: number; baseVsLevel2: number; level1VsLevel2: number; topBottomOrientation: number }>;
      pairs: Record<string, { ev: number; rg: number; bg: number; n: number; weight: number; crossLevel: boolean; exterior: boolean }>;
      thresholds: { levelDiff: number; pairEv: number; pairChroma: number; exteriorPairEv: number; exteriorPairChroma: number };
    };
    expect(qa.version).toBe(mediaBase.split("/").pop());
    for (const scene of walk.scenes) {
      const s = qa.sweeps[scene.id];
      expect(s, `qa entry for ${scene.id}`).toBeTruthy();
      // mean absolute difference (0..255) between the base face and the tile levels reduced to 512 px: sharpness only
      expect(s.baseVsLevel1, `${scene.id} base vs level 1`).toBeLessThan(qa.thresholds.levelDiff);
      expect(s.baseVsLevel2, `${scene.id} base vs level 2`).toBeLessThan(qa.thresholds.levelDiff);
      expect(s.level1VsLevel2, `${scene.id} level 1 vs level 2`).toBeLessThan(qa.thresholds.levelDiff);
      // a rotated top/bottom face at one level would score ~0 here
      expect(s.topBottomOrientation, `${scene.id} top/bottom orientation agreement`).toBeGreaterThan(0.9);
    }
    // neighbouring scenes: luminance and colour-temperature differences on shared surfaces (trusted pairs on the same
    // level; exterior ↔ interior pairs differ by real daylight and are only reported; garden pairs see sky, sun and
    // shade, so their bound is looser)
    let bounded = 0;
    for (const [pair, p] of Object.entries(qa.pairs)) {
      if (p.weight === 0 || p.crossLevel) continue;
      bounded++;
      const ev = p.exterior ? qa.thresholds.exteriorPairEv : qa.thresholds.pairEv;
      const chroma = p.exterior ? qa.thresholds.exteriorPairChroma : qa.thresholds.pairChroma;
      expect(Math.abs(p.ev), `${pair} exposure difference (EV)`).toBeLessThan(ev);
      expect(Math.abs(p.rg), `${pair} red/green shift (%)`).toBeLessThan(chroma);
      expect(Math.abs(p.bg), `${pair} blue/green shift (%)`).toBeLessThan(chroma);
    }
    expect(bounded).toBeGreaterThan(15);
  });
});
