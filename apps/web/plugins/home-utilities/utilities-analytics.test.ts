import { describe, expect, it } from "vitest";
import type { UtilityMonth } from "@orion/shared-types";
import { companySeries, foldCompanies, monthAxis, reconcile, rentShares, tariffImpacts, yearOverYear } from "./utilities-analytics";

let seq = 0;
function month(period: string, rent: number, charges: Record<string, number>, imported: { u?: number; g?: number } = {}): UtilityMonth {
  const utility = Object.values(charges).reduce((s, v) => s + v, 0);
  return {
    id: `m${++seq}`, revision: 1, homeId: "h", period, rentMinor: rent, rentConfirmed: false,
    charges: Object.entries(charges).map(([name, amountMinor], i) => ({ id: `c${seq}-${i}`, name, amountMinor, confirmed: false, note: "" })),
    utilityMinor: utility, confirmedUtilityMinor: 0, grandTotalMinor: utility + rent, confirmedTotalMinor: 0,
    importedUtilityMinor: imported.u ?? null, importedGrandTotalMinor: imported.g ?? null,
    paidMinor: null, remainingMinor: null, payments: [], createdAt: "", updatedAt: ""
  };
}

describe("monthAxis", () => {
  it("keeps missing and empty months as gaps, never zeros", () => {
    const axis = monthAxis([month("2025-01", 100, { A: 10 }), month("2025-02", 0, {}), month("2025-04", 100, { A: 20 })]);
    expect(axis.map((p) => p.period)).toEqual(["2025-01", "2025-02", "2025-03", "2025-04"]);
    expect(axis.map((p) => p.month !== null)).toEqual([true, false, false, true]);
  });
  it("is empty without data", () => expect(monthAxis([month("2025-01", 0, {})])).toEqual([]));
});

describe("companySeries", () => {
  it("stacks per company, null on gaps, folds the tail", () => {
    const axis = monthAxis([month("2025-01", 0, { A: 10, B: 5 }), month("2025-03", 0, { A: 20, C: 1 })]);
    const series = companySeries(axis);
    expect(series.map((s) => s.name)).toEqual(["A", "B", "C"]);
    expect(series[0].values).toEqual([10, null, 20]);
    expect(series[1].values).toEqual([5, null, 0]);
    const folded = foldCompanies(series, 2);
    expect(folded.map((s) => s.name)).toEqual(["A", "Прочие"]);
    expect(folded[1].values).toEqual([5, null, 1]);
  });
});

describe("rentShares", () => {
  it("is null without rent and for gaps", () => {
    const shares = rentShares(monthAxis([month("2025-01", 1000, { A: 250 }), month("2025-03", 0, { A: 5 })]));
    expect(shares[0]?.share).toBe(0.25);
    expect(shares[1]).toBeNull();
    expect(shares[2]?.share).toBeNull();
  });
});

describe("yearOverYear", () => {
  it("pairs the same month of the previous year only when both exist", () => {
    const rows = yearOverYear(monthAxis([month("2024-03", 100, { A: 100 }), month("2024-04", 100, { A: 100 }), month("2025-03", 100, { A: 150 })]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ period: "2025-03", previousPeriod: "2024-03", utilityDeltaMinor: 50, utilityDeltaPercent: 0.5 });
  });
});

describe("tariffImpacts", () => {
  const data = [
    month("2025-04", 0, { A: 100 }), month("2025-05", 0, { A: 100 }), /* июнь — пропуск */
    month("2025-07", 0, { A: 120 }), month("2025-08", 0, { A: 140 }),
    month("2025-11", 0, { A: 160 }), month("2025-12", 0, { A: 200 }), month("2026-01", 0, { A: 220 })
  ];
  const impacts = tariffImpacts(monthAxis(data));
  it("averages known months only and does not cross the neighbouring change", () => {
    expect(impacts[0].beforePeriods).toEqual(["2025-04", "2025-05"]);
    expect(impacts[0].beforeAverageMinor).toBe(100);
    expect(impacts[0].afterPeriods).toEqual(["2025-07", "2025-08", "2025-11"]);
    expect(impacts[0].afterAverageMinor).toBe(140);
    expect(impacts[1].beforePeriods).toEqual(["2025-07", "2025-08", "2025-11"]);
    expect(impacts[1].afterAverageMinor).toBe(210);
    expect(impacts[1].deltaMinor).toBe(70);
  });
  it("returns null when there is no data on a side", () => {
    const only = tariffImpacts(monthAxis([month("2026-01", 0, { A: 5 })]));
    expect(only[0].beforeAverageMinor).toBeNull();
    expect(only[0].deltaMinor).toBeNull();
  });
});

describe("reconcile", () => {
  it("detects differences from data in both directions, ignores equal and absent imports", () => {
    const rows = reconcile([
      month("2024-09", 1000, { A: 100, B: 50 }, { u: 150, g: 1150 }),
      month("2024-10", 1000, { A: 100 }, { u: 100, g: 1650 }),
      month("2026-03", 1000, { A: 100 }, { g: 1750 }),
      month("2026-04", 1000, { A: 100 }, { g: 1000 }),
      month("2026-05", 1000, { A: 100 })
    ]);
    expect(rows.map((r) => [r.period, r.grandDifferenceMinor, r.utilityDifferenceMinor])).toEqual([["2024-10", 550, 0], ["2026-03", 650, null], ["2026-04", -100, null]]);
  });
});
