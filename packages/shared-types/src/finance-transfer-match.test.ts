import { describe, expect, it } from "vitest";
import { findTransferPairs, isTransferPair } from "./finance-transfer-match";

const side = (id: string, type: "expense" | "income", accountId: string, amount: number, at: string, extra: object = {}) => ({
  id, type, accountId, totalAmount: amount, occurredAt: at, importedRef: null as string | null, lines: [{}], ...extra
});

describe("isTransferPair", () => {
  const out = side("e", "expense", "a", 50000, "2026-10-01T10:00:00.000Z");
  it("accepts equal amounts on different accounts within three days", () => {
    expect(isTransferPair(out, side("i", "income", "b", 50000, "2026-10-03T10:00:00.000Z"))).toBe(true);
  });
  it("rejects the same account, another amount, a late date, split lines and obligation payments", () => {
    expect(isTransferPair(out, side("i", "income", "a", 50000, "2026-10-01T10:00:00.000Z"))).toBe(false);
    expect(isTransferPair(out, side("i", "income", "b", 50001, "2026-10-01T10:00:00.000Z"))).toBe(false);
    expect(isTransferPair(out, side("i", "income", "b", 50000, "2026-10-05T11:00:00.000Z"))).toBe(false);
    expect(isTransferPair(out, side("i", "income", "b", 50000, "2026-10-01T10:00:00.000Z", { lines: [{}, {}] }))).toBe(false);
    expect(isTransferPair(side("e", "expense", "a", 50000, "2026-10-01T10:00:00.000Z", { importedRef: "obligation:x:1" }), side("i", "income", "b", 50000, "2026-10-01T10:00:00.000Z"))).toBe(false);
  });
  it("never pairs two expenses or an income first", () => {
    expect(isTransferPair(side("a", "income", "a", 1, "2026-10-01T10:00:00.000Z"), side("b", "expense", "b", 1, "2026-10-01T10:00:00.000Z"))).toBe(false);
  });
});

describe("findTransferPairs", () => {
  it("proposes an unambiguous pair", () => {
    const pairs = findTransferPairs([
      side("e", "expense", "a", 70000, "2026-10-01T10:00:00.000Z"),
      side("i", "income", "b", 70000, "2026-10-01T12:00:00.000Z"),
      side("x", "expense", "a", 120, "2026-10-01T12:00:00.000Z")
    ]);
    expect(pairs.map((p) => [p.expense.id, p.income.id])).toEqual([["e", "i"]]);
  });

  it("proposes nothing when the match is ambiguous", () => {
    expect(
      findTransferPairs([
        side("e1", "expense", "a", 500, "2026-10-01T10:00:00.000Z"),
        side("e2", "expense", "a", 500, "2026-10-02T10:00:00.000Z"),
        side("i1", "income", "b", 500, "2026-10-01T11:00:00.000Z")
      ])
    ).toEqual([]);
  });
});
