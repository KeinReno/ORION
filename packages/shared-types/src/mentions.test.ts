import { describe, expect, it } from "vitest";
import { formatMention, hasMentions, parseMentions } from "./mentions";

describe("parseMentions", () => {
  it("finds plain names and ignores trailing punctuation", () => {
    expect(parseMentions("Привет, @Иван! Посмотри @maria.")).toEqual(["Иван", "maria"]);
  });

  it("supports quoted names with spaces", () => {
    expect(parseMentions('Нужно мнение @"Иван Петров" и @Анна')).toEqual(["Иван Петров", "Анна"]);
  });

  it("does not treat an email address as a mention", () => {
    expect(parseMentions("Пишите на ivan@example.com")).toEqual([]);
    // `@` внутри слова не начинает упоминание; начало строки — начинает, и имя обрывается на втором `@`.
    expect(parseMentions("@ivan@example.com")).toEqual(["ivan"]);
  });

  it("deduplicates case-insensitively and keeps the first spelling", () => {
    expect(parseMentions("@Иван и снова @иван")).toEqual(["Иван"]);
  });

  it("ignores a bare @ and empty quotes", () => {
    expect(parseMentions("собака @ и @\"\"")).toEqual([]);
  });

  it("keeps order of appearance across both forms", () => {
    expect(parseMentions('@"Анна" @Борис @"Виктор"')).toEqual(["Анна", "Борис", "Виктор"]);
  });

  it("round-trips through formatMention", () => {
    for (const name of ["Иван", "Иван Петров", "user.name"]) {
      expect(parseMentions(`привет ${formatMention(name)}`)).toEqual([name]);
    }
  });

  it("hasMentions agrees with parseMentions on the basics", () => {
    expect(hasMentions("текст без упоминаний")).toBe(false);
    expect(hasMentions("текст с @Иван")).toBe(true);
  });
});
