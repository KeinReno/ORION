import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/configure-app";
import { PrismaService } from "../src/common/prisma.service";
import { consumeImportConsentTx, issueImportConsentTx, hashImportConsentToken } from "../src/development/catalog-import-consent";

describe("development import consent on PostgreSQL", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;
  const workspaceId = randomUUID();
  const users = { owner: randomUUID(), lead: randomUUID(), member: randomUUID(), outsider: randomUUID() };
  const originalRoot = process.env.ORION_DEV_CATALOG_ROOT;
  const scope = (userId = users.owner) => ({ userId, workspaceId, catalogId: "orion-dev",
    catalogSha256: "a".repeat(64), previewDigest: "b".repeat(64), selectionHash: "c".repeat(64) });
  const issue = (userId = users.owner, now?: Date) => prisma.withUser(userId, tx => issueImportConsentTx(tx, scope(userId), now));

  beforeAll(async () => {
    process.env.ORION_DEV_CATALOG_ROOT = resolve(".");
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    prisma = app.get(PrismaService);
    await prisma.asSystem(async tx => {
      for (const [name, id] of Object.entries(users)) {
        await tx.user.create({ data: { id, name: `consent-fixture-${name}`, passwordHash: "test-only" } });
      }
      await tx.workspace.create({ data: { id: workspaceId, name: "Orion Dev consent fixture" } });
      for (const role of ["owner", "lead", "member"] as const) {
        await tx.workspaceMember.create({ data: { workspaceId, userId: users[role], role } });
      }
    });
  });
  afterAll(async () => {
    if (originalRoot === undefined) delete process.env.ORION_DEV_CATALOG_ROOT;
    else process.env.ORION_DEV_CATALOG_ROOT = originalRoot;
    if (prisma) await prisma.asSystem(async tx => {
      await tx.workspace.deleteMany({ where: { id: workspaceId } });
      await tx.user.deleteMany({ where: { id: { in: Object.values(users) } } });
    });
    await app?.close();
  });

  it("uses non-bypass application role and forced RLS", async () => {
    const roles = await prisma.$queryRaw<{ rolbypassrls: boolean; rolsuper: boolean }[]>`
      SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`;
    expect(roles).toEqual([{ rolbypassrls: false, rolsuper: false }]);
    const tables = await prisma.$queryRaw<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'development_import_consents'`;
    expect(tables).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  });

  it("stores only a hash; owner and lead cannot read or consume each other's consent", async () => {
    const owner = await issue();
    const lead = await issue(users.lead);
    const ownerRows = await prisma.withUser(users.owner, tx => tx.developmentImportConsent.findMany({ where: { workspaceId } }));
    expect(ownerRows.every(row => row.userId === users.owner)).toBe(true);
    expect(ownerRows.some(row => row.tokenHash === hashImportConsentToken(owner.token))).toBe(true);
    expect(JSON.stringify(ownerRows)).not.toContain(owner.token);
    await expect(prisma.withUser(users.lead, tx => consumeImportConsentTx(tx, scope(users.lead), owner.token))).rejects.toThrow();
    await prisma.withUser(users.lead, tx => consumeImportConsentTx(tx, scope(users.lead), lead.token));
  });

  it.each(["member", "outsider"] as const)("denies %s reads, issue and consumption", async role => {
    const consent = await issue();
    expect(await prisma.withUser(users[role], tx => tx.developmentImportConsent.findMany({ where: { workspaceId } }))).toEqual([]);
    await expect(issue(users[role])).rejects.toThrow();
    await expect(prisma.withUser(users[role], tx => consumeImportConsentTx(tx, scope(), consent.token))).rejects.toThrow();
    expect(await prisma.$queryRaw`SELECT id FROM development_import_consents WHERE "workspaceId" = ${workspaceId}`).toEqual([]);
  });

  it("consumes exactly once under concurrent requests and rejects replay", async () => {
    const issued = await issue();
    const consume = () => prisma.withUser(users.owner, tx => consumeImportConsentTx(tx, scope(), issued.token));
    const results = await Promise.allSettled([consume(), consume()]);
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(row => row.status === "rejected")).toHaveLength(1);
    await expect(consume()).rejects.toThrow(/expired, used or mismatched/);
  });

  it("rejects expired and wrong-scope tokens", async () => {
    const expired = await issue(users.owner, new Date(Date.now() - 360_000));
    await expect(prisma.withUser(users.owner, tx => consumeImportConsentTx(tx, scope(), expired.token))).rejects.toThrow();
    const fresh = await issue();
    for (const change of [{ selectionHash: "d".repeat(64) }, { previewDigest: "d".repeat(64) },
      { catalogSha256: "d".repeat(64) }, { workspaceId: randomUUID() }]) {
      await expect(prisma.withUser(users.owner, tx => consumeImportConsentTx(tx, { ...scope(), ...change }, fresh.token))).rejects.toThrow();
    }
    await prisma.withUser(users.owner, tx => consumeImportConsentTx(tx, scope(), fresh.token));
  });

  it("rolls back token consumption and entity changes together", async () => {
    const issued = await issue();
    const id = randomUUID();
    await expect(prisma.withUser(users.owner, async tx => {
      await consumeImportConsentTx(tx, scope(), issued.token);
      await tx.project.create({ data: { id, workspaceId, name: "Rollback fixture" } });
      throw new Error("forced import failure");
    })).rejects.toThrow(/forced import failure/);
    expect(await prisma.withUser(users.owner, tx => tx.project.findUnique({ where: { id } }))).toBeNull();
    await prisma.withUser(users.owner, tx => consumeImportConsentTx(tx, scope(), issued.token));
  });

  it("keeps data and refuses preview when Projects is disabled", async () => {
    const token = app.get(JwtService).sign({ sub: users.owner });
    await prisma.asSystem(tx => tx.workspace.update({ where: { id: workspaceId }, data: { disabledModules: ["projects"] } }));
    try {
      const response = await fetch(`${base}/workspaces/${workspaceId}/development-import/preview`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      expect(response.status).toBe(409);
      expect(await prisma.withUser(users.owner, tx => tx.workspace.count({ where: { id: workspaceId } }))).toBe(1);
    } finally {
      await prisma.asSystem(tx => tx.workspace.update({ where: { id: workspaceId }, data: { disabledModules: [] } }));
    }
  });

  it("enforces HTTP auth, fresh preview and role revocation", async () => {
    const url = `${base}/workspaces/${workspaceId}/development-import`;
    const headers = (userId: string) => ({ "Content-Type": "application/json",
      Authorization: `Bearer ${app.get(JwtService).sign({ sub: userId })}` });
    expect((await fetch(`${url}/preview`)).status).toBe(401);
    expect((await fetch(`${url}/preview`, { headers: headers(users.member) })).status).toBe(403);
    expect((await fetch(`${url}/preview`, { headers: headers(users.outsider) })).status).toBe(403);
    const response = await fetch(`${url}/preview`, { headers: headers(users.owner) });
    expect(response.status).toBe(200);
    const preview = await response.json() as { previewDigest: string };
    const body = JSON.stringify({ workspaceConfirmed: true, previewDigest: preview.previewDigest, choices: {} });
    const consent = await fetch(`${url}/consent`, { method: "POST", headers: headers(users.owner), body });
    expect(consent.status).toBe(201);
    await prisma.asSystem(tx => tx.workspace.update({ where: { id: workspaceId }, data: { name: "Changed after preview" } }));
    expect((await fetch(`${url}/consent`, { method: "POST", headers: headers(users.owner), body })).status).toBe(409);
    const issued = await issue(users.lead);
    await prisma.asSystem(tx => tx.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: users.lead } }, data: { role: "member" }
    }));
    await expect(prisma.withUser(users.lead, tx => consumeImportConsentTx(tx, scope(users.lead), issued.token))).rejects.toThrow();
  });
});
