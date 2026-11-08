import { describe, expect, it } from "vitest";
import { formatBytes, formatCount, formatDuration } from "./format";

describe("format", () => {
  it("groups thousands and keeps a fixed fraction", () => {
    expect(formatCount(12500)).toBe("12\u00a0500");
    expect(formatCount(1.26, 1)).toBe("1,3");
  });

  it("scales bytes on 1024", () => {
    expect(formatBytes(0)).toBe("0 Б");
    expect(formatBytes(512)).toBe("512 Б");
    expect(formatBytes(1536)).toBe("1,5 КБ");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 МБ");
  });

  it("splits hours and minutes", () => {
    expect(formatDuration(0)).toBe("0 мин");
    expect(formatDuration(12)).toBe("12 мин");
    expect(formatDuration(60)).toBe("1 ч");
    expect(formatDuration(125)).toBe("2 ч 05 мин");
  });
});
