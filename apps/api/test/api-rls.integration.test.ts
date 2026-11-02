import { ModulesService } from "../src/modules/modules.service";
import { TaskOperations } from "../src/tasks/public/task-operations";
import type { ConfirmedCatalogProject } from "../src/development/catalog-project-import";
import { readDevelopmentImportSnapshotTx } from "../src/development/catalog-import-snapshot";
import { applyConfirmedDevelopmentImportTx } from "../src/development/catalog-import-transaction";
import { linkCatalogTaskDependenciesTx } from "../src/development/catalog-task-dependencies";
import { importConfirmedCatalogTasksTx } from "../src/development/catalog-task-import";
import { importConfirmedCatalogProjectsTx } from "../src/development/catalog-project-import";
import { timeCostMinor } from "@orion/shared-types";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { bindCatalogEntityTx } from "../src/development/catalog-mappings";
import { CalendarConnectionsService } from "../src/events/calendar-connections.service";
import { NotificationPolicyService } from "../src/notifications/notification-policy.service";
import { WebdavRemote } from "../src/sync/webdav-remote";
import { configureApp } from "../src/configure-app";

// R29 review (29-REVIEW-GRANTS.md, "Детерминизм WebDAV fixture") — see the
// identical block in `blob-backup.integration.test.ts` for the rationale:
// this fixes DNS-resolution flakiness for the `https://example.com/webdav`
// fixture without touching the real SSRF guard (`assertPublicRemoteUrl`),
// which still runs its actual private/loopback check against the mocked
// (but still fixed-public) resolved address.
const lookupMock = vi.fn().mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }));

interface RegisteredSession {
  accessToken: string;
  user: { id: string };
  workspaceId: string;
}

describe("API workspace isolation", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `integration-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) {
      // Deleting the users is *not* enough: `WorkspaceMember.userId` cascades,
      // so the membership row disappears while the workspace — with every note,
      // task and time entry inside it — stays behind. Without the second step
      // each run left an orphaned workspace in the database; by v0.18 there
      // were 166 of them (and 27 notes/35 tasks inside) from earlier runs.
      await prisma.asSystem(async (tx) => {
        const users = await tx.user.findMany({
          where: { email: { startsWith: emailPrefix } },
          select: { id: true }
        });
        if (users.length === 0) return;
        const userIds = users.map((user) => user.id);
        const memberships = await tx.workspaceMember.findMany({
          where: { userId: { in: userIds } },
          select: { workspaceId: true }
        });
        const workspaceIds = [...new Set(memberships.map((membership) => membership.workspaceId))];

        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        // Cascades from the workspace to notes/tasks/time_entries/… — the real
        // cleanup, and the reason this test asserts the workspace is gone.
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });

        // Self-verifying cleanup: if a future model loses its cascade, this
        // fails the suite loudly instead of silently growing the database.
        const leftovers = await tx.workspace.count({ where: { id: { in: workspaceIds } } });
        if (leftovers > 0) {
          throw new Error(`Cleanup left ${leftovers} test workspace(s) behind`);
        }
      });
    }
    await app?.close();
  });

  it("rejects cross-workspace API access and hides rows through RLS", async () => {
    const alice = await register("alice");
    const bob = await register("bob");

    const created = await request<{ id: string; title: string }>(
      `/workspaces/${alice.workspaceId}/notes`,
      { method: "POST", token: alice.accessToken, body: { title: "Alice private note", body: "secret" } }
    );
    expect(created.status).toBe(201);

    const crossWorkspace = await request(`/workspaces/${alice.workspaceId}/notes`, {
      method: "GET",
      token: bob.accessToken
    });
    expect(crossWorkspace.status).toBe(403);

    const visibleToAlice = await prisma.withUser(alice.user.id, (tx) =>
      tx.note.findMany({ where: { workspaceId: alice.workspaceId } })
    );
    const hiddenFromBob = await prisma.withUser(bob.user.id, (tx) =>
      tx.note.findMany({ where: { workspaceId: alice.workspaceId } })
    );
    expect(visibleToAlice).toHaveLength(1);
    expect(hiddenFromBob).toHaveLength(0);
  });

  it("isolates development catalog mappings by workspace membership and missing session", async () => {
    const alice = await register("alice-dev-mapping");
    const bob = await register("bob-dev-mapping");
    const externalId = `integration-${runId}`;

    const mapping = await prisma.withUser(alice.user.id, (tx) =>
      tx.developmentCatalogMapping.create({
        data: {
          workspaceId: alice.workspaceId,
          catalogId: "orion-dev",
          kind: "project",
          externalId,
          entityId: `project-${externalId}`
        }
      })
    );

    const aliceRows = await prisma.withUser(alice.user.id, (tx) =>
      tx.developmentCatalogMapping.findMany({ where: { workspaceId: alice.workspaceId } })
    );
    const bobRows = await prisma.withUser(bob.user.id, (tx) =>
      tx.developmentCatalogMapping.findMany({ where: { workspaceId: alice.workspaceId } })
    );
    expect(aliceRows.some((row) => row.id === mapping.id)).toBe(true);
    expect(bobRows).toHaveLength(0);

    // No withUser context: the ordinary orion_app connection must fail closed.
    const noSession = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "development_catalog_mappings"
      WHERE "id" = ${mapping.id}
    `;
    expect(noSession).toHaveLength(0);

    await expect(prisma.withUser(bob.user.id, (tx) =>
      tx.developmentCatalogMapping.create({
        data: {
          workspaceId: alice.workspaceId,
          catalogId: "orion-dev",
          kind: "task",
          externalId: `foreign-${externalId}`,
          entityId: `foreign-task-${externalId}`
        }
      })
    )).rejects.toThrow();

    await expect(prisma.withUser(alice.user.id, (tx) =>
      tx.developmentCatalogMapping.create({
        data: {
          workspaceId: alice.workspaceId,
          catalogId: "orion-dev",
          kind: "project",
          externalId,
          entityId: `duplicate-${externalId}`
        }
      })
    )).rejects.toThrow();
  });

  it("allows workspace members to read catalog mappings but denies member writes", async () => {
    const owner = await register("mapping-owner-role");
    const member = await register("mapping-member-role");
    await prisma.asSystem((tx) => tx.workspaceMember.create({
      data: { workspaceId: owner.workspaceId, userId: member.user.id, role: "member" }
    }));
    const externalId = `role-check-${runId}`;
    const created = await prisma.withUser(owner.user.id, (tx) =>
      tx.developmentCatalogMapping.create({
        data: {
          workspaceId: owner.workspaceId, catalogId: "orion-dev",
          kind: "project", externalId, entityId: `entity-${externalId}`
        }
      })
    );
    const visible = await prisma.withUser(member.user.id, (tx) =>
      tx.developmentCatalogMapping.findMany({ where: { workspaceId: owner.workspaceId } })
    );
    expect(visible.some((row) => row.id === created.id)).toBe(true);
    await expect(prisma.withUser(member.user.id, (tx) =>
      tx.developmentCatalogMapping.create({
        data: {
          workspaceId: owner.workspaceId, catalogId: "orion-dev",
          kind: "task", externalId: `member-${externalId}`, entityId: `member-entity-${externalId}`
        }
      })
    )).rejects.toThrow();
    await expect(prisma.withUser(member.user.id, (tx) =>
      tx.developmentCatalogMapping.update({
        where: { id: created.id }, data: { entityId: `hijacked-${externalId}` }
      })
    )).rejects.toThrow();
  });

  it("binds canonical project IDs idempotently and rejects conflicting or unauthorized bindings", async () => {
    const owner = await register("mapping-bind-owner");
    const outsider = await register("mapping-bind-outsider");
    const project = await prisma.withUser(owner.user.id, (tx) =>
      tx.project.create({ data: { workspaceId: owner.workspaceId, name: `Bind project ${runId}` } })
    );
    const input = {
      workspaceId: owner.workspaceId, catalogId: "orion-dev" as const,
      kind: "project" as const, externalId: `binding-${runId}`, entityId: project.id
    };
    const first = await prisma.withUser(owner.user.id, (tx) => bindCatalogEntityTx(tx, owner.user.id, input));
    expect(first.alreadyBound).toBe(false);
    const retry = await prisma.withUser(owner.user.id, (tx) => bindCatalogEntityTx(tx, owner.user.id, input));
    expect(retry).toEqual({ id: first.id, alreadyBound: true });
    await expect(prisma.withUser(owner.user.id, (tx) =>
      bindCatalogEntityTx(tx, owner.user.id, { ...input, externalId: `other-${runId}` })
    )).rejects.toThrow(/Conflicting catalog binding/);
    await expect(prisma.withUser(outsider.user.id, (tx) =>
      bindCatalogEntityTx(tx, outsider.user.id, input)
    )).rejects.toThrow();
    await expect(prisma.withUser(owner.user.id, (tx) =>
      bindCatalogEntityTx(tx, owner.user.id, { ...input, externalId: `missing-${runId}`, entityId: "not-a-project" })
    )).rejects.toThrow();
  });

  it("imports confirmed catalog projects atomically and retries without duplication", async () => {
    const owner = await register("catalog-project-import-owner");
    const projects = [
      { externalId: `project-a-${runId}`, title: `Catalog A ${runId}` },
      { externalId: `project-b-${runId}`, title: `Catalog B ${runId}` }
    ];
    const execute = (rows: ConfirmedCatalogProject[]) => prisma.withUser(owner.user.id, (tx) =>
      importConfirmedCatalogProjectsTx(tx, owner.user.id, owner.workspaceId, "orion-dev", rows)
    );
    const first = await execute(projects);
    expect(first.map((item) => item.outcome)).toEqual(["created", "created"]);
    const again = await execute(projects);
    expect(again.map((item) => item.outcome)).toEqual(["already_mapped", "already_mapped"]);
    expect(again.map((item) => item.entityId)).toEqual(first.map((item) => item.entityId));

    const conflicting = [
      { externalId: `project-rollback-${runId}`, title: `Rollback ${runId}` },
      { externalId: `project-collision-${runId}`, title: projects[0]!.title }
    ];
    await expect(execute(conflicting)).rejects.toThrow(/explicit confirmation/);
    const rolledBack = await prisma.withUser(owner.user.id, (tx) =>
      tx.project.findFirst({ where: { workspaceId: owner.workspaceId, name: conflicting[0]!.title } })
    );
    expect(rolledBack).toBeNull();
    const confirmed = await execute([{ ...projects[0]!, confirmedExistingId: first[0]!.entityId }]);
    expect(confirmed[0]!.outcome).toBe("already_mapped");
  });

  it("requires explicit confirmation before adopting an existing catalog project", async () => {
    const owner = await register("catalog-project-confirm-owner");
    const outsider = await register("catalog-project-confirm-outsider");
    const name = `Existing catalog project ${runId}`;
    const existing = await prisma.withUser(owner.user.id, (tx) =>
      tx.project.create({ data: { workspaceId: owner.workspaceId, name, description: "Manual description" } })
    );
    const input = [{ externalId: `confirmed-${runId}`, title: name }];
    const execute = (userId: string, rows: typeof input | Array<typeof input[number] & { confirmedExistingId: string }>) =>
      prisma.withUser(userId, (tx) =>
        importConfirmedCatalogProjectsTx(tx, userId, owner.workspaceId, "orion-dev", rows)
      );
    await expect(execute(owner.user.id, input)).rejects.toThrow(/explicit confirmation/);
    await expect(execute(outsider.user.id, [{ ...input[0]!, confirmedExistingId: existing.id }]))
      .rejects.toThrow();
    await expect(execute(owner.user.id, [{ ...input[0]!, confirmedExistingId: "stale-id" }]))
      .rejects.toThrow(/confirmation is stale/);
    const adopted = await execute(owner.user.id, [{ ...input[0]!, confirmedExistingId: existing.id }]);
    expect(adopted).toMatchObject([{ entityId: existing.id, outcome: "confirmed_existing" }]);
    const unchanged = await prisma.withUser(owner.user.id, (tx) =>
      tx.project.findUnique({ where: { id: existing.id } })
    );
    expect(unchanged?.description).toBe("Manual description");
    const repeated = await execute(owner.user.id, input);
    expect(repeated).toMatchObject([{ entityId: existing.id, outcome: "already_mapped" }]);
  });

  it("imports canonical catalog tasks idempotently and rejects unconfirmed matches", async () => {
    const owner = await register("catalog-task-import-owner");
    const project = await prisma.withUser(owner.user.id, (tx) =>
      tx.project.create({ data: { workspaceId: owner.workspaceId, name: `Task import project ${runId}` } })
    );
    await prisma.withUser(owner.user.id, (tx) => bindCatalogEntityTx(tx, owner.user.id, {
      workspaceId: owner.workspaceId, catalogId: "orion-dev", kind: "project",
      externalId: `task-parent-${runId}`, entityId: project.id
    }));
    const task = {
      externalId: `task-import-${runId}`, projectExternalId: `task-parent-${runId}`,
      title: `Imported task ${runId}`
    };
    const execute = (items: Array<typeof task & { confirmedExistingId?: string }>) =>
      prisma.withUser(owner.user.id, (tx) =>
        importConfirmedCatalogTasksTx(tx, owner.user.id, owner.workspaceId, "orion-dev", items, app.get(TaskOperations))
      );
    const first = await execute([task]);
    expect(first[0]?.outcome).toBe("created");
    const retry = await execute([task]);
    expect(retry).toEqual([{ ...first[0], outcome: "already_mapped" }]);
    const manual = await prisma.withUser(owner.user.id, (tx) =>
      tx.task.create({ data: {
        workspaceId: owner.workspaceId, projectId: project.id, title: `Manual task ${runId}`,
        description: "Preserve this"
      } })
    );
    const adoption = {
      externalId: `task-adopt-${runId}`, projectExternalId: task.projectExternalId,
      title: manual.title
    };
    await expect(execute([adoption])).rejects.toThrow(/explicit confirmation/);
    await expect(execute([{ ...adoption, confirmedExistingId: first[0]!.entityId }]))
      .rejects.toThrow(/stale/);
    const confirmed = await execute([{ ...adoption, confirmedExistingId: manual.id }]);
    expect(confirmed[0]?.outcome).toBe("confirmed_existing");
    const unchanged = await prisma.withUser(owner.user.id, (tx) =>
      tx.task.findUniqueOrThrow({ where: { id: manual.id } })
    );
    expect(unchanged.description).toBe("Preserve this");
  });

  it("links catalog dependencies idempotently and rejects cycles without partial writes", async () => {
    const owner = await register("catalog-dependency-owner");
    const ids = [`dependency-a-${runId}`, `dependency-b-${runId}`];
    const rows = await prisma.withUser(owner.user.id, async (tx) => {
      const tasks = await Promise.all(ids.map((title) =>
        tx.task.create({ data: { workspaceId: owner.workspaceId, title } })
      ));
      await Promise.all(tasks.map((task, index) =>
        tx.developmentCatalogMapping.create({ data: {
          workspaceId: owner.workspaceId, catalogId: "orion-dev", kind: "task",
          externalId: ids[index]!, entityId: task.id
        } })
      ));
      return tasks;
    });
    const run = (declarations: { externalId: string; dependsOn: string[] }[]) =>
      prisma.withUser(owner.user.id, (tx) =>
        linkCatalogTaskDependenciesTx(tx, owner.user.id, owner.workspaceId, "orion-dev", declarations, app.get(TaskOperations))
      );
    const edge = [{ externalId: ids[0]!, dependsOn: [ids[1]!] }];
    expect(await run(edge)).toEqual({ created: 1, existing: 0 });
    expect(await run(edge)).toEqual({ created: 0, existing: 1 });
    await expect(run([{ externalId: ids[1]!, dependsOn: [ids[0]!] }]))
      .rejects.toThrow(/cycle/);
    const persisted = await prisma.withUser(owner.user.id, (tx) =>
      tx.taskDependency.findMany({ where: { workspaceId: owner.workspaceId, taskId: rows[1]!.id } })
    );
    expect(persisted).toHaveLength(0);
    await expect(run([{ externalId: ids[0]!, dependsOn: ["unknown-dependency"] }]))
      .rejects.toThrow(/Missing catalog task mapping/);
  });

  it("refuses a concurrent reverse edge without introducing a cycle", async () => {
    const owner = await register("dev-import-cycle-race");
    await prisma.withUser(owner.user.id, async tx => {
      for (const externalId of ["a", "b"]) {
        const task = await app.get(TaskOperations).createTx(tx, owner.user.id, owner.workspaceId,
          { title: externalId, description: "", priority: "normal", checklist: [] });
        await bindCatalogEntityTx(tx, owner.user.id, { workspaceId: owner.workspaceId,
          catalogId: "orion-dev", kind: "task", externalId, entityId: task.id });
      }
    });
    const link = (from: string, to: string) => prisma.withUser(owner.user.id, tx => linkCatalogTaskDependenciesTx(
      tx, owner.user.id, owner.workspaceId, "orion-dev", [{ externalId: from, dependsOn: [to] }], app.get(TaskOperations)));
    const results = await Promise.allSettled([link("a", "b"), link("b", "a")]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await prisma.withUser(owner.user.id, tx => tx.taskDependency.count({ where: { workspaceId: owner.workspaceId } }))).toBe(1);
  });

  it("imports catalog projects, tasks and dependencies in one atomic transaction", async () => {
    const owner = await register("dev-import-atomic");
    const catalog = {
      workspaceId: owner.workspaceId, catalogId: "orion-dev",
      workspaceConfirmed: true as const,
      projects: [{ externalId: `p-${runId}`, title: `Atomic project ${runId}` }],
      tasks: [
        { externalId: `t1-${runId}`, projectExternalId: `p-${runId}`, title: `Atomic task 1 ${runId}` },
        { externalId: `t2-${runId}`, projectExternalId: `p-${runId}`, title: `Atomic task 2 ${runId}` }
      ],
      dependencies: [
        { externalId: `t1-${runId}`, dependsOn: [`t2-${runId}`] },
        { externalId: `t2-${runId}`, dependsOn: [] }
      ]
    };
    const execute = (input: typeof catalog) => prisma.withUser(owner.user.id, (tx) =>
      applyConfirmedDevelopmentImportTx(tx, owner.user.id, input, app.get(TaskOperations))
    );
    const first = await execute(catalog);
    expect(first.projects[0]!.outcome).toBe("created");
    expect(first.tasks.map((task) => task.outcome)).toEqual(["created", "created"]);
    expect(first.dependencies.created).toBe(1);
    const retry = await execute(catalog);
    expect(retry.projects[0]!.outcome).toBe("already_mapped");
    expect(retry.tasks.every((task) => task.outcome === "already_mapped")).toBe(true);
    expect(retry.dependencies).toEqual({ created: 0, existing: 1 });

    const bad = {
      ...catalog,
      projects: [{ externalId: `rollback-p-${runId}`, title: `Rollback project ${runId}` }],
      tasks: [{ externalId: `rollback-t-${runId}`, projectExternalId: `rollback-p-${runId}`, title: `Rollback task ${runId}` }],
      dependencies: [{ externalId: `rollback-t-${runId}`, dependsOn: [`missing-${runId}`] }]
    };
    await expect(execute(bad)).rejects.toThrow(/Incomplete development import/);
    const absent = await prisma.withUser(owner.user.id, (tx) =>
      tx.project.findFirst({ where: { workspaceId: owner.workspaceId, name: bad.projects[0]!.title } })
    );
    expect(absent).toBeNull();
  });

  it("serializes parallel imports and publishes canonical task events only once", async () => {
    const owner = await register("dev-import-concurrent");
    const input = {
      workspaceId: owner.workspaceId, catalogId: "orion-dev", workspaceConfirmed: true as const,
      projects: [{ externalId: "p", title: "Parallel import" }],
      tasks: [
        { externalId: "a", projectExternalId: "p", title: "First parallel task" },
        { externalId: "b", projectExternalId: "p", title: "Second parallel task" }
      ],
      dependencies: [{ externalId: "a", dependsOn: ["b"] }, { externalId: "b", dependsOn: [] }]
    };
    const execute = () => prisma.withUser(owner.user.id, tx =>
      applyConfirmedDevelopmentImportTx(tx, owner.user.id, input, app.get(TaskOperations)));
    const results = await Promise.all([execute(), execute()]);
    expect(results.flatMap(result => result.projects).filter(row => row.outcome === "created")).toHaveLength(1);
    expect(results.flatMap(result => result.tasks).filter(row => row.outcome === "created")).toHaveLength(2);
    const before = await prisma.withUser(owner.user.id, tx => tx.domainEvent.findMany({
      where: { workspaceId: owner.workspaceId, type: "tasks.task.changed" }
    }));
    expect(before).toHaveLength(3); // two creates + canonical dependency update
    await execute();
    const after = await prisma.withUser(owner.user.id, tx => tx.domainEvent.count({
      where: { workspaceId: owner.workspaceId, type: "tasks.task.changed" }
    }));
    expect(after).toBe(before.length);
    const commands = app.get(TaskOperations);
    const original = commands.createTx.bind(commands);
    const failingInput = {
      ...input, catalogId: "rollback-fixture",
      projects: [{ externalId: "p", title: "Rolled back parallel import" }]
    };
    const taskFailure = vi.spyOn(commands, "createTx").mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error("forced canonical failure");
    });
    try {
      await expect(prisma.withUser(owner.user.id, tx => applyConfirmedDevelopmentImportTx(
        tx, owner.user.id, failingInput, commands))).rejects.toThrow(/forced canonical failure/);
    } finally { taskFailure.mockRestore(); }
    expect(await prisma.withUser(owner.user.id, tx => tx.project.count({
      where: { workspaceId: owner.workspaceId, name: "Rolled back parallel import" }
    }))).toBe(0);
    expect(await prisma.withUser(owner.user.id, tx => tx.developmentCatalogMapping.count({
      where: { workspaceId: owner.workspaceId, catalogId: "rollback-fixture" }
    }))).toBe(0);
    expect(await prisma.withUser(owner.user.id, tx => tx.domainEvent.count({
      where: { workspaceId: owner.workspaceId, type: "tasks.task.changed" }
    }))).toBe(before.length);
  });

  it("returns only authorized workspace import preview data", async () => {
    const owner = await register("dev-snapshot-owner");
    const outsider = await register("dev-snapshot-outsider");
    const projectName = `Preview project ${runId}`;
    const project = await prisma.withUser(owner.user.id, (tx) =>
      tx.project.create({ data: { workspaceId: owner.workspaceId, name: projectName } })
    );
    await prisma.withUser(owner.user.id, (tx) =>
      tx.task.create({ data: { workspaceId: owner.workspaceId, projectId: project.id, title: `Preview task ${runId}` } })
    );
    const snapshot = await prisma.withUser(owner.user.id, (tx) =>
      readDevelopmentImportSnapshotTx(tx, owner.user.id, owner.workspaceId, "orion-dev", app.get(ModulesService))
    );
    expect(snapshot.targetWorkspaceId).toBe(owner.workspaceId);
    expect(snapshot.projects.some((row) => row.id === project.id)).toBe(true);
    expect(snapshot.tasks.some((row) => row.projectId === project.id)).toBe(true);
    expect(snapshot.mappings).toEqual([]);
    await expect(prisma.withUser(outsider.user.id, (tx) =>
      readDevelopmentImportSnapshotTx(tx, outsider.user.id, owner.workspaceId, "orion-dev", app.get(ModulesService))
    )).rejects.toThrow(/owner or lead/);
  });

  it("has RLS enabled, forced and policied on every workspace-owned table", async () => {
    // The second safeguard (see CLAUDE.md "Postgres RLS") is only real if it is
    // installed on *every* workspace-owned table. v0.11 shipped
    // `finance_transaction_lines` with a denormalised workspaceId and no policy
    // at all, and nothing noticed for two versions — this test is the thing that
    // would have noticed. A new table with a workspaceId column but no RLS fails
    // right here, without anyone having to remember the checklist.
    const rows = await prisma.$queryRaw<
      { table_name: string; rls_enabled: boolean; rls_forced: boolean; policy_count: bigint }[]
    >`
      SELECT c.relname AS table_name,
             c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS rls_forced,
             (SELECT count(*) FROM pg_policies p
               WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'workspaceId' AND a.attnum > 0 AND NOT a.attisdropped
        )
      ORDER BY c.relname
    `;

    // Sanity: the catalog query actually matched the workspace-owned tables.
    expect(rows.length).toBeGreaterThan(15);
    expect(rows.map((row) => row.table_name)).toContain("finance_transaction_lines");

    const unprotected = rows
      .filter((row) => !row.rls_enabled || !row.rls_forced || Number(row.policy_count) === 0)
      .map((row) => `${row.table_name} (enabled=${row.rls_enabled}, forced=${row.rls_forced}, policies=${row.policy_count})`);
    expect(unprotected).toEqual([]);
  });

  it("hides finance transaction lines from another workspace through RLS", async () => {
    const alice = await register("alice-finance");
    const bob = await register("bob-finance");

    const account = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/finance/accounts`, {
      method: "POST",
      token: alice.accessToken,
      body: { name: "Alice wallet", kind: "cash", startingBalance: 0, currency: "RUB" }
    });
    expect(account.status).toBe(201);

    const created = await request(`/workspaces/${alice.workspaceId}/finance/transactions`, {
      method: "POST",
      token: alice.accessToken,
      body: {
        accountId: account.data.id,
        type: "expense",
        note: "Alice private expense",
        occurredAt: new Date().toISOString(),
        lines: [{ amount: 1500 }]
      }
    });
    expect(created.status).toBe(201);

    const visibleToAlice = await prisma.withUser(alice.user.id, (tx) =>
      tx.transactionLine.findMany({ where: { workspaceId: alice.workspaceId } })
    );
    const hiddenFromBob = await prisma.withUser(bob.user.id, (tx) =>
      tx.transactionLine.findMany({ where: { workspaceId: alice.workspaceId } })
    );
    expect(visibleToAlice).toHaveLength(1);
    expect(hiddenFromBob).toHaveLength(0);
  });

  it("attaches documents to a note, keeps the file in Документы, and hides the links through RLS", async () => {
    // The whole v0.17 attachments slice had no code before this: the table and
    // its RLS policy existed since the platform-foundation migration, but
    // nothing read or wrote it. This walks the real HTTP surface (including the
    // multipart upload) and the RLS boundary it must respect.
    const alice = await register("alice-attachments");
    const bob = await register("bob-attachments");

    const note = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/notes`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "Заметка с вложениями", body: "текст" }
    });
    expect(note.status).toBe(201);

    const upload = await uploadAttachment(alice.workspaceId, note.data.id, alice.accessToken, "Смета.csv", "a,b\n1,2\n");
    expect(upload.status).toBe(201);
    expect(upload.data).toHaveLength(1);
    expect(upload.data[0].name).toBe("Смета.csv");
    expect(upload.data[0].mimeType).toBe("text/csv");
    expect(upload.data[0].sizeBytes).toBe(8);
    const documentId = upload.data[0].documentId;

    // The bytes are an ordinary Document in the shared folder — not a private copy.
    const documents = await request<Array<{ id: string; name: string; kind: string; parentId: string | null }>>(
      `/workspaces/${alice.workspaceId}/documents`,
      { method: "GET", token: alice.accessToken }
    );
    expect(documents.status).toBe(200);
    const folder = documents.data.find((doc) => doc.kind === "folder");
    expect(folder?.name).toBe("Вложения заметок");
    expect(documents.data.find((doc) => doc.id === documentId)?.parentId).toBe(folder?.id);

    // Re-attaching the same pair is a conflict, not a silent duplicate.
    const duplicate = await request(`/workspaces/${alice.workspaceId}/notes/${note.data.id}/attachments`, {
      method: "POST",
      token: alice.accessToken,
      body: { documentId }
    });
    expect(duplicate.status).toBe(409);

    const missing = await request(`/workspaces/${alice.workspaceId}/notes/${note.data.id}/attachments`, {
      method: "POST",
      token: alice.accessToken,
      body: { documentId: "00000000-0000-0000-0000-000000000000" }
    });
    expect(missing.status).toBe(404);

    const crossWorkspace = await request(`/workspaces/${alice.workspaceId}/notes/${note.data.id}/attachments`, {
      method: "GET",
      token: bob.accessToken
    });
    expect(crossWorkspace.status).toBe(403);

    const visibleToAlice = await prisma.withUser(alice.user.id, (tx) =>
      tx.noteAttachment.findMany({ where: { workspaceId: alice.workspaceId } })
    );
    const hiddenFromBob = await prisma.withUser(bob.user.id, (tx) =>
      tx.noteAttachment.findMany({ where: { workspaceId: alice.workspaceId } })
    );
    expect(visibleToAlice).toHaveLength(1);
    expect(hiddenFromBob).toHaveLength(0);

    // A void handler answers 200 with an empty body, so this can't go through
    // `request` (which always parses JSON).
    const detach = await fetch(
      `${baseUrl}/workspaces/${alice.workspaceId}/notes/${note.data.id}/attachments/${upload.data[0].id}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${alice.accessToken}` } }
    );
    expect(detach.status).toBe(200);

    const afterDetach = await request<unknown[]>(`/workspaces/${alice.workspaceId}/notes/${note.data.id}/attachments`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(afterDetach.data).toHaveLength(0);

    // Detaching removes only the link: the file is still in Документы and can be re-attached.
    const documentsAfter = await request<Array<{ id: string }>>(`/workspaces/${alice.workspaceId}/documents`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(documentsAfter.data.some((doc) => doc.id === documentId)).toBe(true);

    const reattach = await request(`/workspaces/${alice.workspaceId}/notes/${note.data.id}/attachments`, {
      method: "POST",
      token: alice.accessToken,
      body: { documentId }
    });
    expect(reattach.status).toBe(201);
  });

  it("versions a document's content: replace archives the old bytes, restore reverts, isolated by workspace", async () => {
    const alice = await register("alice-doc-versions");
    const bob = await register("bob-doc-versions");

    async function uploadFile(name: string, content: string): Promise<{ status: number; data: Array<{ id: string }> }> {
      const form = new FormData();
      form.append("files", new Blob([content], { type: "text/plain" }), name);
      const response = await fetch(`${baseUrl}/workspaces/${alice.workspaceId}/documents/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.accessToken}` },
        body: form
      });
      return { status: response.status, data: (await response.json()) as Array<{ id: string }> };
    }

    async function replaceContent(id: string, content: string): Promise<{ status: number }> {
      const form = new FormData();
      form.append("file", new Blob([content], { type: "text/plain" }), "unused.txt");
      const response = await fetch(`${baseUrl}/workspaces/${alice.workspaceId}/documents/${id}/content`, {
        method: "POST",
        headers: { Authorization: `Bearer ${alice.accessToken}` },
        body: form
      });
      return { status: response.status };
    }

    const uploaded = await uploadFile("report.txt", "версия 1");
    expect(uploaded.status).toBe(201);
    const documentId = uploaded.data[0].id;

    expect((await replaceContent(documentId, "версия 2")).status).toBe(201);
    expect((await replaceContent(documentId, "версия 3")).status).toBe(201);

    // The old content is what got archived — newest version first.
    const versions = await request<Array<{ id: string; versionNumber: number }>>(
      `/workspaces/${alice.workspaceId}/documents/${documentId}/versions`,
      { method: "GET", token: alice.accessToken }
    );
    expect(versions.status).toBe(200);
    expect(versions.data.map((v) => v.versionNumber)).toEqual([2, 1]);

    const v2Content = await fetch(
      `${baseUrl}/workspaces/${alice.workspaceId}/documents/${documentId}/versions/${versions.data[0].id}/content`,
      { headers: { Authorization: `Bearer ${alice.accessToken}` } }
    );
    expect(v2Content.status).toBe(200);
    expect(await v2Content.text()).toBe("версия 2");

    const live = await fetch(`${baseUrl}/workspaces/${alice.workspaceId}/documents/${documentId}/content`, {
      headers: { Authorization: `Bearer ${alice.accessToken}` }
    });
    expect(await live.text()).toBe("версия 3");

    // Restoring v1 archives the live content ("версия 3") as a new version first — the
    // restore is itself undoable — then rolls the live content back to "версия 1".
    const version1 = versions.data.find((v) => v.versionNumber === 1)!;
    const restored = await request(
      `/workspaces/${alice.workspaceId}/documents/${documentId}/versions/${version1.id}/restore`,
      { method: "POST", token: alice.accessToken }
    );
    expect(restored.status).toBe(201);

    const liveAfterRestore = await fetch(`${baseUrl}/workspaces/${alice.workspaceId}/documents/${documentId}/content`, {
      headers: { Authorization: `Bearer ${alice.accessToken}` }
    });
    expect(await liveAfterRestore.text()).toBe("версия 1");

    const versionsAfterRestore = await request<Array<{ versionNumber: number }>>(
      `/workspaces/${alice.workspaceId}/documents/${documentId}/versions`,
      { method: "GET", token: alice.accessToken }
    );
    expect(versionsAfterRestore.data.map((v) => v.versionNumber)).toEqual([3, 2, 1]);

    // Bob (a different workspace) can neither list nor read Alice's version history.
    const crossList = await request(`/workspaces/${alice.workspaceId}/documents/${documentId}/versions`, {
      method: "GET",
      token: bob.accessToken
    });
    expect(crossList.status).toBe(403);

    const crossContent = await fetch(
      `${baseUrl}/workspaces/${alice.workspaceId}/documents/${documentId}/versions/${version1.id}/content`,
      { headers: { Authorization: `Bearer ${bob.accessToken}` } }
    );
    expect(crossContent.status).toBe(403);

    const hiddenFromBob = await prisma.withUser(bob.user.id, (tx) =>
      tx.documentVersion.findMany({ where: { workspaceId: alice.workspaceId } })
    );
    expect(hiddenFromBob).toHaveLength(0);
    const visibleToAlice = await prisma.withUser(alice.user.id, (tx) =>
      tx.documentVersion.findMany({ where: { workspaceId: alice.workspaceId } })
    );
    expect(visibleToAlice).toHaveLength(3);
  });

  it("runs the v0.14 platform surface end to end (projects, inbox, links, search, settings, sessions)", async () => {

    // None of this had ever executed: the whole platform-foundation wave was
    // written against a Docker-less machine, so only types were ever checked.
    const user = await register("platform");
    const ws = user.workspaceId;
    const token = user.accessToken;

    // --- preferences (user-scoped, not under /workspaces) ---
    const initialPrefs = await request<{ theme: string }>("/settings/preferences", { method: "GET", token });
    expect(initialPrefs.status).toBe(200);
    expect(initialPrefs.data.theme).toBe("system");

    const patchedPrefs = await request<{ theme: string; quietHoursStart: string | null }>("/settings/preferences", {
      method: "PATCH",
      token,
      body: { theme: "dark", quietHoursStart: "23:00" }
    });
    expect(patchedPrefs.status).toBe(200);
    expect(patchedPrefs.data).toMatchObject({ theme: "dark", quietHoursStart: "23:00" });

    // --- profile + device list ---
    const profile = await request<{ name: string }>("/auth/profile", {
      method: "PATCH",
      token,
      body: { name: "Platform Smoke", email: `${emailPrefix}-platform@example.test` }
    });
    expect(profile.status).toBe(200);
    expect(profile.data.name).toBe("Platform Smoke");

    const sessions = await request<Array<{ id: string; current: boolean }>>("/auth/sessions", { method: "GET", token });
    expect(sessions.status).toBe(200);
    expect(sessions.data.filter((session) => session.current)).toHaveLength(1);

    // --- project (v0.14 made it a first-class entity) ---
    const project = await request<{ id: string; progress: number; counts: { tasks: number } }>(
      `/workspaces/${ws}/projects`,
      { method: "POST", token, body: { name: "Platform smoke" } }
    );
    expect(project.status).toBe(201);
    expect(project.data.progress).toBe(0);

    const projects = await request<Array<{ id: string }>>(`/workspaces/${ws}/projects`, { method: "GET", token });
    expect(projects.data.map((item) => item.id)).toContain(project.data.id);

    // --- inbox capture → process into a task ---
    const captured = await request<{ id: string }>(`/workspaces/${ws}/inbox`, {
      method: "POST",
      token,
      body: { title: "Разобрать smoke-тест" }
    });
    expect(captured.status).toBe(201);

    const processed = await request<{ targetId: string | null; processedAt: string | null }>(
      `/workspaces/${ws}/inbox/${captured.data.id}/process`,
      { method: "POST", token, body: { kind: "task", projectId: project.data.id } }
    );
    expect(processed.status).toBe(201);
    expect(processed.data.processedAt).not.toBeNull();
    expect(processed.data.targetId).not.toBeNull();

    const tasks = await request<Array<{ id: string }>>(`/workspaces/${ws}/tasks`, { method: "GET", token });
    expect(tasks.data.map((task) => task.id)).toContain(processed.data.targetId);

    // --- notification centre (no notifications yet, but the routes must answer) ---
    const notifications = await request<unknown[]>(`/workspaces/${ws}/notifications`, { method: "GET", token });
    expect(notifications.status).toBe(200);
    const readAll = await request<{ updated: number }>(`/workspaces/${ws}/notifications/read-all`, {
      method: "POST",
      token
    });
    expect(readAll.status).toBe(201);
    expect(readAll.data.updated).toBe(0);

    // --- typed link between the created task and the project ---
    const link = await request<{ id: string; title: string }>(`/workspaces/${ws}/links`, {
      method: "POST",
      token,
      body: { sourceType: "task", sourceId: processed.data.targetId, targetType: "project", targetId: project.data.id }
    });
    expect(link.status).toBe(201);
    expect(link.data.title).toBe("Platform smoke");

    const links = await request<{ items: Array<{ id: string }> }>(
      `/workspaces/${ws}/links?type=task&id=${processed.data.targetId}`,
      { method: "GET", token }
    );
    expect(links.data.items).toHaveLength(1);

    // --- global search finds the task by a word from its title ---
    const search = await request<Array<{ id: string; type: string }>>(
      `/workspaces/${ws}/search?q=${encodeURIComponent("smoke")}`,
      { method: "GET", token }
    );
    expect(search.status).toBe(200);
    expect(search.data.some((hit) => hit.id === processed.data.targetId && hit.type === "task")).toBe(true);

    // --- system health (unauthenticated, but must reach the database) ---
    const health = await request<{ status: string; database: string }>("/system/health", { method: "GET" });
    expect(health.status).toBe(200);
    expect(health.data).toMatchObject({ status: "ok", database: "ok" });
  });

  it("gates reminders on the owner's notification preferences", async () => {
    // `UserPreference` used to be write-only: the toggles and quiet hours
    // existed since v0.14 and no reminder producer read them. This test pins
    // the decision the crons now make through NotificationPolicyService.
    // (The crons themselves can't be exercised here without touching every
    // other workspace's tasks, and the fact that the app boots at all already
    // proves the DI wiring — Nest fails hard on a missing provider.)
    const owner = await register("policy");
    const policy = app.get(NotificationPolicyService);
    const ws = owner.workspaceId;

    // No preferences row yet → defaults, everything is delivered.
    expect(await policy.allows(ws, "task")).toBe(true);
    expect(await policy.allows(ws, "event")).toBe(true);
    expect(await policy.allows(ws, "finance")).toBe(true);

    // Muting task reminders must not silence the other kinds.
    const muted = await request("/settings/preferences", {
      method: "PATCH",
      token: owner.accessToken,
      body: { taskReminders: false }
    });
    expect(muted.status).toBe(200);
    expect(await policy.allows(ws, "task")).toBe(false);
    expect(await policy.allows(ws, "event")).toBe(true);
    expect(await policy.allows(ws, "finance")).toBe(true);

    // Quiet hours around "now" in the user's own zone (UTC here) suppress
    // everything; the window is built from the current clock so it always
    // covers this instant, crossing midnight included.
    const now = new Date();
    const clock = (offsetMinutes: number): string => {
      const at = new Date(now.getTime() + offsetMinutes * 60_000);
      return `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`;
    };
    const quiet = await request("/settings/preferences", {
      method: "PATCH",
      token: owner.accessToken,
      body: { quietHoursStart: clock(-30), quietHoursEnd: clock(30), timeZone: "UTC", financeAlerts: false }
    });
    expect(quiet.status).toBe(200);
    expect(await policy.allows(ws, "task")).toBe(false);
    expect(await policy.allows(ws, "finance")).toBe(false);

    // Clearing the window and re-enabling both switches restores delivery —
    // the settings save also drops the policy cache, so this is immediate.
    const restored = await request("/settings/preferences", {
      method: "PATCH",
      token: owner.accessToken,
      body: { quietHoursStart: null, quietHoursEnd: null, taskReminders: true, financeAlerts: true }
    });
    expect(restored.status).toBe(200);
    expect(await policy.allows(ws, "task")).toBe(true);
    expect(await policy.allows(ws, "finance")).toBe(true);

    // A second workspace's policy is independent (the cache is per workspace).
    const other = await register("policy-other");
    await request("/settings/preferences", {
      method: "PATCH",
      token: other.accessToken,
      body: { taskReminders: false }
    });
    expect(await policy.allows(other.workspaceId, "task")).toBe(false);
    expect(await policy.allows(ws, "task")).toBe(true);
  });

  it("raises one budget-overrun alert per budget and month, and honours financeAlerts", async () => {
    // `financeAlerts` had nothing to switch off before v0.16: no code ever
    // produced a finance notification. This exercises the whole path — budget,
    // expense that crosses it, the alert, the dedup — plus the mute switch.
    const user = await register("budget");
    const ws = user.workspaceId;
    const token = user.accessToken;

    const account = await request<{ id: string }>(`/workspaces/${ws}/finance/accounts`, {
      method: "POST",
      token,
      body: { name: "Budget wallet", kind: "cash", startingBalance: 0, currency: "RUB" }
    });
    expect(account.status).toBe(201);

    const category = await request<{ id: string }>(`/workspaces/${ws}/finance/categories`, {
      method: "POST",
      token,
      body: { name: "Кофе", kind: "expense" }
    });
    expect(category.status).toBe(201);

    const occurredAt = new Date().toISOString();
    const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const budget = await request<{ id: string; limitAmount: number }>(`/workspaces/${ws}/finance/budgets`, {
      method: "POST",
      token,
      body: { categoryId: category.data.id, month, limitAmount: 10_000 } // 100 ₽
    });
    expect(budget.status).toBe(201);

    const spend = (amount: number) =>
      request(`/workspaces/${ws}/finance/transactions`, {
        method: "POST",
        token,
        body: { accountId: account.data.id, type: "expense", note: "coffee", occurredAt, lines: [{ categoryId: category.data.id, amount }] }
      });

    const alerts = async (): Promise<Array<{ kind: string; entityType: string | null }>> => {
      const response = await request<Array<{ kind: string; entityType: string | null }>>(
        `/workspaces/${ws}/notifications`,
        { method: "GET", token }
      );
      return response.data.filter((item) => item.kind === "finance_alert");
    };

    // Still inside the limit — silence.
    expect((await spend(6_000)).status).toBe(201);
    expect(await alerts()).toHaveLength(0);

    // Crossing it raises exactly one alert, keyed on the budget row.
    expect((await spend(5_000)).status).toBe(201);
    const afterOverrun = await alerts();
    expect(afterOverrun).toHaveLength(1);
    expect(afterOverrun[0].entityType).toBe("budget");

    // Spending more in the same month must not repeat the alert…
    expect((await spend(1_000)).status).toBe(201);
    expect(await alerts()).toHaveLength(1);

    // …but a muted toggle must stop it before it's ever created.
    await request("/settings/preferences", { method: "PATCH", token, body: { financeAlerts: false } });
    const lunch = await request<{ id: string }>(`/workspaces/${ws}/finance/categories`, {
      method: "POST",
      token,
      body: { name: "Обеды", kind: "expense" }
    });
    await request(`/workspaces/${ws}/finance/budgets`, {
      method: "POST",
      token,
      body: { categoryId: lunch.data.id, month, limitAmount: 5_000 }
    });
    await request(`/workspaces/${ws}/finance/transactions`, {
      method: "POST",
      token,
      body: { accountId: account.data.id, type: "expense", note: "lunch", occurredAt, lines: [{ categoryId: lunch.data.id, amount: 7_000 }] }
    });
    expect(await alerts()).toHaveLength(1);
  });

  it("pulls an external ICS feed on the scheduled pass, read-only", async () => {
    // Two things had never run: the iCalendar importer (the UI for external
    // calendars is new) and the v0.16 cron that keeps subscriptions fresh
    // without anyone pressing "Синхронизировать".
    process.env.ALLOW_PRIVATE_CALENDAR_URLS = "true";
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:orion-smoke-1",
      "SUMMARY:Внешняя встреча",
      "DTSTART:20260915T100000Z",
      "DTEND:20260915T110000Z",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");
    const server = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/calendar");
      response.end(ics);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const user = await register("calendar-feed");
      const connection = await request<{ id: string }>(`/workspaces/${user.workspaceId}/calendar-connections`, {
        method: "POST",
        token: user.accessToken,
        body: {
          name: "Smoke feed",
          kind: "ics",
          url: `http://127.0.0.1:${port}/feed.ics`,
          username: "",
          password: "",
          enabled: true
        }
      });
      expect(connection.status).toBe(201);

      // Exactly what the @Cron does every 30 minutes: no user in scope.
      await app.get(CalendarConnectionsService).handleCron();

      const events = await request<Array<{ id: string; title: string; readOnly: boolean; source: string }>>(
        `/workspaces/${user.workspaceId}/events?from=2026-09-14T00:00:00.000Z&to=2026-09-16T00:00:00.000Z`,
        { method: "GET", token: user.accessToken }
      );
      const imported = events.data.find((event) => event.title === "Внешняя встреча");
      expect(imported).toBeDefined();
      expect(imported?.readOnly).toBe(true);
      expect(imported?.source).toBe("ics");

      // readOnly must be enforced server-side, not just hidden in the UI:
      // a direct PATCH/DELETE against a synced-only event has to be
      // rejected, or the next cron pass would silently discard whatever the
      // user "edited" and nobody would ever notice.
      const importedId = imported!.id;
      const directPatch = await request(`/workspaces/${user.workspaceId}/events/${importedId}`, {
        method: "PATCH",
        token: user.accessToken,
        body: { title: "Захваченная правка" }
      });
      expect(directPatch.status).toBe(400);
      const directDelete = await request(`/workspaces/${user.workspaceId}/events/${importedId}`, {
        method: "DELETE",
        token: user.accessToken
      });
      expect(directDelete.status).toBe(400);
      const stillThere = await request<Array<{ title: string }>>(
        `/workspaces/${user.workspaceId}/events?from=2026-09-14T00:00:00.000Z&to=2026-09-16T00:00:00.000Z`,
        { method: "GET", token: user.accessToken }
      );
      expect(stillThere.data.some((event) => event.title === "Внешняя встреча")).toBe(true);

      // Dropping the event from the feed removes it again (the importer's
      // "delete what the feed no longer lists" step).
      const emptied = ["BEGIN:VCALENDAR", "VERSION:2.0", "END:VCALENDAR"].join("\r\n");
      server.removeAllListeners("request");
      server.on("request", (_request, response) => {
        response.setHeader("Content-Type", "text/calendar");
        response.end(emptied);
      });
      await app.get(CalendarConnectionsService).handleCron();

      const afterRemoval = await request<Array<{ title: string }>>(
        `/workspaces/${user.workspaceId}/events?from=2026-09-14T00:00:00.000Z&to=2026-09-16T00:00:00.000Z`,
        { method: "GET", token: user.accessToken }
      );
      expect(afterRemoval.data.some((event) => event.title === "Внешняя встреча")).toBe(false);
    } finally {
      server.close();
      delete process.env.ALLOW_PRIVATE_CALENDAR_URLS;
    }
  });

  it("guards the task hierarchy and persists manual order", async () => {
    // The subtask/order UI (v0.17) leans on guards that had never been
    // exercised: self-parenting, cycles, and a parent from another workspace.
    const user = await register("hierarchy");
    const ws = user.workspaceId;
    const token = user.accessToken;

    const parent = await request<{ id: string; parentId: string | null; sortOrder: number }>(
      `/workspaces/${ws}/tasks`,
      { method: "POST", token, body: { title: "Родитель" } }
    );
    expect(parent.status).toBe(201);

    const child = await request<{ id: string; parentId: string | null }>(`/workspaces/${ws}/tasks`, {
      method: "POST",
      token,
      body: { title: "Ребёнок", parentId: parent.data.id }
    });
    expect(child.status).toBe(201);
    expect(child.data.parentId).toBe(parent.data.id);

    const selfParent = await request(`/workspaces/${ws}/tasks/${child.data.id}`, {
      method: "PATCH",
      token,
      body: { parentId: child.data.id }
    });
    expect(selfParent.status).toBe(400);

    // Making the parent a child of its own child is the cycle the UI must never
    // send — and the API refuses it even if a client gets it wrong.
    const cycle = await request(`/workspaces/${ws}/tasks/${parent.data.id}`, {
      method: "PATCH",
      token,
      body: { parentId: child.data.id }
    });
    expect(cycle.status).toBe(400);

    const other = await register("hierarchy-other");
    const foreign = await request<{ id: string }>(`/workspaces/${other.workspaceId}/tasks`, {
      method: "POST",
      token: other.accessToken,
      body: { title: "Чужая задача" }
    });
    const crossWorkspace = await request(`/workspaces/${ws}/tasks/${parent.data.id}`, {
      method: "PATCH",
      token,
      body: { parentId: foreign.data.id }
    });
    expect(crossWorkspace.status).toBe(404);

    // Manual order is just a column — the value survives the round trip, and a
    // dependency on a task of another workspace is refused the same way.
    const reordered = await request<{ sortOrder: number }>(`/workspaces/${ws}/tasks/${child.data.id}`, {
      method: "PATCH",
      token,
      body: { sortOrder: 1500 }
    });
    expect(reordered.status).toBe(200);
    expect(reordered.data.sortOrder).toBe(1500);

    const foreignDependency = await request(`/workspaces/${ws}/tasks`, {
      method: "POST",
      token,
      body: { title: "Зависимая", dependencyIds: [foreign.data.id] }
    });
    expect(foreignDependency.status).toBe(404);
  });

  it("projects: canceled tasks count as closed, list follows lifecycle, second user is 403", async () => {
    const user = await register("projects-board");
    const ws = user.workspaceId;
    const token = user.accessToken;

    const project = await request<{ id: string; progress: number; counts: { tasks: number; closed: number } }>(
      `/workspaces/${ws}/projects`,
      { method: "POST", token, body: { name: "Progress fixture" } }
    );
    expect(project.status).toBe(201);
    expect(project.data).toMatchObject({ progress: 0, counts: { tasks: 0, closed: 0 } });

    async function addTask(title: string, status: "todo" | "done" | "canceled"): Promise<void> {
      const created = await request<{ id: string }>(`/workspaces/${ws}/tasks`, {
        method: "POST",
        token,
        body: { title, projectId: project.data.id }
      });
      expect(created.status).toBe(201);
      if (status === "todo") return;
      const patched = await request(`/workspaces/${ws}/tasks/${created.data.id}`, {
        method: "PATCH",
        token,
        body: { status }
      });
      expect(patched.status).toBe(200);
    }

    await addTask("done-1", "done");
    await addTask("done-2", "done");
    await addTask("done-3", "done");
    await addTask("canceled-1", "canceled");
    await addTask("canceled-2", "canceled");
    await addTask("open", "todo");

    const detail = await request<{ progress: number; counts: { tasks: number; closed: number } }>(
      `/workspaces/${ws}/projects/${project.data.id}`,
      { method: "GET", token }
    );
    // 5 closed of 6 — not 50% from counting only status === "done".
    expect(detail.data.counts).toMatchObject({ tasks: 6, closed: 5 });
    expect(detail.data.progress).toBe(83);

    await request(`/workspaces/${ws}/projects`, { method: "POST", token, body: { name: "Z completed", status: "completed" } });
    await request(`/workspaces/${ws}/projects`, { method: "POST", token, body: { name: "M on hold", status: "on_hold" } });
    await request(`/workspaces/${ws}/projects`, { method: "POST", token, body: { name: "A active", status: "active" } });

    const listed = await request<Array<{ name: string; status: string }>>(`/workspaces/${ws}/projects`, {
      method: "GET",
      token
    });
    expect(listed.data.map((row) => row.status)).toEqual(["active", "active", "on_hold", "completed"]);
    expect(listed.data.filter((row) => row.status === "active").map((row) => row.name)).toEqual([
      "A active",
      "Progress fixture"
    ]);

    const other = await register("projects-other");
    const cross = await request(`/workspaces/${ws}/projects`, { method: "GET", token: other.accessToken });
    expect(cross.status).toBe(403);
    const hidden = await prisma.withUser(other.user.id, (tx) =>
      tx.project.findMany({ where: { workspaceId: ws } })
    );
    expect(hidden).toHaveLength(0);
  });

  it("tracks time: one running timer per workspace, manual entries, and workspace guards", async () => {
    const user = await register("time");
    const ws = user.workspaceId;
    const token = user.accessToken;

    const nothingRunning = await request<null>(`/workspaces/${ws}/time/running`, { method: "GET", token });
    expect(nothingRunning.status).toBe(200);
    expect(nothingRunning.data).toBeNull();

    const project = await request<{ id: string; hourlyRate: number | null }>(`/workspaces/${ws}/projects`, {
      method: "POST",
      token,
      body: { name: "Time project", hourlyRate: 200_000 }
    });
    // The rate is what turns tracked time into money — it must survive the round
    // trip, and it is nullable on purpose (unknown ≠ free).
    expect(project.data.hourlyRate).toBe(200_000);
    const task = await request<{ id: string; projectId: string | null }>(`/workspaces/${ws}/tasks`, {
      method: "POST",
      token,
      body: { title: "Timed task", projectId: project.data.id }
    });
    expect(task.data.projectId).toBe(project.data.id);

    const started = await request<{ running: boolean; projectId: string | null }>(`/workspaces/${ws}/time/start`, {
      method: "POST",
      token,
      body: { taskId: task.data.id }
    });
    expect(started.status).toBe(201);
    expect(started.data.running).toBe(true);
    // Denormalised from the task, so "hours per project" needs no join.
    expect(started.data.projectId).toBe(project.data.id);

    // The second timer is refused — and the guarantee is the partial unique
    // index in the DB, which is what makes two devices racing safe.
    const secondStart = await request(`/workspaces/${ws}/time/start`, { method: "POST", token, body: {} });
    expect(secondStart.status).toBe(409);

    const stopped = await request<{ running: boolean; endedAt: string | null }>(`/workspaces/${ws}/time/stop`, {
      method: "POST",
      token,
      body: {}
    });
    expect(stopped.status).toBe(201);
    expect(stopped.data.running).toBe(false);
    expect(stopped.data.endedAt).not.toBeNull();

    const stopAgain = await request(`/workspaces/${ws}/time/stop`, { method: "POST", token, body: {} });
    expect(stopAgain.status).toBe(404);

    const manual = await request<{ minutes: number }>(`/workspaces/${ws}/time`, {
      method: "POST",
      token,
      body: {
        taskId: task.data.id,
        startedAt: "2026-09-10T09:00:00.000Z",
        endedAt: "2026-09-10T11:30:00.000Z"
      }
    });
    expect(manual.status).toBe(201);
    expect(manual.data.minutes).toBe(150);

    const inverted = await request(`/workspaces/${ws}/time`, {
      method: "POST",
      token,
      body: { startedAt: "2026-09-10T11:00:00.000Z", endedAt: "2026-09-10T09:00:00.000Z" }
    });
    expect(inverted.status).toBe(400);

    const byProject = await request<{ items: Array<{ projectId: string | null }>; nextCursor: string | null }>(
      `/workspaces/${ws}/time?projectId=${project.data.id}`,
      { method: "GET", token }
    );
    expect(byProject.data.items.length).toBeGreaterThanOrEqual(2);
    expect(byProject.data.items.every((entry) => entry.projectId === project.data.id)).toBe(true);

    const priced = await request<{
      trackedMinutes: number;
      timeCost: number | null;
      unratedMinutes: number;
    }>(`/workspaces/${ws}/projects/${project.data.id}`, { method: "GET", token });
    expect(priced.status).toBe(200);
    expect(priced.data.trackedMinutes).toBeGreaterThanOrEqual(150);
    expect(priced.data.unratedMinutes).toBe(0);
    expect(priced.data.timeCost).toBe(timeCostMinor(priced.data.trackedMinutes, 200_000));

    const unratedProject = await request<{ id: string }>(`/workspaces/${ws}/projects`, {
      method: "POST",
      token,
      body: { name: "No rate" }
    });
    const hourWithoutRate = await request(`/workspaces/${ws}/time`, {
      method: "POST",
      token,
      body: {
        projectId: unratedProject.data.id,
        startedAt: "2026-09-10T12:00:00.000Z",
        endedAt: "2026-09-10T13:00:00.000Z"
      }
    });
    expect(hourWithoutRate.status).toBe(201);
    const unrated = await request<{
      trackedMinutes: number;
      timeCost: number | null;
      unratedMinutes: number;
    }>(`/workspaces/${ws}/projects/${unratedProject.data.id}`, { method: "GET", token });
    expect(unrated.data.trackedMinutes).toBe(60);
    expect(unrated.data.timeCost).toBeNull();
    expect(unrated.data.unratedMinutes).toBe(60);

    const other = await register("time-other");
    const foreignTask = await request<{ id: string }>(`/workspaces/${other.workspaceId}/tasks`, {
      method: "POST",
      token: other.accessToken,
      body: { title: "Чужая задача" }
    });
    const crossStart = await request(`/workspaces/${ws}/time/start`, {
      method: "POST",
      token,
      body: { taskId: foreignTask.data.id }
    });
    expect(crossStart.status).toBe(404);

    // And the rows themselves are invisible to the other user through RLS.
    const leakCheck = await prisma.withUser(other.user.id, (tx) =>
      tx.timeEntry.findMany({ where: { workspaceId: ws } })
    );
    expect(leakCheck).toHaveLength(0);
  });

  it("tracks habits: schedule, ticks, streak and archive", async () => {
    const user = await register("habits");
    const ws = user.workspaceId;
    const token = user.accessToken;

    const empty = await request<unknown[]>(`/workspaces/${ws}/habits`, { method: "GET", token });
    expect(empty.status).toBe(200);
    expect(empty.data).toHaveLength(0);

    // No weekdays = every day (an empty Postgres array, not "never").
    const daily = await request<{ id: string; streak: number; dueToday: boolean; doneToday: boolean }>(
      `/workspaces/${ws}/habits`,
      { method: "POST", token, body: { name: "Зарядка" } }
    );
    expect(daily.status).toBe(201);
    expect(daily.data).toMatchObject({ streak: 0, dueToday: true, doneToday: false });

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    const tick = await request<{ habitId: string; day: string; done: boolean }>(
      `/workspaces/${ws}/habits/${daily.data.id}/toggle`,
      { method: "POST", token, body: { day: today } }
    );
    expect(tick.status).toBe(201);
    expect(tick.data).toEqual({ habitId: daily.data.id, day: today, done: true });

    const afterTick = await request<Array<{ streak: number; doneToday: boolean }>>(`/workspaces/${ws}/habits`, {
      method: "GET",
      token
    });
    expect(afterTick.data[0]).toMatchObject({ doneToday: true, streak: 1 });

    // Toggling the same day again un-ticks it (one row per habit per day).
    const untick = await request<{ done: boolean }>(`/workspaces/${ws}/habits/${daily.data.id}/toggle`, {
      method: "POST",
      token,
      body: { day: today }
    });
    expect(untick.data.done).toBe(false);

    // Today + yesterday → streak 2. The streak is computed, never stored.
    await request(`/workspaces/${ws}/habits/${daily.data.id}/toggle`, { method: "POST", token, body: { day: today } });
    await request(`/workspaces/${ws}/habits/${daily.data.id}/toggle`, { method: "POST", token, body: { day: yesterday } });
    const twoDays = await request<Array<{ streak: number }>>(`/workspaces/${ws}/habits`, { method: "GET", token });
    expect(twoDays.data[0].streak).toBe(2);

    // A weekly habit scheduled for *another* weekday is not due today.
    const todayWeekday = (new Date().getUTCDay() + 6) % 7;
    const weekly = await request<{ id: string; dueToday: boolean; weekdays: number[] }>(`/workspaces/${ws}/habits`, {
      method: "POST",
      token,
      body: { name: "Дневник", weekdays: [(todayWeekday + 1) % 7] }
    });
    expect(weekly.data.dueToday).toBe(false);
    expect(weekly.data.weekdays).toEqual([(todayWeekday + 1) % 7]);

    const entries = await request<Array<{ habitId: string; day: string }>>(
      `/workspaces/${ws}/habits/entries?from=${yesterday}&to=${today}`,
      { method: "GET", token }
    );
    expect(entries.data.filter((entry) => entry.habitId === daily.data.id)).toHaveLength(2);

    // The panel sends its *own* calendar day as `?today=`, and the API answers
    // about that day: the weekly habit is due tomorrow without the server having
    // to wait for its own UTC clock to roll over, and the streak re-anchors.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const forTomorrow = await request<Array<{ id: string; dueToday: boolean }>>(
      `/workspaces/${ws}/habits?today=${tomorrow}`,
      { method: "GET", token }
    );
    expect(forTomorrow.data.find((habit) => habit.id === weekly.data.id)?.dueToday).toBe(true);

    const forYesterday = await request<Array<{ id: string; doneToday: boolean; streak: number }>>(
      `/workspaces/${ws}/habits?today=${yesterday}`,
      { method: "GET", token }
    );
    const dailyAtYesterday = forYesterday.data.find((habit) => habit.id === daily.data.id);
    expect(dailyAtYesterday?.doneToday).toBe(true);
    expect(dailyAtYesterday?.streak).toBe(1);

    // A malformed day is a 400, not a silently shifted streak window.
    const malformedDay = await request(`/workspaces/${ws}/habits?today=10.09.2026`, { method: "GET", token });
    expect(malformedDay.status).toBe(400);

    const other = await register("habits-other");
    const foreign = await request(`/workspaces/${other.workspaceId}/habits/${daily.data.id}/toggle`, {
      method: "POST",
      token: other.accessToken,
      body: {}
    });
    expect(foreign.status).toBe(404);

    // Archiving hides it from the daily list but keeps the history.
    const archived = await request<{ archivedAt: string | null }>(`/workspaces/${ws}/habits/${daily.data.id}`, {
      method: "DELETE",
      token
    });
    expect(archived.status).toBe(200);
    expect(archived.data.archivedAt).not.toBeNull();

    const active = await request<Array<{ id: string }>>(`/workspaces/${ws}/habits`, { method: "GET", token });
    expect(active.data.some((habit) => habit.id === daily.data.id)).toBe(false);

    const all = await request<Array<{ id: string; streak: number }>>(`/workspaces/${ws}/habits?includeArchived=true`, {
      method: "GET",
      token
    });
    expect(all.data.find((habit) => habit.id === daily.data.id)?.streak).toBe(2);

    const leakCheck = await prisma.withUser(other.user.id, (tx) => tx.habit.findMany({ where: { workspaceId: ws } }));
    expect(leakCheck).toHaveLength(0);
  });

  it("tracks lists: items, checking, clearing checked, archive/restore, isolated by workspace", async () => {
    const user = await register("lists");
    const ws = user.workspaceId;
    const token = user.accessToken;

    const empty = await request<unknown[]>(`/workspaces/${ws}/lists`, { method: "GET", token });
    expect(empty.status).toBe(200);
    expect(empty.data).toHaveLength(0);

    const list = await request<{ id: string; name: string; items: unknown[] }>(`/workspaces/${ws}/lists`, {
      method: "POST",
      token,
      body: { name: "Продукты" }
    });
    expect(list.status).toBe(201);
    expect(list.data.items).toHaveLength(0);

    const item1 = await request<{ id: string; label: string; checked: boolean }>(
      `/workspaces/${ws}/lists/${list.data.id}/items`,
      { method: "POST", token, body: { label: "Молоко" } }
    );
    expect(item1.status).toBe(201);
    expect(item1.data.checked).toBe(false);

    const item2 = await request(`/workspaces/${ws}/lists/${list.data.id}/items`, {
      method: "POST",
      token,
      body: { label: "Хлеб" }
    });
    expect(item2.status).toBe(201);

    // Checking is the same endpoint as renaming — just a different field.
    const toggled = await request<{ checked: boolean }>(
      `/workspaces/${ws}/lists/${list.data.id}/items/${item1.data.id}`,
      { method: "PATCH", token, body: { checked: true } }
    );
    expect(toggled.status).toBe(200);
    expect(toggled.data.checked).toBe(true);

    const withItems = await request<Array<{ id: string; items: Array<{ id: string; checked: boolean }> }>>(
      `/workspaces/${ws}/lists`,
      { method: "GET", token }
    );
    expect(withItems.data[0].items).toHaveLength(2);
    expect(withItems.data[0].items.find((i) => i.id === item1.data.id)?.checked).toBe(true);

    // "Clear checked" removes only «Молоко» (checked), keeps «Хлеб».
    const cleared = await request(`/workspaces/${ws}/lists/${list.data.id}/items/clear-checked`, {
      method: "POST",
      token
    });
    expect(cleared.status).toBe(201);
    const afterClear = await request<Array<{ items: Array<{ label: string }> }>>(`/workspaces/${ws}/lists`, {
      method: "GET",
      token
    });
    expect(afterClear.data[0].items.map((i) => i.label)).toEqual(["Хлеб"]);

    // Archiving hides the list from the default view but keeps its items.
    const archived = await request<{ archivedAt: string | null }>(`/workspaces/${ws}/lists/${list.data.id}`, {
      method: "DELETE",
      token
    });
    expect(archived.status).toBe(200);
    expect(archived.data.archivedAt).not.toBeNull();

    const activeAfterArchive = await request<unknown[]>(`/workspaces/${ws}/lists`, { method: "GET", token });
    expect(activeAfterArchive.data).toHaveLength(0);

    const withArchived = await request<Array<{ id: string; items: unknown[] }>>(
      `/workspaces/${ws}/lists?includeArchived=true`,
      { method: "GET", token }
    );
    expect(withArchived.data.find((l) => l.id === list.data.id)?.items).toHaveLength(1);

    const restored = await request<{ archivedAt: string | null }>(`/workspaces/${ws}/lists/${list.data.id}`, {
      method: "PATCH",
      token,
      body: { archivedAt: null }
    });
    expect(restored.status).toBe(200);
    expect(restored.data.archivedAt).toBeNull();

    // A second workspace can neither see nor touch the first one's lists.
    const other = await register("lists-other");
    const cross = await request(`/workspaces/${ws}/lists`, { method: "GET", token: other.accessToken });
    expect(cross.status).toBe(403);
    const hidden = await prisma.withUser(other.user.id, (tx) => tx.list.findMany({ where: { workspaceId: ws } }));
    expect(hidden).toHaveLength(0);
  });

  it("disables a domain module without deleting its data", async () => {
    const owner = await register("modules-owner");
    const token = owner.accessToken;
    const ws = owner.workspaceId;

    const created = await request<{ id: string }>(`/workspaces/${ws}/habits`, {
      method: "POST",
      token,
      body: { name: "Вода" }
    });
    expect(created.status).toBe(201);

    const listed = await request<Array<{ id: string; enabled: boolean; label: string }>>(`/workspaces/${ws}/modules`, {
      method: "GET",
      token
    });
    expect(listed.status).toBe(200);
    expect(listed.data.find((item) => item.id === "habits")?.enabled).toBe(true);

    const disabled = await request<Array<{ id: string; enabled: boolean }>>(`/workspaces/${ws}/modules/habits`, {
      method: "PATCH",
      token,
      body: { enabled: false, confirm: true }
    });
    expect(disabled.status).toBe(200);
    expect(disabled.data.find((item) => item.id === "habits")?.enabled).toBe(false);

    const blocked = await request(`/workspaces/${ws}/habits`, { method: "GET", token });
    expect(blocked.status).toBe(409);

    const workspaces = await request<Array<{ id: string; disabledModules: string[] }>>("/workspaces/me", {
      method: "GET",
      token
    });
    expect(workspaces.data[0]?.disabledModules).toContain("habits");

    const stillThere = await prisma.asSystem((tx) => tx.habit.findMany({ where: { workspaceId: ws } }));
    expect(stillThere.some((habit) => habit.id === created.data.id)).toBe(true);

    const reenabled = await request<Array<{ id: string; enabled: boolean }>>(`/workspaces/${ws}/modules/habits`, {
      method: "PATCH",
      token,
      body: { enabled: true }
    });
    expect(reenabled.status).toBe(200);

    const restored = await request<Array<{ id: string }>>(`/workspaces/${ws}/habits?includeArchived=true`, {
      method: "GET",
      token
    });
    expect(restored.status).toBe(200);
    expect(restored.data.some((habit) => habit.id === created.data.id)).toBe(true);
  });

  it("keeps projects available when finance and time are disabled", async () => {
    const owner = await register("modules-projects");
    const token = owner.accessToken;
    const ws = owner.workspaceId;

    const project = await request<{ id: string; spentAmount: number; trackedMinutes: number }>(`/workspaces/${ws}/projects`, {
      method: "POST",
      token,
      body: { name: "Без соседей" }
    });
    expect(project.status).toBe(201);

    for (const moduleId of ["finance", "time"] as const) {
      const patched = await request(`/workspaces/${ws}/modules/${moduleId}`, {
        method: "PATCH",
        token,
        body: { enabled: false, confirm: true }
      });
      expect(patched.status).toBe(200);
    }

    const listed = await request<Array<{ id: string; spentAmount: number; trackedMinutes: number }>>(
      `/workspaces/${ws}/projects`,
      { method: "GET", token }
    );
    expect(listed.status).toBe(200);
    const row = listed.data.find((item) => item.id === project.data.id);
    expect(row).toBeDefined();
    expect(row?.spentAmount).toBe(0);
    expect(row?.trackedMinutes).toBe(0);

    const accounts = await request(`/workspaces/${ws}/finance/accounts`, { method: "GET", token });
    expect(accounts.status).toBe(409);
    const running = await request(`/workspaces/${ws}/time/running`, { method: "GET", token });
    expect(running.status).toBe(409);
  });

  it("restricts a module to owner/lead — a plain member is 403'd, not 409'd like a disabled module", async () => {
    const alice = await register("restrict-alice");
    const bob = await register("restrict-bob");
    const ws = alice.workspaceId;

    // Baseline: any member can read Finance before it's restricted.
    const account = await request<{ id: string }>(`/workspaces/${ws}/finance/accounts`, {
      method: "POST",
      token: alice.accessToken,
      body: { name: "Wallet", kind: "cash", startingBalance: 0, currency: "RUB" }
    });
    expect(account.status).toBe(201);

    const restricted = await request<Array<{ id: string; restricted: boolean; enabled: boolean }>>(
      `/workspaces/${ws}/modules/finance/restrict`,
      { method: "PATCH", token: alice.accessToken, body: { restricted: true } }
    );
    expect(restricted.status).toBe(200);
    // Restricting never disables — owner/lead keep full access, only `member` is turned away.
    expect(restricted.data.find((m) => m.id === "finance")).toMatchObject({ restricted: true, enabled: true });

    // Bob joins alice's workspace as a plain member.
    const invite = await request<{ acceptUrl: string }>(`/workspaces/${ws}/invites`, {
      method: "POST",
      token: alice.accessToken,
      body: { email: `${emailPrefix}-restrict-bob@example.test` }
    });
    expect(invite.status).toBe(201);
    const inviteToken = new URL(invite.data.acceptUrl).searchParams.get("token")!;
    const accepted = await request(`/invites/${inviteToken}/accept`, { method: "POST", token: bob.accessToken });
    expect(accepted.status).toBe(201);

    const blocked = await request(`/workspaces/${ws}/finance/accounts`, { method: "GET", token: bob.accessToken });
    expect(blocked.status).toBe(403);

    // Promoted to lead, bob passes straight through the same restriction.
    const membersList = await request<Array<{ id: string; userId: string }>>(`/workspaces/${ws}/members`, {
      method: "GET",
      token: alice.accessToken
    });
    const bobMember = membersList.data.find((m) => m.userId === bob.user.id)!;
    const promoted = await request(`/workspaces/${ws}/members/${bobMember.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { role: "lead" }
    });
    expect(promoted.status).toBe(200);
    const asLead = await request(`/workspaces/${ws}/finance/accounts`, { method: "GET", token: bob.accessToken });
    expect(asLead.status).toBe(200);

    // Back to a plain member — restricted again; only the owner may lift it.
    await request(`/workspaces/${ws}/members/${bobMember.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { role: "member" }
    });
    const bobTriesToLift = await request(`/workspaces/${ws}/modules/finance/restrict`, {
      method: "PATCH",
      token: bob.accessToken,
      body: { restricted: false }
    });
    expect(bobTriesToLift.status).toBe(403);

    const lifted = await request<Array<{ id: string; restricted: boolean }>>(
      `/workspaces/${ws}/modules/finance/restrict`,
      { method: "PATCH", token: alice.accessToken, body: { restricted: false } }
    );
    expect(lifted.data.find((m) => m.id === "finance")?.restricted).toBe(false);
    const restoredAccess = await request(`/workspaces/${ws}/finance/accounts`, { method: "GET", token: bob.accessToken });
    expect(restoredAccess.status).toBe(200);
  });

  it("S02: sync/backup is owner-only on every endpoint — member and lead get 403, no WebDAV call is ever made", async () => {
    // Regression for docs/HISTORY.md "S02: полный
    // перечень owner gates". Before the fix, every SyncService method only
    // called `assertMemberTx` — any member (or lead) could read/replace the
    // remote WebDAV credentials and trigger a full-workspace restore.
    const alice = await register("s02-alice");
    const carol = await register("s02-carol");
    const dave = await register("s02-dave");
    const ws = alice.workspaceId;

    async function inviteAndAccept(email: string, token: string): Promise<void> {
      const invite = await request<{ acceptUrl: string }>(`/workspaces/${ws}/invites`, {
        method: "POST",
        token: alice.accessToken,
        body: { email }
      });
      expect(invite.status).toBe(201);
      const inviteToken = new URL(invite.data.acceptUrl).searchParams.get("token")!;
      const accepted = await request(`/invites/${inviteToken}/accept`, { method: "POST", token });
      expect(accepted.status).toBe(201);
    }

    await inviteAndAccept(`${emailPrefix}-s02-carol@example.test`, carol.accessToken);
    await inviteAndAccept(`${emailPrefix}-s02-dave@example.test`, dave.accessToken);

    const membersList = await request<Array<{ id: string; userId: string }>>(`/workspaces/${ws}/members`, {
      method: "GET",
      token: alice.accessToken
    });
    const daveMember = membersList.data.find((m) => m.userId === dave.user.id)!;
    const promoteLead = await request(`/workspaces/${ws}/members/${daveMember.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { role: "lead" }
    });
    expect(promoteLead.status).toBe(200);
    // carol stays a plain member.

    const remoteInput = {
      kind: "webdav",
      url: "https://example.com/webdav",
      username: "u",
      password: "p",
      baseDir: "/ORION",
      depthInfinity: true,
      encAlgo: "rclone-base64",
      autoEveryMs: -1
    };

    // Owner configures the remote — plain DB write, doesn't touch WebdavRemote.
    const put = await request(`/workspaces/${ws}/sync/remote`, {
      method: "PUT",
      token: alice.accessToken,
      body: remoteInput
    });
    expect(put.status).toBe(200);

    // Every WebdavRemote method a rejected actor could otherwise trigger, set
    // up to fail loudly if ever reached — proof that owner gate runs strictly
    // *before* any secret decryption / network attempt, not just that the
    // HTTP response happens to be 403.
    const spies = [
      vi.spyOn(WebdavRemote.prototype, "connectAndCount").mockRejectedValue(new Error("must not be called")),
      vi.spyOn(WebdavRemote.prototype, "ensureDir").mockRejectedValue(new Error("must not be called")),
      vi.spyOn(WebdavRemote.prototype, "putFile").mockRejectedValue(new Error("must not be called")),
      vi.spyOn(WebdavRemote.prototype, "getFile").mockRejectedValue(new Error("must not be called")),
      vi.spyOn(WebdavRemote.prototype, "exists").mockRejectedValue(new Error("must not be called")),
      vi.spyOn(WebdavRemote.prototype, "listDir").mockRejectedValue(new Error("must not be called"))
    ];

    try {
      for (const nonOwner of [carol, dave]) {
        const getRemote = await request(`/workspaces/${ws}/sync/remote`, {
          method: "GET",
          token: nonOwner.accessToken
        });
        expect(getRemote.status).toBe(403);

        const putRemote = await request(`/workspaces/${ws}/sync/remote`, {
          method: "PUT",
          token: nonOwner.accessToken,
          body: remoteInput
        });
        expect(putRemote.status).toBe(403);

        const testRemote = await request(`/workspaces/${ws}/sync/remote/test`, {
          method: "POST",
          token: nonOwner.accessToken
        });
        expect(testRemote.status).toBe(403);

        const backup = await request(`/workspaces/${ws}/sync/backup`, {
          method: "POST",
          token: nonOwner.accessToken
        });
        expect(backup.status).toBe(403);

        const listBackups = await request(`/workspaces/${ws}/sync/backups`, {
          method: "GET",
          token: nonOwner.accessToken
        });
        expect(listBackups.status).toBe(403);

        const restorePreview = await request(`/workspaces/${ws}/sync/restore`, {
          method: "POST",
          token: nonOwner.accessToken,
          body: { dryRun: true }
        });
        expect(restorePreview.status).toBe(403);

        const restoreApply = await request(`/workspaces/${ws}/sync/restore`, {
          method: "POST",
          token: nonOwner.accessToken,
          body: { dryRun: false, confirmWorkspaceId: ws }
        });
        expect(restoreApply.status).toBe(403);
      }

      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it("S02: restore apply re-checks the actor's role inside its own transaction — a preview taken as owner doesn't survive a demotion", async () => {
    // Preview (dryRun) and apply are two separate HTTP requests; the actor's
    // role can change in between. The fix re-runs `assertMemberRoleTx(...,
    // ["owner"])` fresh on apply instead of trusting the earlier preflight.
    const alice = await register("s02-role-alice");
    const eve = await register("s02-role-eve");
    const ws = alice.workspaceId;

    const invite = await request<{ acceptUrl: string }>(`/workspaces/${ws}/invites`, {
      method: "POST",
      token: alice.accessToken,
      body: { email: `${emailPrefix}-s02-role-eve@example.test` }
    });
    expect(invite.status).toBe(201);
    const inviteToken = new URL(invite.data.acceptUrl).searchParams.get("token")!;
    const accepted = await request(`/invites/${inviteToken}/accept`, { method: "POST", token: eve.accessToken });
    expect(accepted.status).toBe(201);

    const membersList = await request<Array<{ id: string; userId: string }>>(`/workspaces/${ws}/members`, {
      method: "GET",
      token: alice.accessToken
    });
    const eveMember = membersList.data.find((m) => m.userId === eve.user.id)!;
    const promoteOwner = await request(`/workspaces/${ws}/members/${eveMember.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { role: "owner" }
    });
    expect(promoteOwner.status).toBe(200);

    const put = await request(`/workspaces/${ws}/sync/remote`, {
      method: "PUT",
      token: alice.accessToken,
      body: {
        kind: "webdav",
        url: "https://example.com/webdav",
        username: "u",
        password: "p",
        baseDir: "/ORION",
        depthInfinity: true,
        encAlgo: "rclone-base64",
        autoEveryMs: -1
      }
    });
    expect(put.status).toBe(200);

    // Stub the WebDAV surface: capture what `backup` uploads and hand the
    // same bytes back to `restore` — no real network involved, both sides of
    // the round trip are still driven by the real sync-crypto encryption.
    let sealedLatest: Buffer | null = null;
    const ensureDirSpy = vi.spyOn(WebdavRemote.prototype, "ensureDir").mockResolvedValue(undefined);
    const putFileSpy = vi
      .spyOn(WebdavRemote.prototype, "putFile")
      .mockImplementation(async (rel: string, data: Buffer) => {
        if (rel.endsWith("latest.orion")) sealedLatest = data;
      });
    const existsSpy = vi.spyOn(WebdavRemote.prototype, "exists").mockResolvedValue(true);
    const getFileSpy = vi.spyOn(WebdavRemote.prototype, "getFile").mockImplementation(async () => {
      if (!sealedLatest) throw new Error("test setup bug: no backup captured yet");
      return sealedLatest;
    });

    try {
      const backup = await request(`/workspaces/${ws}/sync/backup`, { method: "POST", token: alice.accessToken });
      expect(backup.status).toBe(201);
      expect(sealedLatest).not.toBeNull();

      // Eve is owner right now — preview succeeds.
      const preview = await request<{ snapshot: string; applied: boolean }>(`/workspaces/${ws}/sync/restore`, {
        method: "POST",
        token: eve.accessToken,
        body: { dryRun: true }
      });
      expect(preview.status).toBe(201);
      expect(preview.data.applied).toBe(false);

      // Alice demotes eve *after* the preview — alice remains an owner so
      // this demotion is allowed by `setRole`'s "at least one owner" rule.
      const demote = await request(`/workspaces/${ws}/members/${eveMember.id}`, {
        method: "PATCH",
        token: alice.accessToken,
        body: { role: "member" }
      });
      expect(demote.status).toBe(200);

      // Eve applies using the snapshot name from her still-valid preview —
      // must 403, not silently succeed on a stale preflight.
      const apply = await request(`/workspaces/${ws}/sync/restore`, {
        method: "POST",
        token: eve.accessToken,
        body: { dryRun: false, snapshot: preview.data.snapshot, confirmWorkspaceId: ws }
      });
      expect(apply.status).toBe(403);
    } finally {
      ensureDirSpy.mockRestore();
      putFileSpy.mockRestore();
      existsSpy.mockRestore();
      getFileSpy.mockRestore();
    }
  });

  it("restricted-module-aggregate-access: a restricted/disabled module must not leak through search, project rollup or entity links", async () => {
    // S01 regression (docs/HISTORY.md). Before the
    // fix, `SearchService`/`ProjectsService` built their cross-module queries
    // from `ModulesService.enabledSetTx`, which only knows "disabled" — a
    // `restricted` module (still enabled, just hidden from a plain `member`)
    // sailed straight through every aggregator even though its own direct
    // endpoint answered 403.
    const alice = await register("s01-alice");
    const bob = await register("s01-bob");
    const ws = alice.workspaceId;
    const marker = "restricted-finance-probe";

    const project = await request<{ id: string }>(`/workspaces/${ws}/projects`, {
      method: "POST",
      token: alice.accessToken,
      body: { name: "S01 aggregate fixture" }
    });
    expect(project.status).toBe(201);

    const account = await request<{ id: string }>(`/workspaces/${ws}/finance/accounts`, {
      method: "POST",
      token: alice.accessToken,
      body: { name: "S01 wallet", kind: "cash", startingBalance: 0, currency: "RUB" }
    });
    expect(account.status).toBe(201);

    const transaction = await request<{ id: string }>(`/workspaces/${ws}/finance/transactions`, {
      method: "POST",
      token: alice.accessToken,
      body: {
        accountId: account.data.id,
        projectId: project.data.id,
        type: "expense",
        note: marker,
        occurredAt: new Date().toISOString(),
        lines: [{ amount: 123_456 }]
      }
    });
    expect(transaction.status).toBe(201);
    const transactionId = transaction.data.id;

    const task = await request<{ id: string }>(`/workspaces/${ws}/tasks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "S01 linked task", projectId: project.data.id }
    });
    expect(task.status).toBe(201);
    const taskId = task.data.id;

    const link = await request<{ id: string; title: string }>(`/workspaces/${ws}/links`, {
      method: "POST",
      token: alice.accessToken,
      body: { sourceType: "task", sourceId: taskId, targetType: "transaction", targetId: transactionId }
    });
    expect(link.status).toBe(201);
    expect(link.data.title).toBe(marker);

    // Restrict finance, then bob joins as a plain member.
    const restricted = await request(`/workspaces/${ws}/modules/finance/restrict`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { restricted: true }
    });
    expect(restricted.status).toBe(200);

    const invite = await request<{ acceptUrl: string }>(`/workspaces/${ws}/invites`, {
      method: "POST",
      token: alice.accessToken,
      body: { email: `${emailPrefix}-s01-bob@example.test` }
    });
    expect(invite.status).toBe(201);
    const inviteToken = new URL(invite.data.acceptUrl).searchParams.get("token")!;
    const accepted = await request(`/invites/${inviteToken}/accept`, { method: "POST", token: bob.accessToken });
    expect(accepted.status).toBe(201);

    // Direct endpoint: 403 for the restricted member.
    const directBlocked = await request(`/workspaces/${ws}/finance/accounts`, { method: "GET", token: bob.accessToken });
    expect(directBlocked.status).toBe(403);

    // Search must not surface the transaction nor leak the marker text anywhere
    // in the serialized payload (title/subtitle/matchedText of *other* hits).
    const searchAsBob = await request<Array<{ id: string; type: string }>>(
      `/workspaces/${ws}/search?q=${encodeURIComponent(marker)}`,
      { method: "GET", token: bob.accessToken }
    );
    expect(searchAsBob.status).toBe(200);
    expect(searchAsBob.data.some((hit) => hit.id === transactionId)).toBe(false);
    expect(JSON.stringify(searchAsBob.data)).not.toContain(marker);

    // Project rollup/activity: no financial contribution and no transaction activity item.
    const projectAsBob = await request<{
      spentAmount: number;
      activity: Array<{ type: string; title: string }>;
    }>(`/workspaces/${ws}/projects/${project.data.id}`, { method: "GET", token: bob.accessToken });
    expect(projectAsBob.status).toBe(200);
    expect(projectAsBob.data.spentAmount).toBe(0);
    expect(projectAsBob.data.activity.some((item) => item.type === "transaction")).toBe(false);
    expect(JSON.stringify(projectAsBob.data)).not.toContain(marker);

    // Links: the transaction side of T→F must not appear, and its title must
    // never have been read — not "linked without a title", just absent.
    const linksAsBob = await request<{ items: Array<{ id: string; title: string }> }>(
      `/workspaces/${ws}/links?type=task&id=${taskId}`,
      { method: "GET", token: bob.accessToken }
    );
    expect(linksAsBob.status).toBe(200);
    expect(linksAsBob.data.items.some((row) => row.id === link.data.id)).toBe(false);
    expect(JSON.stringify(linksAsBob.data)).not.toContain(marker);

    // Creating a new link into the restricted module is refused, not silently accepted.
    const otherTask = await request<{ id: string }>(`/workspaces/${ws}/tasks`, {
      method: "POST",
      token: bob.accessToken,
      body: { title: "Bob's task" }
    });
    expect(otherTask.status).toBe(201);
    const blockedCreate = await request(`/workspaces/${ws}/links`, {
      method: "POST",
      token: bob.accessToken,
      body: { sourceType: "task", sourceId: otherTask.data.id, targetType: "transaction", targetId: transactionId }
    });
    expect(blockedCreate.status).toBe(403);
    const linkCountAfter = await prisma.asSystem((tx) =>
      tx.entityLink.count({ where: { workspaceId: ws, sourceType: "task", sourceId: otherTask.data.id } })
    );
    expect(linkCountAfter).toBe(0);

    // Alice (owner) keeps full access through every one of the same paths.
    const searchAsAlice = await request<Array<{ id: string }>>(
      `/workspaces/${ws}/search?q=${encodeURIComponent(marker)}`,
      { method: "GET", token: alice.accessToken }
    );
    expect(searchAsAlice.data.some((hit) => hit.id === transactionId)).toBe(true);

    const projectAsAlice = await request<{ spentAmount: number }>(`/workspaces/${ws}/projects/${project.data.id}`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(projectAsAlice.data.spentAmount).toBe(123_456);

    const linksAsAlice = await request<{ items: Array<{ id: string; title: string }> }>(
      `/workspaces/${ws}/links?type=task&id=${taskId}`,
      { method: "GET", token: alice.accessToken }
    );
    expect(linksAsAlice.data.items.some((row) => row.id === link.data.id && row.title === marker)).toBe(true);

    // Now fully disable finance instead of merely restricting it: direct
    // endpoint is 409 for everyone (including the owner), and the aggregates
    // still don't read finance at all.
    const disabled = await request(`/workspaces/${ws}/modules/finance`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { enabled: false, confirm: true }
    });
    expect(disabled.status).toBe(200);

    const directDisabledOwner = await request(`/workspaces/${ws}/finance/accounts`, { method: "GET", token: alice.accessToken });
    expect(directDisabledOwner.status).toBe(409);
    const directDisabledMember = await request(`/workspaces/${ws}/finance/accounts`, { method: "GET", token: bob.accessToken });
    expect(directDisabledMember.status).toBe(409);

    const projectDisabledOwner = await request<{ spentAmount: number }>(`/workspaces/${ws}/projects/${project.data.id}`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(projectDisabledOwner.data.spentAmount).toBe(0);

    const linksDisabledOwner = await request<{ items: Array<{ id: string }> }>(
      `/workspaces/${ws}/links?type=task&id=${taskId}`,
      { method: "GET", token: alice.accessToken }
    );
    expect(linksDisabledOwner.data.items.some((row) => row.id === link.data.id)).toBe(false);
  });

  it("restricted-module-aggregate-access (documents): NoteAttachmentsService.list checks documents access, not just attach/upload", async () => {
    // The 15-FIRST-TASKS.md callout: attach/upload already gated on the
    // "documents" module, but `list` didn't — a disabled documents module
    // still returned every attachment (name, size, mimeType) through the note.
    const alice = await register("s01-doc-alice");
    const marker = "restricted-doc-probe.csv";

    const note = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/notes`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "S01 doc fixture", body: "текст" }
    });
    expect(note.status).toBe(201);

    const upload = await uploadAttachment(alice.workspaceId, note.data.id, alice.accessToken, marker, "a,b\n1,2\n");
    expect(upload.status).toBe(201);

    // Baseline: with documents enabled, the attachment is visible.
    const before = await request<Array<{ name: string }>>(`/workspaces/${alice.workspaceId}/notes/${note.data.id}/attachments`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(before.status).toBe(200);
    expect(before.data.some((item) => item.name === marker)).toBe(true);

    const disabled = await request(`/workspaces/${alice.workspaceId}/modules/documents`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { enabled: false, confirm: true }
    });
    expect(disabled.status).toBe(200);

    const afterDisable = await request(`/workspaces/${alice.workspaceId}/notes/${note.data.id}/attachments`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(afterDisable.status).toBe(409);
  });

  it("invites a member, gates assignment and role-management by role and plugin state", async () => {
    const alice = await register("team-alice");
    const bob = await register("team-bob");
    const ws = alice.workspaceId;

    // Assigning is refused while the "Команда" plugin is off, even for the owner.
    const teamOffTask = await request<{ id: string }>(`/workspaces/${ws}/tasks`, {
      method: "POST",
      token: alice.accessToken,
      body: { title: "До включения плагина" }
    });
    expect(teamOffTask.status).toBe(201);
    const membersBeforePlugin = await request<Array<{ id: string; userId: string }>>(`/workspaces/${ws}/members`, {
      method: "GET",
      token: alice.accessToken
    });
    const aliceMemberId = membersBeforePlugin.data.find((m) => m.userId === alice.user.id)!.id;
    const blockedAssign = await request(`/workspaces/${ws}/tasks/${teamOffTask.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { assigneeId: aliceMemberId }
    });
    expect(blockedAssign.status).toBe(409);

    const pluginOn = await request<Array<{ id: string; enabled: boolean }>>(`/workspaces/${ws}/plugins/team`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { enabled: true }
    });
    expect(pluginOn.status).toBe(200);
    expect(pluginOn.data.find((p) => p.id === "team")?.enabled).toBe(true);

    // Self-assign works for the owner once the plugin is on.
    const selfAssign = await request<{ assigneeId: string | null }>(`/workspaces/${ws}/tasks/${teamOffTask.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { assigneeId: aliceMemberId }
    });
    expect(selfAssign.status).toBe(200);
    expect(selfAssign.data.assigneeId).toBe(aliceMemberId);

    // A cross-workspace assignee id is refused, same shape as parentId/dependencyIds.
    const foreignMemberId = (
      await request<Array<{ id: string; userId: string }>>(`/workspaces/${bob.workspaceId}/members`, {
        method: "GET",
        token: bob.accessToken
      })
    ).data[0].id;
    const foreignAssign = await request(`/workspaces/${ws}/tasks/${teamOffTask.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { assigneeId: foreignMemberId }
    });
    expect(foreignAssign.status).toBe(400);

    // Invite bob into alice's workspace; the accept link carries the raw token.
    const invite = await request<{ email: string; acceptUrl: string }>(`/workspaces/${ws}/invites`, {
      method: "POST",
      token: alice.accessToken,
      body: { email: `${emailPrefix}-team-bob@example.test` }
    });
    expect(invite.status).toBe(201);
    const token = new URL(invite.data.acceptUrl).searchParams.get("token")!;

    // A non-owner/lead can't invite.
    const bobInviteAttempt = await request(`/workspaces/${ws}/invites`, {
      method: "POST",
      token: bob.accessToken,
      body: { email: "someone-else@example.test" }
    });
    expect(bobInviteAttempt.status).toBe(403);

    const accepted = await request(`/invites/${token}/accept`, { method: "POST", token: bob.accessToken });
    expect(accepted.status).toBe(201);

    const bobWorkspaces = await request<Array<{ id: string; role: string }>>("/workspaces/me", {
      method: "GET",
      token: bob.accessToken
    });
    expect(bobWorkspaces.data.find((w) => w.id === ws)?.role).toBe("member");

    const membersAfterAccept = await request<Array<{ id: string; userId: string; role: string }>>(
      `/workspaces/${ws}/members`,
      { method: "GET", token: alice.accessToken }
    );
    const bobMember = membersAfterAccept.data.find((m) => m.userId === bob.user.id);
    expect(bobMember?.role).toBe("member");

    // A plain member can self-assign but not assign to someone else, and can't change roles.
    const bobTask = await request<{ id: string }>(`/workspaces/${ws}/tasks`, {
      method: "POST",
      token: bob.accessToken,
      body: { title: "Задача боба" }
    });
    const bobSelfAssign = await request(`/workspaces/${ws}/tasks/${bobTask.data.id}`, {
      method: "PATCH",
      token: bob.accessToken,
      body: { assigneeId: bobMember!.id }
    });
    expect(bobSelfAssign.status).toBe(200);

    const bobAssignsAlice = await request(`/workspaces/${ws}/tasks/${bobTask.data.id}`, {
      method: "PATCH",
      token: bob.accessToken,
      body: { assigneeId: aliceMemberId }
    });
    expect(bobAssignsAlice.status).toBe(403);

    const bobPromotesRole = await request(`/workspaces/${ws}/members/${bobMember!.id}`, {
      method: "PATCH",
      token: bob.accessToken,
      body: { role: "lead" }
    });
    expect(bobPromotesRole.status).toBe(403);

    // Owner promotes bob to lead — now he can assign to others and invite, still can't change roles.
    const promoted = await request<{ role: string }>(`/workspaces/${ws}/members/${bobMember!.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { role: "lead" }
    });
    expect(promoted.status).toBe(200);
    expect(promoted.data.role).toBe("lead");

    const leadAssignsAlice = await request(`/workspaces/${ws}/tasks/${bobTask.data.id}`, {
      method: "PATCH",
      token: bob.accessToken,
      body: { assigneeId: aliceMemberId }
    });
    expect(leadAssignsAlice.status).toBe(200);

    const leadInvites = await request(`/workspaces/${ws}/invites`, {
      method: "POST",
      token: bob.accessToken,
      body: { email: "another@example.test" }
    });
    expect(leadInvites.status).toBe(201);

    const leadStillCantSetRoles = await request(`/workspaces/${ws}/members/${aliceMemberId}`, {
      method: "PATCH",
      token: bob.accessToken,
      body: { role: "member" }
    });
    expect(leadStillCantSetRoles.status).toBe(403);

    // Disabling the plugin blocks new assignment but keeps the existing value visible.
    await request(`/workspaces/${ws}/plugins/team`, { method: "PATCH", token: alice.accessToken, body: { enabled: false } });
    const disabledAssign = await request(`/workspaces/${ws}/tasks/${bobTask.data.id}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { assigneeId: null }
    });
    expect(disabledAssign.status).toBe(409);
    const stillAssigned = await request<{ assigneeId: string | null }>(`/workspaces/${ws}/tasks`, {
      method: "GET",
      token: alice.accessToken
    });
    expect((stillAssigned.data as unknown as Array<{ id: string; assigneeId: string | null }>).find((t) => t.id === bobTask.data.id)?.assigneeId).toBe(aliceMemberId);

    // A member cannot remove the owner; the owner can remove bob (a lead, not the last owner).
    const bobRemovesAlice = await request(`/workspaces/${ws}/members/${aliceMemberId}`, {
      method: "DELETE",
      token: bob.accessToken
    });
    expect(bobRemovesAlice.status).toBe(403);

    const removeBob = await request(`/workspaces/${ws}/members/${bobMember!.id}`, {
      method: "DELETE",
      token: alice.accessToken
    });
    expect(removeBob.status).toBe(200);

    const membersAfterRemoval = await request<Array<{ userId: string }>>(`/workspaces/${ws}/members`, {
      method: "GET",
      token: alice.accessToken
    });
    expect(membersAfterRemoval.data.some((m) => m.userId === bob.user.id)).toBe(false);
  });

  it("allows preflight requests from the Tauri desktop origin", async () => {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://tauri.localhost",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type"
      }
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://tauri.localhost");
  });

  async function register(name: string): Promise<RegisteredSession> {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: {
        email: `${emailPrefix}-${name}@example.test`,
        password: "integration-password-123",
        name
      }
    });
    expect(response.status).toBe(201);

    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", {
      method: "GET",
      token: response.data.accessToken
    });
    expect(workspaces.status).toBe(200);
    expect(workspaces.data).toHaveLength(1);
    return { ...response.data, workspaceId: workspaces.data[0].id };
  }

  async function request<T = unknown>(
    path: string,
    options: { method: string; token?: string; body?: unknown }
  ): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    // An empty body is JSON `null` (NestJS sends no body at all when a handler
    // returns null — e.g. "no timer running"), so parse defensively instead of
    // letting `response.json()` throw. The client does the same in `safeJson`.
    const text = await response.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { status: response.status, data };
  }

  /** `multipart/form-data` upload — note attachments share the documents upload shape. */
  async function uploadAttachment(
    workspaceId: string,
    noteId: string,
    token: string,
    name: string,
    content: string
  ): Promise<{
    status: number;
    data: Array<{ id: string; noteId: string; documentId: string; name: string; mimeType: string | null; sizeBytes: number | null }>;
  }> {
    const form = new FormData();
    form.append("files", new Blob([content], { type: "text/csv" }), name);
    const response = await fetch(`${baseUrl}/workspaces/${workspaceId}/notes/${noteId}/attachments/upload`, {
      method: "POST",
      // No Content-Type: the browser/undici sets it with the multipart boundary.
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
    const data = (await response.json()) as Array<{
      id: string;
      noteId: string;
      documentId: string;
      name: string;
      mimeType: string | null;
      sizeBytes: number | null;
    }>;
    return { status: response.status, data };
  }
});
