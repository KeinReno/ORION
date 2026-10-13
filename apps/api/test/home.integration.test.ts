import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

interface RegisteredSession {
  accessToken: string;
  user: { id: string; name: string };
  email: string;
  workspaceId: string;
}

describe("Module Home", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `home-${runId}`;

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

  interface Overview {
    home: { id: string; name: string };
    taskIds: string[];
    listIds: string[];
    inventoryIds: string[];
    obligationIds: string[];
    meters: Array<{ id: string; unit: string; lastValue: number | null; readings: Array<{ id: string; value: number; consumption: number | null }> }>;
    contacts: Array<{ id: string; name: string }>;
  }

  it("дом собирает дела, списки, вещи и платежи, созданные прямо с homeId; чужой дом отклоняется", async () => {
    const alice = await register("alice");
    const mallory = await register("mallory");
    const ws = `/workspaces/${alice.workspaceId}`;
    const home = await request<{ id: string }>(`${ws}/homes`, { method: "POST", token: alice.accessToken, body: { name: "Квартира", kind: "flat" } });
    expect(home.status).toBe(201);
    expect((await request(`${ws}/homes`, { method: "POST", token: alice.accessToken, body: { name: "квартира" } })).status).toBe(409);
    const foreignHome = await request<{ id: string }>(`/workspaces/${mallory.workspaceId}/homes`, { method: "POST", token: mallory.accessToken, body: { name: "Чужой" } });

    const task = await request<{ id: string }>(`${ws}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "Вынести мусор", homeId: home.data.id } });
    const list = await request<{ id: string }>(`${ws}/lists`, { method: "POST", token: alice.accessToken, body: { name: "Купить", homeId: home.data.id } });
    const thing = await request<{ id: string }>(`${ws}/inventory/items`, { method: "POST", token: alice.accessToken, body: { name: "Стиральная машина", homeId: home.data.id } });
    const bill = await request<{ id: string }>(`${ws}/finance/obligations`, {
      method: "POST", token: alice.accessToken, body: { name: "Коммуналка", kind: "utility", payment: 650000, homeId: home.data.id }
    });
    for (const r of [task, list, thing, bill]) expect(r.status).toBe(201);
    // Not attached: another home's record never shows up here.
    await request(`${ws}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "Без дома" } });

    // A home of another workspace cannot be used.
    const mix = await request(`${ws}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "x", homeId: foreignHome.data.id } });
    expect(mix.status).toBe(400);

    const overview = await request<Overview>(`${ws}/homes/${home.data.id}/overview`, { method: "GET", token: alice.accessToken });
    expect(overview.status).toBe(200);
    expect(overview.data.taskIds).toEqual([task.data.id]);
    expect(overview.data.listIds).toEqual([list.data.id]);
    expect(overview.data.inventoryIds).toEqual([thing.data.id]);
    expect(overview.data.obligationIds).toEqual([bill.data.id]);

    // A module the viewer cannot use contributes nothing (here: tasks switched off).
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: alice.workspaceId }, data: { disabledModules: ["tasks"] } }));
    const without = await request<Overview>(`${ws}/homes/${home.data.id}/overview`, { method: "GET", token: alice.accessToken });
    expect(without.data.taskIds).toEqual([]);
    expect(without.data.listIds).toEqual([list.data.id]);
    await prisma.asSystem((tx) => tx.workspace.update({ where: { id: alice.workspaceId }, data: { disabledModules: [] } }));

    // Nobody outside the workspace reads it.
    expect([403, 404]).toContain((await request(`${ws}/homes/${home.data.id}/overview`, { method: "GET", token: mallory.accessToken })).status);
  });

  it("привязать и отвязать существующее; удаление дома не удаляет дела, но убирает счётчики", async () => {
    const alice = await register("alice2");
    const ws = `/workspaces/${alice.workspaceId}`;
    const home = await request<{ id: string }>(`${ws}/homes`, { method: "POST", token: alice.accessToken, body: { name: "Дача", kind: "country" } });
    const other = await request<{ id: string }>(`${ws}/homes`, { method: "POST", token: alice.accessToken, body: { name: "Гараж" } });
    const task = await request<{ id: string }>(`${ws}/tasks`, { method: "POST", token: alice.accessToken, body: { title: "Закрыть воду" } });
    const base = `${ws}/homes/${home.data.id}`;

    expect((await request(`${base}/attach`, { method: "POST", token: alice.accessToken, body: { type: "task", id: task.data.id } })).status).toBe(204);
    expect((await request<Overview>(`${base}/overview`, { method: "GET", token: alice.accessToken })).data.taskIds).toEqual([task.data.id]);
    // Detaching from the wrong home does nothing to the record.
    expect((await request(`${ws}/homes/${other.data.id}/detach`, { method: "POST", token: alice.accessToken, body: { type: "task", id: task.data.id } })).status).toBe(404);
    expect((await request(`${base}/detach`, { method: "POST", token: alice.accessToken, body: { type: "task", id: task.data.id } })).status).toBe(204);
    expect((await request<Overview>(`${base}/overview`, { method: "GET", token: alice.accessToken })).data.taskIds).toEqual([]);

    await request(`${base}/attach`, { method: "POST", token: alice.accessToken, body: { type: "task", id: task.data.id } });
    await request(`${base}/meters`, { method: "POST", token: alice.accessToken, body: { name: "Свет", kind: "electricity" } });
    expect((await request(base, { method: "DELETE", token: alice.accessToken })).status).toBe(204);
    const tasks = await request<Array<{ id: string }>>(`${ws}/tasks`, { method: "GET", token: alice.accessToken });
    expect(tasks.data.map((t) => t.id)).toContain(task.data.id);
    expect(await prisma.asSystem((tx) => tx.meter.count({ where: { homeId: home.data.id } }))).toBe(0);
  });

  it("счётчики: единица по умолчанию, расход между показаниями, назад идти нельзя; контакты", async () => {
    const alice = await register("alice3");
    const ws = `/workspaces/${alice.workspaceId}`;
    const home = await request<{ id: string }>(`${ws}/homes`, { method: "POST", token: alice.accessToken, body: { name: "Квартира" } });
    const base = `${ws}/homes/${home.data.id}`;
    const meter = await request<{ id: string; unit: string }>(`${base}/meters`, { method: "POST", token: alice.accessToken, body: { name: "Холодная вода", kind: "water_cold" } });
    expect(meter.data.unit).toBe("м³");
    const readingsPath = `${base}/meters/${meter.data.id}/readings`;
    const day = (d: number) => new Date(2026, 9, d, 12).toISOString();

    expect((await request(readingsPath, { method: "POST", token: alice.accessToken, body: { value: 100, readAt: day(1) } })).status).toBe(201);
    expect((await request(readingsPath, { method: "POST", token: alice.accessToken, body: { value: 112.5, readAt: day(10) } })).status).toBe(201);
    const back = await request<{ message: string }>(readingsPath, { method: "POST", token: alice.accessToken, body: { value: 99, readAt: day(12) } });
    expect(back.status).toBe(400);
    expect(back.data.message).toContain("меньше предыдущего");
    expect((await request(readingsPath, { method: "POST", token: alice.accessToken, body: { value: -1 } })).status).toBe(400);

    const overview = await request<Overview>(`${base}/overview`, { method: "GET", token: alice.accessToken });
    const m = overview.data.meters[0];
    expect(m.lastValue).toBe(112.5);
    expect(m.readings.map((r) => r.consumption)).toEqual([12.5, null]);

    const afterDelete = await request<{ lastValue: number }>(`${readingsPath}/${m.readings[0].id}`, { method: "DELETE", token: alice.accessToken });
    expect(afterDelete.data.lastValue).toBe(100);

    const contact = await request<{ id: string }>(`${base}/contacts`, { method: "POST", token: alice.accessToken, body: { name: "ООО УК", role: "управляющая компания", phone: "+7 900 000-00-00" } });
    expect(contact.status).toBe(201);
    expect((await request(`${base}/contacts/${contact.data.id}`, { method: "PATCH", token: alice.accessToken, body: { phone: "+7 911 111-11-11" } })).status).toBe(200);
    expect((await request<Overview>(`${base}/overview`, { method: "GET", token: alice.accessToken })).data.contacts).toHaveLength(1);
    expect((await request(`${base}/contacts/${contact.data.id}`, { method: "DELETE", token: alice.accessToken })).status).toBe(204);
  });

  async function register(name: string): Promise<RegisteredSession> {
    const email = `${emailPrefix}-${name}@example.test`;
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    expect(workspaces.status).toBe(200);
    return { accessToken: response.data.accessToken, user: { ...response.data.user, name }, email, workspaceId: workspaces.data[0].id };
  }

  async function request<T = unknown>(
    path: string,
    options: { method: string; token?: string; body?: unknown }
  ): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { status: response.status, data };
  }
});
