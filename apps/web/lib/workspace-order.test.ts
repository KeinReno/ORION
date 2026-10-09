import type { Workspace, WorkspaceOrganization } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { buildSwitcherGroups, filterSwitcherGroups, neighborWorkspace, switchOrder } from "./workspace-order";

const ws = (id: string, name: string): Workspace => ({ id, name }) as Workspace;
const a = ws("a", "Дом");
const b = ws("b", "Работа");
const c = ws("c", "Дача");
const all = [a, b, c];

const org = (patch: Partial<WorkspaceOrganization>): WorkspaceOrganization => ({ spheres: [], favoriteWorkspaceIds: [], ...patch });

describe("buildSwitcherGroups", () => {
  it("is one ungrouped list for an account without spheres or favourites", () => {
    expect(buildSwitcherGroups(all, undefined)).toEqual([{ label: "", workspaces: all }]);
    expect(buildSwitcherGroups(all, org({}))).toEqual([{ label: "", workspaces: all }]);
  });

  it("puts favourites first, then spheres in order, then the rest", () => {
    const groups = buildSwitcherGroups(
      all,
      org({
        favoriteWorkspaceIds: ["c"],
        spheres: [
          { id: "s2", name: "Второй", order: 2, workspaceIds: ["b"] },
          { id: "s1", name: "Первый", order: 1, workspaceIds: ["a"] }
        ]
      })
    );
    expect(groups.map((g) => [g.label, g.workspaces.map((w) => w.id)])).toEqual([
      ["Избранное", ["c"]],
      ["Первый", ["a"]],
      ["Второй", ["b"]],
      // A favourite is repeated where it also belongs; "c" is in no sphere, so it lands in "Другое" too.
      ["Другое", ["c"]]
    ]);
  });

  it("ignores ids of workspaces the user no longer belongs to", () => {
    const groups = buildSwitcherGroups([a], org({ favoriteWorkspaceIds: ["gone", "a"] }));
    expect(groups[0]?.workspaces.map((w) => w.id)).toEqual(["a"]);
  });
});

describe("switchOrder and neighborWorkspace", () => {
  const groups = buildSwitcherGroups(
    all,
    org({ favoriteWorkspaceIds: ["b"], spheres: [{ id: "s", name: "Сфера", order: 1, workspaceIds: ["a", "b"] }] })
  );

  it("lists each workspace once, at its first position", () => {
    expect(switchOrder(groups).map((w) => w.id)).toEqual(["b", "a", "c"]);
  });

  it("walks forward and backward and wraps around", () => {
    const order = switchOrder(groups);
    expect(neighborWorkspace(order, "b", 1)?.id).toBe("a");
    expect(neighborWorkspace(order, "c", 1)?.id).toBe("b");
    expect(neighborWorkspace(order, "b", -1)?.id).toBe("c");
  });

  it("has nowhere to go with fewer than two workspaces", () => {
    expect(neighborWorkspace([a], "a", 1)).toBeUndefined();
    expect(neighborWorkspace([], undefined, 1)).toBeUndefined();
  });

  it("starts from an end when the active workspace is unknown", () => {
    const order = [a, b, c];
    expect(neighborWorkspace(order, "zzz", 1)?.id).toBe("a");
    expect(neighborWorkspace(order, undefined, -1)?.id).toBe("c");
  });
});

describe("filterSwitcherGroups", () => {
  const groups = buildSwitcherGroups(all, org({ favoriteWorkspaceIds: ["a"] }));

  it("keeps everything for an empty query", () => {
    expect(filterSwitcherGroups(groups, "  ")).toEqual(groups);
  });

  it("matches by name ignoring case and drops groups left empty", () => {
    const result = filterSwitcherGroups(groups, "ДА");
    expect(result.flatMap((g) => g.workspaces.map((w) => w.id))).toEqual(["c"]);
    expect(result.every((g) => g.workspaces.length > 0)).toBe(true);
  });

  it("returns nothing when no name matches", () => {
    expect(filterSwitcherGroups(groups, "нет такого")).toEqual([]);
  });
});
