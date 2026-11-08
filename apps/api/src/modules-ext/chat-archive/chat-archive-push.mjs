#!/usr/bin/env node
/**
 * Отправляет транскрипты разговоров с ИИ-агентами в «Архив чатов» ORION — построчно и без изменений.
 *
 *   node apps/api/src/modules-ext/chat-archive/chat-archive-push.mjs --hook                 хук Claude Code (Stop / SessionEnd): JSON события в stdin
 *   node apps/api/src/modules-ext/chat-archive/chat-archive-push.mjs <файл.jsonl> [...]     один или несколько файлов
 *   node apps/api/src/modules-ext/chat-archive/chat-archive-push.mjs --all [--source claude-code|codex] [--since 30]   вся история (за N дней)
 *
 * Куда и с каким токеном: ORION_API_URL + ORION_AGENT_TOKEN из окружения, иначе — запись `mcpServers.orion` из
 * `~/.claude.json` (её пишет «Подключить в один клик»), затем из `~/.cursor/mcp.json`. Токену нужна галочка
 * «Архив чатов → сохранять» (`chat-archive.conversation.create`).
 *
 * Дописывание без дублей: сервер говорит, сколько строк разговора уже есть (`hook/state`), скрипт сверяет хеш последней
 * из них с той же строкой файла и шлёт только хвост. Оборванная последняя строка файла (агент ещё пишет) не отправляется —
 * уйдёт в следующий раз. В режиме --hook скрипт никогда не падает с ошибкой: Claude Code не должен страдать из-за архива,
 * сбои пишутся в `~/.orion/chat-archive-push.log`.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_BATCH_LINES = 2000;
/** Меньше серверного предела (8 МБ): запас на заголовки multipart. */
export const MAX_BATCH_BYTES = 7 * 1024 * 1024;
const DEFAULT_API_URL = "http://127.0.0.1:14000";

function fallbackApiUrl(env) {
  const port = typeof env.PORT === "string" ? env.PORT.trim() : "";
  return port ? `http://127.0.0.1:${port}` : DEFAULT_API_URL;
}

/** Полные строки файла: последний кусок без "\n" — недописанная строка, её не берём. */
export function completeLines(text) {
  const parts = text.split("\n");
  parts.pop();
  return parts;
}

export const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** Пачки с `from`: не больше MAX_BATCH_LINES строк и MAX_BATCH_BYTES байт, но всегда хотя бы одна строка. */
export function planBatches(lines, from, maxLines = MAX_BATCH_LINES, maxBytes = MAX_BATCH_BYTES) {
  const batches = [];
  let start = from;
  while (start < lines.length) {
    let end = start;
    let bytes = 0;
    while (end < lines.length && end - start < maxLines) {
      const size = Buffer.byteLength(lines[end], "utf8") + 1;
      if (end > start && bytes + size > maxBytes) break;
      bytes += size;
      end += 1;
    }
    batches.push({ from: start, to: end, bytes });
    start = end;
  }
  return batches;
}

/** Источник и id сессии: у Claude Code имя файла — id сессии, у Codex id в session_meta (запасной — uuid в имени). */
export function identify(file, lines) {
  const name = basename(file, ".jsonl");
  for (const raw of lines.slice(0, 50)) {
    let line;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    if (line?.type === "session_meta" && typeof line.payload?.id === "string") return { source: "codex", externalId: line.payload.id };
    if (typeof line?.sessionId === "string") return { source: "claude-code", externalId: /^[0-9a-f-]{36}$/i.test(name) ? name : line.sessionId };
  }
  const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(name)?.[1];
  if (uuid && /rollout-/.test(name)) return { source: "codex", externalId: uuid };
  return null;
}

/** Настройки подключения из окружения или из MCP-конфига клиента. */
export function resolveConnection(env = process.env, home = homedir(), read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null)) {
  if (env.ORION_AGENT_TOKEN?.trim()) {
    return { apiUrl: (env.ORION_API_URL ?? fallbackApiUrl(env)).replace(/\/+$/, ""), token: env.ORION_AGENT_TOKEN.trim(), from: "окружение" };
  }
  for (const path of [join(home, ".claude.json"), join(home, ".cursor", "mcp.json")]) {
    const text = read(path);
    if (!text) continue;
    try {
      const orion = JSON.parse(text)?.mcpServers?.orion?.env;
      if (orion?.ORION_AGENT_TOKEN) return { apiUrl: (orion.ORION_API_URL ?? fallbackApiUrl(orion)).replace(/\/+$/, ""), token: orion.ORION_AGENT_TOKEN, from: path };
    } catch {
      // Чужой файл не разобрался — пробуем следующий.
    }
  }
  return null;
}

/** Разбор командной строки: файлы — всё, что не флаг и не значение флага. */
export function parseArgs(argv) {
  const files = [];
  let sourceFilter;
  let sinceDays;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") sourceFilter = argv[++index];
    else if (arg === "--since") {
      const days = Number(argv[++index]);
      if (Number.isFinite(days) && days > 0) sinceDays = days;
    } else if (!arg.startsWith("--")) files.push(arg);
  }
  return { files, all: argv.includes("--all"), hook: argv.includes("--hook"), sourceFilter, sinceDays };
}

class PushError extends Error {}

async function api(connection, method, path, body, attempt = 0) {
  const response = await fetch(`${connection.apiUrl}/ai/v1/chat-archive${path}`, {
    method,
    headers: { Authorization: `Bearer ${connection.token}` },
    body
  });
  if (response.status === 429 && attempt < 5) {
    const wait = Number(response.headers.get("retry-after") ?? "5");
    await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(wait, 1), 60) * 1000));
    return api(connection, method, path, body, attempt + 1);
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  return { status: response.status, data };
}

/** Отправляет недостающий хвост одного файла. Возвращает { appended, title } или бросает PushError с понятной причиной. */
export async function pushFile(connection, file, { sourceFilter } = {}) {
  const lines = completeLines(readFileSync(file, "utf8"));
  if (lines.length === 0) return { appended: 0, title: null, skipped: "пустой файл" };
  const id = identify(file, lines);
  if (!id) return { appended: 0, title: null, skipped: "не похоже на транскрипт Claude Code или Codex" };
  if (sourceFilter && id.source !== sourceFilter) return { appended: 0, title: null, skipped: "другой источник" };
  const query = `source=${id.source}&externalId=${encodeURIComponent(id.externalId)}`;

  let appended = 0;
  let title = null;
  for (let round = 0; round < 3; round += 1) {
    const state = await api(connection, "GET", `/hook/state?${query}`);
    if (state.status !== 200) throw new PushError(`hook/state ${state.status}: ${state.data?.message ?? ""}`);
    const { lineCount, lastSha } = state.data;
    if (lineCount > lines.length) throw new PushError(`в архиве ${lineCount} строк, в файле ${lines.length}: файл укоротился`);
    if (lineCount > 0 && sha256(lines[lineCount - 1]) !== lastSha) throw new PushError(`строка ${lineCount - 1} файла не совпадает с архивом: файл изменился не дописыванием`);
    if (lineCount === lines.length) return { appended, title, skipped: appended === 0 ? "уже в архиве" : undefined };

    let retry = false;
    for (const batch of planBatches(lines, lineCount)) {
      if (batch.bytes > 8 * 1024 * 1024) throw new PushError(`строка ${batch.from} больше 8 МБ — не отправить`);
      const form = new FormData();
      form.append("lines", new Blob([lines.slice(batch.from, batch.to).map((line) => `${line}\n`).join("")], { type: "application/x-ndjson" }), "lines.jsonl");
      const result = await api(connection, "POST", `/hook/lines?${query}&fromSeq=${batch.from}`, form);
      if (result.status === 201) {
        appended += result.data.appended;
        title = result.data.conversation.title;
        continue;
      }
      // Кто-то (второй хук, ручной запуск) успел раньше — перечитать состояние и продолжить с его места.
      if (result.status === 409 && (result.data?.code === "chat_archive_gap" || result.data?.code === "chat_archive_busy")) {
        retry = true;
        break;
      }
      throw new PushError(`hook/lines ${result.status}: ${result.data?.message ?? ""}`);
    }
    if (!retry) return { appended, title };
  }
  throw new PushError("не удалось договориться о месте продолжения за 3 попытки");
}

function walkJsonl(dir, { depth = 0, maxDepth = 4 } = {}) {
  const out = [];
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && depth < maxDepth) out.push(...walkJsonl(path, { depth: depth + 1, maxDepth }));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(path);
  }
  return out;
}

/** Все транскрипты: Claude Code — `<проект>/<сессия>.jsonl` (вложенные транскрипты субагентов не берём), Codex — по датам. */
export function discoverTranscripts(home = homedir(), env = process.env) {
  const claude = walkJsonl(join(home, ".claude", "projects"), { maxDepth: 1 });
  const codex = walkJsonl(join(env.CODEX_HOME || join(home, ".codex"), "sessions"), { maxDepth: 3 });
  return [...claude, ...codex];
}

const LOG_FILE = join(homedir(), ".orion", "chat-archive-push.log");

function log(message) {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    // Не растёт бесконечно: старше мегабайта уходит в .old (одна прошлая копия).
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > 1024 * 1024) renameSync(LOG_FILE, `${LOG_FILE}.old`);
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Журнал — не повод ломать хук.
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  // Оболочки Windows (PowerShell) приписывают BOM при передаче в stdin — JSON.parse на нём спотыкается.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function main(argv) {
  const { hook } = parseArgs(argv);
  const connection = resolveConnection();
  if (!connection) {
    const message = "Нет подключения к ORION: подключите Claude Code в ORION (Настройки → ИИ и агенты) или задайте ORION_AGENT_TOKEN.";
    if (hook) return log(message);
    console.error(message);
    process.exitCode = 1;
    return;
  }

  if (hook) {
    try {
      const event = JSON.parse(await readStdin());
      if (typeof event.transcript_path !== "string" || !existsSync(event.transcript_path)) return log(`нет транскрипта в событии ${event.hook_event_name ?? ""}`);
      const result = await pushFile(connection, event.transcript_path);
      if (result.appended > 0) log(`${basename(event.transcript_path)}: +${result.appended} строк («${result.title}»)`);
    } catch (error) {
      log(`ошибка: ${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }

  const { files: named, all, sourceFilter, sinceDays } = parseArgs(argv);
  let files = all ? discoverTranscripts() : named;
  if (sinceDays !== undefined) {
    const after = Date.now() - sinceDays * 24 * 3600 * 1000;
    files = files.filter((file) => statSync(file).mtimeMs >= after);
  }
  if (files.length === 0) {
    console.error("Нечего отправлять: укажите файлы .jsonl или --all.");
    process.exitCode = 1;
    return;
  }
  console.log(`ORION: ${connection.apiUrl} (токен из: ${connection.from}), файлов: ${files.length}`);
  let total = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const result = await pushFile(connection, file, { sourceFilter });
      total += result.appended;
      if (result.appended > 0) console.log(`  + ${result.appended} строк  ${result.title}  (${basename(file)})`);
      else if (!["уже в архиве", "другой источник"].includes(result.skipped)) console.log(`  · пропущен: ${result.skipped}  (${basename(file)})`);
    } catch (error) {
      failed += 1;
      console.error(`  ! ${basename(file)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`Готово: добавлено строк ${total}, файлов с ошибкой ${failed}.`);
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
