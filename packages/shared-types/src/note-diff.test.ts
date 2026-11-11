import { describe, expect, it } from "vitest";
import { diffNoteLines } from "./note-diff";

describe("diffNoteLines", () => {
  it("помечает одинаковый текст как equal без изменений", () => {
    const diff = diffNoteLines("первая\nвторая", "первая\nвторая");
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.lines.map((line) => line.type)).toEqual(["equal", "equal"]);
    expect(diff.lines[1]).toMatchObject({ text: "вторая", oldLine: 2, newLine: 2 });
  });

  it("показывает добавленную строку с номером в новой версии и без старого", () => {
    const diff = diffNoteLines("a\nb", "a\nx\nb");
    expect(diff.lines.map((line) => line.type)).toEqual(["equal", "added", "equal"]);
    expect(diff.lines[1]).toMatchObject({ text: "x", oldLine: null, newLine: 2 });
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(0);
  });

  it("показывает удалённую строку с номером старой версии", () => {
    const diff = diffNoteLines("a\nx\nb", "a\nb");
    expect(diff.lines.map((line) => line.type)).toEqual(["equal", "removed", "equal"]);
    expect(diff.lines[1]).toMatchObject({ text: "x", oldLine: 2, newLine: null });
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(1);
  });

  it("замену строки отдаёт как removed+added, сохраняя общий контекст", () => {
    const diff = diffNoteLines("шапка\nстарое\nхвост", "шапка\nновое\nхвост");
    expect(diff.lines.map((line) => line.type)).toEqual(["equal", "removed", "added", "equal"]);
    expect(diff.removed).toBe(1);
    expect(diff.added).toBe(1);
  });

  it("нумерация строк остаётся верной после сдвига", () => {
    const diff = diffNoteLines("one\ntwo\nthree", "one\ninserted\ntwo\nthree");
    const equalLines = diff.lines.filter((line) => line.type === "equal");
    expect(equalLines.map((line) => [line.oldLine, line.newLine])).toEqual([
      [1, 1],
      [2, 3],
      [3, 4]
    ]);
  });

  it("пустые тексты не дают ни одной строки, а вставка в пустой — только added", () => {
    expect(diffNoteLines("", "").lines).toEqual([]);
    const added = diffNoteLines("", "первая\nвторая");
    expect(added.lines.map((line) => line.type)).toEqual(["added", "added"]);
    expect(added.lines.map((line) => line.newLine)).toEqual([1, 2]);
    const removed = diffNoteLines("первая\nвторая", "");
    expect(removed.lines.map((line) => line.type)).toEqual(["removed", "removed"]);
    expect(removed.lines.map((line) => line.oldLine)).toEqual([1, 2]);
  });

  it("не вырождается в полную замену на большом общем тексте", () => {
    const before = Array.from({ length: 400 }, (_, index) => `строка ${index}`).join("\n");
    const after = before.replace("строка 200", "изменённая строка 200");
    const diff = diffNoteLines(before, after);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.lines.filter((line) => line.type === "equal")).toHaveLength(399);
  });
});
