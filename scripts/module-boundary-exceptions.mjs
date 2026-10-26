// G4: ВРЕМЕННЫЕ исключения из правила межмодульных границ (architecture-check, moduleBoundaryViolations).
// Каждая запись — существующий долг: сервис файла сегодня трогает чужую таблицу или импортирует чужой сервис.
// Список может ТОЛЬКО сокращаться: новая запись допустима лишь вместе с ADR; запись, которой в коде больше нет
// (долг погашен), обязана быть удалена — иначе проверка падает как «устарела». Закрытие — провайдеры агрегатов
// (projects), позже события G3 и провайдеры Search/Inbox/Overview (G19).
export const MODULE_BOUNDARY_EXCEPTIONS = {
  "apps/api/src/activity/activity.service.ts": { models: ["AgentAuditEntry","TaskActivity","TaskComment"] },
  "apps/api/src/ai/agent-gateway.service.ts": { models: ["Event","InboxItem","Note","Project","Task"], services: ["events/events.service","inbox/inbox.service","search/search.service"] },
  "apps/api/src/ai/agent-jobs.service.ts": { models: ["Event","Note","Task"], services: ["events/events.service"] },
  "apps/api/src/ai/agent-tokens.service.ts": { models: ["Event","Note","Project","Task"] },
  "apps/api/src/home/home.service.ts": { models: ["Contact","FinanceObligation","InventoryItem","List","Task","TaskActivity","TaskComment"] },
  "apps/api/src/lists-finance/lists-finance.service.ts": { models: ["List","ListItem"], services: ["lists/lists.service"] },
  "apps/api/src/lists-inventory/lists-inventory.service.ts": { models: ["InventoryItem","InventoryMovement","List","ListItem"], services: ["inventory/inventory.service","lists/lists.service"] },
  "apps/api/src/lists/lists.service.ts": { models: ["InventoryItem","InventoryMovement","Transaction"] },
};
