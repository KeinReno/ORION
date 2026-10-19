import { describe, expect, it } from "vitest";
import { AGENT_SCOPES, createAgentTokenInputSchema } from "./agent";
import {
  AGENT_CAPTURE_HINTS,
  AGENT_CAPTURE_HINT_INFO,
  agentAccessibleTypes,
  agentCaptureInputSchema,
  buildOrionLink,
  parseOrionLink
} from "./agent-gateway";
import { AGENT_TOOLS, agentToolByName, agentToolDescription, buildAgentToolRequest, isExtensionAgentPermission } from "./agent-tools";
import { isRegisteredPermission } from "./permissions";

describe("каталог инструментов агента", () => {
  it("имена уникальны и начинаются с orion_", () => {
    const names = AGENT_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^orion_[a-z_]+$/);
  });

  it("разрешения инструментов — только настоящие scopes", () => {
    for (const tool of AGENT_TOOLS) for (const scope of tool.scopes ?? []) expect(AGENT_SCOPES).toContain(scope);
  });

  it("каждый параметр пути объявлен в схеме и обязателен; required ⊆ properties", () => {
    for (const tool of AGENT_TOOLS) {
      const properties = Object.keys(tool.input.properties);
      for (const required of tool.input.required) expect(properties, `${tool.name}.${required}`).toContain(required);
      for (const [, param] of tool.http.path.matchAll(/\{(\w+)\}/g)) {
        expect(properties, `${tool.name}: {${param}}`).toContain(param);
        expect(tool.input.required, `${tool.name}: {${param}}`).toContain(param);
      }
    }
  });

  it("пример аргументов проходит схему capture", () => {
    const capture = agentToolByName("orion_capture");
    expect(capture?.example).toBeDefined();
    expect(agentCaptureInputSchema.safeParse(capture?.example).success).toBe(true);
  });

  it("hint-ы capture в каталоге совпадают с контрактом", () => {
    const capture = agentToolByName("orion_capture");
    const hintEnum = (capture?.input.properties.hint as { enum: string[] }).enum;
    expect(hintEnum).toEqual([...AGENT_CAPTURE_HINTS]);
    for (const hint of AGENT_CAPTURE_HINTS) expect(AGENT_CAPTURE_HINT_INFO[hint].scope).toMatch(/:write$/);
  });
});

describe("buildAgentToolRequest", () => {
  it("подставляет параметры пути и убирает их из тела", () => {
    const tool = agentToolByName("orion_update_task")!;
    expect(buildAgentToolRequest(tool, { taskId: "a/b", status: "done" })).toEqual({ method: "PATCH", path: "/ai/v1/tasks/a%2Fb", body: { status: "done" } });
  });

  it("GET: остальные аргументы идут в query, пустые отбрасываются", () => {
    const tool = agentToolByName("orion_search")!;
    expect(buildAgentToolRequest(tool, { q: "бюджет 2026", extra: undefined })).toEqual({ method: "GET", path: "/ai/v1/search?q=%D0%B1%D1%8E%D0%B4%D0%B6%D0%B5%D1%82+2026" });
  });

  it("POST без аргументов — без тела; DELETE — по пути", () => {
    expect(buildAgentToolRequest(agentToolByName("orion_mark_message_read")!, { messageId: "m1" })).toEqual({ method: "POST", path: "/ai/v1/messages/m1/read" });
    expect(buildAgentToolRequest(agentToolByName("orion_unlink_objects")!, { linkId: "l1" })).toEqual({ method: "DELETE", path: "/ai/v1/links/l1" });
  });

  it("без параметра пути — понятная ошибка", () => {
    expect(() => buildAgentToolRequest(agentToolByName("orion_get_note")!, {})).toThrow("noteId");
  });
});

describe("ссылки orion://", () => {
  it("строятся и разбираются обратно, в том числе из веб-формы /open?…", () => {
    const link = buildOrionLink({ type: "note", id: "n 1", workspaceId: "w1" });
    expect(link.startsWith("orion://open?")).toBe(true);
    expect(parseOrionLink(link)).toEqual({ type: "note", id: "n 1", workspaceId: "w1" });
    expect(parseOrionLink("/open?type=project&id=p&workspace=w")).toEqual({ type: "project", id: "p", workspaceId: "w" });
  });

  it("мусор и неизвестные типы отвергаются", () => {
    expect(parseOrionLink("orion://open?type=note&id=x")).toBeNull();
    expect(parseOrionLink("orion://open?type=database&id=x&workspace=w")).toBeNull();
    expect(parseOrionLink("")).toBeNull();
  });
});

describe("agentAccessibleTypes", () => {
  it("тип открыт чтением или записью; без scope — не виден", () => {
    expect(agentAccessibleTypes(["notes:write", "projects:read"])).toEqual(["project", "note"]);
    expect(agentAccessibleTypes(["agents:message", "finance:draft"])).toEqual([]);
  });
});

describe("инструменты подключаемых модулей (G13)", () => {
  const moduleTools = AGENT_TOOLS.filter((tool) => tool.moduleId);

  it("есть образец Pet Care, и каждому инструменту нужно разрешение из реестра, а не scope", () => {
    expect(moduleTools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["orion_pet_care_list_pets", "orion_pet_care_add_entry"]));
    for (const tool of moduleTools) {
      expect(tool.scopes, tool.name).toBeNull();
      expect(tool.group, tool.name).toBe("modules");
      expect(isRegisteredPermission(tool.permission ?? ""), tool.name).toBe(true);
      expect(isExtensionAgentPermission(tool.permission ?? ""), tool.name).toBe(true);
      expect(agentToolDescription(tool)).toContain(tool.permission);
    }
  });

  it("разрешения ядра не выдаются как разрешения модулей", () => {
    expect(isExtensionAgentPermission("tasks.task.create")).toBe(false);
    expect(isExtensionAgentPermission("pet-care.pet.delete")).toBe(false);
  });

  it("токен можно выпустить только с разрешениями модуля", () => {
    const parsed = createAgentTokenInputSchema.parse({ name: "Кормёжка", modulePermissions: ["pet-care.pet.read"] });
    expect(parsed.scopes).toEqual([]);
    expect(createAgentTokenInputSchema.safeParse({ name: "Пусто" }).success).toBe(false);
  });
});
