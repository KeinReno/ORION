import { describe, expect, it } from "vitest";
import { TODAY_HALF_W, coveredByToday } from "./today-badge";

describe("coveredByToday", () => {
  it("drops a week label that would run under the badge from either side", () => {
    expect(coveredByToday(300, 300)).toBe(true);
    expect(coveredByToday(270, 300)).toBe(true);
    expect(coveredByToday(320, 300)).toBe(true);
  });

  it("keeps labels clear of the badge", () => {
    expect(coveredByToday(300 + TODAY_HALF_W, 300)).toBe(false);
    expect(coveredByToday(200, 300)).toBe(false);
  });

  it("uses the clamped badge position at the chart's left edge", () => {
    // Today on the first day: the badge is pushed right to stay readable, and covers the first label.
    expect(coveredByToday(0, 4)).toBe(true);
    expect(coveredByToday(60, 4)).toBe(false);
  });
});
