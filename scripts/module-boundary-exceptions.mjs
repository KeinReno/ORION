// G4: ВРЕМЕННЫЕ исключения из правила межмодульных границ (architecture-check, moduleBoundaryViolations).
// Каждая запись — существующий долг: сервис файла сегодня трогает чужую таблицу или импортирует чужой сервис.
// Список может ТОЛЬКО сокращаться: новая запись допустима лишь вместе с ADR; запись, которой в коде больше нет
// (долг погашен), обязана быть удалена — иначе проверка падает как «устарела». Закрытие — провайдеры агрегатов
// (projects), позже события G3 и провайдеры Search/Inbox/Overview (G19).
export const MODULE_BOUNDARY_EXCEPTIONS = {
  "apps/api/src/activity/activity.service.ts": { models: ["AgentAuditEntry","TaskActivity","TaskComment"] },
  "apps/api/src/ai/agent-gateway.service.ts": { models: ["Event","InboxItem","Note","Project","Task","TaskActivity"], services: ["events/events.service","inbox/inbox.service","notes/notes.service","search/search.service","tasks/tasks.service"] },
  "apps/api/src/ai/agent-jobs.service.ts": { models: ["Event","Note","Task"], services: ["events/events.service","notes/notes.service","tasks/tasks.service"] },
  "apps/api/src/ai/agent-tokens.service.ts": { models: ["Event","Note","Project","Task"] },
  "apps/api/src/ai/agent-undo.service.ts": { services: ["notes/notes.service","tasks/tasks.service"] },
  "apps/api/src/captures/captures.service.ts": { models: ["Account","Contact","FinanceObligation","Goal","Home","Project","Task"], services: ["tasks/tasks.service"] },
  "apps/api/src/home/home.service.ts": { models: ["Contact","FinanceObligation","InventoryItem","List","Task","TaskActivity","TaskComment"] },
  "apps/api/src/lists-finance/lists-finance.service.ts": { models: ["List","ListItem"], services: ["lists/lists.service"] },
  "apps/api/src/lists-inventory/lists-inventory.service.ts": { models: ["InventoryItem","InventoryMovement","List","ListItem"], services: ["inventory/inventory.service","lists/lists.service"] },
  "apps/api/src/lists/lists.service.ts": { models: ["InventoryItem","InventoryMovement","Transaction"] },
  "apps/api/src/markets/markets.service.ts": { models: ["FinanceCategory","InvestmentTrade","Transaction"] },
  "apps/api/src/notes/note-attachments.service.ts": { models: ["Document"], services: ["documents/documents.service"] },
  "apps/api/src/overview/overview.service.ts": { models: ["Account","Task"] },
  "apps/api/src/projects/project-captures.service.ts": { services: ["captures/captures.service"] },
  "apps/api/src/search/search.service.ts": { services: ["notes/notes.service","tasks/tasks.service"] },
};
