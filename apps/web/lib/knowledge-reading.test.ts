import { describe, expect, it } from "vitest";
import { estimateReadMinutes } from "./knowledge-reading";

describe("estimateReadMinutes", () => {
  it("is 0 for empty or whitespace-only text", () => {
    expect(estimateReadMinutes("")).toBe(0);
    expect(estimateReadMinutes("   \n  ")).toBe(0);
  });

  it("is never 0 for any non-empty text, even a couple of words", () => {
    expect(estimateReadMinutes("Короткий факт.")).toBe(1);
  });

  it("rounds to the nearest minute at 200 words/min", () => {
    expect(estimateReadMinutes(Array(200).fill("слово").join(" "))).toBe(1);
    expect(estimateReadMinutes(Array(520).fill("слово").join(" "))).toBe(3); // 2.6 → rounds up
  });

  it("counts Cyrillic words, not just \\w-matching ones", () => {
    expect(estimateReadMinutes(Array(400).fill("текст").join(" "))).toBe(2);
  });
});
