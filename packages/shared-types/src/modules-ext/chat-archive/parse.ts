import type { ChatArchiveKind, ChatArchiveRole, ChatArchiveSource } from "./index";

/**
 * Разбор строки транскрипта в то, что показывает и ищет ORION. Исходная строка хранится отдельно и не меняется,
 * поэтому разбор может ошибаться или устареть без потерь: незнакомая строка становится `meta`, а не отбрасывается.
 * Форматы — то, что пишут Claude Code (`~/.claude/projects/<проект>/<сессия>.jsonl`) и Codex
 * (`~/.codex/sessions/ГГГГ/ММ/ДД/rollout-*.jsonl`); оба не документированы как стабильные.
 */

/** Сколько текста строки хранить для чтения и поиска; целиком строка остаётся в `raw`. */
export const CHAT_ARCHIVE_TEXT_LIMIT = 20_000;

export interface ParsedChatLine {
  role: ChatArchiveRole;
  kind: ChatArchiveKind;
  text: string;
  at: string | null;
  /** custom — заголовок, заданный человеком в источнике; auto — придуманный источником. */
  title?: { value: string; strength: "custom" | "auto" };
  sessionId?: string;
  projectPath?: string;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);
const blocks = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : []);

export function clipChatArchiveText(text: string): string {
  return text.length > CHAT_ARCHIVE_TEXT_LIMIT ? `${text.slice(0, CHAT_ARCHIVE_TEXT_LIMIT)}…` : text;
}

const meta = (at: string | null, text = ""): ParsedChatLine => ({ role: "meta", kind: "meta", text, at });

/** Блоки содержимого → текст: картинки и файлы — пометкой (их байты остаются в исходной строке). */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return blocks(content)
    .map((block) => {
      if (typeof block.text === "string") return block.text;
      if (block.type === "image" || block.type === "input_image") return "[изображение]";
      if (block.type === "document") return "[документ]";
      if (block.type === "tool_result") return textOf(block.content);
      return "";
    })
    .filter((part) => part !== "")
    .join("\n");
}

const toolCall = (name: unknown, args: unknown): string => {
  const shown = typeof args === "string" ? args : args === undefined ? "" : JSON.stringify(args);
  return `${str(name) ?? "инструмент"} ${shown}`.trim();
};

function parseClaudeCode(line: Json): ParsedChatLine {
  const at = str(line.timestamp) ?? null;
  const base: Pick<ParsedChatLine, "sessionId" | "projectPath"> = {
    ...(str(line.sessionId) ? { sessionId: str(line.sessionId) } : {}),
    ...(str(line.cwd) ? { projectPath: str(line.cwd) } : {})
  };
  const message = isObject(line.message) ? line.message : undefined;
  switch (line.type) {
    case "custom-title":
      return { ...meta(at), ...base, ...(str(line.customTitle) ? { title: { value: str(line.customTitle)!, strength: "custom" as const } } : {}) };
    case "ai-title":
      return { ...meta(at), ...base, ...(str(line.aiTitle) ? { title: { value: str(line.aiTitle)!, strength: "auto" as const } } : {}) };
    case "summary":
      return { role: "system", kind: "meta", text: str(line.summary) ?? "", at, ...base };
    case "user": {
      const content = message?.content;
      // Вставки самого Claude Code (напоминания, вывод команд) помечены isMeta: это не реплика человека.
      if (line.isMeta === true) return { ...meta(at, textOf(content)), ...base };
      if (blocks(content).some((block) => block.type === "tool_result")) {
        return { role: "tool", kind: "tool_result", text: textOf(content), at, ...base };
      }
      return { role: "user", kind: "text", text: textOf(content), at, ...base };
    }
    case "assistant": {
      const parts = blocks(message?.content);
      const text = parts.filter((block) => block.type === "text").map((block) => String(block.text ?? "")).join("\n");
      if (text !== "") return { role: "assistant", kind: "text", text, at, ...base };
      const tools = parts.filter((block) => block.type === "tool_use");
      if (tools.length > 0) return { role: "assistant", kind: "tool_call", text: tools.map((block) => toolCall(block.name, block.input)).join("\n"), at, ...base };
      const thinking = parts.filter((block) => block.type === "thinking").map((block) => String(block.thinking ?? "")).join("\n");
      return { role: "assistant", kind: "thinking", text: thinking, at, ...base };
    }
    default:
      return { ...meta(at), ...base };
  }
}

function parseCodex(line: Json): ParsedChatLine {
  const at = str(line.timestamp) ?? null;
  const payload = isObject(line.payload) ? line.payload : {};
  switch (line.type) {
    case "session_meta":
      return { ...meta(at), ...(str(payload.id) ? { sessionId: str(payload.id) } : {}), ...(str(payload.cwd) ? { projectPath: str(payload.cwd) } : {}) };
    case "turn_context":
      return { ...meta(at), ...(str(payload.cwd) ? { projectPath: str(payload.cwd) } : {}) };
    case "compacted":
      return { role: "system", kind: "meta", text: str(payload.message) ?? "", at };
    case "response_item":
      break;
    default:
      // event_msg и прочее дублируют response_item или служебны.
      return meta(at);
  }
  switch (payload.type) {
    case "message": {
      const text = textOf(payload.content);
      if (payload.role === "assistant") return { role: "assistant", kind: "text", text, at };
      if (payload.role === "user") {
        // Codex кладёт от имени пользователя и окружение/AGENTS.md; настоящая реплика помечена user.text.
        const passthrough = isObject(payload.internal_chat_message_metadata_passthrough) ? payload.internal_chat_message_metadata_passthrough : {};
        const kinds = Array.isArray(passthrough.content_item_kinds) ? passthrough.content_item_kinds : [];
        const human = kinds.length === 0 || kinds.some((kind) => kind === "user.text" || kind === "unknown");
        return human ? { role: "user", kind: "text", text, at } : meta(at, text);
      }
      return { role: "system", kind: "meta", text, at };
    }
    case "function_call":
      return { role: "assistant", kind: "tool_call", text: toolCall(payload.name, payload.arguments), at };
    case "custom_tool_call":
      return { role: "assistant", kind: "tool_call", text: toolCall(payload.name, payload.input), at };
    case "local_shell_call":
    case "web_search_call":
      return { role: "assistant", kind: "tool_call", text: toolCall(payload.type, payload.action), at };
    case "function_call_output":
    case "custom_tool_call_output": {
      const output = payload.output;
      const text = typeof output === "string" ? output : isObject(output) && typeof output.content === "string" ? output.content : textOf(output);
      return { role: "tool", kind: "tool_result", text, at };
    }
    case "reasoning":
      return { role: "assistant", kind: "thinking", text: blocks(payload.summary).map((part) => String(part.text ?? "")).join("\n"), at };
    default:
      return meta(at);
  }
}

/** Разбирает одну строку файла. Не JSON или незнакомая форма — `meta` с пустым текстом. */
export function parseChatArchiveLine(source: ChatArchiveSource, raw: string): ParsedChatLine {
  let line: unknown;
  try {
    line = JSON.parse(raw);
  } catch {
    return meta(null);
  }
  if (!isObject(line)) return meta(null);
  const parsed = source === "claude-code" ? parseClaudeCode(line) : parseCodex(line);
  return { ...parsed, text: clipChatArchiveText(parsed.text) };
}

/** Реплика человека или ответ модели — то, что считается «сообщением» разговора. */
export function isChatArchiveMessage(line: { role: ChatArchiveRole; kind: ChatArchiveKind }): boolean {
  return (line.role === "user" || line.role === "assistant") && line.kind === "text";
}

/** Заголовок по первой реплике человека, пока источник не дал своего. */
export function chatArchiveFallbackTitle(text: string): string {
  const first = text.split("\n").map((part) => part.trim()).find((part) => part !== "") ?? "";
  if (first === "") return "Разговор без названия";
  return first.length > 80 ? `${first.slice(0, 79)}…` : first;
}

/**
 * Узнать источник и id сессии по началу файла (импорт файла из панели). null — файл не похож ни на один формат.
 * Claude Code пишет `sessionId` в каждую строку; Codex начинает с `session_meta`.
 */
export function sniffChatArchiveFile(lines: readonly string[]): { source: ChatArchiveSource; externalId: string; projectPath?: string } | null {
  for (const raw of lines.slice(0, 200)) {
    let line: unknown;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!isObject(line)) continue;
    if (line.type === "session_meta" && isObject(line.payload) && str(line.payload.id)) {
      return { source: "codex", externalId: str(line.payload.id)!, ...(str(line.payload.cwd) ? { projectPath: str(line.payload.cwd) } : {}) };
    }
    if (str(line.sessionId) && (line.type === "user" || line.type === "assistant")) {
      return { source: "claude-code", externalId: str(line.sessionId)!, ...(str(line.cwd) ? { projectPath: str(line.cwd) } : {}) };
    }
  }
  return null;
}
