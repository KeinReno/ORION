import { describe, expect, it } from "vitest";
import { keyBindingConflicts, keyBindingScopesOverlap, normalizeKeyBinding } from "./commands";

describe("нормализация сочетаний", () => {
  it("приводит регистр и порядок модификаторов", () => {
    expect(normalizeKeyBinding("Shift+Ctrl+K")).toBe("ctrl+shift+k");
    expect(normalizeKeyBinding("cmd + p")).toBe("meta+p");
    expect(normalizeKeyBinding("Control+Option+Delete")).toBe("ctrl+alt+delete");
    expect(normalizeKeyBinding("   ")).toBe("");
  });
});

describe("конфликты горячих клавиш", () => {
  it("пересекаются global и module, но не module и context", () => {
    expect(keyBindingScopesOverlap("global", "module:tasks")).toBe(true);
    expect(keyBindingScopesOverlap("module:tasks", "module:tasks")).toBe(true);
    expect(keyBindingScopesOverlap("module:tasks", "module:notes")).toBe(false);
    expect(keyBindingScopesOverlap("module:tasks", "context:task")).toBe(false);
  });

  it("находит конфликт по одинаковым клавишам и не считает разные области", () => {
    const conflicts = keyBindingConflicts([
      { id: "a", commandId: "core.open-command-palette", keys: "Ctrl+K", scope: "global" },
      { id: "b", commandId: "tasks.create", keys: "ctrl+k", scope: "module:tasks" },
      { id: "c", commandId: "notes.create", keys: "ctrl+k", scope: "module:notes" },
      { id: "d", commandId: "core.open-global-search", keys: "Ctrl+Shift+F", scope: "global" }
    ]);
    const conflict = conflicts.find((item) => item.keys === "ctrl+k");
    expect(conflict).toBeDefined();
    expect(conflict!.bindingIds.sort()).toEqual(["a", "b", "c"]);
    expect(conflicts.some((item) => item.keys === "ctrl+shift+f")).toBe(false);
  });
});
