import { expect, it } from "vitest";
import { depthOffset } from "./depth-model";
it("bounds foreground displacement at maximum strength, including malformed sensor samples", () => {
  for (const x of [-100, -1, 0, 1, 100, NaN, Infinity]) {
    const result = depthOffset(x, -x, 100);
    expect(Number.isFinite(result.x) && Number.isFinite(result.y)).toBe(true);
    expect(Math.abs(result.x) * 1.7).toBeLessThanOrEqual(4);
    expect(Math.abs(result.y) * 1.7).toBeLessThanOrEqual(4);
  }
  expect(depthOffset(1, -1, 0)).toEqual({ x: 0, y: -0 });
  expect(depthOffset(1, 1, 1000)).toEqual(depthOffset(1, 1, 100));
  expect(depthOffset(1, 1, NaN)).toEqual({ x: 0, y: 0 });
});
