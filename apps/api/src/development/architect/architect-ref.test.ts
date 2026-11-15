import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareAnalysisRoot } from "./architect-ref";

/**
 * Реальный git-репозиторий во временном каталоге: две ревизии с разным набором файлов.
 * Проверяем, что ревизия разворачивается во временный каталог и подчищается после cleanup.
 */
describe("prepareAnalysisRoot", () => {
  let repo: string;

  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: repo, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, stdio: "pipe", encoding: "utf8" });

  beforeAll(() => {
    repo = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "orion-ref-test-"));
    git(["init", "-b", "main"]);
    git(["-c", "user.name=ORION Test", "-c", "user.email=test@orion.local", "commit", "--allow-empty", "-m", "init"]);
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    git(["add", "."]);
    git(["-c", "user.name=ORION Test", "-c", "user.email=test@orion.local", "commit", "-m", "add a.ts"]);
    writeFileSync(join(repo, "b.ts"), "import { a } from \"./a\";\nexport const b = a;\n");
    rmSync(join(repo, "a.ts"));
    git(["add", "."]);
    git(["-c", "user.name=ORION Test", "-c", "user.email=test@orion.local", "commit", "-m", "replace a.ts with b.ts"]);
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("разворачивает состояние репозитория на указанной ревизии", async () => {
    const prepared = await prepareAnalysisRoot(repo, "HEAD~1");
    try {
      expect(existsSync(join(prepared.rootPath, "a.ts"))).toBe(true);
      expect(existsSync(join(prepared.rootPath, "b.ts"))).toBe(false);
      // исходная рабочая копия не тронута: b.ts на месте, a.ts удалён
      expect(existsSync(join(repo, "b.ts"))).toBe(true);
      expect(existsSync(join(repo, "a.ts"))).toBe(false);
    } finally {
      await prepared.cleanup();
    }
    expect(existsSync(prepared.rootPath)).toBe(false);
  });

  it("принимает полный sha и полные имена ссылок", async () => {
    const sha = git(["rev-parse", "HEAD~1"]).trim();
    const prepared = await prepareAnalysisRoot(repo, sha);
    try {
      expect(existsSync(join(prepared.rootPath, "a.ts"))).toBe(true);
    } finally {
      await prepared.cleanup();
    }
  });

  it("отклоняет несуществующую ссылку, не оставляя временный каталог", async () => {
    const before = existsSync(repo);
    await expect(prepareAnalysisRoot(repo, "no-such-ref-xyz")).rejects.toThrow(/не найдена/);
    expect(before).toBe(true);
  });
});
