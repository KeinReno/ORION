import { describe, expect, it } from "vitest";
import { buildPanelDragId, isBlockedDragTarget, isDraggablePanelId, isMacPlatform, panelDragHint, shouldStartPanelDrag } from "./panel-drag";

const base = { button: 0, ctrlKey: false, metaKey: false, isMac: false, blockedTarget: false };

describe("shouldStartPanelDrag", () => {
  it("ignores a plain press", () => {
    expect(shouldStartPanelDrag(base)).toBe(false);
  });
  it("arms on Ctrl (non-mac) and Cmd (mac)", () => {
    expect(shouldStartPanelDrag({ ...base, ctrlKey: true })).toBe(true);
    expect(shouldStartPanelDrag({ ...base, isMac: true, metaKey: true })).toBe(true);
  });
  it("does not treat Ctrl as the modifier on mac (right click) or Cmd off mac", () => {
    expect(shouldStartPanelDrag({ ...base, isMac: true, ctrlKey: true })).toBe(false);
    expect(shouldStartPanelDrag({ ...base, metaKey: true })).toBe(false);
  });
  it("rejects non-primary buttons, extra modifiers and blocked targets", () => {
    expect(shouldStartPanelDrag({ ...base, ctrlKey: true, button: 2 })).toBe(false);
    expect(shouldStartPanelDrag({ ...base, ctrlKey: true, shiftKey: true })).toBe(false);
    expect(shouldStartPanelDrag({ ...base, ctrlKey: true, blockedTarget: true })).toBe(false);
  });
});

describe("isBlockedDragTarget", () => {
  const handle = { name: "handle" };
  it("blocks controls inside the handle", () => {
    expect(isBlockedDragTarget({ closest: () => ({ name: "input" }) }, handle)).toBe(true);
  });
  it("allows the handle itself and plain text", () => {
    expect(isBlockedDragTarget({ closest: () => handle }, handle)).toBe(false);
    expect(isBlockedDragTarget({ closest: () => null }, handle)).toBe(false);
  });
  it("blocks a missing target", () => {
    expect(isBlockedDragTarget(null, handle)).toBe(true);
  });
  it("passes the documented selector (text fields, tables, editor, events)", () => {
    let selector = "";
    isBlockedDragTarget({ closest: (s) => ((selector = s), null) }, handle);
    for (const part of ["input", "textarea", "table", ".cm-editor", "[data-no-panel-drag]", "contenteditable"]) {
      expect(selector).toContain(part);
    }
  });
});

describe("panel ids", () => {
  it("builds kind:id for known kinds", () => {
    expect(buildPanelDragId("projectplan", "p1")).toBe("projectplan:p1");
    expect(buildPanelDragId("task", "t1")).toBe("task:t1");
    expect(buildPanelDragId("note", "n1")).toBe("note:n1");
  });
  it("rejects unknown kinds and unusable ids", () => {
    expect(buildPanelDragId("secret", "x")).toBeNull();
    expect(buildPanelDragId("note", "")).toBeNull();
    expect(buildPanelDragId("note", undefined)).toBeNull();
    expect(buildPanelDragId("note", "a:b")).toBeNull();
    expect(buildPanelDragId("note", "a b")).toBeNull();
  });
  it("validates ids read back from the DOM", () => {
    expect(isDraggablePanelId("projecttasks:abc")).toBe(true);
    expect(isDraggablePanelId("tasks")).toBe(false);
    expect(isDraggablePanelId("evil:abc")).toBe(false);
    expect(isDraggablePanelId(null)).toBe(false);
  });
});

describe("platform + hint", () => {
  it("detects mac", () => {
    expect(isMacPlatform("MacIntel")).toBe(true);
    expect(isMacPlatform("Win32")).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
  });
  it("names the right modifier and the keyboard alternative", () => {
    expect(panelDragHint(false)).toContain("Ctrl");
    expect(panelDragHint(true)).toContain("Cmd");
    expect(panelDragHint(false)).toContain("Открыть панелью");
  });
});
