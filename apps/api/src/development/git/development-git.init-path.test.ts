import { afterAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { effectiveRepositoryRoots, browseDirectory, findRepositoryCandidates, resolveInitRepositoryPath } from "./git-command";

const kept: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "orion-init-path-"));
  kept.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(kept.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("effectiveRepositoryRoots", () => {
  it("когда ORION_DEV_REPOSITORY_ROOTS не задан, разрешает домашний каталог узла", () => {
    expect(effectiveRepositoryRoots({}, "/work", "home-test")).toEqual([resolve("/work", "home-test")]);
  });

  it("явные корни из env побеждают умолчание", () => {
    expect(effectiveRepositoryRoots({ ORION_DEV_REPOSITORY_ROOTS: "C:\\repos" }, "/work", "home-test"))
      .toEqual([resolve("/work", "C:\\repos")]);
  });
});

describe("resolveInitRepositoryPath", () => {
  it("принимает несуществующий каталог внутри корня и каноникализирует существующую часть", async () => {
    const root = await tempDir();
    const checked = await resolveInitRepositoryPath(join(root, "nested", "new-repo"), [root]);
    expect(checked.path).toBe(join(await realpath(root), "nested", "new-repo"));
  });

  it("принимает существующий пустой каталог", async () => {
    const root = await tempDir();
    const empty = join(root, "empty");
    await mkdir(empty);
    const checked = await resolveInitRepositoryPath(empty, [root]);
    expect(checked.path).toBe(await realpath(empty));
  });

  it("отвергает непустой каталог", async () => {
    const root = await tempDir();
    const busy = join(root, "busy");
    await mkdir(busy);
    await writeFile(join(busy, "file.txt"), "data");
    await expect(resolveInitRepositoryPath(busy, [root])).rejects.toThrow("Каталог не пуст");
  });

  it("отвергает путь вне разрешённых корней", async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await expect(resolveInitRepositoryPath(join(outside, "repo"), [root])).rejects.toThrow("вне разрешённых корней");
  });

  it("отвергает относительный путь", async () => {
    const root = await tempDir();
    await expect(resolveInitRepositoryPath("relative/repo", [root])).rejects.toThrow("абсолютным");
  });

  it("раскрывает симлинк до сравнения с корнем: ссылка наружу не проходит", async () => {
    const root = await tempDir();
    const outside = await tempDir();
    const link = join(root, "link-out");
    try {
      await symlink(outside, link, "junction");
    } catch {
      return; // среда без права на симлинки — проверка неприменима
    }
    await expect(resolveInitRepositoryPath(join(link, "repo"), [root])).rejects.toThrow("вне разрешённых корней");
  });
});


describe("findRepositoryCandidates", () => {
  it("находит git-репозитории среди непосредственных подкаталогов корня и пропускает остальное", async () => {
    const root = await tempDir();
    const repo = join(root, "my-app");
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(join(root, "plain-folder"), { recursive: true });
    await mkdir(join(root, "node_modules"), { recursive: true });
    await mkdir(join(root, ".hidden"), { recursive: true });
    await mkdir(join(root, ".hidden", ".git"), { recursive: true });
    const nested = join(root, "plain-folder", "nested-repo");
    await mkdir(join(nested, ".git"), { recursive: true }); // глубже одного уровня — не находится

    const found = await findRepositoryCandidates([root]);
    expect(found).toEqual([{ name: "my-app", path: join(await realpath(root), "my-app") }]);
  });

  it("включает сам корень, если он рабочая копия, и уважает потолок", async () => {
    const root = await tempDir();
    await mkdir(join(root, ".git"), { recursive: true });
    for (let i = 0; i < 5; i++) {
      const repo = join(root, `repo-${i}`);
      await mkdir(join(repo, ".git"), { recursive: true });
    }
    const found = await findRepositoryCandidates([root], 3);
    expect(found.length).toBeLessThanOrEqual(3);
  });
});


describe("browseDirectory", () => {
  it("показывает подкаталоги с признаками git/пустоты и ходит вверх только внутри корня", async () => {
    const root = await tempDir();
    const repo = join(root, "repo-a");
    await mkdir(join(repo, ".git"), { recursive: true });
    await writeFile(join(repo, "file.txt"), "x");
    const empty = join(root, "empty-dir");
    await mkdir(empty, { recursive: true });
    await mkdir(join(root, "plain"), { recursive: true });
    await writeFile(join(root, "plain", "note.txt"), "x");

    const top = await browseDirectory(root, [root]);
    expect(top.parent).toBeNull();
    expect(top.entries).toEqual([
      { name: "empty-dir", isGit: false, empty: true },
      { name: "plain", isGit: false, empty: false },
      { name: "repo-a", isGit: true, empty: false }
    ]);

    const inside = await browseDirectory(repo, [root]);
    expect(inside.parent).toBe(root);
  });

  it("отвергает путь вне корней", async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await expect(browseDirectory(outside, [root])).rejects.toThrow("вне разрешённых корней");
  });
});
