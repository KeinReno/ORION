import { describe, expect, it } from "vitest";
import { catalogConflicts, effectiveCombo, findShortcutConflicts, getShortcutDef, SHORTCUT_CATALOG } from "./catalog";

describe("SHORTCUT_CATALOG", () => {
  it("ships with zero conflicts among its own defaults", () => {
    expect(catalogConflicts({})).toEqual([]);
  });

  it("every id is unique", () => {
    const ids = SHORTCUT_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("getShortcutDef", () => {
  it("finds a known id", () => {
    expect(getShortcutDef("notes.bold")?.label).toBe("Жирный");
  });

  it("is undefined for an unknown id", () => {
    expect(getShortcutDef("nope")).toBeUndefined();
  });
});

describe("effectiveCombo", () => {
  it("falls back to the default when there's no override", () => {
    const def = getShortcutDef("notes.bold")!;
    expect(effectiveCombo(def, {})).toBe("mod+b");
  });

  it("prefers the override", () => {
    const def = getShortcutDef("notes.bold")!;
    expect(effectiveCombo(def, { "notes.bold": "mod+alt+b" })).toBe("mod+alt+b");
  });
});

describe("findShortcutConflicts", () => {
  it("flags two entries in the same scope bound to the same combo (any modifier order)", () => {
    const conflicts = findShortcutConflicts([
      { id: "a", scope: "notes-editor", combo: "mod+shift+k" },
      { id: "b", scope: "notes-editor", combo: "shift+mod+k" }
    ]);
    expect(conflicts).toEqual([{ a: "a", b: "b", combo: "mod+shift+k" }]);
  });

  it("does not flag the same combo in two scopes that never both apply", () => {
    const conflicts = findShortcutConflicts([
      { id: "a", scope: "notes-editor", combo: "mod+b" },
      { id: "b", scope: "tasks-board" as never, combo: "mod+b" }
    ]);
    expect(conflicts).toEqual([]);
  });

  it("flags a clash against a global shortcut from any scope — global is always active", () => {
    const conflicts = findShortcutConflicts([
      { id: "a", scope: "global", combo: "mod+k" },
      { id: "b", scope: "notes-editor", combo: "mod+k" }
    ]);
    expect(conflicts).toEqual([{ a: "a", b: "b", combo: "mod+k" }]);
  });

  it("ignores an unbound (empty-combo) entry", () => {
    expect(findShortcutConflicts([{ id: "a", scope: "notes-editor", combo: "" }, { id: "b", scope: "notes-editor", combo: "" }])).toEqual([]);
  });
});
