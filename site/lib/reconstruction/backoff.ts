/** Exponential backoff with full jitter, and a retry helper that respects RetryClass. */
import { ProviderError, type RetryClass } from "./contract";

export type BackoffOptions = { baseMs?: number; maxMs?: number; factor?: number; jitter?: () => number };

/** Delay for `attempt` (0-based) with full jitter: uniform in [0, min(max, base·factor^attempt)]. */
export function backoffDelay(attempt: number, opts: BackoffOptions = {}): number {
  const base = opts.baseMs ?? 1_000;
  const max = opts.maxMs ?? 60_000;
  const factor = opts.factor ?? 2;
  const cap = Math.min(max, base * Math.pow(factor, Math.max(0, attempt)));
  const rand = opts.jitter ?? Math.random;
  return Math.round(cap * Math.min(1, Math.max(0, rand())));
}

/** Polling cadence for a queued/processing provider job. Grows with elapsed time, capped at 60 s. */
export function pollDelay(elapsedMs: number): number {
  if (elapsedMs < 30_000) return 5_000;
  if (elapsedMs < 180_000) return 10_000;
  if (elapsedMs < 900_000) return 20_000;
  return 60_000;
}

export const RETRYABLE: ReadonlySet<RetryClass> = new Set(["retryable", "rate_limited"]);

export function classifyHttp(status: number): RetryClass {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 402) return "insufficient_credits";
  if (status === 429) return "rate_limited";
  if (status === 408 || status >= 500) return "retryable";
  return "fatal";
}

export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 600) * 1000;
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, Math.min(600_000, at - Date.now())) : undefined;
}

/**
 * Retries `fn` for transient failures only. Never retries fatal, unauthorized
 * or insufficient-credit errors, and never retries anything that is not a
 * ProviderError (a bug should surface, not be repeated).
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: BackoffOptions & { attempts?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (!(error instanceof ProviderError) || !RETRYABLE.has(error.retry) || attempt === attempts - 1) throw error;
      await sleep(error.retryAfterMs ?? backoffDelay(attempt, opts));
    }
  }
  throw lastError;
}
