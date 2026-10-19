import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompassBackupService } from "./compass-backup.service";
import type { CompassEngineService } from "./compass-engine.service";

/** G22: данные Compass (SQLite) входят в резервную копию и возвращаются из неё; движок при подмене останавливается. */
let root: string;
let stop: ReturnType<typeof vi.fn>;
let service: CompassBackupService;
const WS = "ws-1";

function dbPath(workspaceId = WS): string {
  return path.join(root, workspaceId, "compass.sqlite3");
}

function makeDb(workspaceId: string, rows: string[]): DatabaseSync {
  mkdirSync(path.join(root, workspaceId), { recursive: true });
  const db = new DatabaseSync(dbPath(workspaceId));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; CREATE TABLE IF NOT EXISTS plans (name TEXT)");
  for (const row of rows) db.prepare("INSERT INTO plans (name) VALUES (?)").run(row);
  return db;
}

function names(file: string): string[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare("SELECT name FROM plans ORDER BY rowid").all() as Array<{ name: string }>).map((r) => r.name);
  } finally {
    db.close();
  }
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "orion-compass-test-"));
  process.env.COMPASS_DATA_DIR = root;
  stop = vi.fn();
  service = new CompassBackupService({ stop } as unknown as CompassEngineService);
});

afterEach(() => {
  delete process.env.COMPASS_DATA_DIR;
  rmSync(root, { recursive: true, force: true });
});

describe("CompassBackupService", () => {
  it("нет данных Compass — в копию ничего не кладётся", async () => {
    expect(await service.collect(WS)).toBeNull();
  });

  it("копия согласованна, даже когда часть записей ещё только в WAL, и возвращается на место", async () => {
    const db = makeDb(WS, ["план А", "план Б"]); // wal_autocheckpoint = 0: записи остаются в -wal, основной файл пуст
    const entry = await service.collect(WS);
    expect(entry).not.toBeNull();
    expect(entry!.size).toBeGreaterThan(0);

    // Потом базу испортили: после копии появились лишние записи.
    db.prepare("INSERT INTO plans (name) VALUES (?)").run("после копии");
    db.close();

    const staged = await service.stage(WS, entry!);
    await service.publish(WS, staged);

    expect(stop).toHaveBeenCalledWith(WS);
    expect(names(dbPath())).toEqual(["план А", "план Б"]);
    // Прежняя база не пропала: рядом лежит её копия.
    const kept = readdirSync(path.join(root, WS)).filter((f) => f.includes(".pre-restore-") && !f.endsWith("-wal") && !f.endsWith("-shm"));
    expect(kept).toHaveLength(1);
    expect(names(path.join(root, WS, kept[0]!))).toContain("после копии");
    expect(existsSync(`${dbPath()}-wal`)).toBe(false);
  });

  it("повреждённая или чужая запись отвергается до любой записи на диск", async () => {
    makeDb(WS, ["x"]).close();
    const entry = (await service.collect(WS))!;
    await expect(service.stage(WS, { ...entry, sha256: "0".repeat(64) })).rejects.toThrow("контрольная сумма");
    const notSqlite = Buffer.from("not a database at all");
    await expect(
      service.stage(WS, { sha256: (await import("node:crypto")).createHash("sha256").update(notSqlite).digest("hex"), size: notSqlite.length, data: notSqlite.toString("base64") })
    ).rejects.toThrow("не база SQLite");
    expect(readdirSync(path.join(root, WS)).some((f) => f.includes(".restoring-"))).toBe(false);
  });

  it("в режиме server данные Compass не собираются", async () => {
    makeDb(WS, ["x"]).close();
    process.env.ORION_MODE = "server";
    process.env.JWT_SECRET = "test-secret-for-server-mode-xxxxxxxxxxxxxxxx";
    try {
      expect(await service.collect(WS)).toBeNull();
    } finally {
      delete process.env.ORION_MODE;
      delete process.env.JWT_SECRET;
    }
  });
});
