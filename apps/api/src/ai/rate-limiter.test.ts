import { describe, expect, it } from "vitest";
import { DEFAULT_AI_RATE_LIMIT, resolveAiRateLimit, SlidingWindowLimiter } from "./rate-limiter";

describe("SlidingWindowLimiter", () => {
  it("пропускает до лимита и отказывает дальше с Retry-After", () => {
    let t = 1_000_000;
    const limiter = new SlidingWindowLimiter(3, 60_000, () => t);
    expect(limiter.consume("a").allowed).toBe(true);
    t += 10_000;
    expect(limiter.consume("a").allowed).toBe(true);
    t += 10_000;
    expect(limiter.consume("a").allowed).toBe(true);
    t += 10_000;
    expect(limiter.consume("a")).toEqual({ allowed: false, retryAfterSeconds: 30 });
  });

  it("окно скользит: старые вызовы выпадают", () => {
    let t = 0;
    const limiter = new SlidingWindowLimiter(2, 60_000, () => t);
    limiter.consume("a");
    t = 30_000;
    limiter.consume("a");
    t = 59_999;
    expect(limiter.consume("a").allowed).toBe(false);
    t = 60_001;
    expect(limiter.consume("a").allowed).toBe(true);
  });

  it("отказанные попытки не продлевают блокировку", () => {
    let t = 0;
    const limiter = new SlidingWindowLimiter(1, 60_000, () => t);
    limiter.consume("a");
    for (t = 1000; t < 50_000; t += 1000) limiter.consume("a");
    t = 60_001;
    expect(limiter.consume("a").allowed).toBe(true);
  });

  it("ключи независимы, а sweep убирает мёртвые", () => {
    let t = 0;
    const limiter = new SlidingWindowLimiter(1, 1000, () => t);
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("b").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);
    t = 5000;
    limiter.sweep();
    expect(limiter.consume("a").allowed).toBe(true);
  });
});

describe("resolveAiRateLimit", () => {
  it("читает положительное целое, иначе дефолт", () => {
    expect(resolveAiRateLimit("30")).toBe(30);
    expect(resolveAiRateLimit(undefined)).toBe(DEFAULT_AI_RATE_LIMIT);
    expect(resolveAiRateLimit("0")).toBe(DEFAULT_AI_RATE_LIMIT);
    expect(resolveAiRateLimit("abc")).toBe(DEFAULT_AI_RATE_LIMIT);
    expect(resolveAiRateLimit("1.5")).toBe(DEFAULT_AI_RATE_LIMIT);
  });
});
