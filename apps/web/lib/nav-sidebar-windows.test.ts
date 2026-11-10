import { describe, expect, it } from "vitest";
import {
  dockMessageTargetsSidebar,
  detachNavWindow,
  dockNavWindow,
  heartbeatIsFresh,
  initialNavWindows,
  parseHeartbeat,
  parseNavWindowState,
  rememberNavWindowBounds,
  rememberNavWorkspaceBounds,
} from "./nav-sidebar-windows";

describe("nav window placement", () => {
  it("routes dock requests only to the matching detached sidebar window", () => {
    expect(dockMessageTargetsSidebar({ type: "dock", sidebarId: "side-2" }, "side-2")).toBe(true);
    expect(dockMessageTargetsSidebar({ type: "dock", sidebarId: "side-2" }, "side-3")).toBe(false);
    expect(dockMessageTargetsSidebar({ type: "hello", sidebarId: "side-2" }, "side-2")).toBe(false);
  });

  it("refuses to detach the primary bar", () => {
    const state = initialNavWindows();
    expect(detachNavWindow(state, "primary")).toBe(state);
  });

  it("docks a closed window without touching a sidebar record", () => {
    const detached = detachNavWindow(initialNavWindows(), "side-2", { x: 10, y: 20, width: 280, height: 700 });
    expect(detached.bars["side-2"]?.detached).toBe(true);
    const docked = dockNavWindow(detached, "side-2");
    expect(docked.bars["side-2"]?.detached).toBe(false);
    expect(docked.bars["side-2"]?.bounds).toEqual({ x: 10, y: 20, width: 280, height: 700 });
    expect(dockNavWindow(docked, "side-2")).toBe(docked);
  });

  it("does not resurrect a docked bar when bounds arrive late", () => {
    const docked = dockNavWindow(detachNavWindow(initialNavWindows(), "side-2"), "side-2");
    expect(rememberNavWindowBounds(docked, "side-2", { x: 1, y: 2, width: 3, height: 4 })).toBe(docked);
  });

  it("preserves the workspace window size across the compact same-display mode", () => {
    const detached = detachNavWindow(initialNavWindows(), "side-2", { x: 10, y: 20, width: 280, height: 700 });
    const workspace = rememberNavWorkspaceBounds(detached, "side-2", { x: -1200, y: 30, width: 1280, height: 820 });
    const compact = rememberNavWindowBounds(workspace, "side-2", { x: 10, y: 20, width: 280, height: 700 });
    expect(compact.bars["side-2"]?.bounds).toEqual({ x: 10, y: 20, width: 280, height: 700 });
    expect(compact.bars["side-2"]?.workspaceBounds).toEqual({ x: -1200, y: 30, width: 1280, height: 820 });
  });

  it("drops a primary entry and garbage from storage", () => {
    expect(parseNavWindowState({
      bars: { primary: { detached: true }, "side-2": { detached: true, bounds: { x: 1, y: 2, width: 3, height: 4 } }, nope: null },
    }).bars).toEqual({ "side-2": { detached: true, bounds: { x: 1, y: 2, width: 3, height: 4 } } });
    expect(parseNavWindowState(null)).toEqual(initialNavWindows());
  });

  it("treats a recent heartbeat as a live window and ignores the primary bar", () => {
    expect(parseHeartbeat({ "side-2": 1_000, primary: 1_000, nope: "x" })).toEqual({ "side-2": 1_000 });
    expect(heartbeatIsFresh({ "side-2": 1_000 }, "side-2", 6_000, 6_000)).toBe(true);
    expect(heartbeatIsFresh({ "side-2": 1_000 }, "side-2", 8_000, 6_000)).toBe(false);
    expect(heartbeatIsFresh({}, "side-2", 8_000, 6_000)).toBe(false);
  });
});
