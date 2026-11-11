import { Injectable } from "@nestjs/common";
import { AgentModuleToolsService } from "../ai/agent-module-tools.service";
import type { AgentRequest } from "../ai/agent-token.guard";
import type { AgentContext, AuditMeta } from "../ai/agent-tokens.service";

/**
 * Обёртка вызова инструмента модуля для слоя MCP (задание 11.4).
 *
 * Доменные модули не импортируют `ai/agent-module-tools.service` напрямую (G4: чужой сервис —
 * только через контракт). `mcp` — ядро/адаптер, поэтому тонкий фасад живёт здесь: модуль отдаёт
 * имя инструмента из каталога, а разрешение, режим токена, включённость модуля и запись в
 * `AgentAuditEntry` делает существующий механизм. Никакой второй политики доступа не появляется.
 */
@Injectable()
export class AgentToolRunner {
  constructor(private readonly tools: AgentModuleToolsService) {}

  run<T>(
    req: AgentRequest,
    toolName: string,
    fn: (agent: AgentContext) => Promise<T>,
    meta: (result: T) => AuditMeta & { resource?: string } = () => ({})
  ): Promise<T> {
    return this.tools.run(req, toolName, fn, meta);
  }
}
