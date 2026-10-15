import { describe, expect, it } from "vitest";
import { convertMinor, convertWithRate, findRate, formatRate, parseRate, upsertExchangeRateInputSchema } from "./finance-exchange-rates";

const rate = (base: string, quote: string, rateMicro: number, day: string) => ({ base, quote, rateMicro, day });

describe("parseRate / formatRate", () => {
  it("round-trips a typed rate", () => {
    expect(parseRate("92,5")).toBe(92_500_000);
    expect(parseRate(" 92.123456 ")).toBe(92_123_456);
    expect(formatRate(92_500_000)).toBe("92,5");
    expect(formatRate(1_000_000)).toBe("1");
    expect(formatRate(parseRate("0,0125")!)).toBe("0,0125");
  });
  it("rejects what is not a positive rate", () => {
    for (const bad of ["", "abc", "-5", "0", "0,0000001", "1e3", "3000"]) expect(parseRate(bad)).toBeNull();
  });
});

describe("convertMinor", () => {
  it("rounds to the minor unit", () => {
    expect(convertMinor(10_000, 92_500_000)).toBe(925_000); // $100.00 → 9250.00 ₽
    expect(convertMinor(333, 1_500_000)).toBe(500); // 499.5 rounds up
  });
});

describe("findRate", () => {
  const rates = [rate("USD", "RUB", 90_000_000, "2026-09-01"), rate("USD", "RUB", 95_000_000, "2026-10-01"), rate("EUR", "RUB", 100_000_000, "2026-10-05")];

  it("takes the newest rate valid on or before the day", () => {
    expect(findRate(rates, "USD", "RUB", "2026-09-20")).toEqual({ rateMicro: 90_000_000, day: "2026-09-01", inverse: false });
    expect(findRate(rates, "USD", "RUB", "2026-10-15")).toMatchObject({ rateMicro: 95_000_000, day: "2026-10-01" });
  });
  it("does not use a rate from the future", () => {
    expect(findRate(rates, "USD", "RUB", "2026-08-31")).toBeNull();
  });
  it("inverts a rate entered the other way round, and says so", () => {
    const found = findRate(rates, "RUB", "USD", "2026-10-15")!;
    expect(found.inverse).toBe(true);
    expect(found.day).toBe("2026-10-01");
    expect(found.rateMicro).toBe(95_000_000); // the rate as typed, not its rounded reciprocal
    expect(convertWithRate(9_500_000, found)).toBe(100_000); // 95 000 ₽ → $1000.00 exactly
  });
  it("never triangulates through a third currency", () => {
    expect(findRate(rates, "USD", "EUR", "2026-10-15")).toBeNull();
  });
  it("one currency to itself is 1:1", () => {
    expect(findRate([], "RUB", "RUB", "2026-10-15")).toMatchObject({ rateMicro: 1_000_000 });
  });
  it("prefers the newer of a direct and an inverse rate", () => {
    const mixed = [rate("USD", "RUB", 90_000_000, "2026-09-01"), rate("RUB", "USD", 10_000, "2026-10-01")];
    expect(findRate(mixed, "USD", "RUB", "2026-10-15")).toMatchObject({ inverse: true, day: "2026-10-01" });
  });
});

describe("upsertExchangeRateInputSchema", () => {
  it("needs two different three-letter codes and a date", () => {
    expect(upsertExchangeRateInputSchema.safeParse({ base: "USD", quote: "RUB", rateMicro: 1, day: "2026-10-01" }).success).toBe(true);
    expect(upsertExchangeRateInputSchema.safeParse({ base: "USD", quote: "USD", rateMicro: 1, day: "2026-10-01" }).success).toBe(false);
    expect(upsertExchangeRateInputSchema.safeParse({ base: "usd", quote: "RUB", rateMicro: 1, day: "2026-10-01" }).success).toBe(false);
    expect(upsertExchangeRateInputSchema.safeParse({ base: "USD", quote: "RUB", rateMicro: 1, day: "01.10.2026" }).success).toBe(false);
  });
});
