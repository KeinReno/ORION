import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/configure-app";
import { PrismaService } from "../src/common/prisma.service";
import { TaskOperations } from "../src/tasks/public/task-operations";
import { developmentPreviewSchema, developmentConsentSchema, developmentResultSchema } from "@orion/shared-types";

describe("reviewed development import HTTP transaction", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;
  let workspaceId: string;
  const owner = randomUUID();
  const lead = randomUUID();
  const workspaces: string[] = [];
  const originalRoot = process.env.ORION_DEV_CATALOG_ROOT;
  const headers = (userId = owner) => ({ "Content-Type": "application/json",
    Authorization: `Bearer ${app.get(JwtService).sign({ sub: userId })}` });
  const request = (path: string, body?: object, userId = owner) => fetch(
    `${base}/workspaces/${workspaceId}/development-import/${path}`,
    { headers: headers(userId), ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) }
  );
  const review = async () => {
    const previewResponse = await request("preview");
    expect(previewResponse.status).toBe(200);
    const preview = developmentPreviewSchema.parse(await previewResponse.json());
    const body = { workspaceConfirmed: true, previewDigest: preview.previewDigest, choices: {} };
    const consentResponse = await request("consent", body);
    expect(consentResponse.status).toBe(201);
    const consent = developmentConsentSchema.parse(await consentResponse.json());
    return { ...body, token: consent.token };
  };
  const counts = () => prisma.withUser(owner, async tx => ({
    projects: await tx.project.count({ where: { workspaceId } }),
    tasks: await tx.task.count({ where: { workspaceId } }),
    mappings: await tx.developmentCatalogMapping.count({ where: { workspaceId } })
  }));

  beforeAll(async () => {
    process.env.ORION_DEV_CATALOG_ROOT = resolve(".");
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    prisma = app.get(PrismaService);
    await prisma.asSystem(async tx => {
      for (const id of [owner, lead]) await tx.user.create({ data: { id, name: "development-apply-fixture", passwordHash: "test-only" } });
    });
  });
  beforeEach(async () => {
    workspaceId = randomUUID();
    workspaces.push(workspaceId);
    await prisma.asSystem(async tx => {
      await tx.workspace.create({ data: { id: workspaceId, name: "Orion Dev import fixture" } });
      await tx.workspaceMember.createMany({ data: [
        { workspaceId, userId: owner, role: "owner" }, { workspaceId, userId: lead, role: "lead" }
      ] });
      await tx.project.create({ data: { workspaceId, name: "ORION", description: "Keep my project" } });
    });
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (originalRoot === undefined) delete process.env.ORION_DEV_CATALOG_ROOT;
    else process.env.ORION_DEV_CATALOG_ROOT = originalRoot;
    if (prisma) await prisma.asSystem(async tx => {
      await tx.workspace.deleteMany({ where: { id: { in: workspaces } } });
      await tx.user.deleteMany({ where: { id: { in: [owner, lead] } } });
    });
    await app?.close();
  });

  it("imports, preserves ORION, persists acceptance criteria and repeats without duplicates", async () => {
    const body = await review();
    const response = await request("apply", body);
    expect(response.status).toBe(201);
    const result = developmentResultSchema.parse(await response.json());
    expect(result.projects).toHaveLength(13);
    expect(result.tasks).toHaveLength(16);
    expect(await counts()).toEqual({ projects: 14, tasks: 16, mappings: 29 });
    await prisma.withUser(owner, async tx => {
      expect(await tx.project.findFirst({ where: { workspaceId, name: "ORION" } })).toMatchObject({ description: "Keep my project" });
      expect(await tx.task.findFirst({ where: { workspaceId, title: "Make CI reproducible and green" } }))
        .toMatchObject({ description: expect.stringContaining("Failures are surfaced rather than bypassed") });
    });
    expect((await request("apply", body)).status).toBe(409);
    const repeated = await request("apply", await review());
    expect(repeated.status).toBe(201);
    expect(developmentResultSchema.parse(await repeated.json()).tasks.every(row => row.outcome === "already_mapped")).toBe(true);
    expect(await counts()).toEqual({ projects: 14, tasks: 16, mappings: 29 });
  });

  it("requires an explicit workspace acknowledgement and actor-bound token", async () => {
    const body = await review();
    expect((await request("apply", { ...body, workspaceConfirmed: false })).status).toBe(409);
    expect((await request("apply", body, lead)).status).toBe(409);
    expect(await counts()).toEqual({ projects: 1, tasks: 0, mappings: 0 });
    expect((await request("apply", body)).status).toBe(201);
  });

  it("serializes simultaneous requests with exactly one successful import", async () => {
    const body = await review();
    const results = await Promise.all([request("apply", body), request("apply", body)]);
    expect(results.map(row => row.status).sort()).toEqual([201, 409]);
    expect(await counts()).toEqual({ projects: 14, tasks: 16, mappings: 29 });
  });

  it.each(["description", "project description", "dependencies", "modules", "development module", "role", "expiry"] as const)("refuses changed %s after consent", async change => {
    const taskIds = [randomUUID(), randomUUID()];
    await prisma.withUser(owner, tx => tx.task.createMany({ data: taskIds.map(id => ({ id, workspaceId, title: id })) }));
    const body = await review();
    await prisma.asSystem(async tx => {
      if (change === "description") await tx.task.update({ where: { id: taskIds[0] }, data: { description: "Edited after review" } });
      if (change === "project description") await tx.project.updateMany({ where: { workspaceId }, data: { description: "Edited after review" } });
      if (change === "dependencies") await tx.taskDependency.create({ data: { workspaceId, taskId: taskIds[0]!, dependsOnTaskId: taskIds[1]! } });
      if (change === "modules") await tx.workspace.update({ where: { id: workspaceId }, data: { disabledModules: ["tasks"] } });
      if (change === "development module") await tx.workspace.update({ where: { id: workspaceId }, data: { disabledModules: ["orion-dev"] } });
      if (change === "role") await tx.workspaceMember.update({ where: { workspaceId_userId: { workspaceId, userId: owner } }, data: { role: "member" } });
      if (change === "expiry") await tx.developmentImportConsent.updateMany({ where: { workspaceId }, data: { expiresAt: new Date(0) } });
    });
    expect((await request("apply", body)).status).toBe(change === "role" ? 403 : 409);
    expect(await counts()).toEqual({ projects: 1, tasks: 2, mappings: 0 });
  });

  it("rolls back projects, tasks, mappings and consent when canonical task creation fails", async () => {
    const body = await review();
    const operations = app.get(TaskOperations);
    const original = operations.createTx.bind(operations);
    let calls = 0;
    const spy = vi.spyOn(operations, "createTx").mockImplementation(async (...args) => {
      if (++calls === 2) throw new Error("Injected second task failure");
      return original(...args);
    });
    try {
      expect((await request("apply", body)).status).toBe(500);
      expect(await counts()).toEqual({ projects: 1, tasks: 0, mappings: 0 });
      expect(await prisma.withUser(owner, tx => tx.developmentImportConsent.findMany({ where: { workspaceId } })))
        .toEqual([expect.objectContaining({ consumedAt: null })]);
    } finally { spy.mockRestore(); }
    expect((await request("apply", body)).status).toBe(201);
  });
});
