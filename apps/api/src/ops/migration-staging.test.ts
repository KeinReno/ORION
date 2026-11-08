import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMigrationStagingArea } from "./migration-staging";

const directories: string[] = [];
async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "orion-migration-staging-test-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function withProfileRoots<T>(root: string, action: () => Promise<T>): Promise<T> {
  const previousLocal = process.env.LOCALAPPDATA;
  const previousProgram = process.env.ProgramData;
  process.env.LOCALAPPDATA = path.join(root, "local-app-data");
  process.env.ProgramData = path.join(root, "program-data");
  try {
    return await action();
  } finally {
    if (previousLocal === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocal;
    if (previousProgram === undefined) delete process.env.ProgramData;
    else process.env.ProgramData = previousProgram;
  }
}

describe("isolated migration staging area", () => {
  it("creates a new empty profile only under the explicitly selected empty test root", async () => {
    const parent = await temporaryDirectory();
    const testRoot = path.join(parent, "test-root");
    const unrelated = path.join(parent, "unrelated-data.txt");
    await mkdir(testRoot);
    await writeFile(unrelated, "must remain unchanged");

    const staging = await createMigrationStagingArea({ testRoot });

    expect(staging.status).toBe("empty-isolated-staging");
    expect(staging.restorePerformed).toBe(false);
    expect(staging.sourceDataRead).toBe(false);
    expect(staging.experimental).toBe(true);
    expect(staging.filesystemPermissionsVerified).toBe(false);
    expect(path.dirname(staging.root)).toBe(testRoot);
    expect(await readdir(staging.root)).toEqual(["profile", "staging.json"]);
    expect(await readdir(staging.profileDirectory)).toEqual([]);
    expect(JSON.parse(await readFile(path.join(staging.root, "staging.json"), "utf8"))).toMatchObject({
      id: staging.id,
      status: "empty-isolated-staging",
      restorePerformed: false,
      sourceDataRead: false
    });
    expect(await readFile(unrelated, "utf8")).toBe("must remain unchanged");
    expect(await readdir(testRoot)).toEqual([path.basename(staging.root)]);
  });

  it("requires an absolute explicit path and refuses to reuse a non-empty directory", async () => {
    await expect(createMigrationStagingArea({ testRoot: "relative-test-area" })).rejects.toThrow(/абсолютный путь/i);

    const testRoot = await temporaryDirectory();
    const existing = path.join(testRoot, "keep.txt");
    await writeFile(existing, "keep");
    await expect(createMigrationStagingArea({ testRoot })).rejects.toThrow(/должен быть пустым/i);
    expect(await readFile(existing, "utf8")).toBe("keep");
    expect(await readdir(testRoot)).toEqual(["keep.txt"]);
  });

  it("refuses a test root reached through a symbolic link", async () => {
    const parent = await temporaryDirectory();
    const target = path.join(parent, "target");
    const alias = path.join(parent, "alias");
    await mkdir(target);
    try {
      await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform === "win32" && ["EPERM", "EACCES", "ENOTSUP"].includes(code ?? "")) return;
      throw error;
    }

    await expect(createMigrationStagingArea({ testRoot: alias })).rejects.toThrow(/ссылк/i);
    expect(await readdir(target)).toEqual([]);
  });

  it.each(["local-app-data/ORION", "local-app-data/ORION-Rust", "local-app-data/com.orion.desktop", "local-app-data/com.orion.rust.desktop", "program-data/ORION", "program-data/ORION-Rust"])(
    "refuses an empty test root inside protected profile %s",
    async (relativeProfileRoot) => {
      const base = await temporaryDirectory();
      await withProfileRoots(base, async () => {
        const profileRoot = path.join(base, relativeProfileRoot);
        const testRoot = path.join(profileRoot, "empty-test-area");
        await mkdir(testRoot, { recursive: true });

        await expect(createMigrationStagingArea({ testRoot })).rejects.toThrow(/защищённого профиля/i);
        expect(await readdir(testRoot)).toEqual([]);
      });
    }
  );

  it("refuses a real path that resolves inside a protected profile", async () => {
    const base = await temporaryDirectory();
    await withProfileRoots(base, async () => {
      const protectedRoot = path.join(base, "local-app-data", "ORION");
      const actualTarget = path.join(base, "outside-profile-alias-target");
      const testRoot = path.join(actualTarget, "empty-test-area");
      await mkdir(testRoot, { recursive: true });
      await mkdir(path.dirname(protectedRoot), { recursive: true });
      try {
        await symlink(actualTarget, protectedRoot, process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (process.platform === "win32" && ["EPERM", "EACCES", "ENOTSUP"].includes(code ?? "")) return;
        throw error;
      }

      await expect(createMigrationStagingArea({ testRoot })).rejects.toThrow(/реальный путь/i);
      expect(await readdir(testRoot)).toEqual([]);
    });
  });
});
