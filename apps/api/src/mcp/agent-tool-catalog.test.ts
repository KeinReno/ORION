import { describe, expect, it } from "vitest";
import { selectAgentTools, type AgentToolAvailability } from "./agent-tool-catalog";

function available(overrides: Partial<AgentToolAvailability> = {}): AgentToolAvailability {
  return {
    scopes: [],
    modulePermissions: [],
    modules: new Set(["orion-dev", "tasks", "notes", "projects", "knowledge", "pet-care"]),
    ...overrides
  };
}

describe("динамический tools/list (аренда scope'ов)", () => {
  it("новые read-only инструменты видны только с разрешением модуля и включённым модулем", () => {
    const without = selectAgentTools(available()).map((tool) => tool.name);
    expect(without).not.toContain("orion_git_graph");
    expect(without).not.toContain("orion_architect_map");

    const granted = selectAgentTools(available({ modulePermissions: ["orion-dev.development_import.read"] })).map((tool) => tool.name);
    expect(granted).toEqual(expect.arrayContaining(["orion_git_graph", "orion_architect_map"]));
  });

  it("выключенный модуль скрывает инструмент, даже если разрешение выдано", () => {
    const hidden = selectAgentTools(
      available({
        modulePermissions: ["orion-dev.development_import.read"],
        modules: new Set(["tasks", "notes"])
      })
    ).map((tool) => tool.name);
    expect(hidden).not.toContain("orion_git_graph");
    expect(hidden).not.toContain("orion_architect_map");
  });

  it("инструменты ядра фильтруются по scope'ам токена, а не по модулям", () => {
    const scopeOnly = selectAgentTools(available({ scopes: ["tasks:read"] })).map((tool) => tool.name);
    expect(scopeOnly).toEqual(expect.arrayContaining(["orion_get_context", "orion_list_tasks"]));
    expect(scopeOnly).not.toContain("orion_create_note");
    expect(scopeOnly).not.toContain("orion_get_note");

    const writer = selectAgentTools(available({ scopes: ["notes:write"] })).map((tool) => tool.name);
    expect(writer).toContain("orion_create_note");
    expect(writer).not.toContain("orion_list_tasks");
  });

  it("чужое разрешение не открывает инструмент модуля", () => {
    const tools = selectAgentTools(available({ modulePermissions: ["pet-care.pet.read"] })).map((tool) => tool.name);
    expect(tools).toContain("orion_pet_care_list_pets");
    expect(tools).not.toContain("orion_git_graph");
  });
});
