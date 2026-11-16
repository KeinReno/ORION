import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Простой режим финансов (`finance_settings.mode = "simple"`): человек ведёт
 * только доходы и расходы. Операция без `accountId` записывается на
 * авто-созданный счёт «Основной» (flag `Account.isDefault`), переводы
 * запрещены, расширенный режим (`advanced`) — поведение по умолчанию и
 * ничего не меняет для существующих пространств. Режим меняет только
 * владелец пространства.
 */
describe("Finance simple mode", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `finance-simple-${runId}`;

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

  async function request<T = unknown>(path: string, options: { method: string; token?: string; body?: unknown }) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async function register(name: string) {
    const email = `${emailPrefix}-${name}@example.test`;
    const registered = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email, password: "integration-password-123", name }
    });
    expect(registered.status).toBe(201);
    const token = registered.data.accessToken;
    const workspaceId = (await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token })).data[0]!.id;
    return { token, email, userId: registered.data.user.id, workspaceId };
  }

  /** Anya owns the workspace, Petya is a plain member. */
  async function pair(name: string) {
    const anya = await register(`${name}-anya`);
    const petya = await register(`${name}-petya`);
    const invite = await request<{ acceptUrl: string }>(`/workspaces/${anya.workspaceId}/invites`, { method: "POST", token: anya.token, body: { email: petya.email } });
    const inviteToken = new URL(invite.data.acceptUrl).searchParams.get("token")!;
    expect((await request(`/invites/${inviteToken}/accept`, { method: "POST", token: petya.token })).status).toBe(201);
    return { anya, petya, ws: anya.workspaceId, base: `/workspaces/${anya.workspaceId}/finance` };
  }

  type Settings = { workspaceId: string; mode: string; updatedAt: string };
  type Acc = { id: string; name: string; isDefault: boolean; balance: number };
  type Tx = { id: string; accountId: string; type: string };
  const at = "2026-11-10T10:00:00.000Z";

  it("defaults to advanced and rejects an unknown mode", async () => {
    const { anya, base } = await pair("defaults");
    const settings = await request<Settings>(`${base}/settings`, { method: "GET", token: anya.token });
    expect(settings.status).toBe(200);
    expect(settings.data.mode).toBe("advanced");
    expect((await request(`${base}/settings`, { method: "PATCH", token: anya.token, body: { mode: "expert" } })).status).toBe(400);
  });

  it("lets the owner switch the mode but not a plain member", async () => {
    const { anya, petya, base } = await pair("switch");
    expect((await request(`${base}/settings`, { method: "PATCH", token: petya.token, body: { mode: "simple" } })).status).toBe(403);
    const patched = await request<Settings>(`${base}/settings`, { method: "PATCH", token: anya.token, body: { mode: "simple" } });
    expect(patched.status).toBe(200);
    expect(patched.data.mode).toBe("simple");
    // Чтение доступно любому участнику.
    expect((await request<Settings>(`${base}/settings`, { method: "GET", token: petya.token })).data.mode).toBe("simple");
    expect((await request<Settings>(`${base}/settings`, { method: "PATCH", token: anya.token, body: { mode: "advanced" } })).data.mode).toBe("advanced");
  });

  it("advanced mode still requires an explicit account", async () => {
    const { anya, base } = await pair("advanced");
    const missing = await request(`${base}/transactions`, {
      method: "POST",
      token: anya.token,
      body: { type: "expense", occurredAt: at, lines: [{ categoryId: null, amount: 1000 }] }
    });
    expect(missing.status).toBe(400);
  });

  it("simple mode writes an accountless operation onto a lazily created default account and forbids transfers", async () => {
    const { anya, base } = await pair("simple");
    expect((await request(`${base}/settings`, { method: "PATCH", token: anya.token, body: { mode: "simple" } })).status).toBe(200);

    // Счетов ещё нет — первая операция создаёт «Основной» сама.
    const created = await request<Tx>(`${base}/transactions`, {
      method: "POST",
      token: anya.token,
      body: { type: "expense", occurredAt: at, note: "кофе", lines: [{ categoryId: null, amount: 35000 }] }
    });
    expect(created.status).toBe(201);

    const accounts = await request<Acc[]>(`${base}/accounts`, { method: "GET", token: anya.token });
    expect(accounts.status).toBe(200);
    const defaults = accounts.data.filter((a) => a.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.name).toBe("Основной");
    expect(created.data.accountId).toBe(defaults[0]!.id);
    expect(defaults[0]!.balance).toBe(-35000);

    // Вторая операция без счёта попадает на тот же счёт — дублей «Основной» нет.
    const second = await request<Tx>(`${base}/transactions`, {
      method: "POST",
      token: anya.token,
      body: { type: "income", occurredAt: at, lines: [{ categoryId: null, amount: 100000 }] }
    });
    expect(second.status).toBe(201);
    expect(second.data.accountId).toBe(defaults[0]!.id);
    const afterSecond = await request<Acc[]>(`${base}/accounts`, { method: "GET", token: anya.token });
    expect(afterSecond.data.filter((a) => a.isDefault)).toHaveLength(1);

    // Переводы в простом режиме запрещены.
    const transfer = await request(`${base}/transactions`, {
      method: "POST",
      token: anya.token,
      body: { type: "transfer", accountId: defaults[0]!.id, toAccountId: defaults[0]!.id, occurredAt: at, lines: [{ categoryId: null, amount: 1000 }] }
    });
    expect(transfer.status).toBe(400);
  });

  it("switching back to advanced keeps the default account and its history", async () => {
    const { anya, base } = await pair("roundtrip");
    await request(`${base}/settings`, { method: "PATCH", token: anya.token, body: { mode: "simple" } });
    await request(`${base}/transactions`, {
      method: "POST",
      token: anya.token,
      body: { type: "expense", occurredAt: at, lines: [{ categoryId: null, amount: 5000 }] }
    });
    expect((await request(`${base}/settings`, { method: "PATCH", token: anya.token, body: { mode: "advanced" } })).status).toBe(200);

    // В расширенном режиме операция без счёта снова отклоняется — история осталась на «Основной».
    expect((await request(`${base}/transactions`, {
      method: "POST",
      token: anya.token,
      body: { type: "expense", occurredAt: at, lines: [{ categoryId: null, amount: 1000 }] }
    })).status).toBe(400);

    const accounts = await request<Acc[]>(`${base}/accounts`, { method: "GET", token: anya.token });
    const main = accounts.data.find((a) => a.isDefault);
    expect(main?.name).toBe("Основной");
    expect(main?.balance).toBe(-5000);
  });
});
