import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stageSanitizedMigration } from "./migration-stage";

const MOD = 1n << 256n;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function table(rows: Record<string, unknown>[]) {
  const lines = rows.map((row) => JSON.stringify(row));
  const body = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  let sum = 0n;
  for (const line of lines) sum = (sum + BigInt(`0x${sha256(line)}`)) % MOD;
  return { body, entry: { rows: lines.length, fileSha256: sha256(body), rowsDigest: sum.toString(16).padStart(64, "0") } };
}

async function sourceBackup(root: string, rows: Record<string, unknown>[]) {
  const encoded = table(rows);
  await mkdir(path.join(root, "tables"), { recursive: true });
  await writeFile(path.join(root, "tables", "workspaces.ndjson"), encoded.body, "utf8");
  await writeFile(path.join(root, "manifest.json"), `${JSON.stringify({
    version: 1,
    createdAt: "2026-11-08T20:00:00.000Z",
    migrations: ["20260101000000_init"],
    tables: { workspaces: encoded.entry },
    storage: { driver: "local", files: [] },
    secrets: { SYNC_SECRET: null }
  }, null, 2)}\n`, "utf8");
}

describe("sanitized migration stage", () => {
  it("rewrites a copy, keeps the source bytes, and leaves a verifiable backup", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "orion-stage-"));
    const source = path.join(root, "source");
    const destination = path.join(root, "staged");
    const rows = [{ id: "workspace-id", name: "Owned", icsToken: "old-public-feed-token", syncMode: "hybrid" }];
    await sourceBackup(source, rows);
    const before = await readFile(path.join(source, "tables", "workspaces.ndjson"), "utf8");

    const report = await stageSanitizedMigration(source, destination, new Date("2026-11-08T20:00:00.000Z"));
    const after = await readFile(path.join(source, "tables", "workspaces.ndjson"), "utf8");
    const staged = await readFile(path.join(destination, "tables", "workspaces.ndjson"), "utf8");

    expect(after).toBe(before);
    expect(staged).not.toContain("old-public-feed-token");
    expect(JSON.parse(staged.trim()).icsToken).toBeNull();
    expect(report.tablesRewritten).toEqual(["workspaces"]);
    expect(report.credentialsRotated).toBe(0);
  });

  it("refuses a destination that names the classic desktop identity", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "orion-stage-"));
    const source = path.join(root, "source");
    await sourceBackup(source, [{ id: "workspace-id", name: "Owned", icsToken: null }]);
    await expect(stageSanitizedMigration(source, path.join(root, "com.orion.desktop", "staged"))).rejects.toThrow("classic_profile_refused");
  });
});
