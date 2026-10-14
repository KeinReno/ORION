import { describe, expect, it } from "vitest";
import { selectPaletteResults, type PaletteEntry } from "./palette-results";

const command = (id: string, label: string, patch: Partial<PaletteEntry> = {}): PaletteEntry => ({ id, label, ...patch });

describe("selectPaletteResults", () => {
  it("keeps matching actions first and does not duplicate a local record returned by search", () => {
    const entries = [
      command("a:new-task", "Новая задача"),
      command("t:1", "Задача 1", { entityKey: "task:1" }),
      command("s:task:1", "Задача 1", { entityKey: "task:1", serverResult: true, resultGroup: "task" })
    ];
    expect(selectPaletteResults(entries, "задача", "задача").map((entry) => entry.id))
      .toEqual(["a:new-task", "s:task:1"]);
  });

  it("interleaves modules so a long task list does not hide documents", () => {
    const entries = [
      ...Array.from({ length: 16 }, (_, index) => command(`s:task:${index}`, `План ${index}`, { serverResult: true, resultGroup: "task" })),
      command("s:document:1", "План.pdf", { serverResult: true, resultGroup: "document" })
    ];
    expect(selectPaletteResults(entries, "план", "план", 4).map((entry) => entry.id))
      .toEqual(["s:task:0", "s:document:1", "s:task:1", "s:task:2"]);
  });

  it("hides stale search results while the new query is still debouncing", () => {
    const entries = [
      command("t:1", "Новая задача", { entityKey: "task:1" }),
      command("s:document:1", "Старый документ", { serverResult: true, resultGroup: "document" })
    ];
    expect(selectPaletteResults(entries, "новая", "старый").map((entry) => entry.id)).toEqual(["t:1"]);
    expect(selectPaletteResults(entries, "", "старый").map((entry) => entry.id)).toEqual(["t:1"]);
  });
});
