/**
 * LIVE provider smoke test — consumes real credits. Disabled by default.
 *
 *   SODAR_LIVE_SMOKE=1 SODAR_LIVE_PROVIDER=kiri|marble SODAR_LIVE_CONFIRM=yes \
 *   SODAR_LIVE_FIXTURE_DIR=/path/to/real-room-photos KIRI_API_KEY=… npm run test:live
 *
 * The fixture must be a genuine SODAR export (Export originals, unzipped): its
 * frames.json is parsed, one Full 3D room is selected, and only the images
 * that room references are read (20–40 distinct JPEGs from at least three
 * standing positions). Loose folders of JPEGs, quick panoramas, duplicated
 * files and missing manifests are refused, so no credit is ever spent on
 * input a provider cannot reconstruct. It reports the expected credit use before submitting, records
 * the external job identifier to $TMPDIR/sodar-live-smoke.json, polls with the
 * production adapter, and downloads the output well inside the provider's
 * retention window. Credentials are never printed.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { kiriProvider } from "./kiri";
import { marbleProvider } from "./marble";
import { pollDelay } from "./backoff";
import type { ProviderInput } from "./contract";

const enabled = process.env.SODAR_LIVE_SMOKE === "1";
const which = (process.env.SODAR_LIVE_PROVIDER ?? "kiri") as "kiri" | "marble";
const provider = which === "marble" ? marbleProvider : kiriProvider;
const record = join(process.env.TMPDIR ?? tmpdir(), "sodar-live-smoke.json");
export const LIVE_FIXTURE_MIN = 20;
export const LIVE_FIXTURE_MAX = 40;
export const LIVE_MIN_STATIONS = 3;
const MIN_BYTES = 200 * 1024; // a real phone JPEG; rejects thumbnails and synthetic renders
const MANIFEST = "frames.json";

/** Shape written by the scanner's "Export originals (zip)" (schema sodar-frames.v2). */
type ExportManifest = { schema?: string; sessionId?: string; rooms?: Array<{ id?: string; name?: string; mode?: string; frames?: Array<{ file?: string; station?: number; checkpoint?: { index?: number } }> }> };

/** Finds the single frames.json inside an unzipped export (the zip may unpack into a subfolder). */
export function findManifest(dir: string, depth = 0): string[] {
  if (depth > 3) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isFile() && entry.name === MANIFEST) found.push(path);
    else if (entry.isDirectory() && !entry.name.startsWith(".")) found.push(...findManifest(path, depth + 1));
  }
  return found;
}

/** Resolves a manifest-relative frame path, refusing anything that escapes the export folder. */
function resolveFrame(root: string, file: string): string {
  if (!file || file.startsWith("/") || file.startsWith("\\") || /^[A-Za-z]:/.test(file) || file.split(/[\\/]/).includes("..")) throw new Error(`frames.json references an unsafe path: ${JSON.stringify(file)}`);
  const path = resolve(root, file);
  if (!path.startsWith(resolve(root) + sep)) throw new Error(`frames.json references a path outside the export: ${JSON.stringify(file)}`);
  return path;
}

/**
 * Loads a genuine SODAR export as the live fixture. The folder must contain
 * exactly one frames.json (sodar-frames.v2); the room is chosen with
 * SODAR_LIVE_ROOM (id, name or 1-based index) or is the first Full 3D room;
 * only the images that room references are read. Throws with a precise
 * reason instead of padding, duplicating or scanning loose JPEGs.
 */
export function loadLiveFixture(dir: string | undefined, roomSelector = process.env.SODAR_LIVE_ROOM): ProviderInput {
  if (!dir) throw new Error("Set SODAR_LIVE_FIXTURE_DIR to an unzipped SODAR export (Export originals) of a Full 3D scan.");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`SODAR_LIVE_FIXTURE_DIR is not a directory: ${dir}`);
  const manifests = findManifest(dir);
  if (manifests.length === 0) throw new Error("No frames.json found: a paid live test only accepts a SODAR export, never a loose folder of JPEGs.");
  if (manifests.length > 1) throw new Error(`Several exports found (${manifests.length} frames.json); point SODAR_LIVE_FIXTURE_DIR at one of them.`);
  const manifestPath = manifests[0];
  const root = dirname(manifestPath);
  let manifest: ExportManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExportManifest;
  } catch {
    throw new Error("frames.json is not valid JSON.");
  }
  if (!Array.isArray(manifest.rooms) || !manifest.rooms.length) throw new Error(`frames.json (${manifest.schema ?? "unknown schema"}) has no rooms; export from the scanner's results screen (sodar-frames.v2).`);
  const rooms = manifest.rooms;
  let room = rooms.find((candidate) => candidate.mode === "full3d");
  if (roomSelector) {
    const index = Number.parseInt(roomSelector, 10);
    room = rooms.find((candidate) => candidate.id === roomSelector || candidate.name === roomSelector) ?? (Number.isInteger(index) ? rooms[index - 1] : undefined);
    if (!room) throw new Error(`SODAR_LIVE_ROOM=${JSON.stringify(roomSelector)} matches no room in frames.json.`);
  }
  if (!room) throw new Error("No Full 3D room in this export; KIRI needs a translated capture, not a quick panorama.");
  if (room.mode !== "full3d") throw new Error(`Room ${JSON.stringify(room.name ?? room.id)} is a ${room.mode ?? "unknown"} capture; only a Full 3D room may be sent.`);
  const refs = (room.frames ?? []).filter((frame): frame is { file: string; station?: number } => typeof frame.file === "string");
  if (refs.length < LIVE_FIXTURE_MIN || refs.length > LIVE_FIXTURE_MAX) throw new Error(`Room ${JSON.stringify(room.name ?? room.id)} references ${refs.length} photographs; a live smoke test needs ${LIVE_FIXTURE_MIN}–${LIVE_FIXTURE_MAX}.`);
  const stations = new Set(refs.map((frame) => frame.station).filter((station): station is number => Number.isInteger(station)));
  if (stations.size < LIVE_MIN_STATIONS) throw new Error(`Room ${JSON.stringify(room.name ?? room.id)} was captured from ${stations.size} station(s); KIRI needs at least ${LIVE_MIN_STATIONS} distinct standing positions.`);
  const seen = new Map<string, string>();
  const frames = refs.map((frame, index) => {
    const path = resolveFrame(root, frame.file);
    if (!existsSync(path)) throw new Error(`frames.json references a missing image: ${frame.file}`);
    const bytes = new Uint8Array(readFileSync(path));
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) throw new Error(`${frame.file} is not a JPEG.`);
    if (bytes.byteLength < MIN_BYTES) throw new Error(`${frame.file} is ${bytes.byteLength} bytes; real capture frames are expected (≥ ${MIN_BYTES} bytes).`);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const duplicate = seen.get(digest);
    if (duplicate) throw new Error(`${frame.file} duplicates ${duplicate}; duplicated images are never sent to a paid provider.`);
    seen.set(digest, frame.file);
    return { name: basename(frame.file), bytes, mimeType: "image/jpeg", azimuthDeg: (index * 360) / refs.length };
  });
  return { kind: "images", frames: which === "marble" ? frames.filter((_, i) => i % Math.ceil(frames.length / 6) === 0).slice(0, 6) : frames };
}

describe.skipIf(!enabled)(`live smoke: ${which}`, () => {
  it("submits one job from a real capture fixture, polls until done, downloads outputs before expiry", async () => {
    expect(provider.enabled(), "provider key must be configured").toBe(true);
    const input = loadLiveFixture(process.env.SODAR_LIVE_FIXTURE_DIR);
    provider.validateInput(input);
    const estimate = provider.estimateCost(input);
    const balance = await provider.balance();
    console.info(`[live-smoke] provider=${which} images=${input.kind === "images" ? input.frames.length : 1} expectedCredits=${estimate.credits ?? "provider-defined"} balanceBefore=${balance}`);
    if (process.env.SODAR_LIVE_CONFIRM !== "yes") throw new Error("Set SODAR_LIVE_CONFIRM=yes to acknowledge the credit use printed above.");
    const ref = await provider.submit(input, { displayName: "SODAR live smoke" });
    mkdirSync(join(record, ".."), { recursive: true });
    writeFileSync(record, JSON.stringify({ provider: which, externalId: ref.externalId, submittedAt: ref.submittedAt, fixture: process.env.SODAR_LIVE_FIXTURE_DIR, room: process.env.SODAR_LIVE_ROOM ?? "first-full3d" }, null, 2));
    console.info(`[live-smoke] externalId=${ref.externalId} (recorded in ${record})`);
    const started = Date.now();
    for (;;) {
      const status = await provider.status(ref);
      console.info(`[live-smoke] status=${status.status} raw=${status.raw}`);
      if (status.status === "ready") break;
      if (status.status === "failed" || status.status === "expired") throw new Error(`provider reported ${status.status}`);
      if (Date.now() - started > 25 * 60_000) throw new Error("timed out waiting for the provider");
      await new Promise((resolve) => setTimeout(resolve, pollDelay(Date.now() - started)));
    }
    const outputs = await provider.fetchOutputs(ref);
    expect(outputs.length).toBeGreaterThan(0);
    for (const output of outputs) {
      expect(output.bytes.byteLength).toBeGreaterThan(0);
      writeFileSync(join(record, "..", `sodar-live-${which}-${output.name}`), output.bytes);
      console.info(`[live-smoke] output ${output.type} ${output.name} ${output.bytes.byteLength} bytes provenance=${output.provenance}`);
    }
    const after = await provider.balance();
    console.info(`[live-smoke] balanceAfter=${after} consumed=${balance !== null && after !== null ? balance - after : "unknown"}`);
  });
});
