import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { MODULE_CATALOG, ORION_MODULE_IDS, orionModuleIdSchema } from "@orion/shared-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../src/app.module";
import { PrismaService } from "../../../src/common/prisma.service";
import { configureApp } from "../../../src/configure-app";
import { SNAPSHOT_MODEL_REGISTRY } from "../../../src/sync/snapshot-registry";
import { SYNC_CLASSIFICATION } from "../../../src/sync/sync-classification";

/**
 * Архив чатов: импорт транскрипта пачками (дописывание, повтор, разрыв, расхождение), заголовки, точное восстановление
 * оригинала, приватность внутри одного пространства (API и RLS), импорт хуком по токену агента, 409 при выключенном модуле.
 */
describe("Архив чатов", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `chat-archive-${runId}`;

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
        // Каскад от пространства обязан унести и таблицы модуля.
        const orphans =
          (await tx.chatArchiveConversation.count({ where: { workspaceId: { in: workspaceIds } } })) +
          (await tx.chatArchiveLine.count({ where: { workspaceId: { in: workspaceIds } } }));
        if (orphans > 0) throw new Error(`Cleanup left ${orphans} row(s) behind`);
      });
    }
    await app?.close();
  });

  async function request<T = any>(path: string, options: { method: string; token?: string; body?: unknown; form?: FormData }) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: {
        ...(options.form ? {} : { "Content-Type": "application/json" }),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      },
      body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  const linesForm = (lines: readonly string[]) => {
    const form = new FormData();
    form.append("lines", new Blob([lines.map((line) => `${line}\n`).join("")], { type: "application/x-ndjson" }), "lines.jsonl");
    return form;
  };

  let counter = 0;
  async function setup() {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${counter++}@example.test`, password: "integration-password-123", name: "Участник" }
    });
    const token = response.data.accessToken;
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token });
    const ws = workspaces.data[0]!.id;
    const call = (method: string, path: string, body?: unknown) => request(`/workspaces/${ws}/chat-archive${path}`, { method, token, body });
    return {
      token,
      ws,
      userId: response.data.user.id,
      call,
      push: (externalId: string, fromSeq: number, lines: readonly string[]) =>
        request(`/workspaces/${ws}/chat-archive/import?source=claude-code&externalId=${externalId}&fromSeq=${fromSeq}`, { method: "POST", token, form: linesForm(lines) }),
      setModule: (enabled: boolean) => request(`/workspaces/${ws}/modules/chat-archive`, { method: "PATCH", token, body: { enabled } })
    };
  }

  const at = (minute: number) => `2026-10-20T10:${String(minute).padStart(2, "0")}:00.000Z`;
  const userLine = (text: string, minute: number) =>
    JSON.stringify({ type: "user", sessionId: "s-1", cwd: "C:\\proj", timestamp: at(minute), message: { role: "user", content: text } });
  const answerLine = (text: string, minute: number) =>
    JSON.stringify({ type: "assistant", sessionId: "s-1", timestamp: at(minute), message: { role: "assistant", content: [{ type: "text", text }] } });
  const toolLine = (minute: number) =>
    JSON.stringify({ type: "assistant", sessionId: "s-1", timestamp: at(minute), message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "a.ts" } }] } });

  it("is registered through the generated registries, not by hand", () => {
    expect((ORION_MODULE_IDS as readonly string[]).includes("chat-archive")).toBe(true);
    expect(orionModuleIdSchema.safeParse("chat-archive").success).toBe(true);
    expect(MODULE_CATALOG.find((item) => item.id === "chat-archive")?.panelId).toBe("chat-archive");
    for (const model of ["ChatArchiveConversation", "ChatArchiveLine"]) {
      expect(SNAPSHOT_MODEL_REGISTRY.find((item) => item.model === model)?.policy).toBe("derived");
      expect(SYNC_CLASSIFICATION[model]).toBeDefined();
    }
  });

  it("appends batches by line number: repeat is a no-op, a gap or a changed line is 409", async () => {
    const { call, push, ws, token } = await setup();
    const file = ["{\"type\":\"file-history-snapshot\"}", userLine("Как сохранить чаты в ORION?", 1), toolLine(2), answerLine("Через импорт транскрипта.", 3)];

    const first = await push("s-1", 0, file.slice(0, 2));
    expect(first.status, JSON.stringify(first.data)).toBe(201);
    expect(first.data).toMatchObject({ appended: 2, skipped: 0 });
    expect(first.data.conversation).toMatchObject({ source: "claude-code", externalId: "s-1", title: "Как сохранить чаты в ORION?", titleSource: "fallback", projectPath: "C:\\proj", lineCount: 2, messageCount: 1 });

    // Повтор той же пачки и пачка с перекрытием: ничего не дублируется.
    expect((await push("s-1", 0, file.slice(0, 2))).data).toMatchObject({ appended: 0, skipped: 2 });
    const rest = await push("s-1", 1, file.slice(1));
    expect(rest.data).toMatchObject({ appended: 2, skipped: 1 });
    expect(rest.data.conversation).toMatchObject({ lineCount: 4, messageCount: 2, startedAt: at(1), lastAt: at(3) });

    const gap = await push("s-1", 10, [answerLine("потом", 9)]);
    expect(gap.status).toBe(409);
    expect(gap.data).toMatchObject({ code: "chat_archive_gap", lineCount: 4 });
    const diverged = await push("s-1", 3, [answerLine("Другой ответ", 3)]);
    expect(diverged.status).toBe(409);
    expect(diverged.data).toMatchObject({ code: "chat_archive_diverged", lineCount: 4 });

    // Оборванная последняя строка (нет "\n") — отказ, а не половина строки в архиве.
    const torn = new FormData();
    torn.append("lines", new Blob(["{\"type\":\"us"]), "lines.jsonl");
    const tornResponse = await request(`/workspaces/${ws}/chat-archive/import?source=claude-code&externalId=s-1&fromSeq=4`, { method: "POST", token, form: torn });
    expect(tornResponse.status).toBe(400);

    const id = first.data.conversation.id as string;
    const page = await call("GET", `/conversations/${id}/lines`);
    expect(page.data.lines.map((line: { role: string; kind: string }) => `${line.role}/${line.kind}`)).toEqual(["meta/meta", "user/text", "assistant/tool_call", "assistant/text"]);
    expect(page.data.nextSeq).toBeNull();
    const messages = await call("GET", `/conversations/${id}/lines?messagesOnly=true&limit=1`);
    expect(messages.data.lines.map((line: { seq: number }) => line.seq)).toEqual([1]);
    expect(messages.data.nextSeq).toBe(1);

    // Оригинал собирается из raw байт в байт.
    const raw = await call("GET", `/conversations/${id}/raw`);
    expect(raw.data.lines.map((line: { raw: string }) => line.raw)).toEqual(file);
    expect((await call("GET", `/conversations/${id}/raw?only=2`)).data.lines).toEqual([{ seq: 2, raw: file[2] }]);

    const hits = await call("GET", `/search?q=${encodeURIComponent("импорт транскрипта")}`);
    expect(hits.data).toEqual([expect.objectContaining({ conversationId: id, seq: 3, role: "assistant" })]);
  });

  it("titles: the source's title replaces the fallback, a manual rename sticks", async () => {
    const { call, push } = await setup();
    const created = await push("s-2", 0, [userLine("первая реплика", 1), JSON.stringify({ type: "ai-title", aiTitle: "Придумал Claude", sessionId: "s-2" })]);
    expect(created.data.conversation).toMatchObject({ title: "Придумал Claude", titleSource: "auto" });
    const custom = await push("s-2", 2, [JSON.stringify({ type: "custom-title", customTitle: "Мой заголовок", sessionId: "s-2" })]);
    expect(custom.data.conversation).toMatchObject({ title: "Мой заголовок", titleSource: "custom" });
    // Придуманный позже не перебивает заданный человеком.
    expect((await push("s-2", 3, [JSON.stringify({ type: "ai-title", aiTitle: "Снова авто", sessionId: "s-2" })])).data.conversation.title).toBe("Мой заголовок");

    const id = created.data.conversation.id as string;
    expect((await call("PATCH", `/conversations/${id}`, { title: "Переименовал в ORION" })).data).toMatchObject({ titleSource: "manual" });
    expect((await push("s-2", 4, [JSON.stringify({ type: "custom-title", customTitle: "Из источника", sessionId: "s-2" })])).data.conversation.title).toBe("Переименовал в ORION");

    expect((await call("DELETE", `/conversations/${id}`)).status).toBe(204);
    expect((await call("GET", `/conversations/${id}`)).status).toBe(404);
    expect((await call("GET", "/conversations")).data).toEqual([]);
  });

  it("is private: another member of the same workspace sees nothing, through the API or the database", async () => {
    const alice = await setup();
    const bob = await setup();
    const created = await alice.push("s-3", 0, [userLine("Личное", 1)]);
    const id = created.data.conversation.id as string;

    // Чужое пространство: нет членства -> 403.
    expect((await request(`/workspaces/${alice.ws}/chat-archive/conversations`, { method: "GET", token: bob.token })).status).toBe(403);

    // Боб становится участником пространства Алисы — архив Алисы всё равно не его.
    await prisma.asSystem((tx) => tx.workspaceMember.create({ data: { workspaceId: alice.ws, userId: bob.userId, role: "member" } }));
    const asBob = (path: string, method = "GET", body?: unknown) => request(`/workspaces/${alice.ws}/chat-archive${path}`, { method, token: bob.token, body });
    expect((await asBob("/conversations")).data).toEqual([]);
    expect((await asBob(`/conversations/${id}`)).status).toBe(404);
    expect((await asBob(`/conversations/${id}/raw`)).status).toBe(404);
    expect((await asBob(`/conversations/${id}`, "DELETE")).status).toBe(404);
    expect((await asBob(`/search?q=${encodeURIComponent("Личное")}`)).data).toEqual([]);
    // Тот же id сессии у Боба — отдельный разговор, а не дописывание к Алисиному.
    const bobs = await request(`/workspaces/${alice.ws}/chat-archive/import?source=claude-code&externalId=s-3&fromSeq=0`, { method: "POST", token: bob.token, form: linesForm([userLine("Моё", 1)]) });
    expect(bobs.status).toBe(201);
    expect(bobs.data.conversation.id).not.toBe(id);

    // RLS отдельно от кода.
    const hidden = await prisma.withUser(bob.userId, (tx) => tx.chatArchiveLine.findMany({ where: { conversationId: id } }));
    expect(hidden).toEqual([]);
    const visible = await prisma.withUser(alice.userId, (tx) => tx.chatArchiveLine.findMany({ where: { conversationId: id } }));
    expect(visible).toHaveLength(1);
  });

  it("imports through an agent token: the hook's file route needs the import permission; agents search and read", async () => {
    const { token, ws } = await setup();
    const issue = async (modulePermissions: string[]) => {
      const issued = await request<{ secret: string }>(`/workspaces/${ws}/agent-tokens`, { method: "POST", token, body: { name: "Хук архива", modulePermissions, mode: "assistant", expiresInDays: 7 } });
      expect(issued.status, JSON.stringify(issued.data)).toBe(201);
      return issued.data.secret;
    };
    const writer = await issue(["chat-archive.conversation.read", "chat-archive.conversation.create"]);
    const reader = await issue(["chat-archive.conversation.read"]);
    const state = (secret: string) => request(`/ai/v1/chat-archive/hook/state?source=codex&externalId=c-1`, { method: "GET", token: secret });
    const pushFile = (secret: string, fromSeq: number, lines: string[]) =>
      request(`/ai/v1/chat-archive/hook/lines?source=codex&externalId=c-1&fromSeq=${fromSeq}`, { method: "POST", token: secret, form: linesForm(lines) });
    const codex = [
      JSON.stringify({ type: "session_meta", timestamp: at(0), payload: { id: "c-1", cwd: "C:\\codex" } }),
      JSON.stringify({ type: "response_item", timestamp: at(1), payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Найди сделку" }], internal_chat_message_metadata_passthrough: { content_item_kinds: ["user.text"] } } })
    ];

    expect((await state(writer)).data).toEqual({ conversationId: null, lineCount: 0, lastSha: null });
    expect((await pushFile(reader, 0, codex)).status).toBe(403);
    const pushed = await pushFile(writer, 0, codex);
    expect(pushed.status, JSON.stringify(pushed.data)).toBe(201);
    expect(pushed.data.conversation).toMatchObject({ source: "codex", projectPath: "C:\\codex", title: "Найди сделку", lineCount: 2 });
    expect((await state(writer)).data).toMatchObject({ lineCount: 2, lastSha: expect.stringMatching(/^[0-9a-f]{64}$/) });

    // Тот же импорт инструментом агента — JSON-телом, дописывает к тому же разговору.
    const viaTool = await request(`/ai/v1/chat-archive/import`, { method: "POST", token: writer, body: { source: "codex", externalId: "c-1", fromSeq: 2, lines: [JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Нашёл" }] } })] } });
    expect(viaTool.status, JSON.stringify(viaTool.data)).toBe(201);
    expect(viaTool.data).toMatchObject({ appended: 1, conversation: { lineCount: 3, messageCount: 2 } });

    const hits = await request(`/ai/v1/chat-archive/search?q=${encodeURIComponent("Найди")}`, { method: "GET", token: reader });
    expect(hits.status).toBe(200);
    expect(hits.data).toEqual([expect.objectContaining({ title: "Найди сделку", seq: 1 })]);
    const read = await request(`/ai/v1/chat-archive/conversations/${pushed.data.conversation.id}/lines`, { method: "GET", token: reader });
    expect(read.data.lines.map((line: { text: string }) => line.text)).toEqual(["Найди сделку", "Нашёл"]);
    expect((await request(`/ai/v1/chat-archive/conversations`, { method: "GET", token: reader })).data).toHaveLength(1);
  });

  it("answers 409 while the module is disabled, keeps the data, and works again after enabling", async () => {
    const { call, push, setModule } = await setup();
    await push("s-4", 0, [userLine("Останется", 1)]);

    expect((await setModule(false)).status).toBe(200);
    expect((await call("GET", "/conversations")).status).toBe(409);
    expect((await push("s-4", 1, [answerLine("нельзя", 2)])).status).toBe(409);

    expect((await setModule(true)).status).toBe(200);
    expect((await call("GET", "/conversations")).data.map((item: { title: string }) => item.title)).toEqual(["Останется"]);
  });

  it("QA-08-01: 1200-line transcript survives chunked transfer, replay and a corrupt tail without silent loss", async () => {
    const { push, call, token, ws } = await setup();
    const externalId = "gptqa-large-" + Date.now();
    const lines = Array.from({ length: 1200 }, (_, i) =>
      JSON.stringify({
        type: "user", sessionId: externalId, timestamp: at(1),
        message: { role: "user", content: "Строка тестового архива #" + i + " — русский текст" }
      }));
    let conversationId: string | null = null;
    const chunkSize = 250;

    for (let start = 0; start < lines.length; start += chunkSize) {
      const chunk = lines.slice(start, start + chunkSize);
      const added = await push(externalId, start, chunk);
      expect(added.status, JSON.stringify(added.data)).toBe(201);
      expect(added.data).toMatchObject({ appended: chunk.length, skipped: 0 });
      conversationId = added.data.conversation.id;
      // Simulates a lost response followed by exactly the same upload.
      const replay = await push(externalId, start, chunk);
      expect(replay.status).toBe(201);
      expect(replay.data).toMatchObject({ appended: 0, skipped: chunk.length });
      expect(replay.data.conversation.id).toBe(conversationId);
    }
    expect(conversationId).not.toBeNull();
    const state = await call("GET", "/import-state?source=claude-code&externalId=" + externalId);
    expect(state.status).toBe(200);
    expect(state.data).toMatchObject({ conversationId, lineCount: 1200 });

    // Raw pages are reconstructed from persisted rows; never merely compare
    // in-memory input to itself or trust a claimed lineCount.
    const actual: string[] = [];
    let after = -1;
    for (let page = 0; page < 40; page++) {
      const result = await call("GET", "/conversations/" + conversationId + "/raw?after=" + after);
      expect(result.status).toBe(200);
      for (const line of result.data.lines as Array<{ seq: number; raw: string }>) {
        expect(line.seq).toBe(actual.length);
        actual.push(line.raw);
      }
      if (result.data.nextSeq === null) break;
      expect(result.data.nextSeq).toBeGreaterThan(after);
      after = result.data.nextSeq;
    }
    expect(actual).toEqual(lines);

    // A rejected malformed final chunk cannot change previously committed data.
    const torn = new FormData();
    torn.append("lines", new Blob(["{\"type\":\"user\",\"partial\":"], { type: "application/x-ndjson" }), "torn.jsonl");
    const bad = await request("/workspaces/" + ws +
      "/chat-archive/import?source=claude-code&externalId=" + externalId + "&fromSeq=1200",
      { method: "POST", token, form: torn });
    expect(bad.status).toBe(400);
    expect((await call("GET", "/import-state?source=claude-code&externalId=" + externalId)).data.lineCount).toBe(1200);
    const final = await call("GET", "/conversations/" + conversationId + "/raw?only=1199");
    expect(final.data.lines).toEqual([{ seq: 1199, raw: lines[1199] }]);
  });

});
