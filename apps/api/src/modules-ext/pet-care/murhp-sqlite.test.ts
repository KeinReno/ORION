import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { importMurhpInputSchema, parseMurhpBackup } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { readMurhpDatabase } from "./murhp-sqlite";

/** The tables of MurHP (its src/db/schema.ts), with a cat, two days and an event. */
function murhpDatabase(): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murhp-test-"));
  const file = path.join(dir, "murhp.db");
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE cats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL DEFAULT 'Кот', birthdate TEXT NOT NULL DEFAULT '', breed TEXT NOT NULL DEFAULT '',
      weight_kg REAL, vet_contact TEXT NOT NULL DEFAULT '', chronic TEXT NOT NULL DEFAULT '', allergies TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT);
    CREATE TABLE daily_logs (cat_id INTEGER NOT NULL, log_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'normal', status_auto INTEGER NOT NULL DEFAULT 1,
      appetite TEXT NOT NULL DEFAULT '', activity TEXT NOT NULL DEFAULT '', stool TEXT NOT NULL DEFAULT '', water TEXT NOT NULL DEFAULT '', vomiting_count INTEGER NOT NULL DEFAULT 0,
      weight_kg REAL, temperature REAL, meds TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', symptoms_json TEXT NOT NULL DEFAULT '[]', created_at TEXT, updated_at TEXT,
      PRIMARY KEY (cat_id, log_date));
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, cat_id INTEGER NOT NULL, event_date TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'note', title TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '');
    INSERT INTO cats (name, birthdate, breed, weight_kg, allergies) VALUES ('Мурчик', '2020-05-01', 'британец', 4.6, 'курица');
    INSERT INTO daily_logs (cat_id, log_date, status_auto, appetite, vomiting_count, weight_kg, note, symptoms_json)
      VALUES (1, '2026-10-01', 1, 'reduced', 2, 4.5, 'вялый', '[{"id":"vomiting","severity":"moderate","count":2,"time":"morning","note":""}]');
    INSERT INTO daily_logs (cat_id, log_date, status, status_auto, stool, symptoms_json) VALUES (1, '2026-10-02', 'watch', 0, 'soft', 'не json');
    INSERT INTO events (cat_id, event_date, type, title) VALUES (1, '2026-10-01', 'food_change', 'Новый корм');
  `);
  db.close();
  const bytes = fs.readFileSync(file);
  fs.rmSync(dir, { recursive: true, force: true });
  return bytes;
}

describe("reading MurHP's database file", () => {
  it("gives the same JSON as MurHP's backup, which the regular import accepts", async () => {
    const backup = await readMurhpDatabase(murhpDatabase());
    const parsed = importMurhpInputSchema.parse({ backup });
    const rows = parseMurhpBackup(parsed.backup);
    expect(rows.profile).toMatchObject({ name: "Мурчик", birthdate: "2020-05-01", breed: "британец", weightKg: 4.6, allergies: "курица" });
    expect(rows.days.map((item) => item.day)).toEqual(["2026-10-01", "2026-10-02"]);
    expect(rows.days[0]!.input).toMatchObject({ appetite: "reduced", vomitingCount: 2, weightKg: 4.5, note: "вялый" });
    expect(rows.days[0]!.input.symptoms.map((item) => item.id)).toEqual(["vomiting"]);
    // A broken symptoms cell is an empty list, not a failed import; a manual status stays manual.
    expect(rows.days[1]!.input).toMatchObject({ stool: "soft", statusAuto: false, status: "watch", symptoms: [] });
    expect(rows.events).toEqual([expect.objectContaining({ day: "2026-10-01", type: "food_change", title: "Новый корм" })]);
  });

  it("refuses a file that is not SQLite, or not MurHP's", async () => {
    await expect(readMurhpDatabase(Buffer.from('{"app":"murhp"}'))).rejects.toThrow(/не файл базы SQLite/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "not-murhp-"));
    const file = path.join(dir, "other.db");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE things (id INTEGER)");
    db.close();
    await expect(readMurhpDatabase(fs.readFileSync(file))).rejects.toThrow(/не база MurHP/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
