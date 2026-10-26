// G4: ВРЕМЕННЫЕ исключения из правила межмодульных границ (architecture-check, moduleBoundaryViolations).
// Каждая запись — существующий долг: сервис файла сегодня трогает чужую таблицу или импортирует чужой сервис.
// Список может ТОЛЬКО сокращаться: новая запись допустима лишь вместе с ADR; запись, которой в коде больше нет
// (долг погашен), обязана быть удалена — иначе проверка падает как «устарела». Закрытие — провайдеры агрегатов
// (projects), позже события G3 и провайдеры Search/Inbox/Overview (G19).
export const MODULE_BOUNDARY_EXCEPTIONS = {
  "apps/api/src/ai/agent-gateway.service.ts": { models: ["Event","InboxItem","Note","Project","Task"], services: ["inbox/inbox.service","search/search.service"] },
};
