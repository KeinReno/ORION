import { describe, expect, it } from "vitest";
import { canStep, EMPTY_NAV_HISTORY, NAV_HISTORY_LIMIT, recordVisit, stepHistory } from "./nav-history";

const visit = (...ids: string[]) => ids.reduce(recordVisit, EMPTY_NAV_HISTORY);
const any = () => true;

describe("nav history", () => {
  it("records visits in order and ignores a repeat of the current entry", () => {
    const h = recordVisit(visit("a", "b"), "b");
    expect(h.entries).toEqual(["a", "b"]);
    expect(h.index).toBe(1);
  });

  it("steps back and forward without re-recording", () => {
    const back = stepHistory(visit("a", "b", "c"), -1, any)!;
    expect(back.target).toBe("b");
    expect(recordVisit(back.history, "b")).toBe(back.history);
    const forward = stepHistory(back.history, 1, any)!;
    expect(forward.target).toBe("c");
  });

  it("drops the forward branch on a new visit", () => {
    const back = stepHistory(visit("a", "b", "c"), -1, any)!;
    const h = recordVisit(back.history, "d");
    expect(h.entries).toEqual(["a", "b", "d"]);
    expect(canStep(h, 1, any)).toBe(false);
  });

  it("moves a revisited panel to the end instead of duplicating it", () => {
    expect(visit("a", "b", "a").entries).toEqual(["b", "a"]);
  });

  it("skips panels that cannot be shown and reports nothing when none can", () => {
    const h = visit("a", "gone", "c");
    expect(stepHistory(h, -1, id => id !== "gone")!.target).toBe("a");
    expect(stepHistory(h, -1, () => false)).toBeNull();
    expect(stepHistory(EMPTY_NAV_HISTORY, -1, any)).toBeNull();
  });

  it("keeps a bounded history", () => {
    const ids = Array.from({ length: NAV_HISTORY_LIMIT + 10 }, (_, i) => `p${i}`);
    const h = visit(...ids);
    expect(h.entries).toHaveLength(NAV_HISTORY_LIMIT);
    expect(h.entries.at(-1)).toBe(ids.at(-1));
  });
});
