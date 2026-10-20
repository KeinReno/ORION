import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * ADR-0017, вариант C: чат внутри ORION. Языковая модель подменена локальным сервером с заготовленными ответами;
 * проверяем хранение ключа (зашифрован, виден только владельцу), цикл «модель → инструмент → ORION → модель»,
 * журнал агента и отзыв временного токена.
 */
describe("Assistant chat (variant C)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let fake: Server;
  const emailPrefix = `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const API_KEY = "sk-ant-test-0123456789abcdefghijkl";
  const seen: Array<{ key: string | undefined; body: any }> = [];
  let script: Array<(body: any) => { status?: number; json: unknown }> = [];

  beforeAll(async () => {
    process.env.SYNC_SECRET ||= randomBytes(32).toString("base64");
    fake = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        seen.push({ key: req.headers["x-api-key"] as string | undefined, body });
        const next = script.shift();
        const answer = next ? next(body) : { status: 500, json: {} };
        res.writeHead(answer.status ?? 200, { "content-type": "application/json" }).end(JSON.stringify(answer.json));
      });
    });
    await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
    process.env.ORION_ANTHROPIC_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    delete process.env.ORION_ANTHROPIC_URL;
    if (prisma) {
      await prisma.asSystem(async (tx) => {
        const users = await tx.user.findMany({ where: { email: { startsWith: emailPrefix } }, select: { id: true } });
        const ids = users.map((u) => u.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: ids } }, select: { workspaceId: true } });
        await tx.user.deleteMany({ where: { id: { in: ids } } });
        await tx.workspace.deleteMany({ where: { id: { in: memberships.map((m) => m.workspaceId) } } });
      });
    }
    await app?.close();
    await new Promise<void>((resolve) => fake.close(() => resolve()));
  });

  async function request<T = any>(path: string, method: string, token?: string, body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  let counter = 0;
  async function user() {
    const registered = await request<{ accessToken: string; user: { id: string } }>("/auth/register", "POST", undefined, {
      email: `${emailPrefix}-${counter++}@example.test`,
      password: "integration-password-123",
      name: "Хозяин"
    });
    const token = registered.data.accessToken;
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", "GET", token);
    return { token, userId: registered.data.user.id, ws: workspaces.data[0]!.id };
  }

  const text = (value: string) => ({ json: { content: [{ type: "text", text: value }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } } });

  it("хранит ключ зашифрованным и виден только владельцу; статус ключ не раскрывает", async () => {
    const alice = await user();
    const bob = await user();
    expect((await request("/assistant/key", "GET", alice.token)).data).toMatchObject({ configured: false, available: true });
    expect((await request("/assistant/key", "PUT", alice.token, { apiKey: "short" })).status).toBe(400);
    const saved = await request("/assistant/key", "PUT", alice.token, { apiKey: API_KEY });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.data)).not.toContain(API_KEY);
    expect(saved.data).toMatchObject({ configured: true, provider: "anthropic", model: "claude-sonnet-5-5" });

    const stored = await prisma.asSystem((tx) => tx.assistantKey.findUnique({ where: { userId: alice.userId } }));
    expect(stored?.keyEnc).toBeTruthy();
    expect(stored?.keyEnc).not.toContain(API_KEY);
    // RLS: строка чужого пользователя недоступна даже прямым запросом.
    expect(await prisma.withUser(bob.userId, (tx) => tx.assistantKey.findMany())).toEqual([]);
    expect((await request("/assistant/key", "GET", bob.token)).data.configured).toBe(false);

    expect((await request("/assistant/key", "DELETE", alice.token)).status).toBe(204);
    expect((await request("/assistant/key", "GET", alice.token)).data.configured).toBe(false);
  });

  it("без ключа чат отказывает понятным сообщением", async () => {
    const { token, ws } = await user();
    const result = await request(`/workspaces/${ws}/assistant/chat`, "POST", token, { messages: [{ role: "user", content: "привет" }] });
    expect(result.status).toBe(400);
  });

  it("цикл модель → инструмент → ORION → модель: заметка создана от имени чата, токен отозван", async () => {
    const { token, ws } = await user();
    await request("/assistant/key", "PUT", token, { apiKey: API_KEY, model: "claude-test" });
    seen.length = 0;
    script = [
      () => ({ json: { content: [{ type: "tool_use", id: "tu1", name: "orion_capture", input: { text: "Купить корм коту", hint: "idea" } }], stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 20 } } }),
      () => text("Сохранил идею в заметки.")
    ];
    const result = await request(`/workspaces/${ws}/assistant/chat`, "POST", token, { messages: [{ role: "user", content: "запомни: купить корм коту" }] });
    expect(result.status).toBe(201);
    expect(result.data).toMatchObject({ reply: "Сохранил идею в заметки.", inputTokens: 110, outputTokens: 25 });
    expect(result.data.actions).toEqual([{ tool: "orion_capture", ok: true, summary: "готово", proposalId: null }]);

    // Ключ ушёл провайдеру в заголовке, модель — та, что сохранена; в запросе нет инструментов удаления и финансов.
    expect(seen[0]!.key).toBe(API_KEY);
    expect(seen[0]!.body.model).toBe("claude-test");
    const toolNames: string[] = seen[0]!.body.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("orion_capture");
    // No deletion, no finance drafts, no manual; finances only as read tools of the module (G13).
    expect(toolNames.some((name) => name.includes("propose_deletion") || name === "orion_propose_transaction" || name === "orion_finance_refs" || name === "orion_get_manual")).toBe(false);
    expect(toolNames).toEqual(expect.arrayContaining(["orion_habits_list", "orion_lists_add_items", "orion_finance_accounts"]));
    // Результат инструмента вернулся модели во втором запросе.
    expect(JSON.stringify(seen[1]!.body.messages)).toContain("tu1");

    const notes = await request<Array<{ title: string; body: string }>>(`/workspaces/${ws}/notes`, "GET", token);
    expect(notes.data.some((n) => `${n.title} ${n.body}`.includes("Купить корм коту"))).toBe(true);

    const tokens = await request<Array<{ name: string; revokedAt: string | null }>>(`/workspaces/${ws}/agent-tokens`, "GET", token);
    const chatToken = tokens.data.find((t) => t.name === "Чат ORION");
    expect(chatToken?.revokedAt).not.toBeNull();
    const audit = await request<Array<{ tokenName: string; action: string; status: number }>>(`/workspaces/${ws}/agent-tokens/audit`, "GET", token);
    expect(audit.data.some((row) => row.tokenName === "Чат ORION" && row.action === "capture" && row.status === 200)).toBe(true);
  });

  it("неизвестный инструмент модели не выполняется, а отказ провайдера не раскрывает ключ", async () => {
    const { token, ws } = await user();
    await request("/assistant/key", "PUT", token, { apiKey: API_KEY });
    script = [
      () => ({ json: { content: [{ type: "tool_use", id: "tu9", name: "orion_propose_deletion", input: { action: "note.delete", targetId: "x" } }], stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } } }),
      () => text("Удалять не могу.")
    ];
    const refused = await request(`/workspaces/${ws}/assistant/chat`, "POST", token, { messages: [{ role: "user", content: "удали заметку" }] });
    expect(refused.data.actions).toEqual([{ tool: "orion_propose_deletion", ok: false, summary: "инструмент недоступен", proposalId: null }]);

    script = [() => ({ status: 401, json: { error: { message: `bad key ${API_KEY}` } } })];
    const failed = await request(`/workspaces/${ws}/assistant/chat`, "POST", token, { messages: [{ role: "user", content: "привет" }] });
    expect(failed.status).toBe(502);
    expect(JSON.stringify(failed.data)).not.toContain(API_KEY);
  });

  it("правка существующей задачи — запрос на подтверждение: id приходит в ответе чата, подтверждение применяет её", async () => {
    const { token, ws } = await user();
    await request("/assistant/key", "PUT", token, { apiKey: API_KEY, model: "claude-test" });
    const task = await request<{ id: string }>(`/workspaces/${ws}/tasks`, "POST", token, { title: "Старое название" });
    script = [
      () => ({ json: { content: [{ type: "tool_use", id: "tu5", name: "orion_update_task", input: { taskId: task.data.id, title: "Новое название" } }], stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } } }),
      () => text("Предложил переименовать — подтвердите.")
    ];
    const result = await request<{ actions: Array<{ ok: boolean; summary: string; proposalId: string | null }> }>(`/workspaces/${ws}/assistant/chat`, "POST", token, {
      messages: [{ role: "user", content: "переименуй задачу" }]
    });
    expect(result.status).toBe(201);
    expect(result.data.actions[0]).toMatchObject({ ok: true, summary: "ждёт подтверждения" });
    const proposalId = result.data.actions[0]!.proposalId;
    expect(proposalId).toBeTruthy();

    // The chat token is already revoked, but the request stays decidable — that is what the buttons in the chat do.
    const approved = await request<{ status: string }>(`/workspaces/${ws}/agent-tokens/proposals/${proposalId}/approve`, "POST", token, {});
    expect(approved.status).toBe(201);
    expect(approved.data.status).toBe("approved");
    const tasks = await request<Array<{ id: string; title: string }>>(`/workspaces/${ws}/tasks`, "GET", token);
    expect(tasks.data.find((t) => t.id === task.data.id)?.title).toBe("Новое название");
  });

  it("беседы: история сохраняется и уходит модели, контекст экрана — в системной подсказке, чужому не видна", async () => {
    const alice = await user();
    const bob = await user();
    await request("/assistant/key", "PUT", alice.token, { apiKey: API_KEY, model: "claude-test" });
    seen.length = 0;
    script = [() => text("Привет! Чем помочь?")];
    const first = await request<{ conversationId: string; title: string; reply: string; truncated: boolean }>(`/workspaces/${alice.ws}/assistant/send`, "POST", alice.token, {
      message: "Привет, это первая беседа",
      context: { panel: "tasks", label: "Задачи", entityType: "task", entityId: "t-1", title: "Купить корм" }
    });
    expect(first.status).toBe(201);
    expect(first.data).toMatchObject({ title: "Привет, это первая беседа", reply: "Привет! Чем помочь?", truncated: false });
    expect(seen[0]!.body.system).toContain("Сейчас пользователь смотрит раздел «Задачи»");
    expect(seen[0]!.body.system).toContain("«Купить корм» (id t-1)");
    expect(seen[0]!.body.max_tokens).toBe(4096);

    // The second message carries the history to the model; a cut answer is marked.
    seen.length = 0;
    script = [() => ({ json: { content: [{ type: "text", text: "Длинный ответ…" }], stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 1 } } })];
    const second = await request<{ conversationId: string; truncated: boolean }>(`/workspaces/${alice.ws}/assistant/send`, "POST", alice.token, {
      conversationId: first.data.conversationId,
      message: "А что дальше?"
    });
    expect(second.data).toMatchObject({ conversationId: first.data.conversationId, truncated: true });
    expect(seen[0]!.body.messages.map((m: { role: string; content: unknown }) => [m.role, m.content])).toEqual([
      ["user", "Привет, это первая беседа"],
      ["assistant", "Привет! Чем помочь?"],
      ["user", "А что дальше?"]
    ]);
    expect(seen[0]!.body.system).not.toContain("Сейчас пользователь смотрит");

    const list = await request<Array<{ id: string; title: string; messageCount: number }>>(`/workspaces/${alice.ws}/assistant/conversations`, "GET", alice.token);
    expect(list.data).toEqual([expect.objectContaining({ id: first.data.conversationId, messageCount: 4 })]);
    const full = await request<{ messages: Array<{ role: string; truncated: boolean }> }>(`/workspaces/${alice.ws}/assistant/conversations/${first.data.conversationId}`, "GET", alice.token);
    expect(full.data.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(full.data.messages[3]!.truncated).toBe(true);

    // Not Bob's: neither through the API (not a member → 403, and the id is not his) nor in the database (RLS).
    expect((await request(`/workspaces/${alice.ws}/assistant/conversations/${first.data.conversationId}`, "GET", bob.token)).status).toBe(403);
    expect((await request(`/workspaces/${bob.ws}/assistant/conversations/${first.data.conversationId}`, "GET", bob.token)).status).toBe(404);
    expect(await prisma.withUser(bob.userId, (tx) => tx.assistantConversation.count())).toBe(0);

    expect((await request(`/workspaces/${alice.ws}/assistant/conversations/${first.data.conversationId}`, "DELETE", alice.token)).status).toBe(204);
    expect((await request<unknown[]>(`/workspaces/${alice.ws}/assistant/conversations`, "GET", alice.token)).data).toEqual([]);
  });
});
