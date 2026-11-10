import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
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

async function sourceBackup(
  root: string,
  rows: Record<string, unknown>[],
  extraTables: Record<string, Record<string, unknown>[]> = {}
) {
  const tables = { workspaces: rows, ...extraTables };
  const encoded = Object.fromEntries(Object.entries(tables).map(([name, tableRows]) => [name, table(tableRows)]));
  await mkdir(path.join(root, "tables"), { recursive: true });
  for (const [name, value] of Object.entries(encoded)) {
    await writeFile(path.join(root, "tables", `${name}.ndjson`), value.body, "utf8");
  }
  await writeFile(path.join(root, "manifest.json"), `${JSON.stringify({
    version: 1,
    createdAt: "2026-11-08T20:00:00.000Z",
    migrations: ["20260101000000_init"],
    tables: Object.fromEntries(Object.entries(encoded).map(([name, value]) => [name, value.entry])),
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

  it("preserves durable Hub profiles and assignments while removing credential bindings", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "orion-stage-"));
    const source = path.join(root, "source");
    const destination = path.join(root, "staged");
    const durable = {
      agent_hub_agent_profiles: [{ id: "profile", workspaceId: "workspace-id", name: "Reviewer" }],
      agent_hub_task_assignments: [{ id: "assignment", workspaceId: "workspace-id", taskId: "task", profileId: "profile" }]
    };
    await sourceBackup(source, [{ id: "workspace-id", name: "Owned", icsToken: null }], {
      ...durable,
      agent_hub_agent_credentials: [{ id: "binding", workspaceId: "workspace-id", profileId: "profile", tokenId: "credential" }]
    });

    const report = await stageSanitizedMigration(source, destination, new Date("2026-11-08T20:00:00.000Z"));
    for (const [name, rows] of Object.entries(durable)) {
      const sourceRows = await readFile(path.join(source, "tables", `${name}.ndjson`), "utf8");
      const stagedRows = await readFile(path.join(destination, "tables", `${name}.ndjson`), "utf8");
      expect(stagedRows).toBe(sourceRows);
      expect(JSON.parse(stagedRows.trim())).toEqual(rows[0]);
    }
    const stagedBindings = await readFile(path.join(destination, "tables", "agent_hub_agent_credentials.ndjson"), "utf8");
    expect(stagedBindings).toBe("");
    expect(report.tablesRewritten).toContain("agent_hub_agent_credentials");
    expect(report.sideEffectsStopped).toBe(1);
  });

  it("refuses a destination that names the classic desktop identity", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "orion-stage-"));
    const source = path.join(root, "source");
    await sourceBackup(source, [{ id: "workspace-id", name: "Owned", icsToken: null }]);
    await expect(stageSanitizedMigration(source, path.join(root, "com.orion.desktop", "staged"))).rejects.toThrow("classic_profile_refused");
  });

  it("refuses the Rust desktop identity under LocalAppData and ProgramData", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "orion-stage-"));
    const source = path.join(root, "source");
    await sourceBackup(source, [{ id: "workspace-id", name: "Owned", icsToken: null }]);
    const previousLocal = process.env.LOCALAPPDATA;
    const previousProgram = process.env.ProgramData;
    const local = path.join(root, "local");
    const program = path.join(root, "program");
    process.env.LOCALAPPDATA = local;
    process.env.ProgramData = program;
    try {
      const identity = path.join("ORION-Rust", "com.orion.rust.desktop", "staging");
      await expect(stageSanitizedMigration(source, path.join(local, identity))).rejects.toThrow("classic_profile_refused");
      await expect(stageSanitizedMigration(source, path.join(program, identity))).rejects.toThrow("classic_profile_refused");
    } finally {
      if (previousLocal === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = previousLocal;
      if (previousProgram === undefined) delete process.env.ProgramData;
      else process.env.ProgramData = previousProgram;
    }
  });

  it("refuses an existing destination without changing its contents", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "orion-stage-"));
    const source = path.join(root, "source");
    const destination = path.join(root, "staged");
    await sourceBackup(source, [{ id: "workspace-id", name: "Owned", icsToken: null }]);
    await mkdir(destination);
    await writeFile(path.join(destination, "keep.txt"), "existing user data", "utf8");

    await expect(stageSanitizedMigration(source, destination)).rejects.toThrow("stage_destination_exists");
    await expect(readFile(path.join(destination, "keep.txt"), "utf8")).resolves.toBe("existing user data");
  });

  it("refuses source and destination paths that overlap", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "orion-stage-"));
    const destination = path.join(root, "destination");
    const source = path.join(destination, "source");
    await sourceBackup(source, [{ id: "workspace-id", name: "Owned", icsToken: null }]);

    await expect(stageSanitizedMigration(source, destination)).rejects.toThrow("stage_paths_overlap");
    await expect(stageSanitizedMigration(source, path.join(source, "child"))).rejects.toThrow("stage_paths_overlap");
  });

  it("refuses linked path components before copying", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "orion-stage-"));
    const source = path.join(root, "source");
    const linkedSource = path.join(root, "source-alias");
    const destination = path.join(root, "staged");
    await sourceBackup(source, [{ id: "workspace-id", name: "Owned", icsToken: null }]);
    await symlink(source, linkedSource, "junction");

    await expect(stageSanitizedMigration(linkedSource, destination)).rejects.toThrow("stage_path_link_refused");
    await expect(readFile(path.join(destination, "manifest.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
