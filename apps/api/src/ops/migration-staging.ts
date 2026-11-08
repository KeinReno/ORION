import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface CreateMigrationStagingOptions {
  /** An existing, empty, explicitly chosen test directory. Relative paths are refused. */
  testRoot: string;
}

export interface MigrationStagingArea {
  status: "empty-isolated-staging";
  id: string;
  root: string;
  profileDirectory: string;
  experimental: true;
  filesystemPermissionsVerified: false;
  restorePerformed: false;
  sourceDataRead: false;
}

function protectedProfileRoots(): string[] {
  const localAppData = process.env.LOCALAPPDATA?.trim() || path.join(homedir(), "AppData", "Local");
  const programData = process.env.ProgramData?.trim() || "C:\\ProgramData";
  return [
    path.join(localAppData, "ORION"),
    path.join(localAppData, "ORION-Rust"),
    path.join(localAppData, "com.orion.desktop"),
    path.join(localAppData, "com.orion.rust.desktop"),
    path.join(programData, "ORION"),
    path.join(programData, "ORION-Rust")
  ];
}

/**
 * Creates a new, empty staging profile under an explicit test directory.
 * This intentionally accepts no backup/source path, database client or storage
 * directory: it cannot inspect or restore real profile data. This is
 * experimental scaffolding; mode bits are best-effort on POSIX and Windows ACLs
 * are inherited and not inspected or configured, so privacy is not guaranteed.
 */
export async function createMigrationStagingArea(
  options: CreateMigrationStagingOptions
): Promise<MigrationStagingArea> {
  const requestedRoot = options.testRoot;
  if (!requestedRoot || !path.isAbsolute(requestedRoot)) {
    throw new Error("Для staging нужен явно заданный абсолютный путь тестового каталога.");
  }

  const absoluteRoot = path.resolve(requestedRoot);
  if (absoluteRoot === path.parse(absoluteRoot).root) {
    throw new Error("Корень файловой системы нельзя использовать как тестовый каталог.");
  }

  await assertDirectoryPathHasNoLinks(absoluteRoot);
  const root = await realpath(absoluteRoot);
  const rootInfo = await lstat(absoluteRoot);
  const canonicalInfo = await lstat(root);
  if (
    !rootInfo.isDirectory() || rootInfo.isSymbolicLink() ||
    rootInfo.dev !== canonicalInfo.dev || rootInfo.ino !== canonicalInfo.ino
  ) {
    throw new Error("Тестовый каталог небезопасен или изменился во время проверки.");
  }
  await refuseProtectedProfileRoots(absoluteRoot, root);
  if ((await readdir(root)).length !== 0) {
    throw new Error("Тестовый каталог должен быть пустым; существующие файлы не изменены.");
  }

  const id = randomUUID();
  const areaRoot = path.join(root, `orion-migration-staging-${id}`);
  const profileDirectory = path.join(areaRoot, "profile");

  // Non-recursive creation means this function never creates or traverses a
  // caller-supplied child path. The random name also makes overwrite impossible.
  // POSIX mode is a best-effort default. Node does not apply it as a Windows ACL.
  await mkdir(areaRoot, { mode: 0o700 });
  await assertNewDirectoryIsContained(root, areaRoot);
  await mkdir(profileDirectory, { mode: 0o700 });
  await assertNewDirectoryIsContained(root, profileDirectory);

  const manifest: MigrationStagingArea = {
    status: "empty-isolated-staging",
    id,
    root: areaRoot,
    profileDirectory,
    experimental: true,
    filesystemPermissionsVerified: false,
    restorePerformed: false,
    sourceDataRead: false
  };
  await writeFile(path.join(areaRoot, "staging.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });

  return manifest;
}

async function refuseProtectedProfileRoots(requestedRoot: string, realRoot: string): Promise<void> {
  const protectedRoots = protectedProfileRoots();
  for (const protectedRoot of protectedRoots) {
    if (isSameOrInside(requestedRoot, protectedRoot)) {
      throw new Error("Тестовый каталог находится внутри защищённого профиля Classic или ORION-Rust.");
    }
    const canonicalProtectedRoot = await resolveWithExistingAncestors(protectedRoot);
    if (isSameOrInside(realRoot, canonicalProtectedRoot)) {
      throw new Error("Реальный путь тестового каталога находится внутри защищённого профиля Classic или ORION-Rust.");
    }
  }
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Resolve existing symlinks in a protected root even when its tail is absent. */
async function resolveWithExistingAncestors(candidate: string): Promise<string> {
  let current = path.resolve(candidate);
  const tail: string[] = [];
  for (;;) {
    try {
      await lstat(current);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
  return path.join(await realpath(current), ...tail);
}

async function assertDirectoryPathHasNoLinks(directory: string): Promise<void> {
  const parsed = path.parse(directory);
  const parts = directory.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const part of parts) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("Путь тестового каталога содержит ссылку или недиректорию.");
    }
  }
}

async function assertNewDirectoryIsContained(root: string, directory: string): Promise<void> {
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("Созданная staging-область заменена ссылкой или недиректорией.");
  }
  const realDirectory = await realpath(directory);
  const relative = path.relative(root, realDirectory);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Созданная staging-область вышла за границы тестового каталога.");
  }
}
