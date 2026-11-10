import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * The assistant answered by a program on this computer (Codex). The real CLI is replaced by a script that behaves like it
 * from ORION's side: reads the task from stdin, checks the MCP server it was given, calls ORION with the token from its
 * environment and writes its answer to `--output-last-message`. Checked: the user's text never reaches the command line,
 * what the program did shows up as actions (with the request to confirm), the token is revoked afterwards.
 */
describe("Assistant answered by Codex", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let scratch: string;
  const emailPrefix = `assistant-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const saved = { ...process.env };

  const FAKE = `
import fs from "node:fs";
const args = process.argv.slice(2);
const out = args[args.indexOf("--output-last-message") + 1];
let stdin = "";
process.stdin.on("data", (c) => (stdin += c));
process.stdin.on("end", async () => {
  const leaked = ["SYNC_SECRET", "JWT_SECRET", "DATABASE_URL", "APP_DATABASE_URL"].filter((name) => process.env[name]);
  const report = { args, sawTask: stdin.includes("купи корм"), env: Boolean(process.env.ORION_AGENT_TOKEN), leaked };
  fs.writeFileSync(__LOG__, JSON.stringify(report));
  const headers = { "content-type": "application/json", authorization: "Bearer " + process.env.ORION_AGENT_TOKEN };
  await fetch(process.env.ORION_API_URL + "/ai/v1/capture", { method: "POST", headers, body: JSON.stringify({ text: "Купить корм коту", hint: "idea" }) });
  const note = /NOTE=([0-9a-f-]{36})/.exec(stdin);
  if (note) await fetch(process.env.ORION_API_URL + "/ai/v1/proposals", { method: "POST", headers, body: JSON.stringify({ action: "note.delete", targetId: note[1], reason: "просили" }) });
  fs.writeFileSync(out, "Записал идею и попросил удалить черновик.");
});
`;

  beforeAll(async () => {
    process.env.SYNC_SECRET ||= randomBytes(32).toString("base64");
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "orion-fake-codex-"));
    const script = path.join(scratch, "fake-codex.mjs");
    process.env.FAKE_CODEX_LOG = path.join(scratch, "log.json");
    fs.writeFileSync(script, FAKE.replace("__LOG__", JSON.stringify(process.env.FAKE_CODEX_LOG)));
    let bin: string;
    if (process.platform === "win32") {
      bin = path.join(scratch, "codex.cmd");
      fs.writeFileSync(bin, `@"${process.execPath}" "${script}" %*\r\n`);
    } else {
      bin = path.join(scratch, "codex");
      fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
      fs.chmodSync(bin, 0o755);
    }
    process.env.ORION_CODEX_BIN = bin;
    process.env.ORION_CURSOR_AGENT_BIN = path.join(scratch, "no-such-cursor-agent");
    process.env.CODEX_API_KEY = "test";
    process.env.ORION_AGENT_CLIENT_HOME = scratch;

    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    for (const name of ["ORION_CODEX_BIN", "ORION_CURSOR_AGENT_BIN", "CODEX_API_KEY", "ORION_AGENT_CLIENT_HOME", "FAKE_CODEX_LOG"]) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
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
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  async function request<T = unknown>(url: string, method: string, token?: string, body?: unknown) {
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  it("lists Codex as ready and Cursor as missing, without an Anthropic key", async () => {
    const registered = await request<{ accessToken: string }>("/auth/register", "POST", undefined, { email: `${emailPrefix}-a@example.test`, password: "integration-password-123", name: "Хозяин" });
    const engines = await request<Array<{ engine: string; available: boolean; reason: string | null }>>("/assistant/engines", "GET", registered.data.accessToken);
    expect(engines.status).toBe(200);
    expect(engines.data.map((item) => [item.engine, item.available])).toEqual([
      ["anthropic", false],
      ["codex", true],
      ["cursor", false]
    ]);
    expect(engines.data.find((item) => item.engine === "cursor")?.reason).toBe("Cursor CLI не установлен");
  });

  it("answers through the program: the task via stdin, actions and the request in the reply, the token revoked", async () => {
    const registered = await request<{ accessToken: string }>("/auth/register", "POST", undefined, { email: `${emailPrefix}-b@example.test`, password: "integration-password-123", name: "Хозяин" });
    const token = registered.data.accessToken;
    const ws = (await request<Array<{ id: string }>>("/workspaces/me", "GET", token)).data[0]!.id;
    const note = (await request<{ id: string }>(`/workspaces/${ws}/notes`, "POST", token, { title: "Черновик", body: "" })).data;

    const sent = await request<{ reply: string; conversationId: string; actions: Array<{ tool: string; ok: boolean; proposalId: string | null }> }>(
      `/workspaces/${ws}/assistant/send`,
      "POST",
      token,
      { message: `купи корм коту и удали NOTE=${note.id}`, engine: "codex" }
    );
    expect(sent.status, JSON.stringify(sent.data)).toBe(201);
    expect(sent.data.reply).toBe("Записал идею и попросил удалить черновик.");
    expect(sent.data.actions.some((action) => action.ok && action.proposalId === null), JSON.stringify(sent.data.actions)).toBe(true);
    const request_ = sent.data.actions.find((action) => action.proposalId);
    expect(request_?.tool).toBe("note.delete");

    const log = JSON.parse(fs.readFileSync(process.env.FAKE_CODEX_LOG!, "utf8")) as { args: string[]; sawTask: boolean; env: boolean; leaked: string[] };
    expect(log.sawTask).toBe(true);
    expect(log.env).toBe(true);
    // The server's secrets never reach the program (SYNC_SECRET is set in this test process).
    expect(log.leaked).toEqual([]);
    expect(log.args[0]).toBe("exec");
    expect(log.args).toContain("mcp_servers.orion_chat.env_vars=['ORION_AGENT_TOKEN','ORION_API_URL']");
    expect(log.args.join(" ")).not.toContain("купи");
    expect(log.args.join(" ")).not.toContain("orion_agt_");

    // The note is still there until the human approves, and the answer remembers who gave it.
    expect((await request(`/workspaces/${ws}/notes/${note.id}`, "GET", token)).status).toBe(200);
    const conversation = await request<{ messages: Array<{ role: string; engine?: string }> }>(`/workspaces/${ws}/assistant/conversations/${sent.data.conversationId}`, "GET", token);
    expect(conversation.data.messages.at(-1)).toMatchObject({ role: "assistant", engine: "codex" });

    const tokens = await request<Array<{ name: string; revokedAt: string | null }>>(`/workspaces/${ws}/agent-tokens`, "GET", token);
    expect(tokens.data.filter((item) => item.name === "Чат ORION").every((item) => item.revokedAt !== null)).toBe(true);
  });
});
