import { describe, expect, it } from "vitest";
import { NOTE_SEARCH_MATCH_LIMIT, searchNoteText } from "./note-search";

describe("searchNoteText", () => {
  it("находит вхождения без учёта регистра и считает смещения", () => {
    const body = "Первая строка\nвторая Строка со словом";
    const result = searchNoteText(body, "строка");
    expect(result.total).toBe(2);
    expect(result.matches.map((match) => [match.start, match.end])).toEqual([
      [7, 13],
      [21, 27]
    ]);
    expect(result.matches.map((match) => match.line)).toEqual([1, 2]);
  });

  it("возвращает текст строки для превью", () => {
    const result = searchNoteText("a\nискомое здесь\nb", "искомое");
    expect(result.matches[0]).toMatchObject({ line: 2, text: "искомое здесь" });
  });

  it("пустой запрос — пустой результат, а не всё подряд", () => {
    expect(searchNoteText("текст", "   ")).toEqual({ query: "", total: 0, matches: [], truncated: false });
    expect(searchNoteText("", "текст").total).toBe(0);
  });

  it("вхождения не перекрываются и не зацикливаются", () => {
    const result = searchNoteText("аааа", "аа");
    expect(result.matches.map((match) => match.start)).toEqual([0, 2]);
    expect(result.total).toBe(2);
  });

  it("ограничивает число позиций, но считает общее количество", () => {
    const body = Array.from({ length: NOTE_SEARCH_MATCH_LIMIT + 5 }, () => "x").join(" ");
    const result = searchNoteText(body, "x");
    expect(result.total).toBe(NOTE_SEARCH_MATCH_LIMIT + 5);
    expect(result.matches).toHaveLength(NOTE_SEARCH_MATCH_LIMIT);
    expect(result.truncated).toBe(true);
  });

  it("не находит отсутствующий запрос", () => {
    const result = searchNoteText("тут ничего нет", "запрос");
    expect(result.total).toBe(0);
    expect(result.matches).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});
