import { describe, expect, it } from "vitest";
import { browserArea } from "./native-browser";

describe("native browser surface", () => {
  const viewport = { width: 1280, height: 800 };
  it("uses CSS coordinates and clips the surface to the client area", () => {
    expect(browserArea({ left: 200, top: 140, width: 1000, height: 800 }, viewport)).toEqual({ x: 200, y: 140, width: 1000, height: 660 });
    expect(browserArea({ left: -50, top: 100, width: 500, height: 300 }, viewport)).toEqual({ x: 0, y: 100, width: 450, height: 300 });
  });
  it("hides zero-sized, offscreen and invalid surfaces", () => {
    for (const rect of [{ left: 0, top: 0, width: 0, height: 100 }, { left: 2000, top: 0, width: 100, height: 100 }, { left: 0, top: 0, width: NaN, height: 100 }]) {
      expect(browserArea(rect, viewport)).toBeNull();
    }
  });
});
