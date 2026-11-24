import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { execFileSync } from "node:child_process";
import { mkdirSync, promises as fs, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Задание 11 (Git Workspace + привязки коммитов + Architect + MCP-доступ) на реальной PostgreSQL
 * и НАСТОЯЩЕМ `git`: fixture создаётся через `git init`/коммиты, как требует критерий приёмки.
 */

interface Session {
  accessToken: string;
  userId: string;
  workspaceId: string;
}

interface GraphBody {
  head: string | null;
  branch: string | null;
  branches: Array<{ name: string; sha: string; isCurrent: boolean }>;
  tags: Array<{ name: string; sha: string }>;
  commits: Array<{ sha: string; author: string; subject: string; isMerge: boolean; parents: string[]; message: string }>;
  merges: string[];
  pullRequest: null;
  truncated: boolean;
  nextCursor: string | null;
  total: number;
}

describe("11 — Git Workspace, привязки коммитов, Architect и MCP-доступ", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `dev-workspace-${runId}`;
  let fixtureRoot: string;
  let repoPath: string;
  const git = (...args: string[]): string => execFileSync("git", ["-C", repoPath, ...args], { encoding: "utf8" });
  const write = (relative: string, content: string): void => {
    const absolute = join(repoPath, relative);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, content);
  };
  let mergeSha = "";
  let mainSha = "";

  beforeAll(async () => {
    fixtureRoot = join(process.cwd(), "tmp", `dev-workspace-${runId}`);
    repoPath = join(fixtureRoot, "repo");
    await fs.mkdir(repoPath, { recursive: true });

    git("init", "-b", "main");
    git("config", "user.email", "anna@example.test");
    git("config", "user.name", "Анна");
    write("README.md", "# Demo\n");
    write("apps/web/math.ts", "export const add = (a: number, b: number) => a + b;\n");
    write("packages/core/src/index.ts", "export const core = 1;\n");
    git("add", "-A");
    git("commit", "-m", "initial");
    git("checkout", "-b", "feature");
    write("apps/web/feature.ts", "export const feature = true;\n");
    git("add", "-A");
    git("commit", "-m", "feat: feature work #42");
    git("checkout", "main");
    write("apps/web/index.ts", 'import { add } from "./math";\nimport { core } from "../../packages/core/src";\nexport const sum = add(core, 2);\n');
    git("add", "-A");
    git("commit", "-m", "main work");
    mainSha = git("rev-parse", "HEAD").trim();
    git("merge", "--no-ff", "feature", "-m", "Merge branch 'feature'");
    mergeSha = git("rev-parse", "HEAD").trim();

    // Разрешённый корень — только наш fixture; произвольный путь с клиента не должен читаться.
    process.env.ORION_DEV_REPOSITORY_ROOTS = fixtureRoot;

    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.asSystem(async (tx) => {
        const users = await tx.user.findMany({ where: { email: { startsWith: emailPrefix } }, select: { id: true } });
        const userIds = users.map((user) => user.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: userIds } }, select: { workspaceId: true } });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: [...new Set(memberships.map((membership) => membership.workspaceId))] } } });
      });
    }
    await app?.close();
    if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
  });

  async function call<T = unknown>(
    path: string,
    method = "GET",
    token?: string,
    body?: unknown
  ): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async function register(name: string): Promise<Session> {
    const email = `${emailPrefix}-${name}@example.test`;
    const response = await call<{ accessToken: string; user: { id: string } }>("/auth/register", "POST", undefined, {
      email,
      password: "integration-password-123",
      name
    });
    expect(response.status).toBe(201);
    const workspaces = await call<Array<{ id: string }>>("/workspaces/me", "GET", response.data.accessToken);
    return { accessToken: response.data.accessToken, userId: response.data.user.id, workspaceId: workspaces.data[0]!.id };
  }

  let owner: Session;
  let repositoryId: string;

  it("регистрирует репозиторий только внутри разрешённого корня и отклоняет чужой путь", async () => {
    owner = await register("owner");
    const outside = await call(
      `/workspaces/${owner.workspaceId}/development/git/repositories`,
      "POST",
      owner.accessToken,
      { name: "Чужой", path: join(process.cwd(), "apps") }
    );
    expect(outside.status).toBe(400);

    const created = await call<{ id: string; path: string; taskRefPrefix: string }>(
      `/workspaces/${owner.workspaceId}/development/git/repositories`,
      "POST",
      owner.accessToken,
      { name: "ORION", path: repoPath }
    );
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    expect(created.data.taskRefPrefix).toBe("#");
    repositoryId = created.data.id;
    const listed = await call<Array<{ id: string }>>(`/workspaces/${owner.workspaceId}/development/git/repositories`, "GET", owner.accessToken);
    expect(listed.data.map((item) => item.id)).toContain(repositoryId);
  });

  it("возвращает верное дерево: ветки, слияние, порядок и пагинация по sha", async () => {
    const graph = await call<GraphBody>(`/workspaces/${owner.workspaceId}/development/git/${repositoryId}/graph?limit=10`, "GET", owner.accessToken);
    expect(graph.status, JSON.stringify(graph.data)).toBe(200);
    expect(graph.data.branch).toBe("main");
    expect(graph.data.branches.map((branch) => branch.name).sort()).toEqual(["feature", "main"]);
    expect(graph.data.branches.find((branch) => branch.name === "main")?.isCurrent).toBe(true);
    expect(graph.data.tags).toEqual([]);
    expect(graph.data.pullRequest).toBeNull();
    expect(graph.data.commits).toHaveLength(4);
    expect(graph.data.commits[0]!.sha).toBe(mergeSha);
    expect(graph.data.commits[0]!.isMerge).toBe(true);
    expect(graph.data.merges).toEqual([mergeSha]);
    expect(graph.data.commits.some((commit) => commit.subject === "feat: feature work #42")).toBe(true);

    const firstPage = await call<GraphBody>(`/workspaces/${owner.workspaceId}/development/git/${repositoryId}/graph?limit=2`, "GET", owner.accessToken);
    expect(firstPage.data.commits).toHaveLength(2);
    expect(firstPage.data.truncated).toBe(true);
    expect(firstPage.data.total).toBe(4);
    expect(firstPage.data.nextCursor).toBe(firstPage.data.commits[1]!.sha);
    const secondPage = await call<GraphBody>(
      `/workspaces/${owner.workspaceId}/development/git/${repositoryId}/graph?limit=2&cursor=${firstPage.data.nextCursor}`,
      "GET",
      owner.accessToken
    );
    expect(secondPage.data.commits.map((commit) => commit.sha)).toEqual(graph.data.commits.slice(2).map((commit) => commit.sha));
    expect(secondPage.data.truncated).toBe(false);

    const byAuthor = await call<GraphBody>(`/workspaces/${owner.workspaceId}/development/git/${repositoryId}/graph?author=Анна`, "GET", owner.accessToken);
    expect(byAuthor.data.commits).toHaveLength(4);
    const nobody = await call<GraphBody>(`/workspaces/${owner.workspaceId}/development/git/${repositoryId}/graph?author=никого`, "GET", owner.accessToken);
    expect(nobody.data.commits).toEqual([]);

    const byBranch = await call<GraphBody>(`/workspaces/${owner.workspaceId}/development/git/${repositoryId}/graph?branch=feature`, "GET", owner.accessToken);
    expect(byBranch.data.commits.map((commit) => commit.subject)).toContain("feat: feature work #42");
    expect(byBranch.data.commits.map((commit) => commit.subject)).not.toContain("main work");

    const unknown = await call(`/workspaces/${owner.workspaceId}/development/git/${repositoryId}/graph?branch=nope`, "GET", owner.accessToken);
    expect(unknown.status).toBe(400);
  });

  it("compare отдаёт отличающиеся коммиты, файлы и ahead/behind", async () => {
    const compare = await call<{ commits: Array<{ subject: string }>; files: Array<{ path: string }>; ahead: number; behind: number }>(
      `/workspaces/${owner.workspaceId}/development/git/${repositoryId}/compare?from=feature&to=main`,
      "GET",
      owner.accessToken
    );
    expect(compare.status, JSON.stringify(compare.data)).toBe(200);
    // main ушёл вперёд на merge-коммит и «main work»; feature после слияния целиком содержится в main.
    expect(compare.data.ahead).toBe(2);
    expect(compare.data.behind).toBe(0);
    expect(compare.data.commits.map((commit) => commit.subject)).toEqual(["Merge branch 'feature'", "main work"]);
    const files = compare.data.files.map((file) => file.path).sort();
    expect(files).toContain("apps/web/index.ts");

    const missing = await call(`/workspaces/${owner.workspaceId}/development/git/${repositoryId}/compare?from=nope&to=main`, "GET", owner.accessToken);
    expect(missing.status).toBe(400);
  });

  it("коммит с #42 связывает задачу 42; ручная привязка и отвязка работают", async () => {
    // `#42` — 42-я задача пространства по порядку создания (короткого номера в схеме нет).
    const base = Date.now();
    await prisma.asSystem(async (tx) => {
      await tx.task.createMany({
        data: Array.from({ length: 42 }, (_, index) => ({
          workspaceId: owner.workspaceId,
          title: `Задача ${index + 1}`,
          createdAt: new Date(base + index * 1_000)
        }))
      });
    });
    const tasks = await prisma.asSystem((tx) =>
      tx.task.findMany({ where: { workspaceId: owner.workspaceId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } })
    );
    const task42 = tasks[41]!.id;

    const sync = await call<{ linked: number; unresolved: string[] }>(
      `/workspaces/${owner.workspaceId}/development/git/${repositoryId}/sync-links`,
      "POST",
      owner.accessToken,
      {}
    );
    expect(sync.status, JSON.stringify(sync.data)).toBe(200);
    expect(sync.data.linked).toBe(1);
    expect(sync.data.unresolved).toEqual([]);

    const links = await call<Array<{ id: string; sha: string; manual: boolean; taskId: string }>>(
      `/workspaces/${owner.workspaceId}/tasks/${task42}/commit-links`,
      "GET",
      owner.accessToken
    );
    expect(links.data).toHaveLength(1);
    expect(links.data[0]).toMatchObject({ manual: false, taskId: task42 });

    const trace = await call<{ entries: Array<{ kind: string; placeholder: boolean }>; qa: { available: boolean; reason: string }; release: { linked: boolean } }>(
      `/workspaces/${owner.workspaceId}/tasks/${task42}/trace`,
      "GET",
      owner.accessToken
    );
    expect(trace.status).toBe(200);
    const kinds = trace.data.entries.map((entry) => entry.kind);
    expect(kinds).toContain("created");
    expect(kinds).toContain("commit");
    expect(kinds).toContain("check");
    expect(kinds).toContain("release");
    expect(trace.data.entries.find((entry) => entry.kind === "check")?.placeholder).toBe(true);
    expect(trace.data.entries.find((entry) => entry.kind === "release")?.placeholder).toBe(true);
    expect(trace.data.qa.available).toBe(false);
    expect(trace.data.release.linked).toBe(false);

    const snapshot = await call(
      `/workspaces/${owner.workspaceId}/development/architect/${repositoryId}/snapshots`,
      "POST", owner.accessToken, { ref: links.data[0]!.sha }
    );
    expect(snapshot.status, JSON.stringify(snapshot.data)).toBe(201);
    const analyzedTrace = await call<typeof trace.data>(
      `/workspaces/${owner.workspaceId}/tasks/${task42}/trace`, "GET", owner.accessToken
    );
    expect(analyzedTrace.data.qa.available).toBe(true);
    expect(analyzedTrace.data.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "check", placeholder: false, links: expect.arrayContaining([
        expect.objectContaining({ type: "commit", id: links.data[0]!.sha })
      ]) })
    ]));

    // Ручная привязка коммита без ссылки в сообщении.
    const manual = await call<{ id: string; manual: boolean; sha: string }>(
      `/workspaces/${owner.workspaceId}/tasks/${task42}/commit-links`,
      "POST",
      owner.accessToken,
      { repositoryId, sha: mainSha }
    );
    expect(manual.status, JSON.stringify(manual.data)).toBe(201);
    expect(manual.data).toMatchObject({ manual: true, sha: mainSha });

    const afterManual = await call<Array<{ id: string }>>(`/workspaces/${owner.workspaceId}/tasks/${task42}/commit-links`, "GET", owner.accessToken);
    expect(afterManual.data).toHaveLength(2);

    const removed = await call(`/workspaces/${owner.workspaceId}/tasks/${task42}/commit-links/${manual.data.id}`, "DELETE", owner.accessToken);
    expect(removed.status).toBe(204);
    const afterUnlink = await call<Array<{ manual: boolean }>>(`/workspaces/${owner.workspaceId}/tasks/${task42}/commit-links`, "GET", owner.accessToken);
    expect(afterUnlink.data).toHaveLength(1);

    // Повторная синхронизация идемпотентна.
    const again = await call<{ linked: number }>(`/workspaces/${owner.workspaceId}/development/git/${repositoryId}/sync-links`, "POST", owner.accessToken, {});
    expect(again.data.linked).toBe(0);
  });

  it("чужая задача не связывается: ссылка ищется только в этом пространстве", async () => {
    const stranger = await register("stranger");
    const attempt = await call(
      `/workspaces/${stranger.workspaceId}/development/git/${repositoryId}/graph`,
      "GET",
      stranger.accessToken
    );
    expect(attempt.status).toBe(404);
  });

  it("Architect: карта, раскладка и сравнение с проектной схемой (лишняя связь)", async () => {
    const map = await call<{
      nodes: Array<{ id: string; kind: string; x: number | null }>;
      edges: Array<{ from: string; to: string; external: boolean }>;
      metrics: { modules: number; internalEdges: number };
      layoutRevision: number;
    }>(`/workspaces/${owner.workspaceId}/development/architect/${repositoryId}/map`, "GET", owner.accessToken);
    expect(map.status, JSON.stringify(map.data)).toBe(200);
    expect(map.data.nodes.find((node) => node.id === "apps/web")?.kind).toBe("module");
    expect(map.data.nodes.find((node) => node.id === "packages/core/src")?.kind).toBe("module");
    expect(map.data.metrics.modules).toBe(2);
    const edgePairs = map.data.edges.map((edge) => `${edge.from}->${edge.to}`);
    expect(edgePairs).toContain("apps/web/index.ts->apps/web/math.ts");
    expect(edgePairs).toContain("apps/web/index.ts->packages/core/src/index.ts");
    expect(map.data.layoutRevision).toBe(0);

    const layout = await call<{ revision: number; nodes: Array<{ id: string; x: number; y: number }> }>(
      `/workspaces/${owner.workspaceId}/development/architect/${repositoryId}/layout`,
      "PUT",
      owner.accessToken,
      { nodes: [{ id: "apps/web/index.ts", x: 120, y: 80 }] }
    );
    expect(layout.status).toBe(200);
    expect(layout.data.revision).toBe(1);
    const withPosition = await call<{ nodes: Array<{ id: string; x: number | null; y: number | null }> }>(
      `/workspaces/${owner.workspaceId}/development/architect/${repositoryId}/map`,
      "GET",
      owner.accessToken
    );
    expect(withPosition.data.nodes.find((node) => node.id === "apps/web/index.ts")).toMatchObject({ x: 120, y: 80 });

    const stale = await call(
      `/workspaces/${owner.workspaceId}/development/architect/${repositoryId}/layout`,
      "PUT",
      owner.accessToken,
      { nodes: [], expectedRevision: 0 }
    );
    expect(stale.status).toBe(409);

    const projectSchema = {
      nodes: map.data.nodes.map((node) => ({ id: node.id, name: node.id.split("/").pop()!, kind: node.kind, path: node.id })),
      edges: [
        ...map.data.edges.map((edge) => ({ from: edge.from, to: edge.to, kind: "import" as const })),
        { from: "apps/web/index.ts", to: "apps/web/ghost.ts", kind: "import" as const }
      ]
    };
    const saved = await call(`/workspaces/${owner.workspaceId}/development/architect/${repositoryId}/project-schema`, "PUT", owner.accessToken, projectSchema);
    expect(saved.status).toBe(200);
    const comparison = await call<{ counts: { extraEdges: number; missingEdges: number } }>(
      `/workspaces/${owner.workspaceId}/development/architect/${repositoryId}/compare`,
      "GET",
      owner.accessToken
    );
    expect(comparison.status).toBe(200);
    expect(comparison.data.counts.extraEdges).toBe(1);
    expect(comparison.data.counts.missingEdges).toBe(0);
  });

  it("MCP: новые read-only инструменты видны только с разрешением и пишутся в журнал", async () => {
    const issue = async (name: string, modulePermissions: string[]): Promise<string> => {
      const token = await call<{ secret: string }>(`/workspaces/${owner.workspaceId}/agent-tokens`, "POST", owner.accessToken, {
        name,
        modulePermissions,
        mode: "observer",
        expiresInDays: 7
      });
      expect(token.status, JSON.stringify(token.data)).toBe(201);
      return token.data.secret;
    };

    const allowed = await issue("Читатель ORION DEV", ["orion-dev.development_import.read"]);
    const tools = await call<{ tools: Array<{ name: string; moduleId: string | null }> }>("/ai/v1/tools", "GET", allowed);
    expect(tools.status).toBe(200);
    expect(tools.data.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["orion_git_graph", "orion_architect_map"]));
    expect(tools.data.tools.find((tool) => tool.name === "orion_git_graph")?.moduleId).toBe("orion-dev");

    const graph = await call<GraphBody>(`/ai/v1/development/git/graph?repositoryId=${repositoryId}&limit=10`, "GET", allowed);
    expect(graph.status, JSON.stringify(graph.data)).toBe(200);
    expect(graph.data.commits).toHaveLength(4);
    const map = await call<{ nodes: unknown[] }>(`/ai/v1/development/architect/map?repositoryId=${repositoryId}`, "GET", allowed);
    expect(map.status).toBe(200);
    expect(map.data.nodes.length).toBeGreaterThan(0);

    const without = await issue("Только знания", ["knowledge.item.read"]);
    const filtered = await call<{ tools: Array<{ name: string }> }>("/ai/v1/tools", "GET", without);
    expect(filtered.data.tools.map((tool) => tool.name)).not.toContain("orion_git_graph");
    const denied = await call(`/ai/v1/development/git/graph?repositoryId=${repositoryId}`, "GET", without);
    expect(denied.status).toBe(403);

    const audit = await call<Array<{ action: string; module: string | null; status: number }>>(
      `/workspaces/${owner.workspaceId}/agent-tokens/audit`,
      "GET",
      owner.accessToken
    );
    expect(
      audit.data.some((row) => row.action === "orion_git_graph" && row.module === "orion-dev" && row.status === 200)
    ).toBe(true);
    expect(
      audit.data.some((row) => row.action === "orion_architect_map" && row.module === "orion-dev" && row.status === 200)
    ).toBe(true);
    expect(audit.data.some((row) => row.action === "orion_git_graph" && row.status === 403)).toBe(true);
  });
});
