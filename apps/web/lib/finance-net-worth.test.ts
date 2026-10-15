import { describe, expect, it } from "vitest";
import type { Account, Obligation } from "@orion/shared-types";
import { assetShares, buildNetWorth, convertNetWorth } from "./finance-net-worth";

const account = (id: string, balance: number, currency = "RUB", kind: Account["kind"] = "card", archivedAt: string | null = null): Account => ({
  id, workspaceId: "w", name: id, kind, context: "personal", visibility: "workspace", ownerId: null, currency, startingBalance: 0, balance, archivedAt, createdAt: "", updatedAt: ""
});
const obligation = (patch: Partial<Obligation>): Obligation => ({
  id: "o", workspaceId: "w", name: "Кредит", kind: "credit", direction: "owe", principal: 100000, payment: 10000, interval: "monthly",
  nextDueAt: null, dueDay: null, accountId: null, categoryId: null, note: "", counterparty: "", closedAt: null, createdAt: "", updatedAt: "", ...patch
});

describe("buildNetWorth", () => {
  it("separates assets, overdraft, debts and receivables", () => {
    const result = buildNetWorth(
      [account("a", 500000), account("b", -20000), account("old", 999999, "RUB", "cash", "2026-01-01T00:00:00.000Z")],
      [obligation({ principal: 150000 }), obligation({ id: "p", direction: "owed", principal: 30000 })]
    );
    expect(result.currencies).toEqual([{ currency: "RUB", assets: 500000, accountDebt: 20000, owe: 150000, owed: 30000, net: 360000 }]);
  });

  it("skips closed obligations and counts untracked ones instead of treating them as zero", () => {
    const result = buildNetWorth([account("a", 1000)], [obligation({ closedAt: "2026-02-01T00:00:00.000Z" }), obligation({ principal: null })]);
    expect(result.currencies[0]!.owe).toBe(0);
    expect(result.untracked).toBe(1);
  });

  it("never mixes currencies: an obligation without an account is unassigned when there are several", () => {
    const result = buildNetWorth([account("r", 1000, "RUB"), account("u", 50, "USD")], [obligation({ principal: 700 }), obligation({ id: "u", principal: 20, accountId: "u" })]);
    expect(result.unassigned).toHaveLength(1);
    expect(result.currencies.find((c) => c.currency === "USD")!.owe).toBe(20);
    expect(result.currencies.find((c) => c.currency === "RUB")!.owe).toBe(0);
  });

  it("puts an account-less obligation into the only currency", () => {
    expect(buildNetWorth([account("r", 1000)], [obligation({ principal: 300 })]).currencies[0]!.net).toBe(700);
  });
});

describe("assetShares", () => {
  it("shares positive balances of one currency by account kind", () => {
    const shares = assetShares([account("c", 750, "RUB", "cash"), account("s", 250, "RUB", "savings"), account("x", 999, "USD", "cash"), account("n", -5)], "RUB");
    expect(shares.map((s) => [s.kind, s.share])).toEqual([["cash", 0.75], ["savings", 0.25]]);
  });
});

describe("convertNetWorth", () => {
  const rates = [
    { id: "1", workspaceId: "w", base: "USD", quote: "RUB", rateMicro: 90_000_000, day: "2026-10-01", createdAt: "" },
    { id: "2", workspaceId: "w", base: "RUB", quote: "EUR", rateMicro: 100_000, day: "2026-10-01", createdAt: "" }
  ];

  it("converts every part and builds the net from the converted parts", () => {
    const worth = buildNetWorth([account("r", 1_000_000), account("u", 10_000, "USD")], [obligation({ principal: 200_000, accountId: "r" }), obligation({ id: "x", principal: 1000, accountId: "u" })]);
    const converted = convertNetWorth(worth, "RUB", rates, "2026-10-15");
    expect(converted).toMatchObject({ currency: "RUB", assets: 1_000_000 + 900_000, owe: 200_000 + 90_000, missing: [] });
    expect(converted.net).toBe(converted.assets - converted.accountDebt - converted.owe + converted.owed);
    expect(converted.used.map((u) => u.from)).toEqual(["USD"]);
  });

  it("leaves a currency without a rate OUT and says which", () => {
    const worth = buildNetWorth([account("r", 1_000_000), account("k", 5_000, "KZT")], []);
    const converted = convertNetWorth(worth, "RUB", rates, "2026-10-15");
    expect(converted.assets).toBe(1_000_000);
    expect(converted.missing).toEqual(["KZT"]);
  });

  it("uses an inverse rate and ignores a rate dated after the day", () => {
    const worth = buildNetWorth([account("e", 5_000, "EUR")], []);
    const converted = convertNetWorth(worth, "RUB", rates, "2026-10-15"); // RUB→EUR 0,1 inverted: 1 EUR = 10 RUB
    expect(converted).toMatchObject({ assets: 50_000, missing: [] });
    expect(convertNetWorth(worth, "RUB", rates, "2026-09-30").missing).toEqual(["EUR"]);
  });
});
