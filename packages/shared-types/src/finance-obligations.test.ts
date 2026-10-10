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
