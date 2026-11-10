import { describe, expect, it } from "vitest";
import { displayFromWorkArea, monitorIdentity, placeBesideDisplays, restoreOnDisplays, windowDisplayRelation } from "./display-geometry";

const primary = { x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1 };
const left = { x: -1920, y: 0, width: 1920, height: 1080, scaleFactor: 1 };

describe("display geometry", () => {
  it("turns a 150% monitor left of the primary into negative CSS pixels", () => {
    expect(displayFromWorkArea({ x: -2880, y: 0 }, { width: 2880, height: 1620 }, 1.5)).toEqual({
      x: -1920,
      y: 0,
      width: 1920,
      height: 1080,
      scaleFactor: 1.5
    });
  });

  it("keeps a window on a monitor to the left of the primary", () => {
    const saved = { x: -1600, y: 80, width: 900, height: 700 };
    expect(restoreOnDisplays(saved, [left, primary])).toEqual(saved);
  });

  it("moves a window off a disconnected monitor onto the nearest one that remains", () => {
    const restored = restoreOnDisplays({ x: -4000, y: 40, width: 900, height: 700 }, [primary]);
    expect(restored.x).toBeGreaterThanOrEqual(0);
    expect(restored.x + restored.width).toBeLessThanOrEqual(1920);
  });

  it("places a bar on the left monitor when both sides of the primary are full", () => {
    const placed = placeBesideDisplays({ x: 0, y: 40, width: 1800, height: 800 }, [left, primary]);
    expect(placed.x).toBeLessThan(0);
    expect(placed.x).toBeGreaterThanOrEqual(left.x);
  });

  it("does not park a bar off the only connected display", () => {
    const placed = placeBesideDisplays({ x: 0, y: 10, width: 1800, height: 400 }, [primary]);
    expect(placed.x).toBeGreaterThanOrEqual(0);
    expect(placed.x + placed.width).toBeLessThanOrEqual(primary.width);
  });

  it("routes a detached bar locally only when its center is on a different display", () => {
    const displays = [left, primary];
    const host = { x: 100, y: 60, width: 1400, height: 800 };
    expect(windowDisplayRelation(host, { x: 1500, y: 60, width: 280, height: 800 }, displays)).toBe("same");
    expect(windowDisplayRelation(host, { x: -1800, y: 60, width: 1280, height: 800 }, displays)).toBe("different");
  });

  it("does not guess a route when monitor geometry cannot identify a window", () => {
    expect(windowDisplayRelation(
      { x: 100, y: 60, width: 1400, height: 800 },
      { x: -4000, y: 60, width: 1280, height: 800 },
      [primary]
    )).toBe("unknown");
  });

  it("uses native physical monitor bounds and scale as a distinct monitor identity", () => {
    const same = { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 };
    const other = { position: { x: -2560, y: 0 }, size: { width: 2560, height: 1440 }, scaleFactor: 1.5 };
    expect(monitorIdentity(same)).toBe(monitorIdentity({ ...same }));
    expect(monitorIdentity(other)).not.toBe(monitorIdentity(same));
    expect(monitorIdentity(null)).toBeNull();
  });
});
