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
