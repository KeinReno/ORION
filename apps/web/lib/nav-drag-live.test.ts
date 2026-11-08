import { describe, expect, it } from "vitest";
import { NAV_SURFACE_PREFIX, placeBarBeside, pointInRect, readSurfaces, surfaceAt } from "./nav-drag-live";

describe("nav drag across windows", () => {
  it("opens a new bar beside the host, on the same display", () => {
    expect(placeBarBeside({ x: 100, y: 40, width: 1200, height: 800 }, 1920)).toEqual({ x: 1316, y: 40, width: 280, height: 800 });
  });

  it("keeps the bar on the host display when the right edge is full", () => {
    const placed = placeBarBeside({ x: 0, y: 10, width: 1800, height: 400 }, 1920);
    expect(placed.x).toBeLessThan(0);
    expect(placed.y).toBe(10);
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
