import { describe, expect, it } from "vitest";
import { taskFieldsFromSelection } from "./convert-selection-to-task";

describe("taskFieldsFromSelection", () => {
  it("uses the whole selection as the title when it's one line", () => {
    expect(taskFieldsFromSelection("Позвонить в банк")).toEqual({ title: "Позвонить в банк", description: "" });
  });

  it("splits the first non-empty line as title, the rest as description", () => {
    expect(taskFieldsFromSelection("Позвонить в банк\nУточнить ставку\nИ срок")).toEqual({
      title: "Позвонить в банк",
      description: "Уточнить ставку\nИ срок"
    });
  });

  it("skips leading blank lines before picking the title", () => {
    expect(taskFieldsFromSelection("\n\nПозвонить в банк\nДетали")).toEqual({ title: "Позвонить в банк", description: "Детали" });
  });

  it("trims surrounding whitespace on both title and description", () => {
    expect(taskFieldsFromSelection("  Заголовок  \n  текст  ")).toEqual({ title: "Заголовок", description: "текст" });
  });

  it("truncates a title line over 200 characters with an ellipsis", () => {
    const long = "a".repeat(250);
    const result = taskFieldsFromSelection(long);
    expect(result.title).toHaveLength(200);
    expect(result.title.endsWith("…")).toBe(true);
  });

  it("is empty for a selection that's only whitespace", () => {
    expect(taskFieldsFromSelection("   \n  \n ")).toEqual({ title: "", description: "" });
  });
});
