import { describe, expect, it } from "vitest";
import {
  CHAT_ARCHIVE_TEXT_LIMIT,
  chatArchiveFallbackTitle,
  isChatArchiveMessage,
  parseChatArchiveLine,
  sniffChatArchiveFile
} from "./parse";

const line = (value: unknown) => JSON.stringify(value);

describe("parseChatArchiveLine — Claude Code", () => {
  const at = "2026-10-20T10:00:00.000Z";
  const common = { sessionId: "s-1", cwd: "C:\\proj", timestamp: at };

  it("реплика человека строкой и блоками; картинка — пометкой", () => {
    expect(parseChatArchiveLine("claude-code", line({ ...common, type: "user", message: { role: "user", content: "Привет" } }))).toEqual({
      role: "user", kind: "text", text: "Привет", at, sessionId: "s-1", projectPath: "C:\\proj"
    });
    const withImage = parseChatArchiveLine("claude-code", line({
      ...common, type: "user", message: { role: "user", content: [{ type: "image", source: { data: "AAAA" } }, { type: "text", text: "это так?" }] }
    }));
    expect(withImage.text).toBe("[изображение]\nэто так?");
  });

  it("служебная вставка isMeta — не реплика", () => {
    const parsed = parseChatArchiveLine("claude-code", line({ ...common, type: "user", isMeta: true, message: { content: [{ type: "text", text: "напоминание" }] } }));
    expect(parsed.role).toBe("meta");
    expect(isChatArchiveMessage(parsed)).toBe(false);
  });

  it("результат инструмента, вызов инструмента, рассуждение, ответ", () => {
    expect(parseChatArchiveLine("claude-code", line({ ...common, type: "user", message: { content: [{ type: "tool_result", content: "42 строки" }] } }))).toMatchObject({ role: "tool", kind: "tool_result", text: "42 строки" });
    expect(parseChatArchiveLine("claude-code", line({ ...common, type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "a.ts" } }] } }))).toMatchObject({ role: "assistant", kind: "tool_call", text: 'Read {"file_path":"a.ts"}' });
    expect(parseChatArchiveLine("claude-code", line({ ...common, type: "assistant", message: { content: [{ type: "thinking", thinking: "хм" }] } }))).toMatchObject({ kind: "thinking", text: "хм" });
    const answer = parseChatArchiveLine("claude-code", line({ ...common, type: "assistant", message: { content: [{ type: "text", text: "Готово" }, { type: "tool_use", name: "Edit", input: {} }] } }));
    expect(answer).toMatchObject({ role: "assistant", kind: "text", text: "Готово" });
    expect(isChatArchiveMessage(answer)).toBe(true);
  });

  it("заголовки: свой сильнее придуманного", () => {
    expect(parseChatArchiveLine("claude-code", line({ type: "custom-title", customTitle: "Мой", sessionId: "s-1" })).title).toEqual({ value: "Мой", strength: "custom" });
    expect(parseChatArchiveLine("claude-code", line({ type: "ai-title", aiTitle: "Авто", sessionId: "s-1" })).title).toEqual({ value: "Авто", strength: "auto" });
  });

  it("незнакомая строка и не-JSON — meta, а не ошибка", () => {
    expect(parseChatArchiveLine("claude-code", line({ type: "file-history-snapshot" })).role).toBe("meta");
    expect(parseChatArchiveLine("claude-code", "{обрыв")).toEqual({ role: "meta", kind: "meta", text: "", at: null });
    expect(parseChatArchiveLine("claude-code", "[1,2]").role).toBe("meta");
  });

  it("длинный текст обрезается, исходная строка — забота вызывающего", () => {
    const text = "я".repeat(CHAT_ARCHIVE_TEXT_LIMIT + 10);
    const parsed = parseChatArchiveLine("claude-code", line({ ...common, type: "user", message: { content: text } }));
    expect(parsed.text.length).toBe(CHAT_ARCHIVE_TEXT_LIMIT + 1);
    expect(parsed.text.endsWith("…")).toBe(true);
  });
});

describe("parseChatArchiveLine — Codex", () => {
  const at = "2026-10-15T20:29:16.126Z";

  it("session_meta даёт id и папку", () => {
    expect(parseChatArchiveLine("codex", line({ timestamp: at, type: "session_meta", payload: { id: "c-1", cwd: "C:\\w" } }))).toMatchObject({ role: "meta", sessionId: "c-1", projectPath: "C:\\w" });
  });

  it("реплика человека отличается от окружения, которое Codex шлёт от его имени", () => {
    const human = parseChatArchiveLine("codex", line({ timestamp: at, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Сделай" }], internal_chat_message_metadata_passthrough: { content_item_kinds: ["user.text"] } } }));
    expect(human).toMatchObject({ role: "user", kind: "text", text: "Сделай" });
    const env = parseChatArchiveLine("codex", line({ timestamp: at, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>" }], internal_chat_message_metadata_passthrough: { content_item_kinds: ["environments.environment_context"] } } }));
    expect(env.role).toBe("meta");
    expect(parseChatArchiveLine("codex", line({ type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "правила" }] } })).role).toBe("system");
  });

  it("ответ, вызовы и их результаты, рассуждение", () => {
    expect(parseChatArchiveLine("codex", line({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Ок" }] } }))).toMatchObject({ role: "assistant", kind: "text", text: "Ок" });
    expect(parseChatArchiveLine("codex", line({ type: "response_item", payload: { type: "function_call", name: "js", arguments: "{\"a\":1}" } }))).toMatchObject({ kind: "tool_call", text: 'js {"a":1}' });
    expect(parseChatArchiveLine("codex", line({ type: "response_item", payload: { type: "custom_tool_call", name: "exec", input: "ls" } })).text).toBe("exec ls");
    expect(parseChatArchiveLine("codex", line({ type: "response_item", payload: { type: "function_call_output", output: [{ type: "input_text", text: "a" }, { type: "input_text", text: "b" }] } }))).toMatchObject({ role: "tool", text: "a\nb" });
    expect(parseChatArchiveLine("codex", line({ type: "response_item", payload: { type: "custom_tool_call_output", output: "ok" } })).text).toBe("ok");
    expect(parseChatArchiveLine("codex", line({ type: "response_item", payload: { type: "reasoning", summary: [{ type: "summary_text", text: "думаю" }], encrypted_content: "x" } }))).toMatchObject({ kind: "thinking", text: "думаю" });
  });

  it("event_msg дублирует response_item — meta", () => {
    expect(parseChatArchiveLine("codex", line({ type: "event_msg", payload: { type: "user_message", message: "Сделай" } })).role).toBe("meta");
  });
});

describe("chatArchiveFallbackTitle", () => {
  it("первая непустая строка, не длиннее 80 символов", () => {
    expect(chatArchiveFallbackTitle("\n  Как сохранить чаты?\nещё")).toBe("Как сохранить чаты?");
    expect(chatArchiveFallbackTitle("а".repeat(100))).toHaveLength(80);
    expect(chatArchiveFallbackTitle("  ")).toBe("Разговор без названия");
  });
});

describe("sniffChatArchiveFile", () => {
  it("узнаёт Claude Code и Codex, остальное — null", () => {
    expect(sniffChatArchiveFile([line({ type: "ai-title", aiTitle: "x" }), line({ type: "user", sessionId: "s-9", cwd: "C:\\p", message: { content: "x" } })])).toEqual({ source: "claude-code", externalId: "s-9", projectPath: "C:\\p" });
    expect(sniffChatArchiveFile([line({ type: "session_meta", payload: { id: "c-9" } })])).toEqual({ source: "codex", externalId: "c-9" });
    expect(sniffChatArchiveFile(["не json", line({ hello: 1 })])).toBeNull();
  });
});
