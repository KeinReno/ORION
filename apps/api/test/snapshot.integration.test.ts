import { Prisma } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";
import { SnapshotService, SNAPSHOT_VERSION, toposortByParent } from "../src/sync/snapshot.service";
import type { WorkspaceSnapshot } from "../src/sync/snapshot.service";
import { SNAPSHOT_MODEL_REGISTRY } from "../src/sync/snapshot-registry";

/**
 * S03 (10-BACKLOG.md) — snapshot coverage + safe restore preflight.
 *
 * Three invariants, each with its own test:
 *  - S03a: every workspace-scoped Prisma model is explicitly classified in
 *    `snapshot-registry.ts` (derived from Prisma DMMF at test time, not from
 *    a hand-maintained list here — a model can be added to `schema.prisma`
 *    without anyone remembering to update this test).
 *  - S03c: an old/legacy-shaped snapshot is rejected before any row is
 *    touched (fail-closed), not silently applied as a partial restore.
 *  - S03d: a data-only roundtrip (backup -> restore) preserves counts and a
 *    self-referencing tree's structure, even when the snapshot file's row
 *    order doesn't match insertion order (so the test can't pass by
 *    accident on a findMany order that happens to already be a topological
 *    sort).
 */

describe("snapshot coverage and restore preflight (S03)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let snapshots: SnapshotService;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `snapshot-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = app.get(PrismaService);
    snapshots = app.get(SnapshotService);
  });

  afterAll(async () => {
    if (prisma) {
      // Same two-step cleanup as api-rls.integration.test.ts: user.deleteMany
      // alone leaves the workspace (and everything cascaded under it) behind.
      await prisma.asSystem(async (tx) => {
        const users = await tx.user.findMany({
          where: { email: { startsWith: emailPrefix } },
          select: { id: true }
        });
        if (users.length === 0) return;
        const userIds = users.map((u) => u.id);
        const memberships = await tx.workspaceMember.findMany({
          where: { userId: { in: userIds } },
          select: { workspaceId: true }
        });
        const workspaceIds = [...new Set(memberships.map((m) => m.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        const leftovers = await tx.workspace.count({ where: { id: { in: workspaceIds } } });
        if (leftovers > 0) throw new Error(`Cleanup left ${leftovers} test workspace(s) behind`);
      });
    }
    await app?.close();
  });

  it("S03a: every workspace-scoped Prisma model is explicitly classified in snapshot-registry.ts", () => {
    // Derived from the real running schema (Prisma DMMF), not typed by hand —
    // this is the whole point: a new `model X { workspaceId ... }` in
    // schema.prisma shows up here automatically and fails the test if nobody
    // classified it.
    const dmmfModels = Prisma.dmmf.datamodel.models;
    const workspaceScoped = dmmfModels.filter((m) => m.fields.some((f) => f.name === "workspaceId"));
    // `Workspace` itself has no `workspaceId` field (it IS the workspace) but
    // still needs a classification decision (it's the `derived` entry).
    const mustBeClassified = new Set([...workspaceScoped.map((m) => m.name), "Workspace"]);

    const classified = new Set(SNAPSHOT_MODEL_REGISTRY.map((c) => c.model));
    const unclassified = [...mustBeClassified].filter((name) => !classified.has(name));
    expect(unclassified, `unclassified models: ${unclassified.join(", ")}`).toEqual([]);

    // The reverse direction too: no stale entry for a model that no longer
    // exists (schema.prisma is the source of truth, not this file).
    const dmmfNames = new Set(dmmfModels.map((m) => m.name));
    const stale = SNAPSHOT_MODEL_REGISTRY.map((c) => c.model).filter((name) => !dmmfNames.has(name));
    expect(stale, `stale registry entries: ${stale.join(", ")}`).toEqual([]);

    // Every `included` entry must carry a non-null snapshotKey, every
    // excluded/derived entry must not (a key implies "this is copied
    // row-for-row", which is only true for `included`).
    for (const c of SNAPSHOT_MODEL_REGISTRY) {
      if (c.policy === "included") {
        expect(c.snapshotKey, `included model ${c.model} needs a snapshotKey`).not.toBeNull();
      } else if (c.policy !== "derived") {
        expect(c.snapshotKey, `excluded model ${c.model} must not have a snapshotKey`).toBeNull();
      }
    }
  });

  it("S03a regression: an unclassified model would be caught (simulated by removing an entry)", () => {
    // Proves the test above is not a tautology: drop one real included entry
    // and confirm the same assertion shape would fail.
    const withoutMilestone = SNAPSHOT_MODEL_REGISTRY.filter((c) => c.model !== "Milestone");
    const dmmfModels = Prisma.dmmf.datamodel.models;
    const workspaceScoped = dmmfModels.filter((m) => m.fields.some((f) => f.name === "workspaceId"));
    const mustBeClassified = new Set([...workspaceScoped.map((m) => m.name), "Workspace"]);
    const classified = new Set(withoutMilestone.map((c) => c.model));
    const unclassified = [...mustBeClassified].filter((name) => !classified.has(name));
    expect(unclassified).toEqual(["Milestone"]);
  });

  it("S03c: legacy v1 snapshot (no milestones/inventory/workspaceConfig) is rejected fail-closed, no row touched", async () => {
    const alice = await register("legacy");
    const { workspaceId, userId, token } = alice;

    await createSampleData(prisma, userId, workspaceId);

    const before = await prisma.withUser(userId, (tx) => snapshots.counts(tx, workspaceId));
    expect(before.tasks).toBeGreaterThan(0);

    const legacy = { version: 1, workspaceId, generatedAt: new Date().toISOString(), tables: {} } as unknown as WorkspaceSnapshot;

    await expect(
      prisma.withUser(userId, (tx) => snapshots.apply(tx, legacy))
    ).rejects.toThrow(/устаревшем формате v1/);

    const after = await prisma.withUser(userId, (tx) => snapshots.counts(tx, workspaceId));
    expect(after).toEqual(before);
    void token;
  });

  it("S03c: unknown future version is rejected the same way", async () => {
    const alice = await register("future");
    const { workspaceId, userId } = alice;
    await createSampleData(prisma, userId, workspaceId);
    const before = await prisma.withUser(userId, (tx) => snapshots.counts(tx, workspaceId));

    const future = { version: 99, workspaceId, generatedAt: new Date().toISOString(), tables: {}, workspaceConfig: { disabledModules: [], pluginOverrides: [], restrictedModules: [] } } as unknown as WorkspaceSnapshot;
    await expect(prisma.withUser(userId, (tx) => snapshots.apply(tx, future))).rejects.toThrow(/99/);

    const after = await prisma.withUser(userId, (tx) => snapshots.counts(tx, workspaceId));
    expect(after).toEqual(before);
  });

  it("S03d: toposortByParent orders a depth-3 tree parent-before-child regardless of input shuffle", () => {
    const rows = [
      { id: "grandchild", parentId: "child" },
      { id: "root", parentId: null },
      { id: "great-grandchild", parentId: "grandchild" },
      { id: "child", parentId: "root" }
    ];
    const sorted = toposortByParent(rows);
    const indexOf = (id: string) => sorted.findIndex((r) => r.id === id);
    expect(indexOf("root")).toBeLessThan(indexOf("child"));
    expect(indexOf("child")).toBeLessThan(indexOf("grandchild"));
    expect(indexOf("grandchild")).toBeLessThan(indexOf("great-grandchild"));
  });

  it("S03d: data-only roundtrip preserves a shuffled depth-3 task tree and full counts", async () => {
    const alice = await register("roundtrip");
    const { workspaceId, userId } = alice;

    const projectId = await prisma.withUser(userId, async (tx) => {
      const p = await tx.project.create({ data: { workspaceId, name: "S03 roundtrip project" } });
      return p.id;
    });

    // Depth-3 self-referencing task tree.
    const { rootId, childId, grandchildId, greatGrandchildId } = await prisma.withUser(userId, async (tx) => {
      const root = await tx.task.create({ data: { workspaceId, projectId, title: "root" } });
      const child = await tx.task.create({ data: { workspaceId, projectId, title: "child", parentId: root.id } });
      const grandchild = await tx.task.create({
        data: { workspaceId, projectId, title: "grandchild", parentId: child.id }
      });
      const greatGrandchild = await tx.task.create({
        data: { workspaceId, projectId, title: "great-grandchild", parentId: grandchild.id }
      });
      return {
        rootId: root.id,
        childId: child.id,
        grandchildId: grandchild.id,
        greatGrandchildId: greatGrandchild.id
      };
    });

    // Milestone + inventory + document tree — the models S03a found missing.
    await prisma.withUser(userId, async (tx) => {
      const milestone = await tx.milestone.create({ data: { workspaceId, projectId, title: "S03 milestone" } });
      await tx.task.update({ where: { id: rootId }, data: { milestoneId: milestone.id } });
      const item = await tx.inventoryItem.create({ data: { workspaceId, name: "S03 item" } });
      await tx.inventoryMovement.create({ data: { workspaceId, itemId: item.id, type: "receipt", quantity: 5 } });
      const folder = await tx.document.create({ data: { workspaceId, projectId, kind: "folder", name: "S03 folder" } });
      const file = await tx.document.create({
        data: { workspaceId, projectId, kind: "file", name: "s03.txt", parentId: folder.id }
      });
      await tx.documentVersion.create({
        data: { workspaceId, documentId: file.id, versionNumber: 1, storageKey: "s03/v1", sizeBytes: 3, checksum: "abc" }
      });
      await tx.documentAnnotation.create({ data: { workspaceId, documentId: file.id, body: "note" } });
    });

    const before = await prisma.withUser(userId, (tx) => snapshots.counts(tx, workspaceId));

    const snapshot = await prisma.withUser(userId, (tx) => snapshots.serialize(tx, workspaceId));
    expect(snapshot.version).toBe(SNAPSHOT_VERSION);

    // Shuffle every table's row order in the snapshot file itself so the
    // roundtrip can't pass by accident because `findMany` happened to
    // return parent-before-child already.
    for (const key of Object.keys(snapshot.tables)) {
      snapshot.tables[key] = shuffle(snapshot.tables[key]);
    }
    // documents: same adversarial reversal as tasks below — file (child)
    // before folder (parent).
    const docById = new Map(
      (snapshot.tables.documents as Array<{ id: string; name: string }>).map((r) => [r.name, r])
    );
    snapshot.tables.documents = [docById.get("s03.txt"), docById.get("S03 folder")];
    // Sanity: the task array really is shuffled out of parent-before-child
    // order for at least one run (seed a fixed adversarial order instead of
    // trusting Math.random not to coincidentally sort it).
    // Adversarial: explicitly reverse the dependency order so the
    // great-grandchild (deepest leaf) comes first and the root comes last —
    // the exact opposite of what a topological insert needs. If
    // `specSelfRef`/`toposortByParent` weren't doing real work, this ordering
    // would make `apply()` fail on the FK the moment the child row is
    // inserted before its not-yet-existing parent.
    const taskByTitle = new Map(
      (snapshot.tables.tasks as Array<{ id: string; title: string }>).map((r) => [r.title, r])
    );
    snapshot.tables.tasks = [
      taskByTitle.get("great-grandchild"),
      taskByTitle.get("grandchild"),
      taskByTitle.get("child"),
      taskByTitle.get("root")
    ];
    expect((snapshot.tables.tasks[0] as { title: string }).title).toBe("great-grandchild");
    expect((snapshot.tables.tasks[snapshot.tables.tasks.length - 1] as { title: string }).title).toBe("root");

    await prisma.withUser(userId, (tx) => snapshots.apply(tx, snapshot));

    const after = await prisma.withUser(userId, (tx) => snapshots.counts(tx, workspaceId));
    expect(after).toEqual(before);

    const restoredTasks = await prisma.withUser(userId, (tx) =>
      tx.task.findMany({ where: { workspaceId }, select: { id: true, parentId: true, title: true } })
    );
    const byId = new Map(restoredTasks.map((t) => [t.id, t]));
    expect(byId.get(childId)?.parentId).toBe(rootId);
    expect(byId.get(grandchildId)?.parentId).toBe(childId);
    expect(byId.get(greatGrandchildId)?.parentId).toBe(grandchildId);

    const restoredDocs = await prisma.withUser(userId, (tx) =>
      tx.document.findMany({ where: { workspaceId }, select: { id: true, parentId: true, name: true } })
    );
    const fileDoc = restoredDocs.find((d) => d.name === "s03.txt");
    const folderDoc = restoredDocs.find((d) => d.name === "S03 folder");
    expect(fileDoc?.parentId).toBe(folderDoc?.id);

    const restoredVersions = await prisma.withUser(userId, (tx) =>
      tx.documentVersion.findMany({ where: { workspaceId } })
    );
    expect(restoredVersions).toHaveLength(1);
    const restoredAnnotations = await prisma.withUser(userId, (tx) =>
      tx.documentAnnotation.findMany({ where: { workspaceId } })
    );
    expect(restoredAnnotations).toHaveLength(1);
    const restoredMilestones = await prisma.withUser(userId, (tx) =>
      tx.milestone.findMany({ where: { workspaceId } })
    );
    expect(restoredMilestones).toHaveLength(1);
    const restoredInventory = await prisma.withUser(userId, (tx) =>
      tx.inventoryItem.findMany({ where: { workspaceId } })
    );
    expect(restoredInventory).toHaveLength(1);
    const restoredMovements = await prisma.withUser(userId, (tx) =>
      tx.inventoryMovement.findMany({ where: { workspaceId } })
    );
    expect(restoredMovements).toHaveLength(1);
  });

  it("S03d: workspaceConfig (disabledModules/restrictedModules) roundtrips through backup/restore", async () => {
    const alice = await register("config");
    const { workspaceId, userId } = alice;

    await prisma.withUser(userId, (tx) =>
      tx.workspace.update({
        where: { id: workspaceId },
        data: { disabledModules: ["finance"], restrictedModules: ["documents"] }
      })
    );

    const snapshot = await prisma.withUser(userId, (tx) => snapshots.serialize(tx, workspaceId));
    expect(snapshot.workspaceConfig.disabledModules).toEqual(["finance"]);
    expect(snapshot.workspaceConfig.restrictedModules).toEqual(["documents"]);

    // Simulate the config drifting after the backup was taken, then restore.
    await prisma.withUser(userId, (tx) =>
      tx.workspace.update({
        where: { id: workspaceId },
        data: { disabledModules: [], restrictedModules: [] }
      })
    );

    await prisma.withUser(userId, (tx) => snapshots.apply(tx, snapshot));

    const restored = await prisma.withUser(userId, (tx) =>
      tx.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { disabledModules: true, restrictedModules: true }
      })
    );
    expect(restored.disabledModules).toEqual(["finance"]);
    expect(restored.restrictedModules).toEqual(["documents"]);
  });

  // --- helpers --------------------------------------------------------------

  async function register(name: string): Promise<{ workspaceId: string; userId: string; token: string }> {
    const email = `${emailPrefix}-${name}@example.test`;
    const response = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "integration-password-123", name })
    });
    expect(response.status).toBe(201);
    const data = (await response.json()) as { accessToken: string; user: { id: string } };

    const workspacesResponse = await fetch(`${baseUrl}/workspaces/me`, {
      headers: { Authorization: `Bearer ${data.accessToken}` }
    });
    const workspaces = (await workspacesResponse.json()) as Array<{ id: string }>;
    expect(workspaces).toHaveLength(1);
    return { workspaceId: workspaces[0].id, userId: data.user.id, token: data.accessToken };
  }
});

async function createSampleData(prisma: PrismaService, userId: string, workspaceId: string): Promise<void> {
  await prisma.withUser(userId, async (tx) => {
    const project = await tx.project.create({ data: { workspaceId, name: "sample" } });
    await tx.task.create({ data: { workspaceId, projectId: project.id, title: "sample task" } });
  });
}

function shuffle<T>(rows: T[]): T[] {
  const copy = [...rows];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
