# Opportunity Hub — реализация и передача следующему агенту

Обновлено: 14 октября 2026. Исходная ревизия: `d590fc3`.
ТЗ: [OPPORTUNITY_HUB_SPEC.md](OPPORTUNITY_HUB_SPEC.md); архитектура: [ADR-0008](adr/ADR-0008-opportunity-hub.md).

## Состояние

Реализован первый самостоятельный срез **R0.1 Base**: вакансии и заказы, локальные условия/источник, статусы, история действий, поиск/фильтры, постраничное чтение, архив/восстановление, JSON/CSV экспорт. Это не завершённый R0/R1 и не автономный ИИ-менеджер.

Данные сохраняются в PostgreSQL, включены в snapshot registry и восстановление. Новая additive migration `20261013220000_opportunities` применена к локальной разработческой базе; сброса базы не было.

HH не изменялся и не импортировался. Внешних сообщений/откликов не было. Профили, факты, материалы, imports, LLM, подключения HH, grants/runner пока не реализованы. Новые frontend slots из ADR-0008 пока не добавлены; Base не импортирует плагины.

## Код и контракты

- `packages/shared-types/src/opportunity.ts`: строгие input DTO, явные response DTO, kinds/statuses/conditions/query; отсутствие суммы = null, диапазон валидируется, source URL только HTTP(S).
- `apps/api/src/opportunities`: API/service/module, [MODULE.md](../apps/api/src/opportunities/MODULE.md), [AI_CONTEXT.md](../apps/api/src/opportunities/AI_CONTEXT.md).
- Prisma Opportunity: workspace FK, unique source/external ID, revision, conditions/history JSON; ENABLE/FORCE RLS.
- `@orion/core`: методы CRUD/read/export; `@orion/core-react`: scoped infinite-query и mutations.
- `apps/web/panels/OpportunitiesPanel.tsx`: существующий PanelShell/UI, отдельный workspace context, input сохранён при ошибке, guard смены пространства/закрытия панели и beforeunload.
- `apps/web/lib/opportunity-export.ts`: CSV с BOM/semicolon, escaping и neutralization формул; JSON содержит schemaVersion/exportedAt/workspaceId.
- Catalog/panel registry/AppModule/snapshot registries обновлены только для новой сущности.

## API R0.1

Prefix `/workspaces/:workspaceId/opportunities`:

| Method/path | Поведение |
| --- | --- |
| GET `/` | query/kind/status/includeArchived/cursor/limit; 50 default, 200 max; items/nextCursor |
| GET `/:id` | Только карточка текущего workspace |
| POST `/` | Создание; duplicate source/external ID →409 |
| PATCH `/:id` | expectedRevision обязателен; пустой patch →400; конфликт →409 |
| POST `/:id/archive` | expectedRevision; данные/история сохраняются |
| POST `/:id/restore` | expectedRevision; вернуть из архива |
| GET `/export` | Owner-only, до 10 000 записей, включая архив; без тихого truncation |

Каждый service method проверяет membership/роль и module enabled/restricted внутри withUser. Controller guard — дополнительная защита, не замена проверки сервиса. Row lookup всегда workspace-scoped.

## Важные решения первого среза

1. Cursor упорядочен по стабильному `id asc`, а не updatedAt/id из исходного проектируемого API: правки не сдвигают уже открытый cursor. Это явно ограниченный выбор R0.1; для сортировки «свежие сверху» нужен отдельный устойчивый контракт.
2. История хранит actor/time/action/fromStatus/toStatus, не полный diff всех полей. Ни ручной статус, ни запись истории не свидетельствуют об отправке на HH.
3. При конфликте редактор сохраняет локальный ввод; кнопка загрузки свежей revision не отправляет patch. Повторное сохранение передаёт только локально изменённые поля, остальные правки второго клиента остаются. Conditions объединяются по изменённым полям.
4. Whole-workspace export ограничен owner по ТЗ. Действия агента и внешняя отправка в этом API отсутствуют.
5. Новый модуль следует текущей catalog-модели, defaultEnabled true; existing defaults не менялись. Опциональных плагинов пока нет.
6. Условия хранятся как данные карточки; финансовых проводок, валютных конверсий и связи с балансом нет. Дополнительные структурированные требования/дедлайн и специализированные представления расширять отдельным срезом, сохраняя версии.

## Проверка

| Проверка | Результат |
| --- | --- |
| Prisma generate / migrate deploy | Пройдены, новая миграция применена |
| Workspace typecheck | Пройден; последующие frontend изменения проверяются сборкой |
| Полный unit suite | 71 файл, 552 теста, все пройдены |
| CSV и opportunity boundaries | 4 целевых теста пройдены, включая формулы/кавычки/переводы строк |
| Новый integration suite | 5 тестов пройдены: CRUD/filter/page/export/archive/history, CAS race, чужой workspace/raw RLS, restricted member/owner export, реальный snapshot roundtrip |
| Общие API-RLS и snapshot integration | 30 тестов пройдены |
| architecture-check | Пройден |
| plugin-contract-check | 10 тестов пройдены |
| lint | 0 ошибок; два существующих hook warnings в CalendarPanel/DocumentsPanel |
| Полная сборка | Пройдена; после финальных изменений CSV/подписей повторно пройдены workspace typecheck и production web build |

Команды для повторения:

```text
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm architecture-check
corepack pnpm plugin-contract-check
corepack pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/opportunities.integration.test.ts apps/api/test/snapshot.integration.test.ts apps/api/test/api-rls.integration.test.ts
corepack pnpm build
```

Для выбора файлов vitest использовать прямой `pnpm exec vitest run ...`; первоначальная обёртка с дополнительным `--` была остановлена без результата и не считается пройденной проверкой.

### Живой UI smoke

Создана отдельная синтетическая учётная запись и workspace. Проверены:

- вход и доступ к новой панели через обычную навигацию;
- создание вакансии с суммой 80 000–100 000 и описанием;
- архивирование и восстановление; история сохранилась;
- range validation: неправильная верхняя граница отклоняется, введённые значения остаются;
- параллельная HTTP-правка компании, конфликт локального title, загрузка свежей revision без потери ввода и сохранение только своей правки; компания второго клиента сохранена;
- видимое оформление в оболочке ORION.

После проверки выполнен logout; созданные только для smoke user/workspace удалены с проверкой их идентичности. Временный файл с токеном удалён. Скриншот результата сохранён как пользовательский output чата; реальные личные материалы в тест не переносились.

Не проверены: установленный EXE, clean machine, мобильный/320px/full keyboard проход, все визуальные parity-сценарии соседних модулей. Lint/typecheck/живой desktop-sized браузер не подменяют эти проверки.

## Следующий срез

R0.2: profiles/material versions и HH import preview/apply по ТЗ. Сначала public plugin contracts/slots ADR-0008, затем два отдельные расширения с default-off, guards и backup rules. Не помещать profile/HH/LLM бизнес-логику в Base и не исполнять импортируемые скрипты.

Перед продолжением: git status/history, этот progress, паспорта и actual contracts. ТЗ/ADR не выдавать за реализованный plugin runtime или систему внешних approvals. Режим ИИ-менеджера остаётся закрыт до G11–G20 и явного разрешения владельца конкретного внешнего аккаунта.
