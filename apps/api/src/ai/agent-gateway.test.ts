import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { AGENT_TOOLS, agentToolDescription, agentToolModeNote, agentToolModeOutcome } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { handleMcpMessage, loadSettings, redact } from "../mcp/orion-mcp";
import { resolveAgentConnection } from "./agent-connection";
import { GENERATED_AGENT_CONTROLLERS } from "../modules-ext/modules.generated";
import { AgentGatewayController } from "./agent-gateway.controller";
import { AiController } from "./ai.controller";
import { ContactsAgentController } from "../contacts/contacts.agent.controller";
import { DocumentsAgentController } from "../documents/documents.agent.controller";
import { FinanceAgentController } from "../finance/finance.agent.controller";
import { HabitsAgentController } from "../habits/habits.agent.controller";
import { InventoryAgentController } from "../inventory/inventory.agent.controller";
import { ListsAgentController } from "../lists/lists.agent.controller";
import { TimeAgentController } from "../time/time.agent.controller";
import { GoalsAgentController } from "../goals/goals.agent.controller";
import { HealthAgentController } from "../health/health.agent.controller";
import { HomeAgentController } from "../home/home.agent.controller";
import { ProjectsAgentController } from "../projects/projects.agent.controller";

/** Agent tools of the core modules live next to each module (G13), like the manifest modules' ones. */
const CORE_MODULE_AGENT_CONTROLLERS = [
  HabitsAgentController,
  ListsAgentController,
  TimeAgentController,
  ContactsAgentController,
  DocumentsAgentController,
  FinanceAgentController,
  InventoryAgentController,
  ProjectsAgentController,
  GoalsAgentController,
  HealthAgentController,
  HomeAgentController
];

const TOKEN = "orion_agt_SECRETSECRETSECRETSECRET1234";

/** `GET /ai/v1/tasks/:p` for every route Nest registered on the controller class. */
function routesOf(controller: { prototype: object }, prefix: string): string[] {
  const methodNames: Record<number, string> = { [RequestMethod.GET]: "GET", [RequestMethod.POST]: "POST", [RequestMethod.PATCH]: "PATCH", [RequestMethod.DELETE]: "DELETE", [RequestMethod.PUT]: "PUT" };
  const routes: string[] = [];
  for (const name of Object.getOwnPropertyNames(controller.prototype)) {
    const handler = (controller.prototype as Record<string, unknown>)[name];
    if (typeof handler !== "function") continue;
    const path = Reflect.getMetadata("path", handler) as string | undefined;
    const method = Reflect.getMetadata("method", handler) as number | undefined;
    if (path === undefined || method === undefined) continue;
    routes.push(`${methodNames[method]} /${prefix}/${path}`.replace(/\/+$/, "").replace(/:\w+/g, ":p"));
  }
  return routes;
}

describe("каталог инструментов ↔ маршруты /ai/v1", () => {
  // Контроллеры подключаемых модулей (G13) лежат в своих каталогах; префикс — из их собственного @Controller.
  const moduleControllers = [...GENERATED_AGENT_CONTROLLERS, ...CORE_MODULE_AGENT_CONTROLLERS];
  const moduleRoutes = moduleControllers.flatMap((controller) => routesOf(controller, Reflect.getMetadata("path", controller) as string));
  const actual = new Set([...routesOf(AiController, "ai/v1"), ...routesOf(AgentGatewayController, "ai/v1"), ...moduleRoutes]);
  const declared = new Set(AGENT_TOOLS.map((tool) => `${tool.http.method} ${tool.http.path}`.replace(/\{\w+\}/g, ":p")));

  it("у каждого инструмента есть настоящий маршрут", () => {
    for (const route of declared) expect(actual, route).toContain(route);
  });

  it("каждый маршрут агента описан инструментом (иначе агент о нём не узнает)", () => {
    // Маршруты, которых в каталоге нет сознательно: их список — единственное, что можно здесь пополнять.
    const intentionallyUndeclared = new Set<string>();
    for (const route of actual) {
      if (!declared.has(route) && !intentionallyUndeclared.has(route)) throw new Error(`Маршрут ${route} есть в контроллере, но не описан в AGENT_TOOLS`);
    }
  });
});

describe("MCP-адаптер", () => {
  const settings = { apiUrl: "http://127.0.0.1:4000", token: TOKEN };

  it("tools/list отдаёт ровно каталог (имя, описание, схема)", async () => {
    const result = (await handleMcpMessage({ id: 1, method: "tools/list" }, settings)) as { tools: Array<{ name: string; description: string; inputSchema: unknown }> };
    expect(result.tools).toHaveLength(AGENT_TOOLS.length);
    expect(result.tools.map((t) => t.name)).toEqual(AGENT_TOOLS.map((t) => t.name));
    for (const [index, tool] of result.tools.entries()) {
      expect(tool.description.startsWith(AGENT_TOOLS[index]!.description)).toBe(true);
      expect(tool.description).toContain("Режимы токена:");
      expect(tool.inputSchema).toEqual(AGENT_TOOLS[index]!.input);
    }
  });

  it("описания инструментов называют режимы; изменение — запрос у помощника, отказ у наблюдателя", () => {
    const update = AGENT_TOOLS.find((t) => t.name === "orion_update_task")!;
    const note = agentToolModeNote(update);
    expect(note).toContain("наблюдатель — отказ 403");
    expect(note).toContain("помощник — изменение НЕ применяется");
    expect(note).toContain("менеджер — выполняется сразу");
    expect(agentToolModeNote(AGENT_TOOLS.find((t) => t.name === "orion_list_tasks")!)).toContain("любом");
    expect(agentToolDescription(update)).toContain("Нужно разрешение: tasks:write");
  });

  // ADR-0044: deleting a task/note/event is a verb the agent has; only the token mode decides whose hand does it.
  it("удаление задачи, заметки и события: администратор удаляет, помощник и менеджер подают запрос, наблюдатель и «Никогда» — 403", () => {
    const expected = [
      ["orion_delete_task", "/ai/v1/tasks/{taskId}", "tasks:write"],
      ["orion_delete_note", "/ai/v1/notes/{noteId}", "notes:write"],
      ["orion_delete_event", "/ai/v1/events/{eventId}", "events:write"]
    ] as const;
    for (const [name, path, scope] of expected) {
      const tool = AGENT_TOOLS.find((t) => t.name === name);
      expect(tool, `нет инструмента ${name}`).toBeTruthy();
      expect(tool!.http).toEqual({ method: "DELETE", path });
      expect(tool!.effect).toBe("delete");
      expect(tool!.scopes).toEqual([scope]);
      const note = agentToolModeNote(tool!);
      expect(note).toContain("наблюдатель — отказ 403");
      expect(note).toContain("помощник — удаление НЕ выполняется");
      expect(note).toContain("менеджер — удаление НЕ выполняется");
      expect(note).toContain("администратор — удаляет сразу");
      // The narrowed line is what tools/list shows an administrator token.
      expect(agentToolModeOutcome(tool!, "admin")).toContain("удаляет сразу");
      expect(agentToolModeOutcome(tool!, "manager")).toContain("запрос");
    }
    // Asking a human stays a different act: that tool never deletes by itself, in any mode.
    const ask = AGENT_TOOLS.find((t) => t.name === "orion_propose_deletion")!;
    expect(ask.effect).toBe("delete_request");
    expect(agentToolModeNote(ask)).not.toContain("удаляет сразу");
  });

  it("tools/list с известным режимом токена добавляет, что будет именно с этим вызовом", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ mode: "assistant" }), { status: 200 })) as unknown as typeof fetch;
    const result = (await handleMcpMessage({ id: 1, method: "tools/list" }, settings, { fetchImpl })) as { tools: Array<{ name: string; description: string }> };
    expect(result.tools.find((t) => t.name === "orion_update_note")!.description).toContain("Ваш режим «помощник»: изменение НЕ применяется");
    expect(result.tools.find((t) => t.name === "orion_create_note")!.description).toContain("Ваш режим «помощник»: выполняется сразу");
    const init = (await handleMcpMessage({ id: 2, method: "initialize" }, settings, { fetchImpl })) as { instructions: string };
    expect(init.instructions).toContain("Режим ЭТОГО токена: «assistant»");
    // Unreachable ORION: the generic text, no failure.
    const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const generic = (await handleMcpMessage({ id: 3, method: "tools/list" }, settings, { fetchImpl: down })) as { tools: Array<{ description: string }> };
    expect(generic.tools[0]!.description).not.toContain("Ваш режим");
  });

  it("initialize подсказывает начать с orion_get_context", async () => {
    const result = (await handleMcpMessage({ id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, settings)) as { protocolVersion: string; instructions: string };
    expect(result.protocolVersion).toBe("2025-03-26");
    expect(result.instructions).toContain("orion_get_context");
  });

  it("вызов инструмента — один HTTP-запрос с токеном в заголовке", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "n1" }), { status: 201 });
    }) as unknown as typeof fetch;
    const result = (await handleMcpMessage(
      { id: 2, method: "tools/call", params: { name: "orion_capture", arguments: { text: "идея", hint: "idea" } } },
      settings,
      { fetchImpl }
    )) as { content: Array<{ text: string }> };
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:4000/ai/v1/capture");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ text: "идея", hint: "idea" });
    expect(result.content[0]!.text).toContain("n1");
  });

  it("токен не попадает ни в ошибку сети, ни в ответ сервера, ни в сообщение об ошибке", async () => {
    const echoing = (async () => new Response(JSON.stringify({ message: `bad ${TOKEN}` }), { status: 403 })) as unknown as typeof fetch;
    const refused = (async () => {
      throw new Error(`connect ECONNREFUSED while sending ${TOKEN}`);
    }) as unknown as typeof fetch;
    for (const fetchImpl of [echoing, refused]) {
      const result = (await handleMcpMessage({ id: 3, method: "tools/call", params: { name: "orion_get_context", arguments: {} } }, settings, { fetchImpl })) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    }
    expect(redact(`x ${TOKEN} y`, TOKEN)).not.toContain(TOKEN);
  });

  it("без токена — подсказка, как его выпустить, а не обращение к сети", async () => {
    const fetchImpl = (async () => {
      throw new Error("не должно вызываться");
    }) as unknown as typeof fetch;
    const result = (await handleMcpMessage({ id: 4, method: "tools/call", params: { name: "orion_whoami", arguments: {} } }, { apiUrl: settings.apiUrl, token: "" }, { fetchImpl })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Подключить программу");
  });

  it("неизвестный инструмент — ошибка протокола; уведомление без ответа", async () => {
    await expect(handleMcpMessage({ id: 5, method: "tools/call", params: { name: "nope" } }, settings)).rejects.toThrow("Неизвестный инструмент");
    expect(await handleMcpMessage({ method: "notifications/initialized" }, settings)).toBeUndefined();
  });
});

describe("loadSettings", () => {
  it("токен из окружения; флаги побеждают; адрес без хвостового слэша", () => {
    expect(loadSettings({ ORION_AGENT_TOKEN: ` ${TOKEN} `, ORION_API_URL: "http://h:1/" }, [])).toEqual({ apiUrl: "http://h:1", token: TOKEN });
    expect(loadSettings({ ORION_API_URL: "http://env" }, ["--api-url=http://flag/"]).apiUrl).toBe("http://flag");
    expect(loadSettings({}, []).apiUrl).toBe("http://127.0.0.1:4000");
  });
});

describe("resolveAgentConnection (мастер «Подключить агента»)", () => {
  const exists = (known: string[]) => (path: string) => known.some((k) => path.replace(/\\/g, "/").endsWith(k));

  it("установленная версия: команда — её собственный node.exe, аргумент — скомпилированный адаптер", () => {
    const info = resolveAgentConnection({
      baseDir: "C:/Program Files/ORION/runtime/api/dist/ai",
      execPath: "C:/Program Files/ORION/runtime/node.exe",
      env: { PORT: "4000" },
      server: false,
      exists: exists(["runtime/api/dist/mcp/orion-mcp.js", "ORION/runtime/AGENT_MANUAL.md"])
    });
    expect(info.launcher).toBe("installed");
    expect(info.command).toBe("C:/Program Files/ORION/runtime/node.exe");
    expect(info.args[0]!.replace(/\\/g, "/")).toMatch(/runtime\/api\/dist\/mcp\/orion-mcp\.js$/);
    expect(info.apiUrl).toBe("http://127.0.0.1:4000");
    expect(info.manualPath).not.toBeNull();
  });

  it("исходники без сборки — dev-обёртка; ничего нет — unavailable", () => {
    expect(resolveAgentConnection({ baseDir: "/repo/apps/api/src/ai", env: {}, server: false, exists: exists(["scripts/orion-mcp.mjs"]) }).launcher).toBe("repo");
    const none = resolveAgentConnection({ baseDir: "/repo/apps/api/src/ai", env: {}, server: false, exists: () => false });
    expect(none.launcher).toBe("unavailable");
    expect(none.command).toBeNull();
  });

  it("server-режим не раскрывает пути своего компьютера", () => {
    const info = resolveAgentConnection({ baseDir: "/srv/orion/api/dist/ai", env: { ORION_PUBLIC_API_URL: "https://orion.example.com/" }, server: true, exists: () => true });
    expect(info.mode).toBe("server");
    expect(info.command).toBeNull();
    expect(info.args).toEqual([]);
    expect(info.manualPath).toBeNull();
    expect(info.apiUrl).toBe("https://orion.example.com");
  });
});
