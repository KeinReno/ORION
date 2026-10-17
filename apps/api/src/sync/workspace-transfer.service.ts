import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { BadRequestException, Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { WorkspaceTransferPreview } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { STORAGE_ADAPTER, type StorageAdapter } from "../storage/storage-adapter";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { BlobBackupService, type BlobEntry } from "./blob-backup.service";
import { remapBlobKey, remapSnapshot } from "./snapshot-remap";
import { SNAPSHOT_MODEL_REGISTRY } from "./snapshot-registry";
import { SNAPSHOT_VERSION, SnapshotService, type WorkspaceSnapshot } from "./snapshot.service";

/** Вне каталогов пространств (как `_restore-journal`) — своп/удаление пространства его не заденет. */
const JOURNAL_KEY = "_import-journal/pending.json";
const FORMAT = "orion-workspace-transfer";
const FORMAT_VERSION = 1;
/** Контейнер с паролем: magic | salt(16) | iv(12) | tag(16) | шифртекст. Ключ — только из пароля, не из SYNC_SECRET узла: файл должен открываться на другом узле. */
const MAGIC = Buffer.from("ORTR1");
/** Контейнер резервной копии узла (sync-crypto.ts) — привязан к SYNC_SECRET и для переноса не годится. */
const NODE_BACKUP_MAGIC = Buffer.from("ORNC1");

interface TransferFile {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  sourceName: string;
  snapshot: WorkspaceSnapshot;
  blobs: BlobEntry[];
}

export interface ImportOptions {
  dryRun: boolean;
  name?: string;
  passphrase?: string;
  expectedHash?: string;
}

/**
 * ТЗ-05 §5.5 — «Перенести моё пространство на узел». Это процедура, а не слияние:
 * ничего существующего не перезаписывается, результат — всегда новое пространство,
 * владелец которого — импортирующий. Порядок устроен так, чтобы обрыв в любой точке
 * не оставил на узле половины данных: файлы кладутся под ещё не существующий id нового
 * пространства, строки вставляются одной транзакцией, при сбое файлы убираются.
 */
@Injectable()
export class WorkspaceTransferService implements OnModuleInit {
  private readonly logger = new Logger(WorkspaceTransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly snapshots: SnapshotService,
    private readonly blobs: BlobBackupService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter
  ) {}

  /** Хвосты обрыва процесса посреди прошлого импорта убираем при старте. */
  async onModuleInit(): Promise<void> {
    await this.recoverPendingImports().catch((error: unknown) => this.logger.warn(`Не удалось прибрать хвосты импорта: ${String(error)}`));
  }

  /**
   * Журнал идущих импортов (`_import-journal/pending.json`, вне каталогов пространств): id нового пространства
   * записывается ДО первого файла и стирается после коммита или отката. Если процесс оборвался между записью файлов
   * и коммитом, запись осталась — а пространства с таким id нет, значит каталог на диске ничей и его можно убрать.
   * Если пространство есть (обрыв уже после коммита) — файлы живые, трогать нельзя, стирается только запись.
   */
  async recoverPendingImports(): Promise<number> {
    const pending = await this.readJournal();
    if (pending.length === 0) return 0;
    let removed = 0;
    for (const id of pending) {
      const exists = await this.prisma.asSystem((tx) => tx.workspace.count({ where: { id } }));
      if (!exists) {
        await this.storage.remove(id).catch(() => undefined);
        removed += 1;
      }
      await this.journalDrop(id);
    }
    if (removed > 0) this.logger.warn(`Убрано каталогов недоведённого импорта: ${removed}`);
    return removed;
  }

  private journalChain: Promise<unknown> = Promise.resolve();

  private async readJournal(): Promise<string[]> {
    if (!(await this.storage.exists(JOURNAL_KEY))) return [];
    const chunks: Buffer[] = [];
    for await (const chunk of await this.storage.getStream(JOURNAL_KEY)) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch {
      return [];
    }
  }

  /** Читать-менять-писать журнал строго по очереди, иначе два параллельных импорта потеряют записи друг друга. */
  private journalUpdate(change: (ids: string[]) => string[]): Promise<void> {
    const run = this.journalChain.then(async () => {
      const next = change(await this.readJournal());
      await this.storage.putFile(JOURNAL_KEY, Buffer.from(JSON.stringify(next), "utf8"), { contentType: "application/json" });
    });
    this.journalChain = run.catch(() => undefined);
    return run;
  }

  private journalAdd(id: string): Promise<void> {
    return this.journalUpdate((ids) => [...ids, id]);
  }

  private journalDrop(id: string): Promise<void> {
    return this.journalUpdate((ids) => ids.filter((v) => v !== id));
  }

  /** Только владелец: в файле всё содержимое пространства. */
  async exportWorkspace(userId: string, workspaceId: string, passphrase?: string): Promise<{ filename: string; data: Buffer }> {
    const { name, snapshot, blobEntries } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true } });
      const snap = await this.snapshots.serialize(tx, workspaceId);
      const blobEntries = await this.blobs.collect(tx, workspaceId, this.storage);
      return { name: workspace.name, snapshot: snap, blobEntries };
    });
    const file: TransferFile = { format: FORMAT, version: FORMAT_VERSION, exportedAt: new Date().toISOString(), sourceName: name, snapshot, blobs: blobEntries };
    const plain = Buffer.from(JSON.stringify(file), "utf8");
    const data = passphrase ? seal(plain, passphrase) : plain;
    const safeName = name.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 60) || "workspace";
    return { filename: `${safeName}-${snapshot.generatedAt.slice(0, 10)}.orion`, data };
  }

  async importWorkspace(userId: string, bytes: Buffer, options: ImportOptions): Promise<WorkspaceTransferPreview> {
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const file = parseTransferFile(bytes, options.passphrase);
    verifyBlobs(file);

    const newWorkspaceId = randomUUID();
    const importerMemberId = randomUUID();
    const remap = remapSnapshot(file.snapshot, { newWorkspaceId, importerUserId: userId, importerMemberId });
    const targetName = (options.name?.trim() || `${file.sourceName} (перенос)`).slice(0, 80);
    const incoming: Record<string, number> = {};
    for (const [key, rows] of Object.entries(remap.tables)) incoming[key] = rows.length;
    const idCollisions = await this.countCollisions(file.snapshot);

    const preview: WorkspaceTransferPreview = {
      sourceName: file.sourceName,
      exportedAt: file.exportedAt,
      targetName,
      incoming,
      files: file.blobs.length,
      idCollisions,
      reassignedToImporter: remap.report.reassignedToImporter,
      clearedReferences: remap.report.clearedReferences,
      droppedRows: remap.report.droppedRows,
      skippedModels: remap.report.skippedModels,
      problems: remap.report.problems,
      fileHash,
      applied: false,
      workspaceId: null
    };
    if (options.dryRun) return preview;

    if (remap.report.problems.length > 0) {
      throw new BadRequestException(`Перенос невозможен: ${remap.report.problems.slice(0, 5).join("; ")}`);
    }
    if (!options.expectedHash) {
      throw new BadRequestException("Для применения нужен expectedHash из предпросмотра — сначала выполните предпросмотр");
    }
    if (options.expectedHash !== fileHash) {
      throw new BadRequestException("Загружен не тот файл, что был в предпросмотре — повторите предпросмотр");
    }

    // 1. Файлы — под ещё не существующий id: ничего живого они не затрагивают.
    await this.journalAdd(newWorkspaceId);
    try {
      for (const blob of file.blobs) {
        const key = remapBlobKey(blob.key, file.snapshot.workspaceId, newWorkspaceId, remap.idMap);
        await this.storage.putFile(key, Buffer.from(blob.data, "base64"), { contentType: blob.contentType });
      }
      // Пустые папки тоже должны существовать на диске как каталоги.
      await this.storage.mkdir(newWorkspaceId);
    } catch (error) {
      await this.discardFiles(newWorkspaceId);
      throw error;
    }

    // 2. Строки — одна транзакция от имени системной роли: пространство и членство
    //    создаются здесь же (см. WorkspacesService.createForUser), всё или ничего.
    const config = file.snapshot.workspaceConfig;
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL ROLE orion_system");
          await tx.workspace.create({
            data: {
              id: newWorkspaceId,
              name: targetName,
              icsToken: randomBytes(24).toString("base64url"),
              disabledModules: config?.disabledModules ?? [],
              pluginOverrides: config?.pluginOverrides ?? [],
              restrictedModules: config?.restrictedModules ?? [],
              isPersonal: false
            }
          });
          await tx.workspaceMember.create({ data: { id: importerMemberId, workspaceId: newWorkspaceId, userId, role: "owner" } });
          await this.snapshots.insertInto(tx, remap.tables);
        },
        { timeout: 300_000, maxWait: 10_000 }
      );
    } catch (error) {
      await this.discardFiles(newWorkspaceId);
      this.logger.warn(`Перенос пространства «${file.sourceName}» не применён, файлы убраны: ${String(error)}`);
      throw error;
    }

    await this.journalDrop(newWorkspaceId).catch(() => undefined);
    this.logger.log(`Перенос применён: «${file.sourceName}» → ${newWorkspaceId} (владелец ${userId})`);
    return { ...preview, applied: true, workspaceId: newWorkspaceId };
  }

  private async discardFiles(workspaceId: string): Promise<void> {
    await this.storage.remove(workspaceId).catch(() => undefined);
    await this.journalDrop(workspaceId).catch(() => undefined);
  }

  /** Сколько id из файла уже есть на узле (в любом пространстве) — только счёт, содержимое не читается. */
  private async countCollisions(snapshot: WorkspaceSnapshot): Promise<number> {
    let total = 0;
    await this.prisma.asSystem(async (tx) => {
      for (const entry of SNAPSHOT_MODEL_REGISTRY) {
        if (entry.policy !== "included" || !entry.snapshotKey) continue;
        const rows = (snapshot.tables[entry.snapshotKey] ?? []) as Array<Record<string, unknown>>;
        const ids = rows.map((r) => r.id).filter((v): v is string => typeof v === "string");
        if (ids.length === 0) continue;
        const delegate = (tx as unknown as Record<string, { count(args: unknown): Promise<number> } | undefined>)[entry.model.charAt(0).toLowerCase() + entry.model.slice(1)];
        if (!delegate) continue;
        for (let i = 0; i < ids.length; i += 1000) {
          total += await delegate.count({ where: { id: { in: ids.slice(i, i + 1000) } } });
        }
      }
    });
    return total;
  }
}

function parseTransferFile(bytes: Buffer, passphrase?: string): TransferFile {
  let plain = bytes;
  if (bytes.subarray(0, NODE_BACKUP_MAGIC.length).equals(NODE_BACKUP_MAGIC)) {
    throw new BadRequestException(
      "Это резервная копия узла (привязана к SYNC_SECRET того узла). Для переноса на другой узел сделайте «Экспорт для переноса» в исходном ORION."
    );
  }
  if (bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
    if (!passphrase) throw new BadRequestException("Файл защищён паролем — введите пароль");
    try {
      plain = open(bytes, passphrase);
    } catch {
      throw new BadRequestException("Неверный пароль или файл повреждён");
    }
  }
  let parsed: Partial<TransferFile>;
  try {
    parsed = JSON.parse(plain.toString("utf8")) as Partial<TransferFile>;
  } catch {
    throw new BadRequestException("Файл не похож на экспорт пространства ORION");
  }
  if (parsed.format !== FORMAT || typeof parsed.snapshot !== "object" || !Array.isArray(parsed.blobs) || !parsed.snapshot) {
    throw new BadRequestException("Файл не похож на экспорт пространства ORION");
  }
  if (parsed.version !== FORMAT_VERSION) {
    throw new BadRequestException(`Версия файла переноса ${String(parsed.version)} не поддерживается`);
  }
  if (parsed.snapshot.version !== SNAPSHOT_VERSION || typeof parsed.snapshot.workspaceId !== "string" || typeof parsed.snapshot.tables !== "object") {
    throw new BadRequestException("Формат снапшота в файле устарел или повреждён — сделайте экспорт заново в актуальной версии ORION");
  }
  return { ...parsed, sourceName: parsed.sourceName ?? "Пространство", exportedAt: parsed.exportedAt ?? "" } as TransferFile;
}

function verifyBlobs(file: TransferFile): void {
  for (const blob of file.blobs) {
    const buf = Buffer.from(blob.data, "base64");
    if (createHash("sha256").update(buf).digest("hex") !== blob.sha256) {
      throw new BadRequestException(`Файл повреждён: контрольная сумма не совпала для ${blob.key}`);
    }
  }
}

function seal(plain: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

function open(container: Buffer, passphrase: string): Buffer {
  let off = MAGIC.length;
  const salt = container.subarray(off, (off += 16));
  const iv = container.subarray(off, (off += 12));
  const tag = container.subarray(off, (off += 16));
  const decipher = createDecipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(container.subarray(off)), decipher.final()]);
}
