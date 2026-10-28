import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { sniffChatArchiveFile, type ChatArchiveSource } from "@orion/shared-types";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BackgroundJobsService } from "../../common/background-jobs.service";
import { resolveMode } from "../../common/orion-mode";
import { PrismaService } from "../../common/prisma.service";
import { ChatArchiveService } from "./chat-archive.service";

/** Меньше серверного предела импорта — запас, как в `chat-archive-push.mjs`. */
const MAX_BATCH_LINES = 2000;
const MAX_BATCH_BYTES = 7 * 1024 * 1024;

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Полные строки файла — последний кусок без "\n" (агент ещё пишет) не берём. Копия `chat-archive-push.mjs`. */
function completeLines(text: string): string[] {
  const parts = text.split("\n");
  parts.pop();
  return parts;
}

function walkJsonl(dir: string, depth = 0, maxDepth = 4): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && depth < maxDepth) out.push(...walkJsonl(path, depth + 1, maxDepth));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(path);
  }
  return out;
}

/** Где искать транскрипты каждого источника — те же пути, что в `chat-archive-push.mjs discoverTranscripts()`. */
function candidateFiles(source: ChatArchiveSource, home: string, env: NodeJS.ProcessEnv): string[] {
  if (source === "claude-code") return walkJsonl(join(home, ".claude", "projects"), 0, 1);
  return walkJsonl(join(env.CODEX_HOME || join(home, ".codex"), "sessions"), 0, 3);
}

/** Пачки с `from`: не больше MAX_BATCH_LINES строк и MAX_BATCH_BYTES байт, но всегда хотя бы одна строка. */
function planBatches(lines: readonly string[], from: number): { from: number; to: number }[] {
  const batches: { from: number; to: number }[] = [];
  let start = from;
  while (start < lines.length) {
    let end = start;
    let bytes = 0;
    while (end < lines.length && end - start < MAX_BATCH_LINES) {
      const size = Buffer.byteLength(lines[end]!, "utf8") + 1;
      if (end > start && bytes + size > MAX_BATCH_BYTES) break;
      bytes += size;
      end += 1;
    }
    batches.push({ from: start, to: end });
    start = end;
  }
  return batches;
}

interface EnabledSourceRow {
  workspaceId: string;
  userId: string;
  source: string;
  lastScanAt: Date | null;
}

/**
 * ORION-16 — opt-in автосбор: периодически подтягивает локальные транскрипты Claude Code/Codex в архив,
 * в точности той же логикой, что `chat-archive-push.mjs --all` (формат/дедуп/продолжение — общие с
 * `sniffChatArchiveFile`, `ChatArchiveService.importState/importLines`), но в процессе сервера, а не
 * внешним скриптом по HTTP. `completeLines`/`planBatches`/`walkJsonl` — намеренная копия пары десятков
 * строк из скрипта: тот обязан оставаться самостоятельным (`node chat-archive-push.mjs`, вызывается
 * хуком Claude Code и вручную, без pnpm workspace), так что общий модуль для обоих не заводим.
 *
 * Только `ORION_MODE=local`: сканирует `os.homedir()` ПРОЦЕССА СЕРВЕРА — то есть диск той же машины, на
 * которой запущен ORION. В server-режиме (многопользовательском, на отдельном хосте) эти пути почти
 * никогда не принадлежат ни одному из пользователей, поэтому сканирование там отключено целиком, а не
 * просто не находит файлов.
 *
 * Выключение источника (`enabled: false`) только останавливает сбор — уже импортированные разговоры
 * остаются (AC3 задачи): следующий тик просто не трогает этот источник, ничего не удаляет.
 */
@Injectable()
export class ChatArchiveDiscoveryService {
  private readonly logger = new Logger(ChatArchiveDiscoveryService.name);

  constructor(
    private readonly jobs: BackgroundJobsService,
    private readonly prisma: PrismaService,
    private readonly chatArchive: ChatArchiveService
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleCron(): Promise<void> {
    await this.jobs.runJob("chat-archive", "auto-discovery", () => this.runAll());
  }

  async runAll(): Promise<{ scanned: number; appended: number }> {
    if (resolveMode() !== "local") return { scanned: 0, appended: 0 };
    const rows = await this.prisma.asSystem((tx) =>
      tx.chatArchiveAutoSource.findMany({
        where: { enabled: true, workspace: { NOT: { disabledModules: { has: "chat-archive" } } } },
        select: { workspaceId: true, userId: true, source: true, lastScanAt: true }
      })
    );
    let appended = 0;
    for (const row of rows) {
      try {
        appended += await this.scanOne(row);
      } catch (error) {
        this.logger.warn(`автосбор (${row.source}, пространство ${row.workspaceId}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { scanned: rows.length, appended };
  }

  private async scanOne(row: EnabledSourceRow): Promise<number> {
    const source = row.source as ChatArchiveSource;
    const since = row.lastScanAt?.getTime() ?? 0;
    const files = candidateFiles(source, homedir(), process.env).filter((file) => {
      try {
        return statSync(file).mtimeMs > since;
      } catch {
        return false;
      }
    });
    let appended = 0;
    for (const file of files) {
      appended += await this.importFile(row.workspaceId, row.userId, source, file);
    }
    await this.prisma.asSystem((tx) =>
      tx.chatArchiveAutoSource.updateMany({ where: { workspaceId: row.workspaceId, userId: row.userId, source: row.source }, data: { lastScanAt: new Date() } })
    );
    return appended;
  }

  private async importFile(workspaceId: string, userId: string, source: ChatArchiveSource, file: string): Promise<number> {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return 0; // файл исчез/недоступен между обходом каталога и чтением — не повод валить весь тик
    }
    const lines = completeLines(text);
    if (lines.length === 0) return 0;
    const id = sniffChatArchiveFile(lines);
    if (!id || id.source !== source) return 0;

    const state = await this.chatArchive.importState(userId, workspaceId, { source: id.source, externalId: id.externalId });
    if (state.lineCount > lines.length) return 0; // файл короче, чем уже в архиве — не та копия, пропуск
    if (state.lineCount > 0 && sha256(lines[state.lineCount - 1]!) !== state.lastSha) return 0; // изменился не дописыванием

    let appended = 0;
    for (const batch of planBatches(lines, state.lineCount)) {
      const result = await this.chatArchive.importLines(
        userId,
        workspaceId,
        { source: id.source, externalId: id.externalId, fromSeq: batch.from, projectPath: id.projectPath },
        lines.slice(batch.from, batch.to)
      );
      appended += result.appended;
    }
    return appended;
  }
}
