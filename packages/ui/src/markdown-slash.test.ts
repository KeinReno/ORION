import { describe, expect, it } from "vitest";
import { SLASH_COMMANDS, filterSlashCommands, isSlashTrigger } from "./markdown-slash";

describe("filterSlashCommands", () => {
  it("lists everything for a bare slash at a line start", () => {
    expect(filterSlashCommands("", true)).toHaveLength(SLASH_COMMANDS.length);
  });

  it("hides block commands in the middle of a line, keeping the inline ones", () => {
    const ids = filterSlashCommands("", false).map((c) => c.id);
    expect(ids).toEqual(["link", "wiki"]);
  });

  it("matches the Russian label anywhere and Latin aliases by prefix", () => {
    expect(filterSlashCommands("чек", true).map((c) => c.id)).toEqual(["todo"]);
    expect(filterSlashCommands("h2", true).map((c) => c.id)).toEqual(["h2"]);
    expect(filterSlashCommands("tab", true).map((c) => c.id)).toEqual(["table"]);
    expect(filterSlashCommands("заголовок", true).map((c) => c.id)).toEqual(["h1", "h2", "h3"]);
  });

  it("returns nothing for gibberish", () => {
    expect(filterSlashCommands("qqqq", true)).toEqual([]);
  });
});

describe("isSlashTrigger", () => {
  it("fires at a line start or after whitespace", () => {
    expect(isSlashTrigger(undefined)).toBe(true);
    expect(isSlashTrigger("")).toBe(true);
    expect(isSlashTrigger(" ")).toBe(true);
    expect(isSlashTrigger("\n")).toBe(true);
  });
  it("does not fire inside a path or URL", () => {
    expect(isSlashTrigger("a")).toBe(false);
    expect(isSlashTrigger(":")).toBe(false);
    expect(isSlashTrigger("/")).toBe(false);
  });
});

describe("command payloads", () => {
  it("keeps every caret inside what is inserted", () => {
    for (const command of SLASH_COMMANDS) {
      const caret = command.caret ?? command.insert.length;
      expect(caret).toBeGreaterThanOrEqual(0);
      expect(caret + (command.select ?? 0)).toBeLessThanOrEqual(command.insert.length);
    }
  });
  it("puts the code caret on the empty line between the fences and the table caret in the first body cell", () => {
    const code = SLASH_COMMANDS.find((c) => c.id === "code")!;
    expect(code.insert.slice(0, code.caret)).toBe("```\n");
    const table = SLASH_COMMANDS.find((c) => c.id === "table")!;
    expect(table.insert.slice(0, table.caret)).toBe("| Колонка | Колонка |\n| --- | --- |\n| ");
  });
});
