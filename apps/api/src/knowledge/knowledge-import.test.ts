import { describe, expect, it } from "vitest";
import { firstHttpUrl, knowledgeTitleFromFile, originFromFile, originFromInbox } from "./knowledge-import";

const NOW = new Date("2026-11-11T12:00:00.000Z");

describe("импорт материала из файла", () => {
  it("убирает расширение, но сохраняет имя без расширения", () => {
    expect(knowledgeTitleFromFile("Договор аренды.pdf")).toBe("Договор аренды");
    expect(knowledgeTitleFromFile("README")).toBe("README");
    expect(knowledgeTitleFromFile("архив.tar.gz")).toBe("архив.tar");
    expect(knowledgeTitleFromFile("  ")).toBe("Без названия");
  });

  it("origin фиксирует файл, импортёра и время", () => {
    expect(originFromFile("Договор аренды.pdf", "user-1", NOW)).toEqual({
      sourceFile: "Договор аренды.pdf",
      importedAt: NOW.toISOString(),
      importedBy: "user-1"
    });
  });
});

describe("маршрутизация входящего в базу знаний", () => {
  it("находит первую http(s)-ссылку", () => {
    expect(firstHttpUrl("смотри https://example.com/a?b=1 и всё")).toBe("https://example.com/a?b=1");
    expect(firstHttpUrl("нет ссылки")).toBeNull();
    expect(firstHttpUrl("ftp://example.com")).toBeNull();
  });

  it("origin ссылки: url, автор-агент и импортёр", () => {
    expect(originFromInbox({ title: "Статья", body: "Ссылка: https://example.com/x", createdByAgent: "codex" }, "user-1", NOW)).toEqual({
      importedAt: NOW.toISOString(),
      importedBy: "user-1",
      sourceUrl: "https://example.com/x",
      author: "codex"
    });
  });

  it("origin текста без ссылки не выдумывает url/author", () => {
    expect(originFromInbox({ title: "Мысль", body: "Просто текст", createdByAgent: null }, "user-1", NOW)).toEqual({
      importedAt: NOW.toISOString(),
      importedBy: "user-1"
    });
  });
});
