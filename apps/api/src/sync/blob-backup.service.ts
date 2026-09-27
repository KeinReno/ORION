import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { StorageAdapter } from "../storage/storage-adapter";
import { collectBlobRefs, type DocumentRowForBlobs, type DocumentVersionRowForBlobs } from "./blob-manifest";

type Tx = Prisma.TransactionClient;

/** Один файл в бэкапе: неизменяемая пара (ключ, байты) плюс проверяемый checksum. */
export interface BlobEntry {
  key: string;
  sha256: string;
  size: number;
  contentType: string;
  /** base64. Бэкап — один зашифрованный `.orion`-файл (см. sync.service.ts), поэтому байты едут внутри JSON, не отдельными объектами на удалёнке. */
  data: string;
}

async function streamToBuffer(storage: StorageAdapter, key: string): Promise<Buffer> {
  const stream = await storage.getStream(key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// Ключи не под `<workspaceId>/...` — переживают своп корня workspace при
// restore (см. `BlobBackupService.stage`/`publish`).
const STAGING_ROOT = "_restore-staging";
const OLD_ROOT = "_restore-old";
const JOURNAL_ROOT = "_restore-journal";

type RestorePhase = "staging" | "staged" | "swapping" | "done";

interface RestoreJournal {
  workspaceId: string;
  batchId: string;
  phase: RestorePhase;
  total: number;
  stagedKeys: string[];
}

/**
 * ORION — S04. Копирует байты документов внутрь/наружу зашифрованного
 * `.orion`-бэкапа (метаданные строк — уже забота `SnapshotService`, v2/S03),
 * не доверяя сохранённому в БД `checksum`: при экспорте и импорте sha256
 * считается заново из фактически прочитанных байтов, иначе повреждение на
 * диске молча копируется как «ОК» (см. разбор в 12-PROGRESS.md, S04).
 *
 * Restore пишет байты в два шага — staging, потом атомарный своп корня
 * рабочего пространства (`StorageAdapter.move`, `fs.rename` для локального
 * диска — атомарно на одной файловой системе) — чтобы сбой посередине
 * записи не оставил дерево документов наполовину восстановленным:
 * до полного стейджинга и проверки checksum'ов реальное дерево вообще не
 * трогается. Журнал (`_restore-journal/<workspaceId>.json`) живёт вне
 * `<workspaceId>/...` — он не участвует в свопе и переживает его, поэтому
 * `recover()` может отличить «не начато» от «прервано на середине» даже
 * после падения процесса.
 */
@Injectable()
export class BlobBackupService {
  private readonly logger = new Logger(BlobBackupService.name);

  /** Собрать байты всех файлов пространства (внутри RLS-транзакции вызывающего). */
  async collect(tx: Tx, workspaceId: string, storage: StorageAdapter): Promise<BlobEntry[]> {
    const documents = (await tx.document.findMany({
      where: { workspaceId },
      select: { id: true, workspaceId: true, kind: true, name: true, parentId: true, deletedAt: true }
    })) as DocumentRowForBlobs[];
    const versions = (await tx.documentVersion.findMany({
      where: { workspaceId },
      select: { id: true, workspaceId: true, storageKey: true, mimeType: true }
    })) as DocumentVersionRowForBlobs[];

    const refs = collectBlobRefs(documents, versions);
    const out: BlobEntry[] = [];
    for (const ref of refs) {
      let buf: Buffer;
      try {
        buf = await streamToBuffer(storage, ref.key);
      } catch (err) {
        throw new Error(
          `Бэкап не может прочитать файл ${ref.key} из хранилища — байты отсутствуют или недоступны (${(err as Error).message}). Бэкап отклонён целиком, чтобы не сделать частичную копию.`
        );
      }
      out.push({ key: ref.key, sha256: sha256(buf), size: buf.length, contentType: ref.contentType, data: buf.toString("base64") });
    }
    return out;
  }

  /** Ключ журнала — не под workspaceId, чтобы своп корня его не задел. */
  private journalKey(workspaceId: string): string {
    return `${JOURNAL_ROOT}/${workspaceId}.json`;
  }

  private async readJournal(storage: StorageAdapter, workspaceId: string): Promise<RestoreJournal | null> {
    if (!(await storage.exists(this.journalKey(workspaceId)))) return null;
    const buf = await streamToBuffer(storage, this.journalKey(workspaceId));
    return JSON.parse(buf.toString("utf8")) as RestoreJournal;
  }

  private async writeJournal(storage: StorageAdapter, j: RestoreJournal): Promise<void> {
    await storage.putFile(this.journalKey(j.workspaceId), Buffer.from(JSON.stringify(j), "utf8"), {
      contentType: "application/json"
    });
  }

  /**
   * R18-01: только стейджинг (с проверкой checksum на каждый файл) — НЕ
   * трогает живое дерево `<workspaceId>/...` и НЕ публикует. Возвращает
   * `batchId`, который вызывающий (`SyncService.restore`) обязан провести
   * через `publish()` только ПОСЛЕ того, как соответствующая транзакция БД
   * (`SnapshotService.apply`) durably закоммичена — раньше был ровно
   * обратный порядок (своп до `apply()`), и сбой `apply()` после свопа
   * оставлял живые байты уже заменёнными без отката строк БД (Codex
   * 18-REVIEW-FINAL-PASS, R18-01). Не трогает Prisma/БД сама по себе.
   *
   * Бросает исключение, если стейджинг не завершился (например, инъекция
   * сбоя в тесте) — реальное дерево `<workspaceId>/...` гарантированно не
   * тронуто (до `publish()` мы его не касаемся); вызывающий обязан убрать
   * осиротевший batch через `discardStaging()`.
   *
   * `batchId` — вызывающий обязан передать ID, под которым он уже завёл
   * durable lock-строку (`SyncRestoreOperation`) ДО стейджинга: и lock-строка,
   * и файловый журнал должны согласованно ссылаться на один и тот же batch,
   * иначе `publish()` откажется публиковать «чужой» batch.
   */
  async stage(storage: StorageAdapter, workspaceId: string, batchId: string, blobs: BlobEntry[]): Promise<string> {
    const existing = await this.readJournal(storage, workspaceId);
    if (existing && existing.phase !== "done") {
      throw new Error(
        `Предыдущее восстановление файлов для workspace ${workspaceId} не завершено (фаза ${existing.phase}) — сначала вызови recover()`
      );
    }

    // `blob.key` already starts with `<workspaceId>/...` (it's a real
    // StorageAdapter key, e.g. `<ws>/report.txt`), so the staging batch dir
    // must NOT repeat the workspaceId itself — otherwise the later swap
    // (moving the staged workspace subtree onto `workspaceId`) ends up
    // nesting the tree inside itself (`<ws>/<ws>/report.txt`). The batch is
    // scoped by `batchId` alone; `blob.key`'s own leading `<workspaceId>/`
    // segment becomes the subdirectory the swap actually moves.
    const batchRoot = `${STAGING_ROOT}/${batchId}`;
    const innerStagingRoot = `${batchRoot}/${workspaceId}`;
    const journal: RestoreJournal = { workspaceId, batchId, phase: "staging", total: blobs.length, stagedKeys: [] };
    await this.writeJournal(storage, journal);
    // Создаём staging-каталог явно: при нулевых блобах цикл ниже не сделает
    // ни одного putFile, а свопу (move(innerStagingRoot, workspaceId)) нужно,
    // чтобы источник существовал.
    await storage.mkdir(innerStagingRoot);

    for (const blob of blobs) {
      const buf = Buffer.from(blob.data, "base64");
      if (sha256(buf) !== blob.sha256) {
        throw new Error(`Восстановление отклонено: checksum не совпадает для ${blob.key} — снапшот повреждён`);
      }
      await storage.putFile(`${batchRoot}/${blob.key}`, buf, { contentType: blob.contentType });
      journal.stagedKeys.push(blob.key);
      await this.writeJournal(storage, journal);
    }

    journal.phase = "staged";
    await this.writeJournal(storage, journal);

    return batchId;
  }

  /**
   * R18-01: отменить незакоммиченный batch (соответствующая транзакция БД
   * не применилась или не дошла до commit) — живое дерево не трогали, просто
   * убираем staging и журнал. Бросает исключение, если batch уже прошёл
   * `publish()` (фаза `swapping`/`done`) — на этом этапе живое дерево уже
   * могло быть тронуто, откат недопустим, нужен forward-recover, не discard.
   */
  async discardStaging(storage: StorageAdapter, workspaceId: string, batchId: string): Promise<void> {
    const journal = await this.readJournal(storage, workspaceId);
    if (!journal || journal.batchId !== batchId) return;
    if (journal.phase !== "staging" && journal.phase !== "staged") {
      throw new Error(
        `Восстановление: нельзя отменить batch ${batchId} в фазе ${journal.phase} — живое дерево уже могло быть тронуто, нужен forward-recover`
      );
    }
    await storage.remove(`${STAGING_ROOT}/${batchId}`).catch(() => undefined);
    await storage.remove(this.journalKey(workspaceId)).catch(() => undefined);
  }

  /**
   * R18-01: опубликовать уже застейдженный и checksum-проверенный batch —
   * атомарный своп корня workspace. Вызывать ТОЛЬКО после того, как
   * транзакция БД, применяющая тот же снапшот, уже durably закоммичена
   * (`SyncRestoreOperation.phase = "committed"`) — с этого момента откат
   * недопустим, только доведение до конца (идемпотентно: повторный вызов на
   * уже опубликованный/отсутствующий журнал — no-op).
   */
  async publish(storage: StorageAdapter, workspaceId: string, batchId: string): Promise<void> {
    const journal = await this.readJournal(storage, workspaceId);
    if (!journal) return; // уже опубликовано раньше и журнал сам себя стёр (see swap()).
    if (journal.batchId !== batchId) {
      throw new Error(
        `Восстановление: журнал для workspace ${workspaceId} ссылается на другой batch (${journal.batchId} ≠ ${batchId}) — отказ публиковать чужой batch`
      );
    }
    if (journal.phase === "staged") {
      await this.swap(storage, workspaceId, batchId);
      return;
    }
    if (journal.phase === "swapping") {
      // Сбой между двумя rename при прошлой попытке publish() — докатываем
      // вперёд той же логикой, что и recover().
      await this.recover(storage, workspaceId);
      return;
    }
    throw new Error(`Восстановление: неожиданная фаза журнала "${journal.phase}" для публикации batch ${batchId}`);
  }

  /** Своп: freeing-rename старого корня, затем rename staging на его место. */
  private async swap(storage: StorageAdapter, workspaceId: string, batchId: string): Promise<void> {
    const stagingRoot = `${STAGING_ROOT}/${batchId}/${workspaceId}`;
    const oldRoot = `${OLD_ROOT}/${workspaceId}/${batchId}`;

    await this.writeJournal(storage, {
      workspaceId,
      batchId,
      phase: "swapping",
      total: -1,
      stagedKeys: []
    });

    if (await storage.exists(workspaceId)) {
      await storage.move(workspaceId, oldRoot);
    }
    await storage.move(stagingRoot, workspaceId);

    await this.writeJournal(storage, { workspaceId, batchId, phase: "done", total: -1, stagedKeys: [] });
    // Старое дерево больше не нужно — новое (свежепроверенное) уже на месте.
    await storage.remove(oldRoot).catch((err: unknown) => {
      this.logger.warn(`Не удалось убрать ${oldRoot} после успешного свопа: ${(err as Error).message}`);
    });
    await storage.remove(this.journalKey(workspaceId)).catch(() => undefined);
  }

  /**
   * Идемпотентная починка после сбоя посередине `restore()`. Без журнала —
   * нечего чинить (restore либо не запускался, либо уже дочищен). По фазе:
   * - `staging`/`staged` — реальное дерево не тронуто, просто убираем
   *   осиротевший staging и журнал.
   * - `swapping` — сбой между двумя rename: если workspace-корень
   *   отсутствует (первый rename прошёл, второй — нет), значит staged-байты
   *   уже проверены и **дальше безопаснее докатить вперёд**, чем откатывать
   *   назад (откат просто заново обнажил бы ту же самую незавершённую
   *   операцию при следующей попытке restore). Докатываем: staging → корень,
   *   затем убираем old/staging остатки.
   */
  async recover(storage: StorageAdapter, workspaceId: string): Promise<{ recovered: boolean; phase: RestorePhase | null }> {
    const journal = await this.readJournal(storage, workspaceId);
    if (!journal) return { recovered: false, phase: null };

    const batchRoot = `${STAGING_ROOT}/${journal.batchId}`;
    const stagingRoot = `${batchRoot}/${workspaceId}`;
    const oldRoot = `${OLD_ROOT}/${workspaceId}/${journal.batchId}`;

    if (journal.phase === "staging" || journal.phase === "staged") {
      await storage.remove(batchRoot).catch(() => undefined);
      await storage.remove(this.journalKey(workspaceId)).catch(() => undefined);
      return { recovered: true, phase: journal.phase };
    }

    if (journal.phase === "swapping") {
      const rootMissing = !(await storage.exists(workspaceId));
      if (rootMissing && (await storage.exists(stagingRoot))) {
        // Первый rename (workspace → old) прошёл, второй (staging → workspace) — нет. Докатываем.
        await storage.move(stagingRoot, workspaceId);
      }
      // Если корень уже на месте — второй rename тоже успел пройти до сбоя;
      // остаётся только убрать хвосты.
      await storage.remove(oldRoot).catch(() => undefined);
      await storage.remove(batchRoot).catch(() => undefined);
      await storage.remove(this.journalKey(workspaceId)).catch(() => undefined);
      return { recovered: true, phase: "swapping" };
    }

    // phase === "done" не должно тут оказаться (writeJournal(done) сам себя стирает), но на всякий случай.
    await storage.remove(this.journalKey(workspaceId)).catch(() => undefined);
    return { recovered: true, phase: journal.phase };
  }
}
