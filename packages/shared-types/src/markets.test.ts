import { describe, expect, it } from "vitest";
import { compassBackupToEntries, computePositions, tradeImportInputSchema } from "./markets";

const base = { market: "moex", symbol: "SBER", fee: 0, mode: "real" as const };
const t = (day: number, side: "buy" | "sell", qty: number, price: number, extra: Record<string, unknown> = {}) => ({
  ...base,
  side,
  qty,
  price,
  tradedAt: `2026-03-${String(day).padStart(2, "0")}T10:00:00.000Z`,
  ...extra
});

describe("computePositions", () => {
  it("averages the entry price over buys and realises the difference on a sale", () => {
    const [position] = computePositions([t(1, "buy", 10, 100), t(2, "buy", 10, 120), t(3, "sell", 5, 130)]);
    expect(position).toMatchObject({ qty: 15, avgPrice: 110, realized: 5 * (130 - 110), inconsistent: false });
  });

  it("closes a position fully and reports no average price", () => {
    const [position] = computePositions([t(1, "buy", 4, 50), t(2, "sell", 4, 60)]);
    expect(position).toMatchObject({ qty: 0, avgPrice: null, realized: 40 });
  });

  it("flags a sale larger than what the journal holds instead of inventing a short", () => {
    const [position] = computePositions([t(1, "buy", 1, 10), t(2, "sell", 3, 12)]);
    expect(position?.inconsistent).toBe(true);
    expect(position?.qty).toBe(0);
  });

  it("counts only real trades, in time order, and sums fees", () => {
    const positions = computePositions([
      t(5, "sell", 1, 200, { fee: 0.5 }),
      t(1, "buy", 2, 100, { fee: 1 }),
      t(2, "buy", 100, 1, { mode: "paper" }),
      t(3, "buy", 100, 1, { mode: "historical" })
    ]);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ qty: 1, avgPrice: 100, fees: 1.5, realized: 100 });
  });

  it("keeps instruments of different markets apart", () => {
    const positions = computePositions([t(1, "buy", 1, 10), t(1, "buy", 2, 20, { market: "crypto", symbol: "SBER" })]);
    expect(positions.map((p) => [p.market, p.qty])).toEqual([["moex", 1], ["crypto", 2]]);
  });
});

describe("compassBackupToEntries", () => {
  const entry = (over: Record<string, unknown> = {}) => ({ market: "moex", symbol: "SBER", side: "buy", qty: 10, price: 250.5, ts: 1_770_000_000_000, fee: 1.5, note: "", mode: "real", uid: "u1", deleted_at: null, ...over });

  it("reads a version-2 backup, skipping deleted entries", () => {
    const result = compassBackupToEntries({ format: "compass-journal", version: 2, entries: [entry(), entry({ uid: "u2", deleted_at: 1770000000 })], plans: [] });
    expect(result.problems).toEqual([]);
    expect(result.skippedDeleted).toBe(1);
    expect(result.entries.map((e) => e.uid)).toEqual(["u1"]);
  });

  it("rejects what is not a Compass journal backup", () => {
    expect(compassBackupToEntries({ foo: 1 }).problems[0]).toContain("не резервная копия");
    expect(compassBackupToEntries({ format: "compass-journal", version: 9, entries: [] }).problems).toHaveLength(1);
    expect(compassBackupToEntries(null).problems).toHaveLength(1);
  });

  it("reports an unreadable entry and still reads the others", () => {
    const result = compassBackupToEntries({ format: "compass-journal", version: 1, entries: [entry({ qty: -1 }), entry({ uid: "ok" }), 5] });
    expect(result.entries.map((e) => e.uid)).toEqual(["ok"]);
    expect(result.problems).toHaveLength(2);
  });
});

describe("tradeImportInputSchema", () => {
  it("defaults to a dry run and bounds the batch", () => {
    const one = { uid: "a", mode: "real", market: "moex", symbol: "SBER", side: "buy", qty: 1, price: 1, ts: 1 };
    expect(tradeImportInputSchema.parse({ source: "compass", entries: [one] }).dryRun).toBe(true);
    expect(tradeImportInputSchema.safeParse({ source: "compass", entries: [] }).success).toBe(false);
    expect(tradeImportInputSchema.safeParse({ source: "other", entries: [one] }).success).toBe(false);
  });
});
