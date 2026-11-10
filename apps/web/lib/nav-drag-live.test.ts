import { describe, expect, it } from "vitest";
import { placeBarBeside, pointInRect, readSurfaces, resolveNavDropTarget, surfaceAt, NAV_SURFACE_PREFIX } from "./nav-drag-live";

const primary = { x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1 };

describe("nav drag across windows", () => {
  it("opens a new bar beside the host, on the same display", () => {
    expect(placeBarBeside({ x: 100, y: 40, width: 1200, height: 800 }, [primary])).toEqual({ x: 1316, y: 40, width: 280, height: 800 });
  });

  it("keeps the bar on the only display when the right edge is full", () => {
    const placed = placeBarBeside({ x: 0, y: 10, width: 1800, height: 400 }, [primary]);
    expect(placed.x).toBeGreaterThanOrEqual(0);
    expect(placed.x + placed.width).toBeLessThanOrEqual(primary.width);
  });

  it("treats the detached workspace as an open target while preserving compact-bar drops", () => {
    expect(resolveNavDropTarget({ windowKind: "nav", currentSidebarId: "side-2", hasWorkbench: true })).toEqual({ kind: "open" });
    expect(resolveNavDropTarget({ windowKind: "nav", currentSidebarId: "side-2", hasWorkbench: true, hitSidebarId: "side-2" })).toEqual({ kind: "move", sidebarId: "side-2" });
    expect(resolveNavDropTarget({ windowKind: "nav", currentSidebarId: "side-2", hasWorkbench: false })).toEqual({ kind: "move", sidebarId: "side-2" });
  });

  it("prefers a navigation window and ignores a stale or foreign surface", () => {
    const now = 10_000;
    const main = { windowId: "main", kind: "main" as const, bounds: { x: 0, y: 0, width: 1400, height: 900 }, at: now };
    const nav = { windowId: "nav", kind: "nav" as const, sidebarId: "side-2", bounds: { x: 1200, y: 0, width: 300, height: 800 }, at: now };
    expect(pointInRect(1300, 20, nav.bounds)).toBe(true);
    expect(surfaceAt([main, nav], 1300, 20)?.windowId).toBe("nav");
    expect(surfaceAt([main, nav], 100, 20)?.windowId).toBe("main");
    expect(surfaceAt([main, nav], 1300, 20, "nav")?.windowId).toBe("main");
    const entries = {
      [`${NAV_SURFACE_PREFIX}main`]: JSON.stringify(main),
      [`${NAV_SURFACE_PREFIX}old`]: JSON.stringify({ ...nav, windowId: "old", at: now - 20_000 }),
      other: "{}",
    };
    expect(readSurfaces(entries, now).map((surface) => surface.windowId)).toEqual(["main"]);
  });
});
