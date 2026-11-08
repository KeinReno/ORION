import { describe, expect, it } from "vitest";
import {
  detachNavWindow,
  dockNavWindow,
  initialNavWindows,
  parseNavWindowState,
  rememberNavWindowBounds,
} from "./nav-sidebar-windows";

describe("nav window placement", () => {
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

  it("drops a primary entry and garbage from storage", () => {
    expect(parseNavWindowState({
      bars: { primary: { detached: true }, "side-2": { detached: true, bounds: { x: 1, y: 2, width: 3, height: 4 } }, nope: null },
    }).bars).toEqual({ "side-2": { detached: true, bounds: { x: 1, y: 2, width: 3, height: 4 } } });
    expect(parseNavWindowState(null)).toEqual(initialNavWindows());
  });
});
