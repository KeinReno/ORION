import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { SyncRemote as DbSyncRemote } from "@prisma/client";
import type {
  BackupRef,
  BackupResult,
  RestoreInput,
  RestorePreview,
  SyncRemote,
  SyncRemoteInput,
  SyncRemoteTestResult
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { STORAGE_ADAPTER, type StorageAdapter } from "../storage/storage-adapter";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { CompassBackupService, type CompassBackupEntry } from "../markets/compass-backup.service";
import { BlobBackupService, type BlobEntry } from "./blob-backup.service";
import { SnapshotService, type WorkspaceSnapshot } from "./snapshot.service";
import {
  decryptSnapshot,
  encryptSnapshot,
  openSecret,
  sealSecret,
  syncSecretAvailable
} from "./sync-crypto";
import { WebdavRemote, describeWebdavError } from "./webdav-remote";
import { assertPublicRemoteUrl, assertResolvedHostIsPublic } from "../common/remote-url-guard";
import {
  deleteRestoreOperation,
  getRestoreOperation,
  insertRestoreOperationLock,
  isUniqueViolation,
  markRestoreCommitted
} from "./restore-lock.util";

/**
 * Формат байтов, которые едут внутри зашифрованного `.orion`-файла (S04).
 * Отдельно от `WorkspaceSnapshot` (метаданные строк, S03) — блобы это
 * storage-забота, а не Prisma-забота; `SnapshotService` про файловые байты
 * ничего не знает и не должен. Бэкапы до S04 — это просто `WorkspaceSnapshot`
 * без обёртки (нет поля `blobs`), распознаются по отсутствию `blobs` и
 * отклоняются на apply тем же fail-closed путём, что legacy v1 в
 * `snapshot.service.ts` — молча восстановить их значило бы оставить
 * documents-байты нетронутыми/несоответствующими только что заменённым
 * строкам БД.
 */
interface BackupPayload {
  blobs: BlobEntry[];
  snapshot: WorkspaceSnapshot;
  /** Данные Compass (G22). Нет поля — в копии их нет, и восстановление не трогает Compass на этом узле. */
  compass?: CompassBackupEntry;
}

function isBackupPayload(v: unknown): v is BackupPayload {
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray((v as { blobs?: unknown }).blobs) &&
    typeof (v as { snapshot?: unknown }).snapshot === "object"
  );
}

const SNAPSHOTS_DIR = "snapshots";
const LATEST_NAME = "latest.orion";

/**
 * ORION — модуль синхронизации, Стадия 1 (бэкап/восстановление одной ноды в
 * один WebDAV-каталог). Разбор чужого решения и полная архитектура — в
 * `docs/SYNC.md`.
 *
 * Инварианты «модульного контракта» (`CLAUDE.md`): каждый публичный метод
 * начинается с `assertMember` и идёт через `withUser` (RLS); наружу — DTO
 * через `toDto`, Prisma-модели за пределы сервиса не выходят.
 *
 * **Owner-only (S02).** Резервные копии видят и настраивают только `owner`:
 * remote-конфиг хранит расшифровываемый пароль от чужого WebDAV, а
 * `restore` перезаписывает данные всего пространства. Поэтому каждый
 * публичный метод здесь проверяет роль через `assertMemberRoleTx(..., ["owner"])`
 * (а не голый `assertMemberTx`) как самую первую операцию — до расшифровки
 * `passwordEnc`/секрета снапшота и до любого сетевого вызова к WebDAV.
 * `restore` делает эту проверку дважды: один раз на preview (`dryRun`) и
 * заново на apply — роль актёра может смениться между двумя отдельными HTTP-
 * запросами, и apply не должен доверять уже устаревшему preflight.
 *
 * **Stale-preview rejection (S04).** Тем же зазором между preview и apply
 * может воспользоваться и содержимое снапшота, не только роль: второй
 * клиент/сессия успевает сделать новый бэкап поверх `latest.orion` в
 * промежутке. `RestorePreview.manifestHash` — sha256 зашифрованных байт
 * файла, увиденных на preview; apply обязан получить его обратно как
 * `RestoreInput.expectedManifestHash` и сверить со свежим hash того же
 * файла, скачанного заново в начале apply-вызова, до любой самопочинки/
 * owner-recheck/записи на диск. Расхождение — явный отказ, а не тихое
 * применение более нового плана под видом уже просмотренного.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly snapshots: SnapshotService,
    private readonly blobs: BlobBackupService,
    private readonly compass: CompassBackupService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter
  ) {}

  // --- настройка удалёнки --------------------------------------------------

  async getRemote(userId: string, workspaceId: string): Promise<SyncRemote | null> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      return tx.syncRemote.findUnique({ where: { workspaceId } });
    });
    return row ? toDto(row) : null;
  }

  async putRemote(
    userId: string,
    workspaceId: string,
    input: SyncRemoteInput
  ): Promise<SyncRemote> {
    if (!syncSecretAvailable()) {
      throw new BadRequestException(
        "На этом узле не задан SYNC_SECRET (.env) — пароль удалёнки нечем зашифровать. См. docs/SYNC.md §12."
      );
    }
    // S05: same SSRF guard as calendar feeds — WorkDAV remote URL is just as
    // user-controlled and, unlike a read-only ICS feed, backup/restore both
    // write to it.
    await assertPublicRemoteUrl(input.url, "Адрес WebDAV");
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      const existing = await tx.syncRemote.findUnique({ where: { workspaceId } });

      // Пустой input.password = «не менять сохранённый».
      const passwordEnc =
        input.password.length > 0
          ? sealSecret(input.password)
          : (existing?.passwordEnc ?? "");

      const data = {
        kind: input.kind,
        url: input.url,
        username: input.username,
        passwordEnc,
        baseDir: input.baseDir,
        depthInfinity: input.depthInfinity,
        encAlgo: input.encAlgo,
        autoEveryMs: input.autoEveryMs
      };

      return tx.syncRemote.upsert({
        where: { workspaceId },
        create: { workspaceId, ...data },
        update: data
      });
    });
    return toDto(row);
  }

  async testRemote(userId: string, workspaceId: string): Promise<SyncRemoteTestResult> {
    const remote = await this.openRemote(userId, workspaceId);
    try {
      const count = await remote.connectAndCount();
      return { ok: true, detail: `Подключено. В папке рабочего пространства объектов: ${count}` };
    } catch (err) {
      return { ok: false, detail: describeWebdavError(err) };
    }
  }

  // --- бэкап -------------------------------------------------------------

  async backup(userId: string, workspaceId: string): Promise<BackupResult> {
    // `blobs.collect` читает список документов/версий через `tx` (RLS), а
    // сами байты — через StorageAdapter (вне RLS, ключи уже содержат
    // workspaceId). Держим это в одной withUser-транзакции с сериализацией
    // строк, чтобы оба списка (снапшот и манифест байтов) отражали одно и то
    // же согласованное состояние, а не разъехались из-за параллельной
    // правки между двумя раздельными чтениями.
    const { cfg, snapshot, blobDocs } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      const remoteCfg = await tx.syncRemote.findUnique({ where: { workspaceId } });
      if (!remoteCfg) throw new NotFoundException("Удалёнка не настроена");
      const snap = await this.snapshots.serialize(tx, workspaceId);
      const blobEntries = await this.blobs.collect(tx, workspaceId, this.storage);
      return { cfg: remoteCfg, snapshot: snap, blobDocs: blobEntries };
    });
    // DNS-resolve + build the WebDAV client outside the DB transaction — a
    // network round-trip (the DNS-rebinding re-check) has no business
    // holding a Postgres transaction open.
    const remote = await this.remoteFor(cfg, workspaceId);

    // SQLite Compass лежит вне Postgres и RLS: читаем после проверки роли владельца (выше, в транзакции).
    const compassData = await this.compass.collect(workspaceId);
    const payload: BackupPayload = { blobs: blobDocs, snapshot, ...(compassData ? { compass: compassData } : {}) };
    const plain = Buffer.from(JSON.stringify(payload), "utf8");
    const sealed = encryptSnapshot(plain);
    const name = `${snapshot.generatedAt.replace(/[:.]/g, "-")}.orion`;

    try {
      await remote.ensureDir(SNAPSHOTS_DIR);
      // `latest.orion` first: it's what a restore without an explicit
      // `snapshot` name reads, so if the connection drops between the two
      // uploads (same bytes, two keys), the more valuable of the two is the
      // one already durable — a listable-but-incomplete dated entry with no
      // `latest` update would be the worse half to lose.
      await remote.putFile(`${SNAPSHOTS_DIR}/${LATEST_NAME}`, sealed);
      await remote.putFile(`${SNAPSHOTS_DIR}/${name}`, sealed);
      await this.markRun(userId, workspaceId, null);
    } catch (err) {
      await this.markRun(userId, workspaceId, describeWebdavError(err));
      throw err;
    }

    return {
      name,
      sizeBytes: sealed.length,
      counts: SnapshotService.tableCounts(snapshot),
      compassIncluded: compassData !== null
    };
  }

  async listBackups(userId: string, workspaceId: string): Promise<BackupRef[]> {
    const remote = await this.openRemote(userId, workspaceId);
    const files = await remote.listDir(SNAPSHOTS_DIR);
    return files
      .filter((f) => f.name.endsWith(".orion") && f.name !== LATEST_NAME)
      .map((f) => ({
        name: f.name,
        sizeBytes: f.size,
        createdAt: parseStamp(f.name) ?? f.lastmod
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // --- восстановление ---------------------------------------------------

  async restore(
    userId: string,
    workspaceId: string,
    input: RestoreInput
  ): Promise<RestorePreview> {
    const remote = await this.openRemote(userId, workspaceId);
    const key = `${SNAPSHOTS_DIR}/${input.snapshot ?? LATEST_NAME}`;
    if (!(await remote.exists(key))) {
      throw new NotFoundException(`Снапшот не найден: ${input.snapshot ?? LATEST_NAME}`);
    }

    const sealed = await remote.getFile(key);
    let parsed: unknown;
    try {
      parsed = JSON.parse(decryptSnapshot(sealed).toString("utf8"));
    } catch (err) {
      throw new BadRequestException(
        `Не удалось расшифровать снапшот — другой SYNC_SECRET или файл повреждён (${(err as Error).message})`
      );
    }
    if (!isBackupPayload(parsed)) {
      // Бэкап сделан до S04 — метаданные строк есть, файловых байтов нет.
      // Тот же fail-closed принцип, что у legacy v1 снапшота в
      // snapshot.service.ts: молча восстановить строки БД, оставив
      // документы без байтов (или со старыми, не соответствующими байтами),
      // хуже отказа.
      throw new BadRequestException(
        "Этот бэкап сделан до появления файловых бэкапов (S04) — в нём нет байтов документов. " +
          "Восстановление отклонено, чтобы не оставить documents без содержимого; сделайте новый бэкап на исходном узле, если он ещё доступен."
      );
    }
    const { snapshot, blobs: blobEntries } = parsed;
    if (snapshot.workspaceId !== workspaceId) {
      throw new BadRequestException(
        "Снапшот принадлежит другому рабочему пространству — восстановление отклонено"
      );
    }

    const incoming = { ...SnapshotService.tableCounts(snapshot), documentBlobs: blobEntries.length, ...(parsed.compass ? { compassData: 1 } : {}) };
    // sha256 самих зашифрованных байт, скачанных ВЫШЕ, в этом же вызове —
    // preview и apply читают удалёнку одинаково (по `key`), поэтому если
    // содержимое `key` изменится между двумя раздельными HTTP-запросами
    // (второй клиент успел сделать новый бэкап под тем же именем, обычно
    // `latest.orion`), пересчитанный здесь hash на apply разойдётся с тем,
    // что вернул предыдущий preview (S04, stale-preview rejection).
    const manifestHash = createHash("sha256").update(sealed).digest("hex");

    if (input.dryRun) {
      const current = await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
        return this.snapshots.counts(tx, workspaceId);
      });
      return {
        snapshot: input.snapshot ?? LATEST_NAME,
        createdAt: snapshot.generatedAt,
        incoming,
        current,
        applied: false,
        manifestHash
      };
    }

    if (input.confirmWorkspaceId !== workspaceId) {
      throw new BadRequestException(
        "Для применения нужен confirmWorkspaceId, равный id рабочего пространства"
      );
    }

    // Stale-preview rejection (S04): apply обязан подтвердить, что снапшот,
    // который он вот-вот применит (скачан заново ВЫШЕ, в начале этого же
    // вызова), — тот же самый, что показал предыдущий preview, а не более
    // свежий бэкап, о котором пользователь ничего не видел. Без этой
    // проверки второй клиент, успевший сделать новый бэкап между preview и
    // apply, тихо подменил бы план восстановления — apply применил бы чужие
    // изменения под видом уже просмотренного плана. Проверка стоит здесь —
    // до самопочинки/owner-recheck/blob-restore ниже, т.е. раньше любого
    // фактического воздействия на диск или БД этого запроса.
    if (!input.expectedManifestHash) {
      throw new BadRequestException(
        "Для применения нужен expectedManifestHash из предпросмотра — сначала повторите предпросмотр (dryRun: true)"
      );
    }
    if (input.expectedManifestHash !== manifestHash) {
      throw new BadRequestException(
        "Превью устарело: снапшот на удалёнке изменился после предпросмотра (например, другой клиент успел сделать новый бэкап). " +
          "Восстановление отклонено, чтобы не применить план, который вы не видели — повторите предпросмотр и подтвердите заново."
      );
    }

    // Самопочинка перед началом: предыдущая попытка apply могла оборваться
    // посередине (сбой процесса между commit БД и публикацией файлов, или
    // раньше). Решение "откатить" против "докатить вперёд" принимается по
    // durable `SyncRestoreOperation`-строке в БД, не только по файловому
    // журналу (R18-01) — см. `recoverPendingRestore` и док-комментарий
    // `SyncRestoreOperation` в schema.prisma.
    await this.recoverPendingRestore(userId, workspaceId);

    // Re-check the role here, not just trust the preflight above: the
    // actor's role can change between a preview (dryRun) and this apply
    // call (two separate HTTP requests) — an owner demoted to member in
    // between must not be able to apply a previously-previewed restore.
    // Own short transaction (not held open across the storage I/O below).
    const before = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      return this.snapshots.counts(tx, workspaceId);
    });

    // R18-01 — durable two-phase restore. Was: stage+swap live files, THEN
    // apply DB rows; a DB failure after the swap left live bytes replaced
    // with no corresponding row change and nothing to roll back to (the old
    // tree had already been deleted) — Codex 18-REVIEW-FINAL-PASS. Now:
    //
    //   1. Stage (checksum-verified) — live tree untouched either way.
    //   2. Acquire the durable per-workspace lock row (also blocks a second
    //      concurrent restore: unique workspaceId → 409).
    //   3. Apply DB rows AND flip the lock row to "committed" in the SAME
    //      transaction — atomic: either both happen, or (on failure) neither
    //      does, and the live tree is still the old one either way.
    //   4. Only once that transaction has durably committed do we publish
    //      the staged files (swap root). From this point on we can only
    //      move forward (DB already reflects the new state) — a crash here
    //      is resumed by `recoverPendingRestore` on the next attempt via the
    //      "committed" lock row, exactly like `blobs.publish()` being
    //      idempotent for an in-progress swap.
    const batchId = randomUUID();
    try {
      await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
        await insertRestoreOperationLock(tx, randomUUID(), workspaceId, batchId);
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          "Восстановление для этого пространства уже выполняется — дождитесь его завершения"
        );
      }
      throw err;
    }

    let compassStaged: string | null = null;
    try {
      await this.blobs.stage(this.storage, workspaceId, batchId, blobEntries);
      if (parsed.compass) compassStaged = await this.compass.stage(workspaceId, parsed.compass);
    } catch (err) {
      await this.blobs.discardStaging(this.storage, workspaceId, batchId).catch(() => undefined);
      if (compassStaged) await this.compass.discard(compassStaged).catch(() => undefined);
      await this.prisma.withUser(userId, (tx) => deleteRestoreOperation(tx, workspaceId)).catch(() => undefined);
      throw err;
    }

    try {
      await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
        await this.snapshots.apply(tx, snapshot);
        await markRestoreCommitted(tx, workspaceId);
      });
    } catch (err) {
      // Transaction rolled back in full — the lock row never reached
      // "committed" and the DB rows are untouched. Live tree was never
      // touched either (we haven't published yet) — safe to just discard
      // the staged batch and release the lock.
      await this.blobs.discardStaging(this.storage, workspaceId, batchId).catch(() => undefined);
      if (compassStaged) await this.compass.discard(compassStaged).catch(() => undefined);
      await this.prisma.withUser(userId, (tx) => deleteRestoreOperation(tx, workspaceId)).catch(() => undefined);
      throw err;
    }

    // DB durably committed — from here on only forward progress is safe.
    await this.blobs.publish(this.storage, workspaceId, batchId);
    await this.prisma.withUser(userId, (tx) => deleteRestoreOperation(tx, workspaceId));
    // Compass — после снятия блокировки: подмена файла безвозвратна только для движка, а прежняя база остаётся рядом.
    if (compassStaged) {
      await this.compass.publish(workspaceId, compassStaged).catch((error) => {
        this.logger.error(`Данные Compass не подменены (подготовленный файл ${compassStaged}): ${error instanceof Error ? error.message : String(error)}`);
      });
    }

    const current = before;

    this.logger.warn(`restore применён для workspace ${workspaceId} из ${key}`);
    return {
      snapshot: input.snapshot ?? LATEST_NAME,
      createdAt: snapshot.generatedAt,
      incoming,
      current,
      applied: true,
      manifestHash
    };
  }

  // --- внутреннее -----------------------------------------------------

  /**
   * R18-01: recovery, ведомое durable-строкой `SyncRestoreOperation`, а не
   * только файловым журналом. Вызывается в начале каждого apply-restore, до
   * захвата нового lock — если предыдущая попытка не дошла до конца, её
   * нужно сперва разрешить, иначе новый lock всегда получит 409 от старого.
   *
   * `phase === "committed"` — транзакция БД прошлой попытки уже durably
   * закоммичена; откатывать нечего и небезопасно, единственный правильный
   * путь — довести публикацию файлов до конца (`blobs.publish`, идемпотентно).
   * `phase === "staging"/"staged"` — БД не тронута, живое дерево не тронуто
   * (до `publish()` мы его не касаемся) — безопасно отменить batch.
   */
  private async recoverPendingRestore(userId: string, workspaceId: string): Promise<void> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      return getRestoreOperation(tx, workspaceId);
    });
    if (!row) {
      // Защитная зачистка: файловый журнал без строки в БД (осиротевший до
      // появления этого механизма, либо после publish(), у которого удаление
      // строки прошло, а собственная самоочистка журнала — нет). recover()
      // безопасен и идемпотентен сам по себе.
      await this.blobs.recover(this.storage, workspaceId).catch(() => undefined);
      return;
    }
    if (row.phase === "committed") {
      await this.blobs.publish(this.storage, workspaceId, row.batchId);
    } else {
      await this.blobs.discardStaging(this.storage, workspaceId, row.batchId).catch(() => undefined);
    }
    await this.prisma.withUser(userId, (tx) => deleteRestoreOperation(tx, workspaceId));
  }

  /** Для фонового приёма Link (без пользователя): удалёнка пространства или `null`, если не настроена. */
  async systemRemoteFor(workspaceId: string): Promise<WebdavRemote | null> {
    const cfg = await this.prisma.asSystem((tx) => tx.syncRemote.findUnique({ where: { workspaceId } }));
    return cfg ? this.remoteFor(cfg, workspaceId) : null;
  }

  /** owner-only assertMemberRoleTx + распаковка конфига в готовый WebdavRemote. */
  private async openRemote(userId: string, workspaceId: string): Promise<WebdavRemote> {
    const cfg = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      return tx.syncRemote.findUnique({ where: { workspaceId } });
    });
    if (!cfg) throw new NotFoundException("Удалёнка не настроена");
    return this.remoteFor(cfg, workspaceId);
  }

  private async remoteFor(cfg: DbSyncRemote, workspaceId: string): Promise<WebdavRemote> {
    // S05: re-run the DNS-rebinding half of the SSRF guard right before the
    // actual network client is built, not only once at putRemote()
    // config-save time — the config can be saved long before it's used, and
    // re-checking here shrinks the window between "resolved as public" and
    // "request actually sent" to as tight as practical without pinning the
    // resolved IP into the `webdav` package's own HTTP client.
    let host: string;
    try {
      host = new URL(cfg.url).hostname.toLowerCase();
    } catch {
      throw new BadRequestException("Адрес WebDAV указан некорректно");
    }
    await assertResolvedHostIsPublic(host, "Адрес WebDAV");
    return new WebdavRemote({
      url: cfg.url,
      username: cfg.username,
      password: cfg.passwordEnc ? openSecret(cfg.passwordEnc) : "",
      baseDir: cfg.baseDir,
      workspaceId,
      depthInfinity: cfg.depthInfinity
    });
  }

  /**
   * Отметка результата последнего прогона. Своя короткая `withUser`-
   * транзакция (не держим её открытой во время сетевой заливки в облако);
   * через `withUser`, иначе FORCE RLS не пропустит UPDATE.
   */
  private async markRun(userId: string, workspaceId: string, error: string | null): Promise<void> {
    await this.prisma.withUser(userId, (tx) =>
      tx.syncRemote.update({
        where: { workspaceId },
        data: { lastRunAt: new Date(), lastError: error }
      })
    );
  }
}

// --- DTO -----------------------------------------------------------------

function toDto(row: DbSyncRemote): SyncRemote {
  return {
    workspaceId: row.workspaceId,
    kind: row.kind as SyncRemote["kind"],
    url: row.url,
    username: row.username,
    hasPassword: row.passwordEnc.length > 0,
    baseDir: row.baseDir,
    depthInfinity: row.depthInfinity,
    encAlgo: row.encAlgo as SyncRemote["encAlgo"],
    autoEveryMs: row.autoEveryMs,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    lastError: row.lastError ?? null
  };
}

/** `2026-09-08T12-00-00-000Z.orion` → `2026-09-08T12:00:00.000Z` (или null). */
function parseStamp(fileName: string): string | null {
  const m = fileName.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.orion$/);
  if (!m) return null;
  return `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
}
