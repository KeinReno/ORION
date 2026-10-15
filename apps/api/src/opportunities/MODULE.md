# Opportunities Base

Модуль `opportunities`, дополнительный, самостоятельный. Паспорт R0.1; 14 октября 2026.

Владеет карточками вакансий/заказов, условиями, источником, статусом, архивом и журналом локальных правок. Не владеет профилями людей, отправкой, LLM и HH-сессиями.

Публичный контракт: `packages/shared-types/src/opportunity.ts`; REST `/workspaces/:workspaceId/opportunities`; клиент `@orion/core`, hooks `@orion/core-react`.
Чтение/создание/PATCH, archive/restore через POST с expectedRevision; поиск и фильтры, cursor pagination по стабильному id; owner-only export до 10 000 записей (JSON API, JSON/CSV в UI). PATCH требует CAS revision; история записывается в той же транзакции.

API и сервис проверяют включение/restriction; сервис дополнительно проверяет membership внутри withUser. Данные защищены ENABLE/FORCE RLS и workspace FK. Disable не удаляет данные. Backup registry включает Opportunity, credentials в Base отсутствуют.

Работает без всех optional plugins и соседних модулей. Base не импортирует concrete plugins. R0.2 добавляет публичный OPPORTUNITIES_IMPORT_PORT.v1 (insert-only capture, external lookup, scoped existence check) и typed UI slots opportunities.views / opportunities.details.sections. Композиция расширений вынесена в отдельный OpportunityExtensionsModule; никакой HH/profile логики в Base нет.

Модель: Prisma Opportunity; `conditions` — структурированный JSON, `history` — последовательность действий/статусов, не полный diff каждой версии. Не считать локальную правку/статус доказательством внешней отправки.

Приёмка: `apps/api/test/opportunities.integration.test.ts`, boundary schemas, snapshot/RLS suites. UI smoke — отдельная синтетическая учётная запись. Инструкции/оставшиеся критерии: `docs/OPPORTUNITY_HUB_PROGRESS.md`, `docs/OPPORTUNITY_HUB_SPEC.md`.
