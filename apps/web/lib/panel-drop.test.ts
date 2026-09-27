import { describe, expect, it } from "vitest";
import {
  ORION_PANEL_DRAG_MIME,
  isOrionPanelDragEvent,
  panelWindowUrl,
  readDraggedPanelId,
  resolveDropAction
} from "./panel-drop";

function fakeDragEvent(types: string[], data?: Record<string, string>): DragEvent {
  return {
    dataTransfer: {
      types,
      getData: (type: string) => data?.[type] ?? ""
    }
  } as unknown as DragEvent;
}

describe("isOrionPanelDragEvent", () => {
  it("detects the ORION panel mime type among others", () => {
    expect(isOrionPanelDragEvent(fakeDragEvent(["text/plain", ORION_PANEL_DRAG_MIME]))).toBe(true);
  });

  it("rejects an unrelated drag (e.g. a dockview internal tab drag, or a file drop)", () => {
    expect(isOrionPanelDragEvent(fakeDragEvent(["Files"]))).toBe(false);
    expect(isOrionPanelDragEvent(fakeDragEvent([]))).toBe(false);
  });

  it("handles a missing dataTransfer without throwing", () => {
    expect(isOrionPanelDragEvent({} as DragEvent)).toBe(false);
  });
});

describe("readDraggedPanelId", () => {
  it("reads the panel id set at dragstart", () => {
    const event = fakeDragEvent([ORION_PANEL_DRAG_MIME], { [ORION_PANEL_DRAG_MIME]: "tasks" });
    expect(readDraggedPanelId(event)).toBe("tasks");
  });

  it("returns null when nothing was set", () => {
    expect(readDraggedPanelId(fakeDragEvent([]))).toBeNull();
  });
});

describe("resolveDropAction", () => {
  const known = new Set(["tasks", "notes", "settings"]);
  const disabled = new Set(["notes"]);

  it("focuses instead of duplicating an already-open panel", () => {
    expect(resolveDropAction("tasks", known, disabled, new Set(["tasks"]))).toEqual({ kind: "focus" });
  });

  it("creates a new panel that isn't open yet", () => {
    expect(resolveDropAction("tasks", known, disabled, new Set())).toEqual({ kind: "create" });
  });

  it("refuses an unknown panel id", () => {
    expect(resolveDropAction("bogus", known, disabled, new Set())).toEqual({ kind: "unknown-panel" });
  });

  it("refuses a panel whose module is disabled in this workspace", () => {
    expect(resolveDropAction("notes", known, disabled, new Set())).toEqual({ kind: "module-disabled" });
  });

  it("refuses a null panel id (drop without a recognized payload)", () => {
    expect(resolveDropAction(null, known, disabled, new Set())).toEqual({ kind: "unknown-panel" });
  });
});

describe("panelWindowUrl", () => {
  it("builds a bare panel url with no workspace hint", () => {
    expect(panelWindowUrl("tasks")).toBe("/panel/tasks");
  });

  it("carries the workspace id, url-encoded", () => {
    expect(panelWindowUrl("tasks", "ws id/1")).toBe("/panel/tasks?workspaceId=ws%20id%2F1");
  });

  it("omits the query string for a null/empty workspace id", () => {
    expect(panelWindowUrl("tasks", null)).toBe("/panel/tasks");
  });

  it("maps an instanced panel id onto its static route plus ?instance=", () => {
    expect(panelWindowUrl("project:p1", "ws1")).toBe("/panel/project?instance=p1&workspaceId=ws1");
    expect(panelWindowUrl("project:p1")).toBe("/panel/project?instance=p1");
  });
});
