import { describe, expect, it } from "vitest";
import { eventLocalStart, eventShortStart, sumByCurrency } from "./format";

/**
 * S16 (Finance): accounts are not all the same currency (Account.currency,
 * v0.14) — summing raw balance integers across a USD account and a EUR
 * account produces a number that isn't a real amount of anything (100 USD +
 * 100 EUR ≠ 200 of anything). Before this helper existed, DashboardPanel's
 * `financeStats.totalBalance` did exactly that naive `reduce((sum, a) => sum
 * + a.balance, 0)` across every account regardless of currency, then printed
 * it with `formatMoney(total)` — which defaults to the RUB (₽) symbol,
 * so the figure looked like a precise ruble total but wasn't one.
 */
describe("sumByCurrency", () => {
  it("keeps different currencies apart instead of adding them into one misleading total", () => {
    const accounts = [
      { currency: "RUB", balance: 10000 },
      { currency: "USD", balance: 5000 },
      { currency: "RUB", balance: 2000 },
      { currency: "EUR", balance: 3000 }
    ];
    const totals = sumByCurrency(accounts, (a) => a.currency, (a) => a.balance);
    expect(new Map(totals)).toEqual(
      new Map([
        ["RUB", 12000],
        ["USD", 5000],
        ["EUR", 3000]
      ])
    );
    // The naive bug this guards against: a single combined number.
    const naiveSum = accounts.reduce((sum, a) => sum + a.balance, 0);
    expect(totals.length).toBeGreaterThan(1);
    expect(totals.some(([, amount]) => amount === naiveSum)).toBe(false);
  });

  it("returns a single entry, unchanged, for a single-currency workspace (the common case)", () => {
    const accounts = [
      { currency: "RUB", balance: 10000 },
      { currency: "RUB", balance: 2500 }
    ];
    const totals = sumByCurrency(accounts, (a) => a.currency, (a) => a.balance);
    expect(totals).toEqual([["RUB", 12500]]);
  });

  it("handles an empty list", () => {
    expect(sumByCurrency([] as { currency: string; balance: number }[], (a) => a.currency, (a) => a.balance)).toEqual([]);
  });
});

describe("eventLocalStart", () => {
  it("anchors an all-day date on local midnight of its UTC date", () => {
    const d = eventLocalStart({ startAt: "2026-10-03T00:00:00.000Z", allDay: true });
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 3, 0]);
  });

  it("leaves a timed event's instant alone", () => {
    expect(eventLocalStart({ startAt: "2026-10-03T10:15:00.000Z", allDay: false }).toISOString()).toBe(
      "2026-10-03T10:15:00.000Z"
    );
  });

  it("prints an all-day start without a time of day", () => {
    expect(eventShortStart({ startAt: "2026-10-03T00:00:00.000Z", allDay: true })).not.toMatch(/\d:\d\d/);
  });
});
