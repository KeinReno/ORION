import { describe, expect, it } from "vitest";
import { readingProblem, withConsumption } from "./home";

const r = (value: number, day: number) => ({ value, readAt: new Date(2026, 9, day, 12).toISOString() });

describe("withConsumption", () => {
  it("is newest first and each entry holds usage since the previous reading by date", () => {
    const out = withConsumption([r(120, 20), r(100, 1), r(110.5, 10)]);
    expect(out.map((x) => x.value)).toEqual([120, 110.5, 100]);
    expect(out.map((x) => x.consumption)).toEqual([9.5, 10.5, null]);
  });
  it("rounds away float noise", () => {
    expect(withConsumption([r(0.1, 1), r(0.3, 2)])[0].consumption).toBe(0.2);
  });
  it("is empty for no readings", () => {
    expect(withConsumption([])).toEqual([]);
  });
});

describe("readingProblem", () => {
  const existing = [r(100, 1), r(150, 20)];
  it("accepts a reading that fits between its neighbours or comes first/last", () => {
    expect(readingProblem(existing, r(120, 10))).toBeNull();
    expect(readingProblem(existing, r(160, 25))).toBeNull();
    expect(readingProblem(existing, r(90, 0))).toBeNull();
    expect(readingProblem([], r(5, 1))).toBeNull();
  });
  it("rejects a reading below the previous one", () => {
    expect(readingProblem(existing, r(99, 5))).toContain("меньше предыдущего");
  });
  it("rejects a reading above the next one by date", () => {
    expect(readingProblem(existing, r(151, 10))).toContain("больше следующего");
  });
});
