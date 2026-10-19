import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../src/app.module";
import { PrismaService } from "../../../src/common/prisma.service";
import { configureApp } from "../../../src/configure-app";

/**
 * G13: модуль объявляет инструменты для ИИ-агентов в манифесте, а токен получает на них разрешения реестра.
 * Агент видит инструмент в контексте, режим и разрешение действуют, выключенный модуль даёт 409, всё попадает в журнал.
 */
describe("Pet Care tools for AI agents (manifest-declared)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `pet-care-agent-${runId}`;
  const READ = "pet-care.pet.read";
  const CREATE = "pet-care.pet.create";

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
        const userIds = users.map((u) => u.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: userIds } }, select: { workspaceId: true } });
        const workspaceIds = [...new Set(memberships.map((m) => m.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        const leftovers = await tx.workspace.count({ where: { id: { in: workspaceIds } } });
        if (leftovers > 0) throw new Error(`Cleanup left ${leftovers} test workspace(s) behind`);
      });
    }
    await app?.close();
  });

  async function request<T = any>(path: string, options: { method: string; token?: string; body?: unknown }) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  let counter = 0;
  async function setup() {
    const response = await request<{ accessToken: string }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${counter++}@example.test`, password: "integration-password-123", name: "Хозяин" }
    });
    const token = response.data.accessToken;
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token });
    const ws = workspaces.data[0]!.id;
    const pet = await request(`/workspaces/${ws}/pet-care/pets`, { method: "POST", token, body: { name: "Барсик", species: "cat" } });
    const issue = (body: Record<string, unknown>) => request<{ secret: string }>(`/workspaces/${ws}/agent-tokens`, { method: "POST", token, body: { name: "Агент", ...body } });
    const agentOf = async (body: Record<string, unknown>) => {
      const created = await issue(body);
      expect(created.status).toBe(201);
      const secret = created.data.secret;
      return (method: string, path: string, payload?: unknown) => request(`/ai/v1${path}`, { method, token: secret, body: payload });
    };
    return {
      token,
      ws,
      petId: pet.data.id as string,
      issue,
      agentOf,
      human: (method: string, path: string, body?: unknown) => request(`/workspaces/${ws}${path}`, { method, token, body })
    };
  }

  it("отказывает в выпуске токена с разрешением, которого не объявил ни один модуль", async () => {
    const { issue } = await setup();
    expect((await issue({ modulePermissions: ["tasks.task.create"] })).status).toBe(400);
    expect((await issue({ modulePermissions: ["pet-care.pet.delete"] })).status).toBe(400);
    expect((await issue({ modulePermissions: [READ] })).status).toBe(201);
  });

  it("показывает инструменты в контексте и выполняет их с журналом", async () => {
    const { agentOf, petId, human } = await setup();
    const agent = await agentOf({ modulePermissions: [READ, CREATE], mode: "assistant" });

    const context = await agent("GET", "/context");
    expect(context.status).toBe(200);
    expect(context.data.moduleTools.map((t: { name: string }) => t.name).sort()).toEqual(["orion_pet_care_add_entry", "orion_pet_care_list_pets"]);
    expect(context.data.modules.map((m: { id: string }) => m.id)).toContain("pet-care");

    const pets = await agent("GET", "/pet-care/pets");
    expect(pets.status).toBe(200);
    expect(pets.data.map((p: { id: string }) => p.id)).toEqual([petId]);

    const entry = await agent("POST", `/pet-care/pets/${petId}/entries`, { kind: "feeding", note: "Сухой корм, 60 г" });
    expect(entry.status).toBe(201);
    expect((await agent("POST", `/pet-care/pets/${petId}/entries`, { kind: "bath" })).status).toBe(400);
    expect((await agent("POST", `/pet-care/pets/нет-такого/entries`, { kind: "walk" })).status).toBe(404);

    // Человек видит запись агента в журнале ухода, а журнал агента — запись о вызове.
    expect((await human("GET", `/pet-care/pets/${petId}/entries`)).data.map((e: { note: string }) => e.note)).toEqual(["Сухой корм, 60 г"]);
    const audit = await human("GET", "/agent-tokens/audit");
    const row = audit.data.find((r: { action: string; status: number }) => r.action === "orion_pet_care_add_entry" && r.status === 200);
    expect(row).toMatchObject({ module: "pet-care", objectType: "pet-care-entry", objectId: entry.data.id });
  });

  it("соблюдает выданные разрешения и режим токена", async () => {
    const { agentOf, petId } = await setup();
    const readOnly = await agentOf({ modulePermissions: [READ] });
    expect((await readOnly("GET", "/pet-care/pets")).status).toBe(200);
    expect((await readOnly("POST", `/pet-care/pets/${petId}/entries`, { kind: "walk" })).status).toBe(403);
    expect((await readOnly("GET", "/context")).data.moduleTools.map((t: { name: string }) => t.name)).toEqual(["orion_pet_care_list_pets"]);

    const observer = await agentOf({ modulePermissions: [READ, CREATE], mode: "observer" });
    expect((await observer("GET", "/pet-care/pets")).status).toBe(200);
    expect((await observer("POST", `/pet-care/pets/${petId}/entries`, { kind: "walk" })).status).toBe(403);

    // Токен с правами только на задачи про питомцев ничего не знает.
    const unrelated = await agentOf({ scopes: ["tasks:read"] });
    expect((await unrelated("GET", "/pet-care/pets")).status).toBe(403);
    expect((await unrelated("GET", "/context")).data.moduleTools).toEqual([]);
  });

  it("не пускает в чужое пространство и уважает выключенный модуль", async () => {
    const alice = await setup();
    const bob = await setup();
    const aliceAgent = await alice.agentOf({ modulePermissions: [READ, CREATE] });
    // Питомец Боба недоступен токену Алисы: её пространство — единственное, что токен видит.
    expect((await aliceAgent("POST", `/pet-care/pets/${bob.petId}/entries`, { kind: "walk" })).status).toBe(404);

    expect((await alice.human("PATCH", "/modules/pet-care", { enabled: false })).status).toBe(200);
    expect((await aliceAgent("GET", "/pet-care/pets")).status).toBe(409);
    expect((await aliceAgent("GET", "/context")).data.moduleTools).toEqual([]);
    expect((await alice.human("PATCH", "/modules/pet-care", { enabled: true })).status).toBe(200);
    expect((await aliceAgent("GET", "/pet-care/pets")).status).toBe(200);
  });
});
