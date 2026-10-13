import { describe, expect, it } from "vitest";
import { goalProgress } from "./goal";

describe("goalProgress", () => {
  it("is the weighted mean of plans that have progress", () => {
    expect(goalProgress([{ weight: 1, progress: 100 }, { weight: 3, progress: 20 }])).toEqual({ progress: 40, unknown: 0 });
  });

  it("leaves plans without tasks out instead of counting them as 0 %", () => {
    expect(goalProgress([{ weight: 1, progress: 50 }, { weight: 5, progress: null }])).toEqual({ progress: 50, unknown: 1 });
  });

  it("is unknown (null), not 0, when no plan has progress or there are no plans", () => {
    expect(goalProgress([{ weight: 1, progress: null }])).toEqual({ progress: null, unknown: 1 });
    expect(goalProgress([])).toEqual({ progress: null, unknown: 0 });
  });

  it("a genuine 0 % plan counts as 0", () => {
    expect(goalProgress([{ weight: 1, progress: 0 }, { weight: 1, progress: 100 }]).progress).toBe(50);
  });
});
