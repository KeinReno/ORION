import { describe, expect, it } from "vitest";
import { applyProjectOrder, moveProject, projectOrderKey, projectPinKey, stepProject, togglePin } from "./project-order";

const p = (id: string) => ({ id });

describe("applyProjectOrder", () => {
  it("orders by the saved list and appends unknown projects after, keeping their given order", () => {
    expect(applyProjectOrder([p("a"), p("b"), p("c"), p("d")], ["c", "a"]).map((x) => x.id)).toEqual(["c", "a", "b", "d"]);
  });
  it("ignores ids that no longer exist", () => {
    expect(applyProjectOrder([p("a")], ["gone", "a"]).map((x) => x.id)).toEqual(["a"]);
  });
});

describe("moveProject", () => {
  it("moves before a target and to the end", () => {
    const all = ["a", "b", "c", "d"];
    expect(moveProject(all, all, "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(moveProject(all, all, "a", null)).toEqual(["b", "c", "d", "a"]);
  });
  it("is a no-op for itself / unknown targets", () => {
    const all = ["a", "b"];
    expect(moveProject(all, all, "a", "a")).toEqual(all);
    expect(moveProject(all, all, "a", "zzz")).toEqual(all);
    expect(moveProject(all, all, "zzz", "a")).toEqual(all);
  });
  it("keeps hidden (filtered-out) projects in their slots", () => {
    // b is hidden by a filter; visible are a, c, d. Move d before a.
    const result = moveProject(["a", "b", "c", "d"], ["a", "c", "d"], "d", "a");
    expect(result).toEqual(["d", "b", "a", "c"]);
  });
  it("gives never-ordered visible projects a place", () => {
    expect(moveProject([], ["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });
});

describe("stepProject", () => {
  const all = ["a", "b", "c"];
  it("moves one place up or down and stops at the edges", () => {
    expect(stepProject(all, all, "b", -1)).toEqual(["b", "a", "c"]);
    expect(stepProject(all, all, "b", 1)).toEqual(["a", "c", "b"]);
    expect(stepProject(all, all, "a", -1)).toEqual(all);
    expect(stepProject(all, all, "c", 1)).toEqual(all);
  });
});

it("keys by user and workspace", () => {
  expect(projectOrderKey("u", "w1")).not.toBe(projectOrderKey("u", "w2"));
  expect(projectPinKey("u", "w1")).not.toBe(projectPinKey("u", "w2"));
  expect(projectPinKey("u", "w1")).not.toBe(projectOrderKey("u", "w1"));
});

describe("togglePin", () => {
  it("adds an unpinned id and removes an already-pinned one", () => {
    expect(togglePin([], "a")).toEqual(["a"]);
    expect(togglePin(["a"], "b")).toEqual(["a", "b"]);
    expect(togglePin(["a", "b"], "a")).toEqual(["b"]);
  });
});
