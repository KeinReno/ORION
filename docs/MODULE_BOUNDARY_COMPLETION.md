# Завершение межмодульных границ

Текущая работа по [ADR-0034](adr/ADR-0034-module-boundary-completion.md),
начата 26.10.2026 на 27bcb0e. Исходно 17 исключений; цель — ноль.

## Этап 1 — Goals: 17 → 16

ProjectCatalog сохраняет существующий расчёт прогресса и реестр агрегатов.
Task/Milestone проекции принадлежат владельцам, принимают исходный tx.
Проверка добавления проекта использует ProjectReferences. Goals больше не
импортирует полный ProjectsModule. Схема, UI и данные не менялись.

Проверено: API typecheck, focused ESLint, architecture-check, module-docs,
контрактный snapshot (2), plugin contracts (11), Goals integration (7).
Новый сценарий проверяет RLS, scope при доступе к двум пространствам,
видимость незакоммиченных данных и rollback. Финальные общие проверки ещё впереди.

## Этап 2 — Home Utilities: 16 → 15

HomeUtilityReferences проверяет активный дом и электрический счётчик в исходном tx.
404, привязка к дому, ограничения пространства и проверки плагина сохранены.
SDK не загружает HomeModule. Проверено: architecture-check, API typecheck,
focused ESLint, Home integration (7, включая коммуналку, тарифы, платежи и изоляцию).

## Этап 3 — Overview: 15 → 14

TaskOverviewReader и FinanceOverviewReader возвращают DTO-проекции без имени
пространства. Overview сохраняет отдельную RLS-транзакцию на пространство,
проверку доступных модулей, membership задачи, валюты и устранение дублей.
Баланс вычисляется прежним finance helper внутри владельца данных.
Проверено: architecture-check, API typecheck, focused ESLint, Overview integration (2).

## Этап 4 — Markets: 14 → 13

InvestmentJournal реализован в Finance, текущем владельце InvestmentTrade.
Журнал, импорт и атомарная запись комиссии перенесены без изменения правил:
только реальные сделки, явное подтверждение суммы, без повторного списания.
Markets сохраняет свои API и watchlist; FinanceModule целиком не загружается.
Проверено: architecture-check, API typecheck, focused ESLint, Markets integration (6).

## Этап 5 — Note attachments: 13 → 12

DocumentAttachmentStore владеет метаданными документов, общей папкой и загрузкой.
Notes хранит только ссылки; метаданные читаются пакетом в том же tx без чужого
Prisma include. Отвязка не удаляет файл; повторная привязка, папка вместо файла,
корзина и отключение Documents сохраняют прежние правила. Notes не загружает
полный DocumentsModule и его cron. Проверено: architecture-check, API typecheck,
focused ESLint, API/RLS integration (23, включая вложения и выключение Documents).

## Этап 6 — Search / Agent undo: 12 → 10

TaskOperations и NoteOperations задают публичные CRUD-команды и создание в
исходной транзакции. Общий implementation используется доменом и SDK, без
повторной регистрации lifecycle-провайдеров. Search, Captures и AI используют
контракты; создание task agent journal перенесено в Tasks.createFromAgentTx.
Полностью удалены исключения Search и AgentUndo; зависимости других AI-сервисов
сократились, но их чтение ещё предстоит перенести.
Проверено: architecture-check, API typecheck, focused ESLint; integration:
create-and-link, agent-manager, agent-gateway, captures — 32 сценария.

## Этап 7 — Captures / Project captures: 10 → 8

Все семь типов якорей проверяются через SDK владельцев: Projects, Tasks, Goals,
Home, Finance, Contacts. Сохраняются порядок проверки existence/module, архивные
ссылки, 404 и исходный tx. CaptureOperations обслуживает старые проектные маршруты
без загрузки полного CapturesModule/TasksModule в Projects.
Проверено: architecture-check, API typecheck, focused ESLint;
Captures + Project captures + Goals integration — 16 сценариев.

## Этап 8 — Activity: 8 → 7

TaskJournalReader и AgentJournalReader отдают только поля ленты; запросы остаются
в .service.ts владельцев. Activity сохраняет membership/module gate, сортировку,
лимит, авторство и тексты. SDK не загружают TasksModule или AiModule.
Проверено: architecture-check, API typecheck, focused ESLint, Activity integration (1).

## Этап 9 — Lists restore: 7 → 6

Восстановление пунктов проверяет ссылки через InventoryReferences и
TransactionReferences. Сохраняет batch-чтение в исходном tx, проверки занятых
движений, отсутствующих объектов и повторных id. Архивные/выключенные соседи
не меняют прежнюю допустимость ссылки. Полные соседние модули не загружаются.
Проверено: architecture-check, API typecheck, focused ESLint, Lists integration (11).

## Этап 10 — Lists Finance: 6 → 5

ListExpenseCommands владеет блокировкой пунктов и их отметками; bridge сохраняет
проверки суммы и повторного расхода. FinanceExpenseModule предоставляет прежние
read/write контракты без полного FinanceModule. Реализации перенесены из public
в owner .service.ts, так что запросы также проверяются архитектурой.
Проверено после исправления ошибки имени Nest-модуля при переносе: API typecheck,
architecture-check, focused ESLint; Lists + Home integration — 18 сценариев,
включая гонку записи одного расхода. Модульная ошибка не попала в итоговый этап.

## Этап 11 — Lists Inventory: 5 → 4

ListShoppingCommands владеет пунктами/отметками, InventoryShoppingCommands —
остатками, блокировкой позиции и приходом через прежний InventoryService.
Bridge сохраняет порядок блокировок, повторную покупку без второго прихода,
расчёт пополнения и уведомление после commit. Полные ListsModule/InventoryModule
для SDK не загружаются. Проверено: architecture-check, API typecheck, focused
ESLint; Lists Inventory + Inventory concurrency — 7 сценариев.

## Этап 12 — Home: 4 → 3

Home получает привязанные записи и команды переноса от Tasks, Lists, Inventory,
Finance; Contacts владеет CRUD домашних контактов. TaskJournalReader отдаёт ленту,
TaskTimeReader — время для вклада участников, без чужого relation include в Tasks.
Сохранены ограничения модулей, пределы выборок, архивы, отвязка только от данного
дома, телефон/phones, расчёт вклада и отслеживаемое время. Схема не менялась.
Проверено: architecture-check, API typecheck после уточнения TaskStatus в контракте,
ESLint всего API (0 ошибок, прежнее предупреждение Knowledge), Home integration (7).

## Этап 13 — Agent Tokens: 3 → 2

ProjectAgentReader проверяет project fence; TaskIntegrationReader и owner SDK
Notes/Events читают projectId объекта в исходном RLS/пространстве. Существующая
политика archived/trash для fence не меняется. AgentCoreModule импортирует только
малые reference SDK, без доменных контроллеров и lifecycle-провайдеров.
Проверено: architecture-check, API typecheck, ESLint API (0 ошибок);
Agent manager + AI bridge — 21 сценарий, включая fence, роли и отмену создания.

## Этап 14 — Agent Jobs: 2 → 1

Предложения читают узкие owner snapshots только с полями превью, revision,
updatedAt и readOnly. Notes сохраняет скрытие корзины; Events — отказ изменения
внешнего события. EventOperations использует существующую реализацию recurrence
без полного EventsModule/его jobs. Права человека, CAS, stale basis и diff сохранены.
Проверено: architecture-check, API typecheck, ESLint API (0 ошибок);
Agent manager + Gateway integration — 20 сценариев.

## Этап 15 — Agent Gateway: 1 → 0

Gateway читает проекты и ссылки через owner SDK; InboxAgentOperations создаёт
входящие, SearchOperations использует реестр поиска/связей. AI controller также
переведён на ProjectCatalog и AgentDraftOperations. AiModule больше не импортирует
полные Tasks, Notes, Projects, Events, Finance, Inbox, Search ради этих операций.
Сохраняются idempotency, project fence, module/scope gates, аудит и транзакция
создания/связывания. Ноль исключений, без расширения Core или ослабления checker.
Проверено: architecture-check, API typecheck, ESLint API (0 ошибок);
Gateway + Agent manager + AI bridge + Create-and-link — 36 сценариев.
Финальная общая приёмка выполняется отдельно ниже.

## Этап 16 — внутренние helper-импорты и итоговая проверка

Удалён home-refs.util.ts: пять потребителей (Tasks, Lists, Inventory, Contacts,
Finance Obligations) используют HomeReferences.assertTx. Ошибка 400, архивные
ссылки, принадлежность пространству и исходный RLS сохранены. Проверка архитектуры
теперь запрещает скрывать чужие delegate-запросы за непубличным helper-импортом.
Явные public.ts/public-контракты владельцев и Core-only helpers остаются допустимы.
31 тест checker, включая два новых негативных/позитивных сценария, прошёл.

SDK-host интеграционный тест запускает команды/проекции без полных доменных
модулей, контроллеров, cron и регистраций агрегатов; проверяет единый tx/rollback,
двойное членство, RLS и приватные заметки.

Браузерный Agent Manager приведён к текущему раскрываемому разделу настроек и
точному тексту журнала (чтобы не спутать его с индикатором активности). Проверки
согласования, применения, отмены и отзыва доступа сохранены; snapshots панелей
не обновлялись.

## Финальная приёмка, 26.10.2026

- **Исключения: 17 → 0**, без изменения ownership map или расширения Core.
- Unit: **191 файл, 1501 тест**, полный повторный прогон после изменений checker.
- Integration: **110 файлов, 620 тестов; 1 прежний пропуск**, полный повторный
  прогон после удаления helper. Изолированная БД orion_platform_integration на :5444.
- Browser: **47 сценариев**, production API/web; все панели default-full и
  plugins-off, Goals link/unlink, покупка/склад, расход/отмена очистки, агентское
  предложение/подтверждение/журнал/undo/revoke. Изолированная orion_e2e, :4144/:3144.
- Typecheck, production API + web build, architecture-check, plugin contracts
  (включены в unit), contract snapshot, module-docs, platform-map — прошли.
- ESLint: **0 ошибок, 30 существующих предупреждений** в полном прогоне;
  новые/изменённые API, checker и browser test также проверены отдельно.
- Схема БД, миграции, сохранённые данные и пользовательский дизайн не менялись.
  Паспорта модулей, карта возможностей и индекс SDK актуализированы.
- Platform API **1.9.0**, Integration API **1.8.0**.

Воспроизведение: pnpm typecheck; pnpm lint; pnpm exec vitest run --maxWorkers=1
--testTimeout=30000; pnpm exec vitest run --config vitest.integration.config.mts
--maxWorkers=1 (DATABASE_URL/APP_DATABASE_URL только изолированной БД);
pnpm architecture-check; pnpm module-docs:check; pnpm platform-map:check;
node scripts/e2e-local.mjs e2e/panels.spec.ts e2e/project-goals-card.spec.ts
e2e/lists.spec.ts e2e/lists-inventory.spec.ts e2e/agent-manager.spec.ts.

Статический checker не разбирает произвольный SQL и неизвестные алиасы Prisma.
Эти ограничения не использованы для переноса долга: реализации новых запросов
находятся у владельцев в проверяемых .service.ts. Новая Windows-сборка/установка
не входят в эту приёмку; проверены production API и браузерный веб-клиент.
