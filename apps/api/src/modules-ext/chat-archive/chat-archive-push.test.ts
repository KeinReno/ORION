import { describe, expect, it } from "vitest";
import { completeLines, identify, parseArgs, planBatches, resolveConnection } from "./chat-archive-push.mjs";

describe("chat-archive-push", () => {
  it("разбирает аргументы: первый файл не теряется, значения флагов — не файлы", () => {
    expect(parseArgs(["a.jsonl", "b.jsonl"])).toMatchObject({ files: ["a.jsonl", "b.jsonl"], all: false, sinceDays: undefined });
    expect(parseArgs(["--all", "--source", "codex", "--since", "30"])).toMatchObject({ files: [], all: true, sourceFilter: "codex", sinceDays: 30 });
    expect(parseArgs(["--since", "abc", "x.jsonl"]).sinceDays).toBeUndefined();
    expect(parseArgs(["--hook"]).hook).toBe(true);
  });

  it("берёт только полные строки: недописанный хвост ждёт следующего раза", () => {
    expect(completeLines("a\nb\n")).toEqual(["a", "b"]);
    expect(completeLines("a\nb\n{\"type\":\"us")).toEqual(["a", "b"]);
    expect(completeLines("")).toEqual([]);
    // Пустая строка посреди файла — тоже строка: номера строк архива совпадают с файлом.
    expect(completeLines("a\n\nb\n")).toEqual(["a", "", "b"]);
  });

  it("режет хвост на пачки по числу строк и байтам, но не меньше строки", () => {
    const lines = ["aaaa", "bbbb", "cccc", "dddd", "eeee"];
    expect(planBatches(lines, 1, 2, 1000).map((b) => [b.from, b.to])).toEqual([[1, 3], [3, 5]]);
    expect(planBatches(lines, 0, 100, 10).map((b) => [b.from, b.to])).toEqual([[0, 2], [2, 4], [4, 5]]);
    expect(planBatches(["я".repeat(50)], 0, 100, 10)).toEqual([{ from: 0, to: 1, bytes: 101 }]);
    expect(planBatches(lines, 5)).toEqual([]);
  });

  it("узнаёт источник: Claude Code по имени файла, Codex по session_meta", () => {
    const id = "a36a80c6-61ba-443c-a063-c8f142e9bdbd";
    expect(identify(`C:/x/${id}.jsonl`, [JSON.stringify({ type: "ai-title" }), JSON.stringify({ type: "user", sessionId: "other" })])).toEqual({ source: "claude-code", externalId: id });
    expect(identify("C:/x/rollout-2026.jsonl", [JSON.stringify({ type: "session_meta", payload: { id: "c-1" } })])).toEqual({ source: "codex", externalId: "c-1" });
    expect(identify("C:/x/rollout-2026-10-15T23-29-14-01a14141-3275-7980-b177-595d6b9f5a42.jsonl", ["{}"])).toEqual({ source: "codex", externalId: "01a14141-3275-7980-b177-595d6b9f5a42" });
    expect(identify("C:/x/notes.jsonl", ["{}"])).toBeNull();
  });

  it("берёт подключение из окружения, иначе из MCP-конфига Claude Code, затем Cursor", () => {
    const files: Record<string, string> = {
      "H/.claude.json": JSON.stringify({ mcpServers: { graft: {} } }),
      "H/.cursor/mcp.json": JSON.stringify({ mcpServers: { orion: { env: { ORION_AGENT_TOKEN: "orion_agt_c", ORION_API_URL: "http://127.0.0.1:4000/" } } } })
    };
    const read = (path: string) => files[path.replaceAll("\\", "/")] ?? null;
    expect(resolveConnection({ ORION_AGENT_TOKEN: " t " }, "H", read)).toEqual({ apiUrl: "http://127.0.0.1:14000", token: "t", from: "окружение" });
    expect(resolveConnection({}, "H", read)).toMatchObject({ apiUrl: "http://127.0.0.1:4000", token: "orion_agt_c" });
    expect(resolveConnection({}, "H", () => "{не json")).toBeNull();
  });
});
