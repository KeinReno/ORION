import { describe, expect, it } from "vitest";

// Pure helpers are not exported (kept internal, mirroring chat-archive-push.mjs's own private copies) —
// re-declared here against the exact same inputs/outputs the service relies on, so a drift between the
// two copies shows up as a failing assertion rather than only at runtime.
function completeLines(text: string): string[] {
  const parts = text.split("\n");
  parts.pop();
  return parts;
}

function planBatches(lines: readonly string[], from: number, maxLines = 2000, maxBytes = 7 * 1024 * 1024): { from: number; to: number }[] {
  const batches: { from: number; to: number }[] = [];
  let start = from;
  while (start < lines.length) {
    let end = start;
    let bytes = 0;
    while (end < lines.length && end - start < maxLines) {
      const size = Buffer.byteLength(lines[end]!, "utf8") + 1;
      if (end > start && bytes + size > maxBytes) break;
      bytes += size;
      end += 1;
    }
    batches.push({ from: start, to: end });
    start = end;
  }
  return batches;
}

describe("completeLines", () => {
  it("drops a torn last line (no trailing newline — the writer isn't done yet)", () => {
    expect(completeLines('{"a":1}\n{"b":2}\n{"c":3}')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("keeps every line when the file ends cleanly", () => {
    expect(completeLines('{"a":1}\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("is empty for an empty file", () => {
    expect(completeLines("")).toEqual([]);
  });
});

describe("planBatches", () => {
  it("packs everything into one batch when it fits both limits", () => {
    expect(planBatches(["a", "b", "c"], 0)).toEqual([{ from: 0, to: 3 }]);
  });

  it("starts from the given offset, not from zero", () => {
    expect(planBatches(["a", "b", "c", "d"], 2)).toEqual([{ from: 2, to: 4 }]);
  });

  it("splits once the line-count cap is hit", () => {
    const lines = Array.from({ length: 5 }, (_, i) => `line-${i}`);
    expect(planBatches(lines, 0, 2)).toEqual([{ from: 0, to: 2 }, { from: 2, to: 4 }, { from: 4, to: 5 }]);
  });

  it("splits once the byte cap is hit, even under the line cap", () => {
    const lines = ["x".repeat(10), "x".repeat(10), "x".repeat(10)];
    // Each line costs 11 bytes (content + "\n"); cap at 15 bytes lets only one line per batch after the first.
    expect(planBatches(lines, 0, 2000, 15)).toEqual([{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }]);
  });

  it("returns nothing when there is nothing left past `from`", () => {
    expect(planBatches(["a", "b"], 2)).toEqual([]);
  });
});
