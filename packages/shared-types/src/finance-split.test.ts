import { describe, expect, it } from "vitest";
import { computeSplitBalances, createSettlementInputSchema, createSplitInputSchema, equalShares, suggestSettlements } from "./finance-split";

const split = (paidById: string, amount: number, shares: [string, number][], currency = "RUB") => ({
  amount, currency, paidById, shares: shares.map(([userId, share]) => ({ userId, share }))
});

describe("equalShares", () => {
  it("adds up exactly, remainder kopecks to the first people", () => {
    expect(equalShares(1000, ["a", "b", "c"])).toEqual([{ userId: "a", share: 334 }, { userId: "b", share: 333 }, { userId: "c", share: 333 }]);
    expect(equalShares(7, ["a", "b"]).reduce((sum, s) => sum + s.share, 0)).toBe(7);
    expect(equalShares(5, [])).toEqual([]);
  });
});

describe("computeSplitBalances", () => {
  it("credits the payer with what others owe, and sums to zero", () => {
    const balances = computeSplitBalances([split("anya", 3000, [["anya", 1000], ["petya", 1000], ["masha", 1000]])], []);
    expect(balances).toEqual([
      { userId: "anya", currency: "RUB", net: 2000 },
      { userId: "masha", currency: "RUB", net: -1000 },
      { userId: "petya", currency: "RUB", net: -1000 }
    ]);
    expect(balances.reduce((sum, b) => sum + b.net, 0)).toBe(0);
  });

  it("a settlement reduces the debt and can clear it entirely", () => {
    const splits = [split("anya", 2000, [["anya", 1000], ["petya", 1000]])];
    expect(computeSplitBalances(splits, [{ fromUserId: "petya", toUserId: "anya", amount: 400, currency: "RUB" }])).toEqual([
      { userId: "anya", currency: "RUB", net: 600 },
      { userId: "petya", currency: "RUB", net: -600 }
    ]);
    expect(computeSplitBalances(splits, [{ fromUserId: "petya", toUserId: "anya", amount: 1000, currency: "RUB" }])).toEqual([]);
  });

  it("keeps currencies apart", () => {
    const balances = computeSplitBalances([split("a", 100, [["a", 0], ["b", 100]], "USD"), split("b", 500, [["a", 500], ["b", 0]], "RUB")], []);
    expect(balances.filter((b) => b.currency === "USD").map((b) => [b.userId, b.net])).toEqual([["a", 100], ["b", -100]]);
    expect(balances.filter((b) => b.currency === "RUB").map((b) => [b.userId, b.net])).toEqual([["b", 500], ["a", -500]]);
  });
});

describe("suggestSettlements", () => {
  it("clears a chain with the fewest payments", () => {
    // a is owed 300, b owes 100, c owes 200 → two payments, not three.
    const suggestions = suggestSettlements([
      { userId: "a", currency: "RUB", net: 300 },
      { userId: "b", currency: "RUB", net: -100 },
      { userId: "c", currency: "RUB", net: -200 }
    ]);
    expect(suggestions).toEqual([
      { fromUserId: "c", toUserId: "a", amount: 200, currency: "RUB" },
      { fromUserId: "b", toUserId: "a", amount: 100, currency: "RUB" }
    ]);
  });

  it("applying the suggestions leaves everyone at zero", () => {
    const splits = [split("a", 900, [["a", 300], ["b", 300], ["c", 300]]), split("b", 400, [["a", 100], ["b", 100], ["c", 200]])];
    const balances = computeSplitBalances(splits, []);
    const after = computeSplitBalances(splits, suggestSettlements(balances).map((s) => ({ fromUserId: s.fromUserId, toUserId: s.toUserId, amount: s.amount, currency: s.currency })));
    expect(after).toEqual([]);
  });

  it("never nets different currencies against each other", () => {
    const suggestions = suggestSettlements([
      { userId: "a", currency: "RUB", net: 100 }, { userId: "b", currency: "RUB", net: -100 },
      { userId: "b", currency: "USD", net: 50 }, { userId: "a", currency: "USD", net: -50 }
    ]);
    expect(suggestions).toHaveLength(2);
    expect(suggestions.find((s) => s.currency === "USD")).toMatchObject({ fromUserId: "a", toUserId: "b", amount: 50 });
  });
});

describe("input schemas", () => {
  const base = { title: "Продукты", amount: 3000, paidById: "a", occurredAt: "2026-10-01T10:00:00.000Z" };
  it("requires the shares to add up to the amount, once per person", () => {
    expect(createSplitInputSchema.safeParse({ ...base, shares: equalShares(3000, ["a", "b", "c"]) }).success).toBe(true);
    expect(createSplitInputSchema.safeParse({ ...base, shares: [{ userId: "a", share: 1000 }] }).success).toBe(false);
    expect(createSplitInputSchema.safeParse({ ...base, shares: [{ userId: "a", share: 1500 }, { userId: "a", share: 1500 }] }).success).toBe(false);
  });
  it("a settlement needs two different people", () => {
    expect(createSettlementInputSchema.safeParse({ fromUserId: "a", toUserId: "a", amount: 1, occurredAt: "2026-10-01T10:00:00.000Z" }).success).toBe(false);
    expect(createSettlementInputSchema.safeParse({ fromUserId: "a", toUserId: "b", amount: 1, occurredAt: "2026-10-01T10:00:00.000Z" }).success).toBe(true);
  });
});
