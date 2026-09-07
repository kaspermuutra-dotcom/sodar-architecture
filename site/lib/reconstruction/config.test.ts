import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providersForMode, reconstructionConfig } from "./config";
import { customerStage, isProviderId } from "./contract";

const env = { ...process.env };
beforeEach(() => {
  for (const key of ["KIRI_API_KEY", "WORLDLABS_API_KEY", "OPENAI_API_KEY", "KIRI_ENABLED", "WORLDLABS_ENABLED", "RECONSTRUCTION_KILL_SWITCH", "RECONSTRUCTION_MODE", "SODAR_DAILY_JOBS_PER_USER"]) delete process.env[key];
});
afterEach(() => {
  process.env = { ...env };
});

describe("provider configuration", () => {
  it("disables providers whose key is missing", () => {
    expect(reconstructionConfig().kiri.enabled).toBe(false);
    expect(reconstructionConfig().marble.enabled).toBe(false);
    expect(providersForMode(undefined)).toEqual([]);
  });
  it("enables with a key, honours explicit flags and the kill switch", () => {
    process.env.KIRI_API_KEY = "k";
    process.env.WORLDLABS_API_KEY = "w";
    expect(providersForMode(undefined)).toEqual(["kiri", "marble"]);
    process.env.WORLDLABS_ENABLED = "0";
    expect(providersForMode(undefined)).toEqual(["kiri"]);
    process.env.RECONSTRUCTION_KILL_SWITCH = "true";
    expect(providersForMode(undefined)).toEqual([]);
    expect(reconstructionConfig().killSwitch).toBe(true);
  });
  it("routes by mode: kiri_only, marble_only, dual", () => {
    process.env.KIRI_API_KEY = "k";
    process.env.WORLDLABS_API_KEY = "w";
    process.env.RECONSTRUCTION_MODE = "kiri_only";
    expect(providersForMode(["kiri", "marble"])).toEqual(["kiri"]);
    process.env.RECONSTRUCTION_MODE = "marble_only";
    expect(providersForMode(["kiri", "marble"])).toEqual(["marble"]);
    process.env.RECONSTRUCTION_MODE = "nonsense";
    expect(reconstructionConfig().mode).toBe("dual");
  });
  it("clamps numeric limits into sane ranges", () => {
    process.env.SODAR_DAILY_JOBS_PER_USER = "-5";
    expect(reconstructionConfig().limits.dailyJobsPerUser).toBe(1);
    process.env.SODAR_DAILY_JOBS_PER_USER = "abc";
    expect(reconstructionConfig().limits.dailyJobsPerUser).toBe(6);
  });
  it("maps every job status to a customer-facing stage", () => {
    expect(customerStage("queued")).toBe("building");
    expect(customerStage("needs_retake")).toBe("attention");
    expect(customerStage("partially_ready")).toBe("ready");
    expect(customerStage("expired")).toBe("stopped");
    expect(isProviderId("kiri")).toBe(true);
    expect(isProviderId("luma")).toBe(false);
  });
});
