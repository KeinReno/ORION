import { describe, expect, it } from "vitest";
import { buildPanelDragId, dragEndWindowTarget, isBlockedDragTarget, isDraggablePanelId, isMacPlatform, panelDragHint, panelDragMode } from "./panel-drag";

const base = { button: 0, ctrlKey: false, metaKey: false, isMac: false, blockedTarget: false };

describe("panelDragMode", () => {
  it("a plain press is a dock drag, Ctrl (Cmd on mac) makes it a window drag", () => {
    expect(panelDragMode(base)).toBe("dock");
    expect(panelDragMode({ ...base, ctrlKey: true })).toBe("window");
    expect(panelDragMode({ ...base, isMac: true, metaKey: true })).toBe("window");
  });
  it("does not treat Ctrl as the modifier on mac (right click) or Cmd off mac", () => {
    expect(panelDragMode({ ...base, isMac: true, ctrlKey: true })).toBeNull();
    expect(panelDragMode({ ...base, metaKey: true })).toBeNull();
  });
  it("rejects non-primary buttons, extra modifiers and blocked targets", () => {
    expect(panelDragMode({ ...base, button: 2 })).toBeNull();
    expect(panelDragMode({ ...base, ctrlKey: true, shiftKey: true })).toBeNull();
    expect(panelDragMode({ ...base, altKey: true })).toBeNull();
    expect(panelDragMode({ ...base, blockedTarget: true })).toBeNull();
    expect(panelDragMode({ ...base, ctrlKey: true, blockedTarget: true })).toBeNull();
  });
});

describe("dragEndWindowTarget", () => {
  const end = { mode: "dock" as const, dropEffect: "none", clientX: 400, clientY: 300, screenX: 900, screenY: 500, innerWidth: 1500, innerHeight: 900 };
  it("dock mode opens a window only when dropped outside the app window", () => {
    expect(dragEndWindowTarget(end)).toBeNull();
    expect(dragEndWindowTarget({ ...end, clientX: 1800 })).toEqual({ x: 900, y: 500 });
    expect(dragEndWindowTarget({ ...end, clientY: -20 })).toEqual({ x: 900, y: 500 });
  });
  it("window mode opens at the drop point, inside or outside the app", () => {
    expect(dragEndWindowTarget({ ...end, mode: "window" })).toEqual({ x: 900, y: 500 });
    expect(dragEndWindowTarget({ ...end, mode: "window", clientX: 2000 })).toEqual({ x: 900, y: 500 });
  });
  it("never when the dock took the drop or the drag was cancelled", () => {
    expect(dragEndWindowTarget({ ...end, mode: "window", dropEffect: "copy" })).toBeNull();
    expect(dragEndWindowTarget({ ...end, mode: "window", screenX: 0, screenY: 0 })).toBeNull();
    expect(dragEndWindowTarget({ ...end, clientX: 1800, screenX: 0, screenY: 0 })).toBeNull();
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
    expect(panelDragHint(false)).toContain("панелью");
  });
});
