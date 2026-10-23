import { describe, expect, it } from "vitest";
import { applyMarkdownFormat } from "./markdown-format";

describe("light markdown formatting", () => {
  it("wraps and unwraps the selected text and keeps the selection usable", () => {
    const bold = applyMarkdownFormat({ value: "Купить хлеб", start: 7, end: 11 }, "bold");
    expect(bold).toEqual({ value: "Купить **хлеб**", start: 9, end: 13 });
    expect(applyMarkdownFormat(bold, "bold")).toEqual({ value: "Купить хлеб", start: 7, end: 11 });
    const italic = applyMarkdownFormat({ value: "Купить хлеб", start: 0, end: 6 }, "italic");
    expect(italic.value).toBe("*Купить* хлеб");
    expect(applyMarkdownFormat(italic, "italic").value).toBe("Купить хлеб");
    expect(applyMarkdownFormat({ value: "**жирный**", start: 0, end: 10 }, "italic").value).toBe("***жирный***");
  });
  it("inserts a pair of markers for a bare cursor", () => {
    expect(applyMarkdownFormat({ value: "Текст", start: 5, end: 5 }, "bold")).toEqual({ value: "Текст****", start: 7, end: 7 });
  });
  it("prefixes and unprefixes every selected line", () => {
    const source = { value: "Первая\nВторая\nТретья", start: 0, end: 20 };
    const list = applyMarkdownFormat(source, "list");
    expect(list.value).toBe("- Первая\n- Вторая\n- Третья");
    expect(applyMarkdownFormat(list, "list").value).toBe(source.value);
    const mixed = applyMarkdownFormat({ value: "- Первая\nВторая", start: 0, end: 15 }, "heading");
    expect(mixed.value).toBe("## - Первая\n## Вторая");
    expect(applyMarkdownFormat(mixed, "heading").value).toBe("- Первая\nВторая");
  });
  it("formats only the current line and keeps the cursor on it", () => {
    const result = applyMarkdownFormat({ value: "Одна\nДве", start: 7, end: 7 }, "quote");
    expect(result).toEqual({ value: "Одна\n> Две", start: 9, end: 9 });
    expect(applyMarkdownFormat(result, "quote")).toEqual({ value: "Одна\nДве", start: 7, end: 7 });
  });
  it("does not touch the next line when the selection ends at its start", () => {
    const result = applyMarkdownFormat({ value: "Первая\nВторая", start: 0, end: 7 }, "heading");
    expect(result.value).toBe("## Первая\nВторая");
    expect(result.start).toBe(0); expect(result.end).toBe(9);
  });
});
