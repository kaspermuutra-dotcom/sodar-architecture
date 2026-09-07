/**
 * LIVE provider smoke test — consumes real credits. Disabled by default.
 *
 *   SODAR_LIVE_SMOKE=1 SODAR_LIVE_PROVIDER=kiri|marble KIRI_API_KEY=… WORLDLABS_API_KEY=… npm run test:live
 *
 * Reports the expected credit use before submitting, uses the bundled
 * synthetic room (site/public/media/demo-frames) as a known-safe fixture,
 * records the external job identifier to $TMPDIR/sodar-live-smoke.json, polls
 * with the production adapter, and downloads the output well inside the
 * provider's retention window. Credentials are never printed.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { kiriProvider } from "./kiri";
import { marbleProvider } from "./marble";
import { pollDelay } from "./backoff";
import type { ProviderInput } from "./contract";

const enabled = process.env.SODAR_LIVE_SMOKE === "1";
const which = (process.env.SODAR_LIVE_PROVIDER ?? "kiri") as "kiri" | "marble";
const provider = which === "marble" ? marbleProvider : kiriProvider;
const fixtureDir = join(process.cwd(), "public", "media", "demo-frames");
const record = join(process.env.TMPDIR ?? tmpdir(), "sodar-live-smoke.json");

function fixtureInput(): ProviderInput {
  const files = readdirSync(fixtureDir).filter((name) => /\.jpe?g$/i.test(name)).sort();
  const frames = files.map((name, index) => ({ name, bytes: new Uint8Array(readFileSync(join(fixtureDir, name))), mimeType: "image/jpeg", azimuthDeg: (index * 360) / files.length }));
  // KIRI needs ≥ 20 photographs; the fixture ring has 12, so it is repeated with distinct names (a smoke test of the pipe, not of quality).
  const padded = which === "kiri" && frames.length < 20 ? [...frames, ...frames].slice(0, 20).map((frame, index) => ({ ...frame, name: `frame-${index}.jpg` })) : frames.slice(0, which === "marble" ? 6 : 300);
  return { kind: "images", frames: padded };
}

describe.skipIf(!enabled)(`live smoke: ${which}`, () => {
  it("submits one job, polls until done, downloads outputs before expiry", async () => {
    expect(provider.enabled(), "provider key must be configured").toBe(true);
    const input = fixtureInput();
    provider.validateInput(input);
    const estimate = provider.estimateCost(input);
    const balance = await provider.balance();
    console.info(`[live-smoke] provider=${which} images=${input.kind === "images" ? input.frames.length : 1} expectedCredits=${estimate.credits ?? "provider-defined"} balanceBefore=${balance}`);
    if (process.env.SODAR_LIVE_CONFIRM !== "yes") throw new Error("Set SODAR_LIVE_CONFIRM=yes to acknowledge the credit use printed above.");
    const ref = await provider.submit(input, { displayName: "SODAR live smoke" });
    mkdirSync(join(record, ".."), { recursive: true });
    writeFileSync(record, JSON.stringify({ provider: which, externalId: ref.externalId, submittedAt: ref.submittedAt }, null, 2));
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
