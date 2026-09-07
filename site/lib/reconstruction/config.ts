/**
 * Server-side provider flags, limits and kill switches. Read from the
 * environment at call time (never cached at module load) so tests and hot
 * reloads see changes. Values are never logged.
 */
import type { ProviderId } from "./contract";

function flag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

function int(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export type RoutingMode = "kiri_only" | "marble_only" | "dual";

export function reconstructionConfig() {
  const killSwitch = flag("RECONSTRUCTION_KILL_SWITCH", false);
  const modeRaw = process.env.RECONSTRUCTION_MODE?.trim();
  const mode: RoutingMode = modeRaw === "kiri_only" || modeRaw === "marble_only" || modeRaw === "dual" ? modeRaw : "dual";
  return {
    killSwitch,
    mode,
    kiri: { enabled: !killSwitch && flag("KIRI_ENABLED", true) && Boolean(process.env.KIRI_API_KEY?.trim()) && mode !== "marble_only" },
    marble: { enabled: !killSwitch && flag("WORLDLABS_ENABLED", true) && Boolean(process.env.WORLDLABS_API_KEY?.trim()) && mode !== "kiri_only" },
    astra: { enabled: !killSwitch && flag("ASTRA_ENABLED", true) && Boolean(process.env.OPENAI_API_KEY?.trim()) },
    aiFill: { enabled: !killSwitch && flag("AI_FILL_ENABLED", true) && Boolean(process.env.OPENAI_API_KEY?.trim()) },
    limits: {
      maxRoomsPerScan: int("SODAR_MAX_ROOMS_PER_SCAN", 12, 1, 100),
      maxImagesPerJob: int("SODAR_MAX_IMAGES_PER_JOB", 300, 20, 300),
      dailyJobsPerUser: int("SODAR_DAILY_JOBS_PER_USER", 6, 1, 1000),
      dailyAstraPerUser: int("SODAR_DAILY_ASTRA_PER_USER", 60, 1, 10_000),
      dailyAiFillPerUser: int("SODAR_DAILY_AI_FILL_PER_USER", 20, 1, 10_000),
      /** Refuse to submit when the provider balance is below this many credits. */
      minKiriBalance: int("KIRI_MIN_BALANCE", 1, 0, 1_000_000),
      minMarbleBalance: int("WORLDLABS_MIN_BALANCE", 1600, 0, 100_000_000),
    },
  };
}

export function providerEnabled(id: ProviderId): boolean {
  const config = reconstructionConfig();
  return id === "kiri" ? config.kiri.enabled : config.marble.enabled;
}

/** Providers to run for a new job, in the order results are expected. Never blocks KIRI on Marble. */
export function providersForMode(requested: ProviderId[] | undefined): ProviderId[] {
  const config = reconstructionConfig();
  const wanted = requested?.length ? requested : (["kiri", "marble"] as ProviderId[]);
  return wanted.filter((id) => (id === "kiri" ? config.kiri.enabled : config.marble.enabled));
}
