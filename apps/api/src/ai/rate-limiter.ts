/** Default per-token budget on `/ai/v1`: calls per sliding minute. Override with `ORION_AI_RATE_LIMIT`. */
export const DEFAULT_AI_RATE_LIMIT = 120;
export const AI_RATE_WINDOW_MS = 60_000;

/** `ORION_AI_RATE_LIMIT` as a positive integer; anything else falls back to the default. */
export function resolveAiRateLimit(raw: string | undefined = process.env.ORION_AI_RATE_LIMIT): number {
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_AI_RATE_LIMIT;
}

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * In-memory sliding-window limiter keyed by an arbitrary string (the agent token id).
 * A rejected attempt is NOT counted, so a client that keeps hammering does not extend
 * its own lockout. State is per process and lost on restart — fine for a local bridge.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = AI_RATE_WINDOW_MS,
    private readonly now: () => number = Date.now
  ) {}

  consume(key: string): RateDecision {
    const t = this.now();
    const cutoff = t - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((at) => at > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      const retryMs = recent[0] + this.windowMs - t;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
    }
    recent.push(t);
    this.hits.set(key, recent);
    return { allowed: true };
  }

  /** Drop keys with no live hits so a long-running process does not accumulate dead tokens. */
  sweep(): void {
    const cutoff = this.now() - this.windowMs;
    for (const [key, list] of this.hits) {
      if (list.length === 0 || list[list.length - 1] <= cutoff) this.hits.delete(key);
    }
  }
}
