import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { componentDataStatusSchema } from "@orion/shared-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/** G11: после `migrate deploy` все компоненты с миграциями «ok»; без входа ответа нет. */
describe("GET system/components", () => {
  let app: INestApplication;
  let baseUrl: string;
  const email = `components-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  });

  afterAll(async () => {
    // Пространство пользователя не каскадится вместе с ним: удаляем явно, иначе оно осиротеет.
    if (app) {
      await app.get(PrismaService).asSystem(async (tx) => {
        const users = await tx.user.findMany({ where: { email }, select: { id: true } });
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { workspaceId: true } });
        await tx.user.deleteMany({ where: { email } });
        await tx.workspace.deleteMany({ where: { id: { in: memberships.map((m) => m.workspaceId) } } });
      });
    }
    await app?.close();
  });

  it("требует входа и отдаёт состояние данных Pet Care", async () => {
    expect((await fetch(`${baseUrl}/system/components`)).status).toBe(401);
    const register = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "integration-password-123", name: "Проверка" })
    });
    const { accessToken } = (await register.json()) as { accessToken: string };
    const response = await fetch(`${baseUrl}/system/components`, { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(response.status).toBe(200);
    const list = componentDataStatusSchema.array().parse(await response.json());
    expect(list.find((item) => item.componentId === "pet-care")).toMatchObject({ state: "ok", pending: [], failed: [] });
  });
});
