import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BadRequestException } from "@nestjs/common";

/**
 * The MurHP desktop app keeps its data in SQLite (`%APPDATA%\com.murhp.diary\murhp.db`); its «Экспорт копии (.json)» is the
 * same data as JSON. ORION reads the database file and returns exactly that JSON shape, so the existing preview and the
 * idempotent import (`parseMurhpBackup` → `importMurhp`) handle it unchanged. Nothing is written anywhere but a temp file
 * that is removed at once.
 */

type Row = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === "string" ? value : value === null || value === undefined ? "" : String(value));
const number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "bigint" ? Number(value) : null);

function symptomsOf(raw: unknown): unknown[] {
  try {
    const parsed: unknown = JSON.parse(text(raw) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Rows of MurHP's tables → the JSON of MurHP's «Экспорт копии» (same field names as its `rowToDay`). */
export function murhpBackupFromRows(cat: Row | undefined, days: Row[], events: Row[]): { app: "murhp"; version: number; exportedAt: string; cat: Row | null; days: Row[]; events: Row[] } {
  return {
    app: "murhp",
    version: 1,
    exportedAt: new Date().toISOString(),
    cat: cat
      ? {
          name: text(cat.name),
          birthdate: text(cat.birthdate),
          breed: text(cat.breed),
          weightKg: number(cat.weight_kg),
          vetContact: text(cat.vet_contact),
          chronic: text(cat.chronic),
          allergies: text(cat.allergies),
          notes: text(cat.notes)
        }
      : null,
    days: days.map((row) => ({
      date: text(row.log_date),
      status: text(row.status) || "normal",
      statusAuto: number(row.status_auto) !== 0,
      appetite: text(row.appetite),
      activity: text(row.activity),
      stool: text(row.stool),
      water: text(row.water),
      vomitingCount: number(row.vomiting_count) ?? 0,
      weightKg: number(row.weight_kg),
      temperature: number(row.temperature),
      meds: text(row.meds),
      note: text(row.note),
      symptoms: symptomsOf(row.symptoms_json),
      updatedAt: text(row.updated_at)
    })),
    events: events.map((row) => ({ date: text(row.event_date), type: text(row.type) || "note", title: text(row.title), note: text(row.note) }))
  };
}

const SQLITE_HEADER = Buffer.from("SQLite format 3\u0000", "latin1");

export async function readMurhpDatabase(bytes: Buffer): Promise<ReturnType<typeof murhpBackupFromRows>> {
  if (bytes.length < SQLITE_HEADER.length || !bytes.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) {
    throw new BadRequestException("Это не файл базы SQLite. Нужен murhp.db из папки MurHP или копия .json.");
  }
  const { DatabaseSync } = await import("node:sqlite");
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "orion-murhp-"));
  const file = path.join(dir, "murhp.db");
  try {
    await fs.promises.writeFile(file, bytes);
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]).map((row) => text(row.name)));
      if (!tables.has("daily_logs") || !tables.has("cats")) throw new BadRequestException("Это не база MurHP: нет таблиц cats и daily_logs.");
      const cat = db.prepare("SELECT * FROM cats ORDER BY id LIMIT 1").get() as Row | undefined;
      const catId = cat ? number(cat.id) ?? 1 : 1;
      const days = db.prepare("SELECT * FROM daily_logs WHERE cat_id = ? ORDER BY log_date").all(catId) as Row[];
      const events = tables.has("events") ? (db.prepare("SELECT * FROM events WHERE cat_id = ? ORDER BY event_date").all(catId) as Row[]) : [];
      return murhpBackupFromRows(cat, days, events);
    } finally {
      db.close();
    }
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}
