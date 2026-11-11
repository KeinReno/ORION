import { AGENT_TOOLS, type AgentScope, type AgentToolDef } from "@orion/shared-types";

/**
 * Динамический `tools/list` (11.4). Источник остаётся один — каталог `AGENT_TOOLS`; меняется только
 * вопрос «что из него доступно ИМЕННО этому токену сейчас».
 *
 * Механизм аренды не дублируется: инструмент модуля виден, только когда токену выдано его
 * разрешение (`AgentToken.modulePermissions`) и модуль не выключен в пространстве. Инструмент ядра
 * виден по scope'ам токена. Права администрирования/режим токена здесь не расширяются: сервер всё
 * равно проверит их на вызове (`AgentModuleToolsService`/`runOp`), список — только витрина.
 */
export interface AgentToolAvailability {
  scopes: readonly AgentScope[];
  modulePermissions: readonly string[];
  /** Модули, доступные этому пользователю в пространстве (выключенные/ограниченные уже исключены). */
  modules: ReadonlySet<string>;
}

export function selectAgentTools(availability: AgentToolAvailability): AgentToolDef[] {
  return AGENT_TOOLS.filter((tool) => {
    if (tool.moduleId) {
      if (!tool.permission) return false;
      return availability.modulePermissions.includes(tool.permission) && availability.modules.has(tool.moduleId);
    }
    if (tool.scopes === null) return true;
    return tool.scopes.some((scope) => availability.scopes.includes(scope));
  });
}

/** Форма ответа `GET /ai/v1/tools`; ровно то, что MCP-адаптер кладёт в `tools/list`. */
export interface AgentToolListing {
  name: string;
  description: string;
  inputSchema: AgentToolDef["input"];
  /** Модуль, к которому относится инструмент; `null` — инструмент ядра. */
  moduleId: string | null;
}
