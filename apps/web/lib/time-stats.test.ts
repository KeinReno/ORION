import { describe, expect, it } from "vitest";
import { dailyTotals, localDayKey, periodStats, projectShares } from "./time-stats";

// Local noon on Sunday 20 Sep 2026; entries are built from local dates so the suite is zone-independent.
const NOW = new Date(2026, 8, 20, 12, 0);
const at = (dayOffset: number, hour: number, minute = 0): string => new Date(2026, 8, 20 + dayOffset, hour, minute).toISOString();
const entry = (startedAt: string, endedAt: string | null, projectId: string | null = null) => ({ startedAt, endedAt, projectId });

describe("dailyTotals", () => {
  it("returns the last N local days, oldest first, ending today", () => {
    const totals = dailyTotals([], 3, NOW);
    expect(totals.map((d) => d.key)).toEqual(["2026-09-18", "2026-09-19", "2026-09-20"]);
    expect(totals.every((d) => d.minutes === 0)).toBe(true);
  });

  it("adds up the entries of a day", () => {
    const totals = dailyTotals([entry(at(0, 9), at(0, 10)), entry(at(0, 10, 30), at(0, 11, 0)), entry(at(-1, 14), at(-1, 14, 45))], 3, NOW);
    expect(totals.map((d) => d.minutes)).toEqual([0, 45, 90]);
  });

  it("splits a session that crosses midnight between the two days", () => {
    const totals = dailyTotals([entry(at(-1, 23), at(0, 1))], 2, NOW);
    expect(totals.map((d) => d.minutes)).toEqual([60, 60]);
  });

  it("counts a running entry up to now and ignores work outside the window", () => {
    const totals = dailyTotals([entry(at(0, 10), null), entry(at(-30, 9), at(-30, 10))], 2, NOW);
    expect(totals.map((d) => d.minutes)).toEqual([0, 120]);
  });
});

describe("projectShares", () => {
  it("splits the window across projects, largest first, with time of no project kept apart", () => {
    const shares = projectShares(
      [entry(at(0, 9), at(0, 10), "a"), entry(at(-1, 9), at(-1, 12), "b"), entry(at(-1, 13), at(-1, 14), null)],
      7,
      NOW
    );
    expect(shares.map((s) => [s.projectId, s.minutes])).toEqual([["b", 180], ["a", 60], [null, 60]]);
    expect(shares[0]?.percent).toBe(60);
  });

  it("only counts the part of an entry that lies inside the window", () => {
    const shares = projectShares([entry(at(-10, 9), at(-6, 9), "a")], 3, NOW);
    expect(shares).toEqual([]);
  });

  it("is empty when nothing was worked", () => {
    expect(projectShares([], 7, NOW)).toEqual([]);
  });
});

describe("periodStats", () => {
  it("averages over days that had work, not over quiet ones", () => {
    const totals = dailyTotals([entry(at(0, 9), at(0, 11)), entry(at(-2, 9), at(-2, 10))], 7, NOW);
    const stats = periodStats(totals);
    expect(stats).toMatchObject({ total: 180, workedDays: 2, averageWorked: 90 });
    expect(stats.best && localDayKey(stats.best.day)).toBe("2026-09-20");
  });

  it("has no best day for an empty period", () => {
    expect(periodStats(dailyTotals([], 7, NOW))).toMatchObject({ total: 0, workedDays: 0, averageWorked: 0, best: null });
  });
});
