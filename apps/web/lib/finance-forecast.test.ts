import type { Obligation } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { buildForecast, dueState, nextMonths, plannedPayments } from "./finance-forecast";

const NOW = new Date(2026, 9, 10, 12, 0); // 10 Oct 2026

describe("nextMonths", () => {
  it("lists the following calendar months across a year end", () => {
    expect(nextMonths(new Date(2026, 10, 15), 3)).toEqual(["2026-12", "2027-01", "2027-02"]);
  });
});

describe("buildForecast", () => {
  const history = [
    { month: "2026-07", income: 100_000, expense: 70_000 },
    { month: "2026-08", income: 100_000, expense: 90_000 },
    { month: "2026-09", income: 100_000, expense: 80_000 }
  ];

  it("carries the average month forward and brackets it with the worst and best month", () => {
    const forecast = buildForecast(history, 500_000, NOW, 3);
    expect(forecast).toMatchObject({ averageIncome: 100_000, averageExpense: 80_000, averageNet: 20_000, warnings: [] });
    expect(forecast.points.map((p) => p.month)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(forecast.points[0]).toEqual({ month: "2026-11", balance: 520_000, low: 510_000, high: 530_000 });
    expect(forecast.points[2]).toEqual({ month: "2027-01", balance: 560_000, low: 530_000, high: 590_000 });
  });

  it("says so when there is nothing to build on, and when there is little", () => {
    expect(buildForecast([], 100, NOW).warnings[0]).toContain("Нет истории");
    expect(buildForecast([], 100, NOW).points).toEqual([]);
    expect(buildForecast(history.slice(0, 2), 100, NOW).warnings[0]).toContain("только 2");
  });

  it("ignores empty months instead of averaging zeros into the result", () => {
    const withGap = [...history, { month: "2026-06", income: 0, expense: 0 }];
    expect(buildForecast(withGap, 0, NOW).averageNet).toBe(20_000);
  });

  it("a deficit history projects a falling balance, possibly below zero", () => {
    const f = buildForecast([{ month: "2026-09", income: 10_000, expense: 30_000 }, { month: "2026-08", income: 10_000, expense: 30_000 }, { month: "2026-07", income: 10_000, expense: 30_000 }], 30_000, NOW, 2);
    expect(f.points.map((p) => p.balance)).toEqual([10_000, -10_000]);
  });
});

function obligation(over: Partial<Obligation>): Obligation {
  return {
    id: "o1",
    workspaceId: "w",
    name: "Кредит",
    kind: "credit",
    direction: "owe",
    principal: null,
    payment: 10_000,
    interval: "monthly",
    nextDueAt: "2026-10-15T09:00:00.000Z",
    dueDay: 15,
    accountId: null,
    categoryId: null,
    note: "",
    counterparty: "",
    closedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over
  };
}

describe("plannedPayments", () => {
  it("unrolls a monthly obligation through the horizon, in date order", () => {
    const list = plannedPayments([obligation({})], new Date("2026-12-31T00:00:00.000Z"));
    expect(list.map((p) => p.dueAt.slice(0, 10))).toEqual(["2026-10-15", "2026-11-15", "2026-12-15"]);
  });
  it("keeps the 31st through February", () => {
    const list = plannedPayments([obligation({ nextDueAt: "2027-01-31T09:00:00.000Z", dueDay: 31 })], new Date("2027-04-30T23:59:00.000Z"));
    expect(list.map((p) => p.dueAt.slice(0, 10))).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  });
  it("stops when a tracked principal runs out and shrinks the last payment", () => {
    const list = plannedPayments([obligation({ principal: 25_000 })], new Date("2027-12-31T00:00:00.000Z"));
    expect(list.map((p) => p.amount)).toEqual([10_000, 10_000, 5_000]);
  });
  it("skips closed obligations and ones without a due date; a one-off appears once", () => {
    const end = new Date("2027-12-31T00:00:00.000Z");
    expect(plannedPayments([obligation({ closedAt: "2026-01-01T00:00:00.000Z" }), obligation({ id: "o2", nextDueAt: null })], end)).toEqual([]);
    expect(plannedPayments([obligation({ interval: "once" })], end)).toHaveLength(1);
  });
});

describe("dueState", () => {
  it("separates overdue, the coming week and later", () => {
    expect(dueState("2026-10-09T09:00:00.000Z", NOW)).toBe("overdue");
    expect(dueState(new Date(2026, 9, 10, 8, 0).toISOString(), NOW)).toBe("soon");
    expect(dueState(new Date(2026, 9, 17, 8, 0).toISOString(), NOW)).toBe("soon");
    expect(dueState(new Date(2026, 9, 30, 8, 0).toISOString(), NOW)).toBe("later");
    expect(dueState(null, NOW)).toBe("none");
  });
});
