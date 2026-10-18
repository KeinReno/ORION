import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { isServerMode } from "../common/orion-mode";
import { CompassEngineService } from "./compass-engine.service";

/**
 * Данные Compass (SQLite самого движка, а не Postgres) в резервной копии `.orion` — G22.
 * Раньше они не входили ни в бэкап, ни в восстановление: журнал можно было забрать в «Сделки» ORION, но планы, сигналы,
 * оповещения, рисунки и прогнозы терялись. Снимок делается через `VACUUM INTO` — согласованная копия работающей базы
 * (в режиме WAL) без остановки движка. Восстановление кладёт файл атомарно, старую базу оставляет рядом.
 */
export interface CompassBackupEntry {
  /** Согласованная копия `compass.sqlite3` одним файлом (без -wal/-shm). */
  sha256: string;
  size: number;
  /** base64 */
  data: string;
}

const DB_NAME = "compass.sqlite3";

@Injectable()
export class CompassBackupService {
  private readonly logger = new Logger(CompassBackupService.name);

  constructor(private readonly engine: CompassEngineService) {}

  private dataDir(workspaceId: string): string {
    return path.join(process.env.COMPASS_DATA_DIR ?? path.resolve(process.cwd(), ".data", "compass"), workspaceId);
  }

  /** `null` — у пространства нет данных Compass или на этом узле их нет по определению (режим server). */
  async collect(workspaceId: string): Promise<CompassBackupEntry | null> {
    if (isServerMode()) return null;
    const source = path.join(this.dataDir(workspaceId), DB_NAME);
    if (!existsSync(source)) return null;
    const target = path.join(tmpdir(), `orion-compass-${randomUUID()}.sqlite3`);
    try {
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(source, { readOnly: true });
      try {
        db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
      } finally {
        db.close();
      }
      const bytes = await readFile(target);
      return { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, data: bytes.toString("base64") };
    } finally {
      await rm(target, { force: true });
    }
  }

  /** Проверяет целостность записи и кладёт байты во временный файл рядом с базой; возвращает путь для `publish`. */
  async stage(workspaceId: string, entry: CompassBackupEntry): Promise<string> {
    const bytes = Buffer.from(entry.data, "base64");
    if (bytes.length !== entry.size || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
      throw new BadRequestException("Данные Compass в резервной копии повреждены (контрольная сумма не совпала) — восстановление отклонено");
    }
    if (bytes.subarray(0, 15).toString("latin1") !== "SQLite format 3") {
      throw new BadRequestException("Данные Compass в резервной копии — не база SQLite — восстановление отклонено");
    }
    const dir = this.dataDir(workspaceId);
    await mkdir(dir, { recursive: true });
    const staged = path.join(dir, `${DB_NAME}.restoring-${randomUUID()}`);
    await writeFile(staged, bytes);
    return staged;
  }

  async discard(stagedPath: string): Promise<void> {
    await rm(stagedPath, { force: true });
  }

  /**
   * Подменяет базу: останавливает движок пространства, старую базу (и её -wal/-shm) откладывает как `.pre-restore-<время>`,
   * подготовленный файл переименовывает на место (атомарно в пределах одного каталога).
   */
  async publish(workspaceId: string, stagedPath: string): Promise<void> {
    this.engine.stop(workspaceId);
    const dir = this.dataDir(workspaceId);
    const live = path.join(dir, DB_NAME);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (existsSync(live)) {
      const old = path.join(dir, `${DB_NAME}.pre-restore-${stamp}`);
      await rename(live, old);
      // Журнал WAL хранит подтверждённые, но ещё не слитые в файл записи — откладываем его вместе с базой, иначе они пропадут.
      if (existsSync(`${live}-wal`)) await rename(`${live}-wal`, `${old}-wal`);
    }
    // Остатки журнала старой базы не должны примениться к новой.
    await rm(`${live}-wal`, { force: true });
    await rm(`${live}-shm`, { force: true });
    await rename(stagedPath, live);
    this.logger.warn(`Данные Compass пространства ${workspaceId} восстановлены из резервной копии`);
  }
}
