import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * A new session fires several first requests at once (preferences, organization, …). They all create the
 * user's preference row on first use; the loser of that race used to get a unique-constraint 500.
 */
describe("Settings first use under concurrency", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const emailPrefix = `settings-first-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.asSystem(async (tx) => {
        const users = await tx.user.findMany({ where: { email: { startsWith: emailPrefix } }, select: { id: true } });
        if (users.length === 0) return;
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { workspaceId: true } });
        const workspaceIds = [...new Set(memberships.map((m) => m.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        const leftovers = await tx.workspace.count({ where: { id: { in: workspaceIds } } });
        if (leftovers > 0) throw new Error(`Cleanup left ${leftovers} test workspace(s) behind`);
      });
    }
    await app?.close();
  });

  it("answers every concurrent first request with 200 and one preference row", async () => {
    for (let round = 0; round < 6; round += 1) {
      const registered = await fetch(`${baseUrl}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: `${emailPrefix}-${round}@example.test`, password: "integration-password-123", name: `First use ${round}` })
      });
      expect(registered.status).toBe(201);
      const { accessToken, user } = (await registered.json()) as { accessToken: string; user: { id: string } };
      const headers = { Authorization: `Bearer ${accessToken}` };
      const paths = Array.from({ length: 24 }, (_, i) => (i % 2 === 0 ? "/settings/preferences" : "/settings/organization"));
      const responses = await Promise.all(paths.map((path) => fetch(`${baseUrl}${path}`, { headers })));
      expect(responses.map((r) => r.status)).toEqual(paths.map(() => 200));
      const rows = await prisma.asSystem((tx) => tx.userPreference.count({ where: { userId: user.id } }));
      expect(rows).toBe(1);
    }
  });
});
