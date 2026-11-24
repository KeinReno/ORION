import { afterEach, describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { DevelopmentGitService } from "./development-git.service";

/** Лёгкие двойники зависимостей: allowedRoots проверяет членство, но не трогает БД дальше этого. */
function makeService() {
  const prisma = {
    withUser: (_userId: string, fn: (tx: unknown) => Promise<unknown>) => fn({})
  };
  const workspaces = { assertMemberTx: async () => undefined };
  return new DevelopmentGitService(prisma as never, workspaces as never);
}

describe("DevelopmentGitService.allowedRoots", () => {
  const original = process.env.ORION_DEV_REPOSITORY_ROOTS;
  afterEach(() => {
    if (original === undefined) delete process.env.ORION_DEV_REPOSITORY_ROOTS;
    else process.env.ORION_DEV_REPOSITORY_ROOTS = original;
  });

  it("отдаёт корни из ORION_DEV_REPOSITORY_ROOTS (разделители `;` и перевод строки)", async () => {
    const roots = ["repos", "work", "legacy"].map((name) => resolve(process.cwd(), name));
    process.env.ORION_DEV_REPOSITORY_ROOTS = `${roots[0]}; ${roots[1]}
${roots[2]}`;
    await expect(makeService().allowedRoots("u1", "w1")).resolves.toEqual({ roots });
  });

  it("когда корни не заданы, разрешает домашний каталог узла", async () => {
    delete process.env.ORION_DEV_REPOSITORY_ROOTS;
    await expect(makeService().allowedRoots("u1", "w1")).resolves.toEqual({
      roots: [resolve(process.cwd(), homedir())]
    });
  });
});
