import { describe, expect, it } from "vitest";
import { advanceObligationDue } from "./finance-obligations";

const d = (iso: string): Date => new Date(iso);

describe("advanceObligationDue", () => {
  it("moves a monthly due date one month on, keeping the day", () => {
    expect(advanceObligationDue(d("2026-03-10T09:00:00.000Z"), "monthly")?.toISOString()).toBe("2026-04-10T09:00:00.000Z");
  });
  it("clamps the 29th–31st to the last day of a shorter month, and does not drift afterwards", () => {
    expect(advanceObligationDue(d("2026-01-31T09:00:00.000Z"), "monthly")?.toISOString()).toBe("2026-02-28T09:00:00.000Z");
    expect(advanceObligationDue(d("2028-01-30T09:00:00.000Z"), "monthly")?.toISOString()).toBe("2028-02-29T09:00:00.000Z");
  });
  it("keeps the anchor day through a short month instead of drifting to the 28th for good", () => {
    const feb = advanceObligationDue(d("2026-01-31T09:00:00.000Z"), "monthly", 31)!;
    expect(feb.toISOString()).toBe("2026-02-28T09:00:00.000Z");
    expect(advanceObligationDue(feb, "monthly", 31)?.toISOString()).toBe("2026-03-31T09:00:00.000Z");
    // Without the anchor the old behaviour (documented): the day is whatever the date has.
    expect(advanceObligationDue(feb, "monthly")?.toISOString()).toBe("2026-03-28T09:00:00.000Z");
    // A leap-day yearly payment returns to the 29th in the next leap year.
    const common = advanceObligationDue(d("2028-02-29T09:00:00.000Z"), "yearly", 29)!;
    expect(common.toISOString()).toBe("2029-02-28T09:00:00.000Z");
  });

  it("rolls December into January of the next year", () => {
    expect(advanceObligationDue(d("2026-12-15T09:00:00.000Z"), "monthly")?.toISOString()).toBe("2027-01-15T09:00:00.000Z");
  });
  it("moves a yearly date a year on (29 Feb → 28 Feb in a common year)", () => {
    expect(advanceObligationDue(d("2028-02-29T09:00:00.000Z"), "yearly")?.toISOString()).toBe("2029-02-28T09:00:00.000Z");
    expect(advanceObligationDue(d("2026-05-01T09:00:00.000Z"), "yearly")?.toISOString()).toBe("2027-05-01T09:00:00.000Z");
  });
  it("has no next date for a one-off obligation", () => {
    expect(advanceObligationDue(d("2026-05-01T09:00:00.000Z"), "once")).toBeNull();
  });
});
