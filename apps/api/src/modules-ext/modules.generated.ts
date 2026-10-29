// АВТОГЕНЕРИРУЕТСЯ scripts/module-registry.mjs из modules-ext/*/module.manifest.json — руками не править.
// Обновить: pnpm module-registry; сверить: pnpm module-registry --check.
import { AgentHubModule } from "./agent-hub/agent-hub.module";
import { ChatArchiveModule } from "./chat-archive/chat-archive.module";
import { PetCareModule } from "./pet-care/pet-care.module";
import { AgentHubAgentController } from "./agent-hub/agent-hub.agent.controller";
import { ChatArchiveAgentController } from "./chat-archive/chat-archive.agent.controller";
import { PetCareAgentController } from "./pet-care/pet-care.agent.controller";

/** Nest-модули подключаемых модулей; app.module.ts разворачивает этот список в `imports`. */
export const GENERATED_NEST_MODULES = [AgentHubModule, ChatArchiveModule, PetCareModule];

/** Контроллеры маршрутов агента `ai/v1/<модуль>/*` (G13): тест «инструмент ↔ маршрут» сверяет их с каталогом. */
export const GENERATED_AGENT_CONTROLLERS = [AgentHubAgentController, ChatArchiveAgentController, PetCareAgentController];
