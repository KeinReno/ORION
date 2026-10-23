import { describe, expect, it } from "vitest";
import { extractChecklist } from "./text-to-checklist";

describe("text to checklist", () => {
  it("moves list lines and leaves prose in the description", () => {
    const result = extractChecklist("Подготовка к поездке\n\n- Документы\n- [x] Зарядка\n* Билеты\nОстальное — по желанию");
    expect(result.items).toEqual([
      { title: "Документы", done: false },
      { title: "Зарядка", done: true },
      { title: "Билеты", done: false },
    ]);
    expect(result.body).toBe("Подготовка к поездке\n\nОстальное — по желанию");
  });
  it("splits plain and numbered lines when no markers are present", () => {
    expect(extractChecklist("Купить молоко\nПозвонить\n")).toEqual({ items: [
      { title: "Купить молоко", done: false }, { title: "Позвонить", done: false },
    ], body: "" });
    expect(extractChecklist("1. Первый\n2) Второй").items.map((item) => item.title)).toEqual(["Первый", "Второй"]);
    expect(extractChecklist("[x] Готово\n[ ] Дальше").items).toEqual([
      { title: "Готово", done: true }, { title: "Дальше", done: false },
    ]);
  });
  it("rejects empty, oversized and over-limit input without partial results", () => {
    expect(() => extractChecklist("   \n\n")).toThrow("Не нашли шагов");
    expect(() => extractChecklist("- " + "x".repeat(201))).toThrow("длиннее 200");
    expect(() => extractChecklist("- Раз\n- Два", 199)).toThrow("не больше 200");
    expect(extractChecklist("- Раз", 198).items).toHaveLength(1);
  });
});
