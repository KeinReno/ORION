# ORION — состояние на 30 октября 2026

## Приёмка бэкенд-заданий DeepSeek-агентов (задания 01–12) — 12.11.2026

Задания 01–12 из `tasks/deepseek-backend` приняты в `experiment/orion-rust-foundation`. По ходу приёмки
исправлено (исторические блоки ниже описывают состояние до этих правок):

- **Реестры снапшота/синка** (`snapshot-registry.ts`, `sync-classification.ts`, `snapshot.service.ts`):
  добавлены политики `KnowledgeItemRevision`/`KnowledgeSettings` (задание 08; `included`, ключи
  `knowledgeItemRevisions`/`knowledgeSettings`) и sync-классы `NoteStackState`/`AgentMemberEvent`
  (`not-synced`), `KnowledgeItemRevision` (`append-only`), `KnowledgeSettings` (`lww`) — инвентарные
  тесты `whole-node-snapshot-inventory`, `migration-table-inventory`, `sync-classification` зелёные.
- **Sync-реплики полей Task** (`packages/core/src/sync/memory-host.ts`, `replica-view.ts`): в device-view
  доки добавлены поля Tasks 2.0 (`statusId`, `importance`, `urgency`, `complexity`, `executorSource`,
  `archivedAt`) — `taskSchema` их требует, без них копия на устройстве молча отбрасывала задачи.
  `replica-notes-tasks` и `convergence.fuzz` (ТЗ-06 этап 3) зелёные.
- **Формат прав**: `entity-links.read/manage` переименованы в `entity-links.link.read/manage`
  (`module.resource.action`); в перечень действий добавлен `execute` (`core.command.execute`, задание 10)
  — обновлены `PERMISSION_ACTIONS`, тест реестра и `docs/platform-api/PERMISSIONS.md`.
- **Матрица модулей** (`component-dependents.integration.test.ts`): добавлена проба `planning`
  (`GET /planning/blocks`) — модуль появился в `MODULE_CATALOG` в задании 04.
- **Контракт логбука** (задание 05): `.default("")` вложенной схемы ломал `z.ZodType<T>`-инференс в
  api-client — вынесен во входную схему `projectLogAlternativeInputSchema`; service приводит `tasks ?? []`.
- **Типизация интеграционных тестов**: возвращён `T = any` по умолчанию в семи хелперах (сознательный
  дефолт), типы в `workspace-transfer`, `component-dependents`, `qa-orion-dev-journey`, `private-notes`.

Проверки на чистой БД (PostgreSQL 127.0.0.1:5433): `prisma migrate reset --force` — все 175 миграций
применяются с нуля (включая 17 новых); гранты `orion_app`/`orion_system` повторно применены из
`infra/postgres/init/01-app-roles.sql` (grants живут на схеме и теряются при reset — повторять после
любого `migrate reset`). Интеграционные тесты: 782/788 зелёные; 6 отказов — внешние блокировки среды,
не кода: `migration-stage` (initdb не может писать в `B:\Temp` — тот же класс блокировки антивируса,
что и esbuild), `assistant-cli` (внешний Codex CLI завершается с ошибкой), 3 unit-прогона
(`orion-ext` ×2, `platform-map`) — esbuild.exe заблокирован Windows Defender (`Access is denied`).

Прочее: typecheck всех пакетов — зелёный; `pnpm lint` — зелёный (в ignores добавлен чужой профиль
`splash/_chromeprofile/**`); `pnpm --filter @orion/api build` — собирается; `architecture-check`,
`plugin-contract-check` (11/11), `module-docs:check` — OK; unit: 2104 passed / 3 (только esbuild).
`capabilities.generated.json` НЕ перегенерирован — для этого нужно разрешить esbuild в Windows Security,
затем `pnpm platform-map && pnpm platform-map:check`.

## Orion Dev + Git Workspace + Architect + MCP-доступ — 11.11.2026

Задание 11 (backend, волна 3). Новые файлы: `packages/shared-types/src/development-git.ts`,
`development-architect.ts` (+ тест парсера ссылок), `apps/api/src/development/git/*`
(`git-command`, `git-graph-parser`, `development-git.service`, `development-task-links.service`,
контроллеры), `apps/api/src/development/architect/*` (анализатор + сервис + контроллер),
`apps/api/src/development/development-agent.controller.ts`, `apps/api/src/mcp/agent-tool-catalog.ts`
(+ тест), `agent-tool-runner.ts`, `agent-tools.module.ts`,
`apps/api/src/tasks/public/task-trace-reader.*` и `apps/api/src/tasks/task-trace-reader.service.ts`,
миграция `20261111203000_development_git_architect`, интеграционный тест
`apps/api/test/development-workspace.integration.test.ts`.

- **11.1 Git Workspace.** Репозиторий добавляет владелец/лид по абсолютному пути внутри
  `ORION_DEV_REPOSITORY_ROOTS`; путь проходит `realpath`, проверку корня и `.git` и сохраняется
  каноническим. Произвольный путь с клиента в `git` не попадает; при каждом чтении путь
  перепроверяется. `GET …/development/git/:repoId/graph` отдаёт ветки, теги, коммиты (sha, родители,
  автор, дата, сообщение), слияния, `pullRequest: null`, фильтры author/branch/from/to и пагинацию
  курсором по sha (default 500, максимум 2000). `GET …/compare?from=&to=` — отличающиеся коммиты,
  diffstat файлов и ahead/behind. Кэш истории — в памяти процесса, ключ включает подпись `.git`
  (HEAD/index/packed-refs/refs/reflog); меняющие git-операции отсутствуют.
- **11.2 Привязки коммитов.** `TaskCommitLink` (RLS, unique task+repo+sha): разбор
  `taskRefPrefix` (по умолчанию `#`, настраивается на репозиторий) — `#42` это 42-я задача
  пространства по порядку создания, `#<uuid>` — начало id; ссылка разрешается публичным контрактом
  `TaskTraceReader`, только внутри пространства. `POST …/sync-links` идемпотентен; ручные
  link/unlink — `tasks.task.update`. `GET tasks/:id/trace`: создание → поручение → журнал
  статусов/срока → коммиты → проверки (QA-заглушка) → релиз (заглушка), единая timeline-структура с
  явным `placeholder`.
- **11.3 Architect.** Анализатор обходит файлы (без `node_modules`/`.git`/сборочных каталогов),
  строит узлы file/dir/module (index.ts)/crate (Cargo.toml), метрики и рёбра импортов TS/TSX и
  Rust на регулярном уровне, без AST и новых зависимостей. `GET …/architect/:repoId/map?path=`,
  `GET/PUT …/layout` (позиции узлов, viewport, revision → 412/409 при чужой ревизии),
  `GET/PUT …/project-schema`, `GET …/compare` — расхождения «задумано ↔ в коде».
- **11.4 MCP.** `GET /ai/v1/tools` отдаёт отфильтрованный каталог: инструменты модулей видны только
  при выданном разрешении и включённом модуле, инструменты ядра — по scope'ам токена. MCP-адаптер
  берёт `tools/list` у сервера, при недоступности — прежний статический каталог. Новые read-only
  инструменты `orion_git_graph` и `orion_architect_map` идут через существующий
  `AgentModuleToolsService` (разрешение, режим, модуль, `AgentAuditEntry` на каждый вызов).
- **Данные.** Три модели в блоке `BEGIN 11`, RLS `ENABLE`+`FORCE`+membership-политика; внесены в
  `MODEL_OWNERS`, `SNAPSHOT_MODEL_REGISTRY`/`SNAPSHOT_MODELS` и `SYNC_CLASSIFICATION`
  (путь репозитория — `not-synced`, привязки — `strict`, раскладка — `lww`); `TaskCommitLink.createdById`
  ремапится на импортирующего.

Проверки: unit `git-graph-parser` 9/9, `architect-analyzer` 9/9, `agent-tool-catalog` 4/4,
shared-types `development-git` 4/4, `agent-gateway` 17/17; интеграция
`development-workspace.integration.test.ts` 7/7 на реальной PostgreSQL и настоящем `git`
(ветвление+слияние, пагинация, compare, `#42`, ручная привязка/отвязка, trace, карта/раскладка/сравнение,
MCP-список и аудит); `rls-coverage` и `api-rls` — PASS; миграция применена; `architecture-check` — OK;
`plugin-contract-check` 11/11; `module-docs:check` — OK; scoped ESLint по файлам задания — 0.

Ограничения: API и `@orion/shared-types` typecheck — чисто, но общий `pnpm typecheck` красный в
`packages/core` (`api-client.ts`, несовместимость `alternatives` журнала проекта — задание 05);
`platform-map:check` падает на отказе доступа к каталогу выше рабочего (esbuild `Access is denied`);
полный lint завален артефактами `splash/_chromeprofile` (чужой профиль Chromium), файлы задания
чистые; `snapshot`/`sync-classification` тесты красные из-за неклассифицированных
`KnowledgeItemRevision`/`KnowledgeSettings` и `NoteStackState`/`AgentMemberEvent` (другие задания).
`#42` — порядковый номер задачи пространства, потому что короткого номера в схеме задач нет;
QA-проверки и релизы — контрактные заглушки; внешнего Git-провайдера и PR нет; фронтенд (дерево,
2D-редактор) в объём не входил.

## Команда и разграничение прав человек/ИИ — backend, 12.11.2026

Задание 12. Бэкенд: principal-модель членства, срок и аудит приглашений, упоминания в
комментариях и журнале проекта, CAS-ревизия проекта. Фронтенд команды не делался (вне объёма).

- **12.1. Principal-модель.** `WorkspaceMember.kind` (`human | agent`), `status`
  (`active | disabled`), `agentProfileId`, `displayName`; `userId` стал nullable, CHECK требует
  ровно одну ссылку (User или профиль Agent Hub). Миграция проставляет существующим строкам
  `human/active` — их семантика не меняется. Членство агента ссылается на `AgentHubAgentProfile`;
  связь держит триггер БД (`team_agent_member_sync`): профиль появился/переименован/удалён —
  членство появилось/обновило имя/ушло. Это осознанно не Prisma-делегат из `workspaces/`:
  agent-hub — подключаемый модуль, его модели лежат в генерируемой области schema.prisma, а
  публичного контракта-читателя у него нет (architecture-check ловит такие обращения).
- **API команды.** `GET /workspaces/:id/team` — единый список людей, агентов и приглашённых
  (`kind`, `status`, `role`, фильтры `?kind=human|agent`, `?status=active|invited|disabled`).
  Приглашения в нём видят только владелец и лид; состав команды — все участники.
  `GET /workspaces/:id/members` не изменился: только живые люди (у каждого непустой `userId`),
  добавлены поля `kind`/`status`/`agentProfileId`. Роль агента не меняется и строку ростера
  нельзя удалить (400): его подключение — существующий owner-control flow (ADR-0047), отзыв
  credential, а не удаление строки.
- **Права.** Агент никогда не наследует права человека по `role`: его вызовы авторизуются
  scope'ами токена и матрицей разрешений. Проверено: агент с `tasks:read` при создателе-владельце
  получает 403 «нет разрешения `tasks.task.update`», задача не меняется.
- **12.2. Приглашения.** `expiresInDays` (по умолчанию 7 дней; `null` — бессрочно, явный выбор),
  `POST …/invites/:id/resend` — та же строка приглашения (email и роль), новый токен, срок
  перезапускается; аудит `revokedById`, `resentAt`, `resentById`, `resendCount`. Принятие:
  отозванного — 409, истёкшего — 410, уже принятого — 409 (причина в тексте).
- **12.3. Упоминания.** `parseMentions` в `shared-types` (`@Иван`, `@"Иван Петров"`; адрес
  электронной почты упоминанием не считается). Резолв — только по участникам этого пространства.
  Человек получает адресное `Notification` (с его тумблерами и тихими часами), агент —
  `AgentMemberEvent` (`GET /workspaces/:id/team/agents/:memberId/events`). Записи журнала проекта
  используют тот же разбор. Лента уведомлений при чтении проверяет существование объекта в этом
  пространстве: удалённый/невидимый объект отдаётся как «Содержимое недоступно», без тела и
  `entityId`; отметить прочитанным такое уведомление нельзя (404).
- **12.4. CAS проекта.** `Project.revision` + `expectedRevision` в `PATCH …/projects/:id`:
  конфликт — 409 `project_revision_conflict` с текущей копией; правка без токена остаётся
  last-write-wins, но ревизия растёт. Задачи, заметки и материалы знаний уже работали по этому
  контракту; проект приведён к нему.
- **Проверки.** `apps/api/test/team-access.integration.test.ts` — 6 сценариев PASS.
  `shared-workspaces`, `notifications`, `task-comments`, `project-logbook` — PASS (ожидания
  кодов 410/409 у приглашений обновлены). `architecture-check`, `plugin-contract-check` (11),
  `module-docs:check` — OK; изменённые файлы чисты по eslint; typecheck `shared-types`,
  `core`, `core-react`, `ui` и мои файлы API — без ошибок.
- **Ограничения.** `status = "disabled"` в модель добавлен, но процессом пока не выставляется:
  подключение агента выключается отзывом credential (ADR-0047), отдельной ручки «отключить в
  ростере» нет намеренно. Миграции `20261112120000_team_permissions` и
  `20261112121000_team_agent_member_name` применяются к чистой БД. В общем рабочем дереве
  остаются незавершённые правки параллельных заданий: `pnpm --filter api typecheck` падает на
  `tsconfig.test.json` чужих тестов, `platform-map:check` в этой среде не запускается (esbuild не
  может прочитать каталог репозитория — ошибка окружения, не кода).

## Agent Hub 2.0: оркестрация, Trace, Memory — backend, 11.11.2026

Задание 09 (backend). Новые файлы: `packages/shared-types/src/agent-hub-trace.ts`
(+тест), `agent-hub-memory.ts`, `agent-hub-orchestration.ts` (+тест);
`apps/api/src/modules-ext/agent-hub/`: `agent-hub-transitions.service.ts`,
`agent-hub-delegation.service.ts`, `agent-hub-trace.service.ts`,
`agent-hub-memory.service.ts`, `agent-hub-dto.ts`; миграции
`20261111200000_agent_hub_orchestration`, `20261111201000_agent_hub_memory_trace`,
`20261111202000_agent_hub_memory_agent_scope`; интеграционный тест
`apps/api/test/modules-ext/agent-hub/agent-hub-orchestration.integration.test.ts`.
Манифест модуля — `1.1.0`; новые модели объявлены в реестре снапшота.

- **9.1. Делегирование.** `AgentHubExecution` получил `parentExecutionId`,
  `delegationDepth`, `delegatedToProfileId`, `delegationChain` (цепочка профилей,
  защита от циклов), `delegationPayload` (краткое поручение, инструкции,
  задача/проект, `materialLinkIds` из EntityLink, ограничения прав) и
  `resultSummary`. Глубина ограничена политикой пространства `agent_hub_policies`
  (по умолчанию 3, меняет только владелец/руководитель; делегатор может только
  ужесточить). `A → B → A` — 409 `delegation_cycle`, глубина сверх лимита — 409
  `delegation_depth_exceeded`. Дочерняя ветка (`targetKind = delegation`, цель —
  собственный id) видна в очереди только профилю-получателю; родительская ревизия
  не двигается, делегирование фиксируется шагом trace. При завершении дочернего
  исполнения родителю пишется `delegation_result` с итогом, evidence и checkpoint.
- **9.1/9.4. Машина состояний.** Прежние значения статусов сохранены; добавлены
  `waiting_approval` и `reassigned`. Каждый переход проверяется по разрешённому
  списку и пишет `AgentHubEvent` в одной транзакции с состоянием (CAS по
  `revision`). `request_approval` останавливает операцию выше read-only до
  решения человека; `approve` возвращает в `working` с новым lease, `reject`
  завершает `failed` с причиной. `reassign` завершает ветку как `reassigned`
  (терминальный статус, частичный уникальный индекс «одно активное исполнение на
  цель» обновлён) и атомарно открывает независимое исполнение той же цели с новым
  журналом. `AgentHubTransitions.commitTx` — единственная точка смены состояния.
- **9.2. Trace.** Новая таблица `agent_hub_trace_steps`: `tool_call |
  tool_result | delegation | approval_wait | note | error`, `stepId` /
  `parentStepId` (дерево), `agentId`, payload, длительность (для `tool_result`
  считается сервером), ошибка, попытка. `GET …/executions/:id/trace` отдаёт
  плоскую ленту и дерево; `type`, `stepId`, `agentId`, `depth` — фильтры того же
  endpoint. `tool_result` без родительского `tool_call` отклоняется. Внутренние
  рассуждения модели не фиксируются и не восстанавливаются.
- **9.3. Memory.** `AgentMemoryRecord`: scope `user | project | agent | global`,
  `scopeId`, ключ, jsonb-значение, `source`, `agentId`, `provenanceEventId`,
  `validity` (`valid | superseded | outdated`) и `supersededById`; частичный
  уникальный индекс держит одну `valid`-запись на scope/профиль/ключ, перезапись
  создаёт новую ревизию и помечает прежнюю. `POST …/agent-hub/context` собирает
  память областей исполнения (глобальная, проект, агент, пользователь) и
  возможности включённых модулей, ограничивает объём (≤50 записей, 32 КБ) и
  помечает `outdated` как `needsVerification`. User-память, записанная агентом,
  приватна для его профиля: другой агент получает 403 и на чтение (пусто), и на
  перезапись ключа; запись в память проекта ограничена проектным fence токена.
  Чтение/запись агента журналируются в `AgentAuditEntry` через
  `AgentModuleToolsService`. Новые MCP-инструменты: `orion_agent_hub_delegate`,
  `orion_agent_hub_request_approval`, `orion_agent_hub_trace_record`,
  `orion_agent_hub_memory_write`, `orion_agent_hub_memory_read`,
  `orion_agent_hub_context`; права `agent-hub.memory.*` и `agent-hub.policy.*`
  внесены в реестр. `scope-ceiling` не расширялся.

Проверки: unit — новые `agent-hub-trace` 5/5 и `agent-hub-orchestration` 9/9,
прежний `agent-hub-lifecycle` 10/10, каталог инструментов ↔ маршруты 16/16;
интеграция на реальной PostgreSQL/RLS — новые 5/5 (делегирование, цикл, глубина,
approval/reject, trace-дерево и фильтры, память и superseded-цепочка, reassign),
прежние 21/21 Agent Hub без изменения ожиданий; все 170 миграций применены к
чистой временной базе; `pnpm module-registry --check` — OK,
`pnpm module-docs:check` — OK, `pnpm plugin-contract-check` — 11/11; ESLint по
изменённым файлам — 0 ошибок/0 предупреждений; Prisma Client перегенерирован.

Ограничения: глобальные гейты в этом checkout красные из-за параллельных
незавершённых срезов — `architecture-check` зелёный, но общий API-typecheck и
production build API на момент сдачи проходят только по файлам задания (сборка
API собрана); `pnpm lint` целиком падает на артефактах профиля Chrome
`splash/_chromeprofile/**` (минифицированные JS расширений) и на чужих
`workspaces/members.service.ts` / `team.controller.ts`, ESLint по изменённым
файлам — 0 ошибок. `platform-map:check` не запускается в этой среде (esbuild:
`Cannot read directory "../..": Access is denied`), поэтому
`capabilities.generated.json` перегенерирован тем же алгоритмом через TypeScript
API и совпал с прежним выводом плюс версия `agent-hub` 1.1.0. Общий unit-прогон
`packages/shared-types` — 604/605: красный чужой `entity-links.read` (id не
соответствует формату `module.resource.action`, задание 01); `sync`/`ops`
инвентари красные на `NoteStackState` и `AgentMemberEvent` без строки
sync-классификации (задания 07 и 12). Фронтенд Hub/Trace/Memory в объём не
входил (в панели добавлены только подписи двух новых статусов ради типизации);
автоматического диспетчера нет. Истёкший lease в `waiting_approval` при
`reconcile` возвращает исполнение в очередь и сбрасывает запрос подтверждения —
владельцу нужно запросить его снова.

## Центр проектов: иерархия, шаблоны, портфель, история (задание 03) — 11.11.2026

Бэкенд без изменений фронтенда. Схема: `Project.parentId` (self-ref, `SetNull` при удалении родителя,
индекс `(workspaceId, parentId)`), новые таблицы `project_templates` и `project_history_entries`
(обе — `ENABLE` + `FORCE ROW LEVEL SECURITY` + политика по членству; явный `GRANT` ролям приложения
отдельной миграцией, потому что `ALTER DEFAULT PRIVILEGES` из `infra/postgres/init` действует только
в базе, созданной init-скриптом). Миграции: `20261111102912_project_center`, `20261111103000_project_center_grants`.

Добавлено:

- **Иерархия.** Смена/назначение родителя — с блокировкой строки пространства, проверкой предков
  (recursive CTE в `ProjectHierarchyRepository`) и лимитом глубины 6. Цикл → 409 с кодом
  `project_hierarchy_cycle` и путём `A → B → C → A`; слишком глубокое дерево → 400 с причиной.
  `GET projects/:id` отдаёт `ancestors` и `childCount`, `Project` — `parentId`.
  Событие `projects.project.parent_changed`.
- **Шаблоны** (`projects/templates`, права `projects.template.*`): структура — одно JSON-дерево со
  сдвигами в днях (вехи, задачи, записи журнала, дочерние проекты), схема — `projectTemplateStructureSchema`.
  `POST projects/from-template` и `POST projects/:id/duplicate` создают проект + вехи + задачи + записи
  одной транзакцией; задачи создаются публичным `TaskOperations.createTx`, вехи — `MilestoneCommands.createTx`
  (таблицы соседей из projects не пишутся). Дублирование по умолчанию не копирует описания
  (`withContent: false`), не копирует журнал/комментарии/вложения, дочерние проекты — по `withChildren`.
- **Портфель.** `GET projects/portfolio` (`projects.portfolio.read`): прогресс по задачам, открытые задачи,
  просрочка, риски (`no_tasks`, `milestone_without_dates`, `overdue`, `blocked_dependency`), дедлайны,
  загрузка по участникам, распределение по статусам; фильтры `scope/status/memberId/from/to`, пагинация
  `limit/offset` и `page.truncated`. Данные соседей — через расширенные провайдеры агрегатов
  (`openTasksByAssignee` у tasks, `milestonesWithoutDates` у milestones), не чтением чужих таблиц.
- **История.** `GET projects/:id/history` (`projects.history.read`) из append-only `ProjectHistoryEntry`
  с фильтрами `field/from/to` и пагинацией; пишется в транзакции самого изменения, поэтому не расходится
  с данными. Публикуются `projects.project.updated` (изменения «было → стало») и `parent_changed`.
  `POST/DELETE projects/:id/history/:historyId/decision` относят изменение к записи журнала.
  История включена в резервную копию (`projectTemplates`, `projectHistoryEntries` в реестре снапшота,
  `specSelfRef` для projects из-за `parentId`).

Проверено локально (Windows, PostgreSQL 16 на 127.0.0.1:5433):

- `pnpm --filter @orion/shared-types typecheck` — мои файлы чистые; полный прогон пакета падает на чужих
  незавершённых файлах (`planning.ts` в момент прогона). `pnpm --filter @orion/api typecheck` — исходники
  API чистые, тестовая сборка падает на чужих тестах (`workspace-transfer`, `qa-orion-dev-journey`).
- `pnpm exec vitest run packages/shared-types/src/project-center.test.ts` — **16 passed**.
  `pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/project-center.integration.test.ts`
  — **10 passed**: цикл (409 с путём), лимит глубины, from-template (проект+вехи+задачи+журнал, даты от
  `startDate`, статус задачи), откат при инъекции отказа в середине материализации (ни проекта, ни вех,
  ни задач), duplicate с/без содержимого, архивация шаблона, портфель (прогресс/риски/дедлайны/загрузка/
  фильтр по участнику/пагинация/архив), история (поля, фильтры, связывание с журналом, `parent_changed`).
- Миграции с нуля: чистая БД, `prisma migrate deploy` — **все миграции применились**; проверены таблицы,
  `parentId`, `relrowsecurity`/`relforcerowsecurity` и права `orion_app` (после grants-миграции).
- `pnpm architecture-check` — OK (в том числе после перевода копирования на публичные контракты).
- `pnpm module-docs` / `pnpm module-docs:check` — OK (обновлён блок манифеста projects: новые права и события).
- `pnpm lint` по затронутым файлам — 0 ошибок, 0 предупреждений.

Не подтверждено в этой среде: `pnpm platform-map`/`platform-map:check` и `pnpm build` — esbuild не может
прочитать каталог рабочей копии (`Access is denied` на файле даже при `esbuild.exe --bundle`), то есть это
ограничение окружения, а не кода; на момент прогона полная сборка API дополнительно падала на незавершённых
правках соседних заданий (`development-git`, `entity-links`, `agent-hub`). Полный `pnpm test` — 2025/2040,
все 15 отказов в файлах соседних незавершённых заданий (`sync-classification` — `NoteStackState`,
`DevelopmentGitRepository`, `TaskCommitLink`, `DevelopmentArchitectLayout`; `permissions` — id
`entity-links.read` без ресурсного сегмента; `contract-snapshot`; sync-реплики; `agent-manual`).

Ограничения среза: портфель агрегирует максимум 500 проектов за запрос (дальше `page.truncated: true` — цифры
по первым 500); шаблон не копирует вложения/файлы и не переносит права доступа (шаблон — не проект);
удаление шаблона — архивация; связь «история ↔ решение» хранится ссылкой `logEntryId` (не EntityLink), потому
что закрытый каталог `SearchableEntityType` не содержит типов истории/записи журнала и принадлежит заданиям
01/05 — при его расширении связь проецируется без миграции данных. `Project.parentId` пока не участвует в
поиске/обзоре и не отдаётся агенту отдельным инструментом.

## Планирование: тайм-блоки, Гантт, матрица, учёт времени (задание 04) — 11.11.2026

Пакет `tasks/deepseek-backend`, волна 2. Реализовано в общем checkout поверх работы
заданий 01–03 и 05–09 (их незакоммиченные миграции были предпосылкой прогона).
Фронтенд не входил.

**Новый модуль `planning`** (`apps/api/src/planning/`, `@RequireModule("planning")`,
`workspaces/:workspaceId/planning`). Матрица, Гантт и календарь планирования —
представления существующих задач, вех, событий и проектов: чужих таблиц модуль не
читает. Контракт — [platform-api/PLANNING.md](platform-api/PLANNING.md).

- Тайм-блоки (`planning_blocks`): окно, тип, draft/committed, необязательная
  ссылка на задачу и проект (без FK — проверка через публичные контракты
  владельцев), `revision` (CAS) и `clientMutationId` (идемпотентный перенос).
  Пересечения с событиями и другими блоками — предупреждение в ответе (минуты
  наложения), не запрет; при выключенном календаре события не читаются.
  `POST …/blocks/:id/move` публикует `planning.block.moved` с оценкой «что
  затронуто»: другие блоки той же задачи и транзитивные зависимые задачи.
- Гантт `GET …/gantt?projectId=`: задачи проекта (через `TaskOperations`), вехи
  (новый узкий `MilestoneTimelineReader`), зависимости и CPM. Критический путь,
  `totalFloat`, конфликты (порядок зависимостей, цикл, отсутствие дат, перегрузка
  исполнителя) и `unscheduled` считает чистый `computeCriticalPath` в
  `shared-types`.
- `POST …/reschedule-impact` — dry-run: цепочка зависимых задач, вех, блоков и
  событий (связь через `EntityLink`) с величинами сдвига; записей в БД нет.
- Матрица: оси importance/urgency/priority/status/customFieldId, встроенный
  Эйзенхауэр (не хранится и не удаляется) + пользовательские пресеты
  (`planning_matrix_presets`). Распределение — запрос по полям задач; запись
  квадранта — `TaskOperations.update` (`importance`/`urgency`/`priority`/
  `fieldValues`), оси без записываемого поля честно перечислены в `skipped`.
  Пока явные поля не заданы, важность/срочность проецируются из приоритета и
  срока с указанием источника (`source`) и `degraded`.
- Учёт времени (`time`): пауза/возобновление (`pausedSeconds`/`pausedAt`,
  вычитаются в `entryMinutes`), переключение между задачами `POST time/switch`
  (закрывает прежний таймер, публикует `time.entry.switched`; `start` сохраняет
  прежнее 409 на второй таймер — защита S06), журнал ручных правок (`editedAt`,
  `edits`, `time.entry.edited`), `GET time/analytics` (факт по проектам/задачам,
  свободное vs привязанное время, план/факт по `estimatedMinutes`, недельный
  план) и `TimePlan` (`time_plans`, ISO-неделя, `time.plan.manage`).
- Права: `planning.block.*`, `planning.view.read`, `planning.preset.manage`,
  `time.plan.manage`. События: `planning.block.moved`, `time.entry.switched`,
  `time.entry.edited`. Новые таблицы — с ENABLE + FORCE RLS и политикой
  членства; внесены в реестр снапшота и классификацию синхронизации.
- Контракты платформы: module 1.3.0 → 1.4.0, event 1.1.0 → 1.2.0,
  permission 1.3.0 → 1.4.0, Platform API 1.13.0 → 1.14.0; снимок и
  `capabilities.generated.json` перегенерированы, 11 plugin contract tests
  зелёные (слоты не менялись).

Проверки (Windows, отдельная PostgreSQL 16 на 127.0.0.1:5433, БД
`orion_planning04`, создана заново): **все миграции с нуля применились**
(157+ … включая незакоммиченные миграции других заданий пакета; моя —
`20261111190500_planning_blocks_presets_time_plan`). Focused integration:
**10 passed** (`planning.integration.test.ts` 7, `time-planning.integration.test.ts`
3), плюс затронутые сьюты time-calendar-contracts / task-time-bridge /
time-entries / time-pagination / snapshot / domain-events. Unit: 16 тестов CPM
(эталонный граф из 8 задач с ручным расчётом), матрицы и каскада переноса,
4 новых теста `entryMinutes` с паузой. `architecture-check` зелёный (включая
«нет чужих таблиц в planning/time»). `plugin-contract-check` — 11/11.
`module-docs` и `contracts.snapshot.json` обновлены, `module-docs:check`
зелёный. Scoped ESLint по файлам задания — 0 ошибок.

Ограничения и что не удалось проверить:

- `pnpm platform-map:check` в этой среде не запускается: дочерний процесс
  esbuild не может прочитать каталоги выше рабочего дерева
  (`Cannot read directory "../..": Access is denied`) — ограничение песочницы,
  воспроизводится на пустом файле. `docs/platform-api/capabilities.generated.json`
  перегенерирован эквивалентной логикой без esbuild (тот же derivation, `tmp/`-скрипт
  вне репозитория); расхождение с `pnpm platform-map` не проверено запуском.
- `time-calendar-contracts` требовал правки оснастки: облегчённый Nest-host
  собирался без `DomainEventsModule`, а Time теперь публикует события, а
  `TasksService` (задание 02) уже требует `DomainEventBus` — модуль добавлен в
  набор host-модулей; продуктовый код ради теста не ослаблялся.
- Остальной пакет 00-README одновременно правится другими агентами: на момент
  проверки `tsc` по всему `apps/api` красный только на незавершённых файлах
  `src/development/**` (задание 11), к заданию 04 отношения не имеет. Полный
  `pnpm lint`/`pnpm test` по всему дереву в таком состоянии не показателен.
- Не проверялись: установленный Tauri/Windows runtime, браузерная панель
  планирования (её нет — фронтенд вне задания), реальные нагрузки на Гантте
  (сейчас выборка задач проекта целиком, как у публичного `TaskOperations.list`).

## Foundation Core (задание 01) — 11.11.2026

Реализовано (API, без фронтенда):

- **Единый слой связей** `apps/api/src/entity-links/`: `EntityLinksService` — единственный writer
  `entity_links`; `EntityLink.kind` переведён в Prisma-enum `EntityLinkKind` (миграция
  `20261111150000_foundation_core_entity_links`), добавлены `bidirectional` и `createdById`.
  Инварианты в транзакции: оба конца существуют и принадлежат пространству, нет самосвязи, нет цикла
  `depends_on`/`blocks` (409; legacy `goal_prerequisite` остаётся 400), симметричный вид хранится одной
  канонической строкой. Модульный SDK — `EntityLinkOperations`; `SearchService` больше не пишет таблицу.
- **События**: `entity_link.created/deleted` (publisher `core`, payload `{type,from,to}`) в общем outbox;
  диспетчер проверяет тип/версию/payload при доставке, изолирует падение подписчика через SAVEPOINT;
  добавлены диагностика `GET workspaces/:id/domain-events/status`, `GET system/domain-events` и ручной
  replay упавшей доставки.
- **Жизненный цикл модулей**: `BackgroundJobRegistry` (декларативный каталог cron-задач) и
  `BackgroundJobSupervisor` (проверка включённости компонента в пространстве, счётчик `paused`);
  `GET system/jobs/registry`; пурж корзины заметок/документов пропускает пространства с выключенным
  модулем. Core-джобы (`core`) всегда включены.
- **CI**: `module-docs:check` добавлен в `ci.yml` и `ci-selfhosted.yml` рядом с `architecture-check`,
  `platform-map:check` и `plugin-contract-check`.

Проверки: unit — `entity-links.test.ts`, `background-job-supervisor.test.ts`, `delivery-policy.test.ts`
зелёные; интеграционные `entity-links.integration.test.ts` (16), `domain-events.integration.test.ts` (9),
`background-jobs.integration.test.ts` (1) на реальной PostgreSQL зелёные; миграции применяются к текущей
базе; `module-docs:check` и `plugin-contract-check` зелёные; typecheck исходников API/Web — зелёный.
Оставшиеся красные проверки этого checkout — не Foundation Core: `tsconfig.test.json` (типизация
`request<T = unknown>` в существующих интеграционных тестах) и `architecture-check` (манифест и RLS
миграций `modules-ext/agent-hub`, задание 09). `platform-map` локально не запускается — esbuild в
песочнице среды не может прочитать корень диска; сгенерированная карта при этом актуальна (в CI
генерируется обычным Node).

Ограничения: удаление сущности каскадно чистит связи через `EntityLinkOperations.removeForEntityTx`
(владелец сущности вызывает его в своей транзакции); отдельного DB-триггера нет. Аудит связи — строка
outbox (`actorId`/`occurredAt`) плюс `EntityLink.createdById`, отдельной таблицы аудита нет.


## База знаний 2.0 — 11.11.2026

Задание 06 (backend, без фронтенда). Зоны: `apps/api/src/knowledge/**`,
`packages/shared-types/src/knowledge.ts`, `agent-tools.ts`, `domain-events.ts`,
`apps/api/src/inbox/public/inbox-items*`,
`apps/api/src/inbox/inbox-items-reader.service.ts`,
`scripts/module-ownership.mjs`; миграции `20261111160000_knowledge_verification_revisions`,
`20261111161000_knowledge_search_vector`, `20261111162000_knowledge_search_lowercase`;
тесты `apps/api/test/knowledge.integration.test.ts`,
`packages/shared-types/src/knowledge.test.ts`,
`apps/api/src/knowledge/knowledge-import.test.ts`.

- **6.1. Происхождение и проверка.** `KnowledgeItem.origin` (jsonb: sourceFile,
  importedAt, sourceUrl, author, importedBy), `verificationState`
  (`unverified | verified | outdated`), `lastVerifiedAt`, `verifiedById`.
  `POST …/items/:itemId/verify` фиксирует автора и время и публикует
  `knowledge.item.verification.changed` (outbox, та же транзакция). Правка
  title/summary/body/origin снимает подтверждение; дата и автор прошлой
  проверки остаются историей. `outdated` — вычисляемое: проверка была, но
  прошло больше `verificationDays` (настройка пространства, по умолчанию 90).
  Список принимает `verification=unverified|verified|outdated`, `overdue=true`
  и `sort=verification` (сначала те, чья проверка старше, NULL — первыми).
- **6.2. Поиск.** `searchVector` — материализованный tsvector (russian) по
  title/summary/body, GIN + триггер миграции. `GET …/search?q=&type=&verified=&projectId=&from=&to=`:
  `websearch_to_tsquery`, точная фраза поднимается через `phraseto_tsquery`,
  ранг — `ts_rank` с весами полей, сниппет — `ts_headline` с `<b>`. База живёт с
  локалью C, где `to_tsvector` не складывает кириллицу в нижний регистр, поэтому
  вектор и запрос строятся через `lower()`. Провайдер глобального поиска
  `knowledge_item` (`KnowledgeSearchProvider`, задание 10) использует тот же
  `searchVector`; тип `knowledge_item` связуем через `EntityLink` (адаптер в
  `entity-links/entity-registry.ts`).
- **6.3. Версии.** `KnowledgeItemRevision` (title/summary/body/origin + authorId).
  Снимок — на явное `POST …/items/:itemId/revisions` и при переходе в
  `published`; автосохранение снимков не плодит. Восстановление применяет снимок
  как новую ревизию (`restoredFromId`), историю не перезаписывает; лимит
  `revisionLimit` (по умолчанию 20) обрезает только самые старые снимки.
- **6.4. Входящие и импорт.** `POST …/from-inbox/:inboxItemId`: материал из
  записи «Входящих», заполнение `origin`, удаление записи только по
  `deleteFromInbox: true` (чтение и удаление — через публичный контракт
  `InboxItems` в одной транзакции). `POST …/import/documents`: пофайловый отчёт
  (ok/failed+причина), каждый файл пишется отдельной транзакцией, поэтому ошибка
  одного не откатывает остальные; файлы Documents переиспользуются, источник —
  `KnowledgeSource type=document`.
- **6.5. Агент.** `orion_knowledge_search` и `orion_knowledge_read` добавлены в
  каталог `AGENT_TOOLS` (MCP-адаптер и руководство строятся из него). Нужен
  `knowledge.item.read` в разрешениях токена, включённый модуль и запись о чтении
  в журнале агента; ответ всегда содержит состояние проверки.
- Настройки пространства — `knowledge_settings` (`GET` любому участнику,
  `PATCH` — владельцу). У всех трёх новых таблиц ENABLE + FORCE RLS; модели
  внесены в реестр владения.

Проверки: unit 13/13 (`knowledge`, `knowledge-import`); интеграция
`knowledge.integration.test.ts` — 6/6 на реальной PostgreSQL (проверка и сброс,
порог/просроченные, русский и английский поиск с рангом фразы, версии и restore,
импорт и входящие, отказ агенту без разрешения и журнал чтений);
`api-rls.integration.test.ts` — 35/35 (структурная проверка RLS новых таблиц);
`agent-module-tools`/`ai-bridge`/`agent-gateway` — 27/27; `g19-providers` — 3/3
(провайдер `knowledge_item` зарегистрирован, материал виден в глобальном поиске);
миграции с нуля — 167/167 на отдельной чистой БД; `module-docs:check` — OK;
`plugin-contract-check` — 11/11; scoped ESLint — 0 ошибок.
`architecture-check` по файлам задания чист (красный на чужих `NoteStackState`,
`planning-gantt` и `project-templates`); `platform-map:check` падает на
`Access is denied` при чтении каталога в этом окружении (не код задания);
production build API красный на незавершённом `src/development/**` параллельного
задания 11 (неверные относительные импорты), ошибок в файлах Knowledge нет.

Ограничения: «значимость» правки API различает только по явному запросу версии и
публикации — другого сигнала от клиента нет, автосохранение остаётся без снимка;
импорт папок разворачивает клиент, сервер принимает готовый список `documentIds`;
семантический поиск не реализован (только место под будущий провайдер).

## Журнал проекта: типизация и автозаписи — 11.11.2026

Задание 05 (backend). Изменены `apps/api/src/projects/project-logbook.*`,
`project-logbook-validation.ts`, `project-logbook-auto-entries.service.ts`,
`apps/api/src/milestones/milestones.service.ts`,
`apps/api/src/projects/projects.service.ts`,
`apps/api/src/tasks/tasks.service.ts`,
`packages/shared-types/src/project-logbook.ts`, `domain-events.ts`,
`search.ts`, `modules.ts`; миграция `20261111120000_logbook_typed_entries`;
тесты `apps/api/test/project-logbook.integration.test.ts` и
`apps/api/src/projects/project-logbook-validation.test.ts`.

- **5.1. Типы.** `ProjectLogEntry.type`: `observation | decision | hypothesis |
  result | incident | change` (колонка `type`, исторический `kind` остаётся
  алиасом в ответе для прежнего клиента). `decision` требует `rationale` и
  принимает `alternatives`; `hypothesis` — `verificationDue`; `result` —
  `confirmsEntryId` (только гипотеза/решение того же проекта) и `verdict`;
  `incident` — обязательный `severity` и `resolution`; `change` — `source`.
  Несоответствие полей типу — 422 `logbook_entry_invalid` с картой `errors`.
  Существующие записи сохраняют прежнее значение (`kind` уже был подмножеством
  нового enum), новые колонки получают безопасные дефолты.
- **5.2. Автозаписи.** Подписка `projects.logbook-auto-entries`
  (`componentId: "projects-logbook"`) на `projects.project.status_changed`,
  `projects.project.dates_changed`, `projects.milestone.completed`,
  `projects.milestone.dates_changed`, `tasks.task.assigned`. Запись создаётся
  как `change/source=event` со ссылкой на событие; `source=event` read-only
  (PATCH/DELETE → 409). Bulk-операция несёт общий `bulkId`: unique index
  `(projectId, dedupeKey)` + `createMany(skipDuplicates)` дают ровно одну
  запись (проверено каскадом вех и прямыми событиями).
- **5.3. Материалы.** `project_log_entry` зарегистрирован в EntityLink-реестре;
  запись не хранит копий. `GET /workspaces/:id/project-log/:entryId/related`
  агрегирует связи; удаление записи чистит их через `EntityLinkOperations`.
- **5.4. Фильтры и сводка.** Список принимает `type`, `authorId`, `from`,
  `to`, `hasTasks`, `limit`, `projectId` (workspace-wide endpoint) и
  `includeChildren` (recursive CTE по `Project.parentId`).
  `GET .../logbook/summary` отдаёт количества по типам, просроченные гипотезы,
  инциденты без resolution и решения без результатов.

Проверки: unit `project-logbook-validation` — 5/5, `delivery-policy` — 8/8;
интеграция `project-logbook.integration.test.ts` — 7/7 на реальной PostgreSQL
(типы/422, фильтры и дочерние проекты, сводка, EntityLinks, автозаписи,
bulk-дедупликация, read-only); миграция применена к локальной БД и ко всем
164+ миграциям на чистой временной PostgreSQL (scratch-база создана и удалена);
`module-docs:check` — OK; `plugin-contract-check` — 11/11; scoped ESLint —
0 ошибок; `@orion/shared-types` typecheck — чисто; `pnpm --filter @orion/api
build` — PASS. `architecture-check` больше не указывает на файлы журнала: он
падает на манифесте Agent Hub (`AgentHubTraceStep` и RLS-таблицы, задание 09).
`platform-map:check` падает на `Access is denied` при чтении каталога в этом
окружении (не связано с изменением). Полный API typecheck (`tsconfig.test.json`)
красный из-за чужих интеграционных тестов (`agent-remote-policy`,
`assistant-chat`, `component-dependents`, `login-policy`); ошибок в файлах
задания нет.

Ограничения: прежний контракт сохраняет `kind` рядом с `type` до отдельного
решения о breaking-change; bulk-группировка работает для издателей, которые
передают `bulkId` (сейчас — каскад вех); вложения Knowledge/Documents/Notes
прикрепляются через существующий `POST /links`, отдельного экрана вложения в
этом задании нет.

## Созвездия: серверная раскладка и граф — 11.11.2026

Задание 08 (backend). Новые файлы: `packages/shared-types/src/goal-canvas.ts`
(+ тест), `apps/api/src/goals/goal-canvas.service.ts`,
`goal-canvas.controller.ts`, миграция `20261111170000_goal_canvas_layouts`,
интеграционный тест `apps/api/test/goals-canvas.integration.test.ts`.

- **8.1. Раскладка.** Модель `GoalCanvasLayout` (workspaceId + goalId, entries/viewport/
  zones/conflicts jsonb, revision) с RLS. `GET/PUT
  /workspaces/:workspaceId/goals/:goalId/canvas-layout`: частичный PUT сливает ноды
  по `updatedAt` (свежая правка побеждает, ноды вне запроса не трогаются); конфликт
  одной ноды возвращается с обеими версиями и хранится в строке до разрешения.
  Полная замена — только с `If-Match` по ревизии (нет заголовка — 428, чужая
  ревизия — 412); ответ несёт `ETag`. Битая ссылка помечается `broken` при
  чтении, строка раскладки не удаляется.
- **8.2. Граф.** `GET …/:goalId/graph` за один запрос собирает поддерево целей,
  проекты планов, задачи и вехи, плюс рёбра `depends_on`/`continues`/`relates_to`
  из `entity_links` (legacy `goal_prerequisite` нормализуется в `depends_on`).
  Запись связей остаётся за общим слоем EntityLinksService.
- **8.3. Автокомпоновка.** `POST …/:goalId/canvas-layout/auto`: детерминированная
  слоистая раскладка (топологические слои, горизонтальный вес по числу листьев),
  ручные якоря (`dirty`) неподвижны при `respectManual` (по умолчанию), узлы не
  перекрываются; применение — только явным PUT. Параметр `strategy` оставлен
  точкой замены будущего Rust-оптимизатора.
- **8.4. Прогресс и поиск.** `GET …/:goalId/progress` отдаёт тот же процент, что и
  DTO цели (этапы-планы с весами, проекты, суммарные задачи, подцели);
  `GET …/:goalId/graph/search?q=` ищет по названиям нод и отдаёт координаты.

Проверки: unit `goal-canvas.test.ts` — 11/11; интеграция
`goals-canvas.integration.test.ts` — 8/8 (два клиента, конфликт одной ноды, If-Match,
битая ссылка, граф, авто-раскладка, прогресс, чужое пространство); существующий
`goals.integration.test.ts` — 7/7; goal/search unit — 45/45; scoped ESLint — 0
ошибок/0 предупреждений. Миграция применена к локальной PostgreSQL.

Миграции: на отдельной чистой базе `prisma migrate deploy` применил все
миграции, включая `20261111170000_goal_canvas_layouts`; у таблицы проверены
`ENABLE`/`FORCE ROW LEVEL SECURITY` и политика `goal_canvas_layouts_isolation`,
после чего на этой же базе прошёл весь `goals-canvas.integration.test.ts` (8/8).
Скрэтч-база удалена.

Ограничения этого checkout: `architecture-check` и `module-docs:check` зелёные.
`platform-map:check` в этой среде не запускается — генератор на esbuild не может
прочитать каталог выше рабочего (`Cannot read directory "../..": Access is denied`),
как и у остальных параллельных заданий; карта перегенерирована тем же алгоритмом
через TypeScript API и содержит `packages/shared-types/src/goal-canvas.ts`
и `GoalCanvasLayout` за `goals`. Общий `@orion/api` typecheck красный на чужих
срезах (`development/git`, `entity-links` → `knowledge_item`, `agent-hub`), в
`goals/` ошибок нет. Полный `pnpm lint` захватывает посторонний минифицированный
файл в рабочем дереве; ESLint по всем файлам задания — 0 ошибок/0 предупреждений.
Наша модель внесена в `MODEL_OWNERS`, snapshot/бэкап и sync-классификацию;
фронтенд-холст, DnD и мини-карта в объём не входили.

## Заметки 2.0 — backend, 11.11.2026

Серверный срез задания 07. История версий: восстановление создаёт новую ревизию с `restoredFrom` (старая история и снимок «до» сохраняются), добавлен построчный diff без сторонних библиотек (`packages/shared-types/src/note-diff.ts`, собственный LCS). Wiki-ссылки разрешаются по заголовку, id и короткому номеру (`[[N-104]]`), неразрешённая цель остаётся строкой `NoteLink` с `broken: true`; есть `GET notes/:id/links` и `GET notes/links/broken`. Поиск внутри заметки отдаёт смещения вхождений (`GET notes/:id/search?q=`), связанные заметки — wiki-ссылки глубины 2, общие `EntityLink` и общий проект (`GET notes/:id/related`). Свёрнутость и порядок стопок вынесены в per-user `note_stack_states` (ENABLE + FORCE RLS, политика по участнику); вложенные стопки отвергаются 400. Ночная чистка ревизий не трогает пространства с выключенным модулем.

Проверки: `prisma migrate deploy` с нуля на отдельной базе — все 167 миграций применились, включая `20261111103247_notes_20_versions_links_stack_state`; Prisma Client сгенерирован; 8 новых интеграционных тестов (версии, diff, wiki-ссылки и broken, номерные ссылки, поиск, связанные, стопки) — PASS; прежние `notes-get-one`, `note-cas`, `private-notes` и `rls-coverage` — PASS; unit-тесты diff/search — 13 PASS; ESLint по изменённым файлам — 0; `plugin-contract-check` — 11 PASS; `module-docs:check` — OK; карта платформы перегенерирована (в ней `NoteStackState` у notes). Интеграционные сьюты в этой среде запускались с `--pool=threads`: пул forks падает native abort до старта Nest, включая неизменённые тесты.

Ограничения: `platform-map:check` в этой среде не запускается — генератор на esbuild не может прочитать каталог выше рабочего (отказ доступа к `C:\Users` из дочернего процесса), поэтому карта собрана тем же алгоритмом через TypeScript API и в ней `NoteStackState` числится за notes. `architecture-check` указывает на модели без владельца из соседних срезов (`DevelopmentGitRepository`, `TaskCommitLink`, `DevelopmentArchitectLayout`), файлов заметок в замечаниях нет. Общий `typecheck` красный в `packages/core` из-за типов `ProjectLogEntry` (задание 05); `@orion/api` typecheck чистый. Production build API на момент проверки упирается в незавершённый `entity-registry` (`knowledge_item`, задание 01). Фронтенд (панель истории/ссылок/поиска) в объём не входил.

## Аудит текущего checkout и исправления — 11.11.2026

Комплексный аудит дерева (поверх `7666960b`): API/Web typecheck, architecture-check,
platform-map, module-docs и 11 plugin contracts прошли; unit — 1938/1938 после
исправлений ниже. Маркеров конфликтов нет.

Исправлено:

- **Утечка дескрипторов в update-pipeline.** `payload.prepare()` на error-path
  уничтожал входной поток fire-and-forget; на Windows дескриптор `.orion.gz` ещё
  жил при возврате, и удаление временного каталога падало с ENOTEMPTY (3 теста
  `runtime-payload` стабильно красные). Теперь `finally` дожидается события
  `close` обоих потоков. Тесты: 18/18 три прогона подряд.
- **Контрактный снимок (G2).** Слот `tasks.context.actions` был добавлен в код без
  обновления снимка и версии: plugin contract поднят до **1.5.0**, снимок и
  `capabilities.generated.json` регенерированы (карта заодно подтянула новые
  модели Agent Hub и миграцию `20261110140000`).
- **Lint: 0 errors / 0 warnings** (было 1 error / 58 warnings). Убраны
  неиспользуемые импорты и переменные (`layout.tsx`, `DocumentsPanel`,
  `HabitsPanel`, `fields.tsx`, `qr.ts` и др.), `T = any` в интеграционных тестах
  приведён к проектной норме `T = unknown`, `createProject` в
  `permission-api.integration.test.ts` удалён как мёртвый код. Keyboard-эффекты в
  CalendarPanel/DocumentsPanel получили актуальные зависимости (устранён класс
  багов устаревших замыканий: `openItem`/`reschedule`/`openFolder`/`requestMove`
  теперь `useCallback`).

Добавлено:

- **Self-hosted CI** `.github/workflows/ci-selfhosted.yml` (Windows): суперсет
  hosted `ci.yml` плюс `cargo test`/`clippy` для orion-rust и `cargo check`
  Tauri-оболочки — впервые Rust-проверки в CI. Регистрация runner требует
  5 минут владельца: [docs/CI_SELFHOSTED_RUNNER.md](CI_SELFHOSTED_RUNNER.md).

Не закрыто аудитом (требует владельца или отдельных этапов): регистрация runner в
GitHub UI, нативная приёмка Tauri, G20 (две установки), G10/G11/G16, hosted CI
по-прежнему заблокирован billing'ом аккаунта.

Продолжение ночи 11.11.2026 — полная локальная проверка на настоящем Node 22
(`node` в shell агента — Kimi.exe в режиме ELECTRON_RUN_AS_NODE; настоящий
бинарник взят из извлечённого NSIS runtime `tmp/orion-r-beta1-*/runtime/node.exe`):

- Локальный PostgreSQL (scripts/postgres.mjs, порт 5433): все **157 миграций**
  применены к чистой базе.
- Интеграционный сьют (124 файла, ~700 тестов): **зелёный**. Два реальных
  дефекта тестов исправлены: `api-rls` ожидал 2 заметки после создания одной
  (ожидание 1→2 попало в сводный коммит без соответствующей функции — возвращено
  к 1); `time-calendar-contracts` не знал про новое поле `assigneeId` в
  `TaskReference`. Известная нестабильность: `domain-events` (outbox) флаки под
  параллельной нагрузкой полного сьюта — в изоляции и при повторе зелёный;
  стоит отдельного расследования таймингов.
- Production build: API (`tsc` + build-api-runtime) и Web (`next build`, все
  страницы) собраны без ошибок.
- Артефакт среды: тест `assistant-cli` падает, если сьют запущен Kimi-node —
  фейковый CLI наследует scrubbed env без ELECTRON_RUN_AS_NODE и запускает
  Kimi.exe как приложение. На настоящем Node проходит.

## Назначение ИИ-агента на задачу — текущий checkout, 10.11.2026

Agent Hub хранит отдельный логический профиль агента и назначение на существующую задачу. Профиль создаётся пользователем с явной привязкой собственного действующего ключа AI Bridge; ключ не является идентичностью агента. Пункт контекстного меню в задачах и проектных представлениях предоставляется отключаемым плагином. Назначение не запускает выполнение; при отдельном запуске очередь ограничивает получение задачи связанными ключами. Одновременное назначение участника и агента запрещено.

Профили и назначения включены в snapshot; связи с ключами исключены и при переносе требуют повторной привязки. Сервер и интерфейс прошли проверки типов, архитектурных границ и контрактов. На отдельной временной PostgreSQL применены миграции и прошли 21 интеграционный тест Agent Hub, включая выбор получателя и прежнюю общую очередь. Приёмка в установленном Tauri и на пользовательских данных не проводилась. Контракт и ограничения: [AGENT_TASK_ASSIGNMENT.md](extensions/AGENT_TASK_ASSIGNMENT.md).

## ORION-R Beta 1 — исправленная сборка 10.11.2026

Исправлены видимость выбранного узла Goals и проверка принадлежности runtime собственному Windows Job в Tauri; занятые порты дают отказ. Собран локальный неподписанный NSIS `ORION-Rust_0.1.44-beta.1-x64-setup.exe`, SHA-256 `47993904ef90fa6bf7e201d27f2111a85bf9d5e98567a798cb90c48fffcdf7ae`; прежний 0.1.43 следует считать заменённым. 37 тестов Goals, 23 теста Tauri (6 helper ignored), architecture-check и platform-map прошли. Браузерные Goals Atlas: два исходных сценария и отдельно повторённый третий прошли на изолированной базе. Runtime из NSIS отдельно дошёл до API/database health в тестовом Job. Нативный запуск Tauri не проверен: auto-review отклонил попытку изолированного smoke (`blocked by policy`). Полный Rust lifecycle и безопасный импорт Classic остаются неготовыми. [Отчёт](ORION_R_BETA1_BUILD.md).

## ORION-R Beta 1 — локальная сборка 09.11.2026

Локальный NSIS `ORION-Rust_0.1.43-beta.1-x64-setup.exe`, 96 747 773 байта, SHA-256 `e5f437cf238c1e78d80d8aeb244173286d4cd42e2c63e2e14330badf0c0a656d`; метка runtime `v0.1.0-orion-rust-beta.1`, внутренний номер установщика `0.1.43`. Сборка из изменённого дерева поверх `5a56bd26`, не воспроизводимая по одному commit; не опубликована, не подписана и не установлена. Извлечённый из NSIS runtime на одноразовом профиле дошёл до API health с `database=ok`; принадлежность API и PostgreSQL тестовому Job подтверждена, процессы завершены. Нативное окно установленной сборки не проверено.

Собраны Knowledge, Project Logbook, Notes 2.0 и Goals 2.0; проектирование переноса описано в [ORION_R_MIGRATION_ACCEPTANCE.md](ORION_R_MIGRATION_ACCEPTANCE.md). Перенос реальных данных не готов, stage CLI отключён; прямой Rust supervisor не заменяет штатный JavaScript launcher. Полный typecheck, production API/Web build, architecture-check, platform-map и 11 plugin contract tests прошли; lint: 0 errors, 57 warnings. Полный unit run: 1899 passed, 1 timeout в `orion-ext`; отдельный повтор 3/3 passed. Изолированный PostgreSQL: применены 156 миграций, Notes 2/2 и Logbook 3/3; отдельно проверен Knowledge FK lifecycle. См. [отчёт и ограничения приёмки](ORION_R_BETA1_BUILD.md).

## PROJECT LOGBOOK — реализация в текущем checkout, 09.11.2026

В Projects добавлен default-full plugin `projects-logbook`: хронология наблюдений, решений и изменений, ссылки на существующие задачи с локальным комментарием к записи и направленные межпроектные связи. Задачи и их описания не копируются и не меняются; QA-v3, продолжающий QA-v2, показывает QA-v2 в предшественниках и QA-v3 в последователях. Связи доступны по типам «продолжает», «заменяет», «создан на основе», «зависит от», «связан с»; последнее отношение парное и не дублируется.

Проверки: Prisma Client и все 156 миграций на изолированной временной PostgreSQL; три focused API integration, восемь snapshot integration и структурная RLS-проверка PASS; `plugin-contract-check` (11), `module-docs:check`, `platform-map:check`, API/Web typecheck и production build PASS. Playwright E2E PASS: перетаскивание существующей задачи в запись, локальный комментарий без изменения задачи, направление связей, desktop/mobile и отсутствие горизонтальной прокрутки. Скриншоты: `tmp/project-logbook/desktop.png` и `tmp/project-logbook/mobile.png`. `architecture-check` блокируется только существующим импортом `documents/documents.service` из `apps/api/src/send/send.service.ts`; ошибок владельца или внутренних импортов Logbook не выдаёт.

## Заметки 2.0 — работа в текущем дереве, 09.11.2026

Расширена существующая реализация вложений: массовая загрузка сохраняет выбранные локальные папки как дерево внутри «Вложений заметок», файлы можно перетаскивать непосредственно на редактор, а веб-ссылки добавляются в Markdown. Предпросмотр вложений использует общий `FilePreview`; архивы хранятся как обычные документы и доступны для скачивания.

Добавлены серверные визуальные стопки: выбор нескольких заметок, сворачивание/раскрытие, сохранение порядка и перемещение выбранных заметок в новую или существующую стопку. Удаление стопки снимает группировку, не удаляя записи. Контракт и ограничения: [NOTES_2.0.md](NOTES_2.0.md). Приёмка после миграции и полный интерфейсный smoke ещё не выполнены.

## Knowledge 2.0 — работа в текущем дереве, 09.11.2026

Библиотека получила отдельное дерево коллекций, список с описаниями, поиск, фильтр по типу и сортировку, редактор/режим чтения, быстрый захват веб-ссылки и импорт документов/папок. ZIP-архивы распаковываются в браузере; файлы сохраняются через Documents с исходной структурой каталогов и привязкой как источники Knowledge. Другие архивные форматы этим импортом не распаковываются.

Связь материала с проектом необязательна: nullable `projectId`, проверка через публичный `ProjectReferences`, отображение в «Материалах» проекта. Существующие материалы остаются без проекта; при удалении проекта запись сохраняется, связь очищается. Решение: [ADR-0049](adr/ADR-0049-knowledge-collections-and-project-links.md).

Проверено: Prisma Client generation, Web/API typecheck, точечный ESLint, Web production build (60/60 страниц), `module-docs:check`, `platform-map:check`, Knowledge UI detector; `plugin-contract-check` — 11 тестов PASS. Первая сборка с ZIP завершилась ошибкой записи `.next/static/<build-id>/_ssgManifest.js`; повторная сборка прошла полностью. Общий `lint` и `architecture-check` остаются красными из-за других текущих изменений в `scripts/restore-staged.mjs`, `scripts/stage-backup.mjs` и `projects-logbook`. Миграция БД, browser smoke и Windows/Tauri не запускались.

## GOALS 2.0 — реализация в текущем checkout, 09.11.2026

Карта целей переведена с фиксированной сетки на мировые координаты с автоматическими отступами по числу конечных узлов. «Вписать всё» и первичное открытие масштабируют всю цель; Shift/Ctrl/Cmd выбирает группу для совместного личного перемещения. Масштаб и камера хранятся локально по пространству и корневой цели. При 20+ элементах полный маршрут остаётся читаемым и выбираемым в прокручиваемом списке. Изменение дерева/зависимостей остаётся в явном режиме связей, позиции карты не меняют исходные записи. Детали: [GOALS_CONSTELLATIONS.md](GOALS_CONSTELLATIONS.md).

35 целевых unit-тестов прошли; scoped ESLint, web typecheck, module-docs, platform-map и plugin-contract-check (11) прошли. `architecture-check` остаётся красным на соседнем срезе Projects/Logbook и прежнем импорте Documents: `ProjectLogEntry`, `ProjectLogEntryTask`, `ProjectRelation` без владельца; прямое обращение Logbook к `Task`; импорт `documents.service`; plugin `projects-logbook` импортирует `use-enabled-modules`. Browser smoke не запущен: в checkout отсутствует `apps/api/.env`, необходимый `test:e2e:local`. Windows/Tauri не проверялись.

## ORION-R: повторная проверка — 09.11.2026

Повторные измерения API/БД из `5a56bd26` не подтверждают принадлежность PostgreSQL тестовому Job, а выборка по дереву родителей могла его пропустить. В новом одиночном запуске с проверкой принадлежности обоих слушателей точному Job API/БД были готовы за 84,59 с (Beta 42) и 71,02 с (ORION-R); затем по два повтора дали 59,13/59,67 с и 59,16/55,09 с. Private bytes выбранных процессов после готовности были около 227–229 МиБ; это не замер окна или CPU во время старта и не даёт вывода о преимуществе Rust, поскольку обе сборки используют JavaScript-лаунчер. Незавершённые команды прямого Rust-запуска и восстановления возвращают ошибку до изменения данных; штатный запуск PostgreSQL и API пока остаётся в JavaScript. Подготовка копии и восстановление не прошли приёмку как безопасная миграция.

## ORION-R: подготовка измерений — 08.11.2026

Добавлен наблюдатель CPU и памяти выбранных процессов и описаны ограничения миграции в [ORION_R_RUNTIME_MIGRATION.md](ORION_R_RUNTIME_MIGRATION.md). Rust supervisor, перенос профиля и сравнение установленных сборок пока не выполнены.

Добавлен предварительный просмотр манифеста копии (`inspect-migration`): только чтение, без проверки целостности и без восстановления. Количества остаются непроверенными утверждениями манифеста; безопасный импорт ещё не реализован.

Добавлена отдельная офлайн-проверка состава и контрольных сумм (`verify-migration`) и экспериментальная тестовая staging-область. Проверка не подтверждает подлинность источника и не запускает перенос; staging не подключён к интерфейсу и не предназначен для конфиденциальных данных.

Существующий `restoreNodeBackup` теперь выполняет проверку манифеста и путей до вызова БД. Это не санитизация полномочий и не защита от конкурентной подмены файлов; прямое восстановление по-прежнему нельзя считать безопасным переносом между установками.

Для полного установщика исправлена упаковка `edition.json` рядом с лаунчером и добавление файла в fingerprint оболочки. Собран локальный NSIS `ORION Rust_0.1.43_x64-setup.exe`, SHA-256 `538bced2e35c17146a6338b16585f937fe0ef5ffda31fd87f20bb3c86836d9ac` (дерево с незакоммиченными изменениями поверх `c79b2396`, не релиз). Извлечённые launcher/config/fingerprint совпали со stage, отказ на тестовом каталоге Classic не изменил его. Установка и полный запуск Tauri не проверялись.

## Orion Send — 08.11.2026, код без установщика

Прямая передача файлов между двумя локальными узлами описана в [orion-link/IMPLEMENTATION_REPORT.md](orion-link/IMPLEMENTATION_REPORT.md). Установщик Windows этим изменением не собирался. Два физических компьютера не проверялись: [orion-link/TEST_REPORT.md](orion-link/TEST_REPORT.md).

## Интеграция Agent connection PR #96 — beta.37, 03.11.2026

В локальную beta-ветку перенесён PR #96 (`84bb0dc`): выбор роли/срока,
включая бессрочный доступ, owner-only admin, аудит продления срока,
приватный token-file и loopback REST handshake перед записью MCP config.
Добавлены защита параллельных установок и внешних правок, TOML parse/semantic
preservation, откат token-file при ошибке записи. Scope ceiling beta.36 сохранён.
1708 unit PASS; 7 focused PostgreSQL сценариев PASS (включая утрату owner).
Полный PostgreSQL: 684 PASS / 1 opt-in skip; после ACL/path исправлений
7 focused integration PASS. 8 Chromium PASS, включая фактический stdio-MCP
orion_get_context через созданный token-file. Windows ACL проверены отдельно:
явные user/SYSTEM/Administrators на пустом файле до записи секрета.
Windows beta.37 (`821e694`) собрана, опубликована и установлена локально.
Финальный full PostgreSQL 684 PASS / 1 skip; packaged MCP/context/import/restart
и native startup/wizard PASS. SHA-256 в release body проверен.
[Артефакт, проверки и границы CI](../development/WINDOWS_BETA_37_2026-11-03.md).
Platform API 1.13.0 / AgentGateway 1.1.0. [ADR-0047](adr/ADR-0047-agent-connection-owner-control.md).
Master и XLSX PR #94 не изменены; существующий ORION DEV сохранён.

## Windows beta.36 — 03.11.2026

Опубликован [GitHub prerelease](https://github.com/KeinReno/ORION/releases/tag/v0.1.0-windows-beta.36)
из `18930a8` с ORION DEV; NSIS версия 0.1.36. SHA-256 в body и
SHA256SUMS.txt проверен против GitHub asset digest. Master не изменён.
Проверки, локальный outbox test failure/fresh retry и границы CI зафиксированы
в [отчёте](../development/WINDOWS_BETA_36_2026-11-03.md).

## ORION DEV — рабочий обзор 02.11.2026, вне master

Модуль 1.1.0 открывает обзор направлений и задач по этапам. Русские подписи
каталога не меняют сохранённые названия; ручные переименования, статусы,
архив и зависимости читаются через канонические Project/Task contracts.
Импорт вынесен в отдельный раздел; просмотр не записывает данные. Сетевые
ошибки и частичное наполнение показаны явно. Обзор открывает объекты через
dock, а в отдельном окне — через штатный маршрут single-object panel.
1695 unit PASS; TypeScript, lint (0 errors / 39 прежних warnings), architecture
и plugin contracts PASS. Браузерный обзор и 4 сценария импорта/recovery PASS;
42 panel parity PASS (всего 47 Chromium); 20 PostgreSQL consent/apply PASS.
Windows-кандидат `dd6307e` собран и установлен: обзор/этапы/открытие задачи
проверены в рабочем профиле, исходный ORION и 16 задач сохранены. Packaged
runtime import/restart/reimport PASS. Артефакт и SHA-256 — в UI-отчёте.
[Решение и сценарии](../development/ORION_DEV_UI_2026-11-02.md),
[ADR-0046](adr/ADR-0046-development-workspace-overview.md).

## ORION DEV — локальный reviewed apply 02.11.2026, вне master

Продолжение добавляет атомарный POST apply и панель `orion-dev` через штатный
реестр модулей. Требуются подтверждение пространства и точные решения о
совпадениях; устаревший snapshot отклоняется. Критерии приёмки и фазы сохраняются
в описаниях новых объектов, существующие поля сохраняются. Каталог включён
в API-пакет Windows-сборки. Platform API 1.12.0 / integration 1.11.0.
Проверки: 1692 unit, 682 integration / 1 opt-in skip, 42 Chromium parity и
4 ORION DEV-сценария PASS; typecheck/lint (0 errors)/architecture/contracts PASS.
Windows NSIS собран из `08c4491`; автономный runtime на новом профиле проверен
через импорт/перезапуск/повтор без дублей. По разрешению владельца обновлена
рабочая beta.28, без резервной копии по его указанию. В существующее Orion Dev
через нативный review/consent/apply добавлены 13 проектов, 16 задач и 5 зависимостей;
старый ORION сохранён (всего 14 проектов). Повторный импорт после перезапуска
создал 0 объектов; критерии приёмки сохранены в канонической задаче. [Отчёт и артефакт](../development/LOCAL_BETA_2026-11-02.md),
[контракт и UX](adr/ADR-0045-development-review-apply.md).

## ORION DEV — первый этап стабилизации 02.11.2026, исторический срез `caa2db0`

Ветка `codex/orion-dev-stabilization-20261102` основана на PR #95 (`2710e64`),
без XLSX PR #94. Исправлены типы, регистрация Prisma-моделей, исключение одноразовых
consent из backup/sync, согласованность CLI/API planner, межмодульные обращения и
канонические TaskOperations/events. Импортные helpers сериализуют запись и
блокируют граф зависимостей; preview учитывает выключенные Projects/Tasks.
153 миграции, включая consent/RLS, применены в отдельном PostgreSQL-кластере.
На `caa2db0`: 1692 unit, 671 integration / 1 opt-in skip, 42 Chromium,
typecheck/lint (0 errors)/architecture/contracts/generators и API/Web build PASS.
Production API preview/consent пережили рестарт на синтетическом профиле.
Восстановлено сужение live agent scopes по ADR-0007, включая конкурентные edits.
Это не обновление установленного приложения и не наполнение рабочего Orion Dev:
public apply, UI и Windows end-to-end ещё не готовы.
[Точный объём, проверки и блокеры](../development/LOCAL_STABILIZATION_2026-11-02.md).

> **Статус документа:** оперативная сводка с изменениями по 30.10.2026; для факта выполнения требуется проверка на конкретном HEAD. [Политика документации](DOCUMENTATION_LIFECYCLE.md) разграничивает действующие требования и исторические отчёты. Изменения документации сами по себе не подтверждают готовность продукта или Windows-приёмку.

> Направление и приоритеты задаёт [PLATFORM.md](PLATFORM.md) (KAIDEN Orion Platform 1.0). Этот файл — только факт: что в коде и что проверено.

Единая точка входа: что лежит в master, что проверено на этой ревизии и что осталось. Отчёты по отдельным этапам — архив; при расхождении верен этот файл и проверка на текущем коммите.

## Agent Hub и Habitat — локальная интеграция 29–30.10.2026

Текущий выпуск — [Windows beta 35](https://github.com/KeinReno/ORION/releases/tag/v0.1.0-windows-beta.35), исходный commit `bc99d82`, установщик `ORION_0.1.35_x64-setup.exe` (96 474 964 байта), SHA-256 `3E18D9B1C22F1A7E665560DF32CC083BF8FA9A27943C35BDCBAED3191E9D8F83` совпал с GitHub asset. После beta 34 [PR #93](https://github.com/KeinReno/ORION/pull/93) добавил остановку Habitat после отмены или отзыва токена: read-only проверка очереди каждые 5 секунд и fail-closed остановка локального host. Исправлена нестабильная проверка `module-registry --check` на свежем Windows checkout при CRLF в историческом Prisma-фрагменте. На Windows прошли 1604 unit-теста, 31 тест Habitat, полный typecheck, lint без ошибок, архитектурные и контрактные проверки, сборка API/Web и native host smoke с остановкой CLI. Проверен состав NSIS, но не проведены установка на другом чистом ПК и визуальная проверка экрана с активным исполнением. GitHub Actions по-прежнему не запускает задания из-за состояния оплаты аккаунта.

PR #92 объединил Agent Hub и Habitat с основной веткой. [Windows beta 34](https://github.com/KeinReno/ORION/releases/tag/v0.1.0-windows-beta.34) собрана из `1397203`; установщик `ORION_0.1.34_x64-setup.exe` (96 456 070 байт), SHA-256 `94d016944bac0279808f09ec2dc7bc8c1ea99ca11d60e55b3559a45a02abf08a` совпал с GitHub asset. В beta входят опциональный Agent Hub с долговременными исполнениями и журналом, ручной MCP-протокол с арендой и проверкой полномочий, реестр заявленных runtime-сессий и локальный Habitat с явным запуском оператором. Экран позволяет владельцу/руководителю поставить существующую задачу в ручную очередь, посмотреть события, отменить исполнение и восстановить просроченную аренду; присутствие observer показано отдельно. Право сообщать о присутствии (`agent-hub.runtime.create`) отделено от права захватить задание (`agent-hub.execution.create`).

На Windows прошли генераторы модуля/документации/карты платформы, Prisma Client, typecheck, lint (0 ошибок), architecture-check, web build, 1603 unit-теста, 29 тестов Habitat и 13 API-интеграционных тестов Agent Hub. Все 150 миграций применены в отдельной тестовой БД. Нативный host .NET 8 собран и прошёл Windows smoke, включая остановку дочернего дерева. В браузере на синтетическом профиле ранее открыта зарегистрированная панель Agent Hub и проверено пустое состояние; обновлённый экран с активным исполнением и установка beta 34 на другом чистом ПК не проверены. Автоматического назначения заданий, службы Windows, низкопривилегированной OS-изоляции, подтверждения работающей модели и независимой проверки результата пока нет. Успешный выход локального процесса переводит исполнение только на проверку, не завершает пользовательскую задачу.

## Завершение процессов локального runtime при выходе — 27.10.2026

До этой правки Windows не завершала `node.exe` (launcher) и порождённые им API
`node.exe` и `postgres.exe` при закрытии ORION, крахе шелла или снятии процесса
через «Диспетчер задач» — они оставались в фоне на портах 4000/55432. Это же
приводило к тому, что `ready()`-проверка при следующем запуске молча находила
старый осиротевший процесс и пропускала запуск актуальной версии (выбор payload,
миграции). `apps/desktop/src-tauri/src/main.rs::bind_launcher_lifetime` привязывает
дерево процессов launcher'а к Job Object с `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`:
хэндл не закрывается явно, поэтому Windows закрывает его (и убивает всё дерево)
сама при завершении `orion-desktop.exe` любым способом.

**Не проверено.** В этой среде нет Rust/Cargo/Tauri CLI (как и для прежних
Rust-правок) — `cargo check`/`cargo test`/реальная сборка NSIS не запускались.
Перед следующим релизом нужно: `cargo check --release` и `cargo test` на
Windows-машине с Rust, затем ручная проверка — закрыть ORION и в «Диспетчере
задач» убедиться, что `node.exe`/`postgres.exe` этого профиля не остались.

## Правила публикации Tasks — 26.10.2026

Первый backend-срез: остановленное по умолчанию правило, фильтр проектов/статусов,
точный предпросмотр полей и участников, CAS и явное согласие на будущие записи.
Существующий outbox и ограниченная сверка обновляют выбранные поля; выход из фильтра,
удаление оригинала и потеря прав закрывают доступ. Tombstones, FORCE RLS, безопасный
restore обоих концов и независимые копии сохранены. Ручные публикации не перехватываются.

**1504 unit**, **634 integration / 1 skip**, **2 production browser**; typecheck,
lint (0 errors / 30 прежних warnings), architecture/contracts/docs/map и API/web
build passed. Platform API 1.10.0 / Integration 1.9.0 / Event 1.1.0.
UI управления правилами, согласующие, Family presets, Knowledge rules, Android и
Orion Link — следующие этапы, не готовые функции. Это ещё не Windows release;
новая миграция потребует полного установщика.
[Контракт](platform-api/PUBLICATION_RULES.md), [проверки и передача работы](PUBLICATION_RULES_STAGE1_2026-10-26.md),
[PR #79](https://github.com/KeinReno/ORION/pull/79).

## Отзывчивый запуск Windows — 26.10.2026

Ожидание локального runtime вынесено из Tauri setup в фоновый поток. Встроенный
экран загрузки появляется до API/React, показывает этапы launcher и явную ошибку;
переход в клиент — после health с готовой БД. Исправлена нормализация CRLF в CSP.
1501 unit, 18 runtime payload, 5 Rust, typecheck/architecture/contracts и два
синтетических native startup сценария прошли. Выпущена
[Windows beta24](https://github.com/KeinReno/ORION/releases/tag/v0.1.0-windows-beta.24):
полный установщик 73964457 байт; архив, metadata/hash и комплектный runtime на
изолированной БД проверены (health ok за ~35,5с). Это не замер личного профиля;
установка нового NSIS и реальный payload update/rollback ещё требуют приёмки.
[Реализация, проверки и границы](DESKTOP_STARTUP_2026-10-26.md).

## Межмодульные границы — 26.10.2026

Закрыты все **17** оставшихся service-исключений: Goals, Home, Activity, Overview,
Markets, Notes attachments, Captures, списки/мосты и агентские операции. Запросы и
команды перенесены в SDK владельцев с сохранением RLS, scope, транзакций, CAS и
защиты от повторного списания/прихода. Старый helper дома удалён; architecture-check
также обнаруживает чужие запросы за внутренними helper-импортами.

Локально: **1501 unit**, **620 integration / 1 skip**, **47 browser** (default-full,
plugins-off и рабочие сценарии), typecheck/lint/build/architecture/contracts/docs/map.
Схема, данные и дизайн сохранены. Platform API 1.9.0 / Integration API 1.8.0.
[Этапы и проверенные границы](MODULE_BOUNDARY_COMPLETION.md),
[SDK для агентов и модулей](platform-api/MODULE_BOUNDARY_SDKS.md).

## Пакеты обновлений desktop — beta 23, 26.10.2026

Protocol 1: UI/API обновляются без Rust/NSIS. Ed25519, пофайловые SHA-256,
подписанные ссылки на неизменившиеся baseline-файлы; exact shell/native/runtime
и Prisma compatibility. Отдельные pending/trial/active/previous, API health + React
hydration, откат и native reload trusted окон при неудачном запуске. Origin/IPC
сохранены. Смена БД, оболочки, Node/PG или launcher требует полного установщика.

**1499 unit / 191 files**, **43 Chromium**, **3 Rust**, **5 native WebView2 checks**
прошли. Typecheck/architecture/contracts/map passed; lint — 0 errors / 30 warnings.
Подписанный контрольный пакет на production-файлах: **660235 байт**, 10232
записей, 10229 переиспользованы; signature/integrity/rollback/commit passed.
Это синтетическая проверка, не публичная beta 24 и не installed update acceptance.

Windows beta 23 из **45a514e**: **73961343 байт**, SHA-256
7839370b376bf93941dd1290a6bf2092def266f5ce7142591d258c721548d28b. Архив/состав/import проверены; installer без Authenticode.
Чистая установка и полный цикл обновления установленного приложения не подтверждены.
[Релиз](https://github.com/KeinReno/ORION/releases/tag/v0.1.0-windows-beta.23),
[контракт/сборка](DESKTOP_PAYLOAD_UPDATES.md), [приёмка и ограничения](WINDOWS_BETA23_2026-10-26.md).

## Контрольная точка beta 22 — 25.10.2026

Tasks использует публичные ProjectTaskLinks и MilestoneReferences вместо чужих моделей.
ADR-0032; Integration API 1.7.0 / Platform API 1.8.0. Исключения: **17 файлов / 50 model entries /
19 service entries**. Focused: 18 passed; unit: 1476 passed; integration: **616 passed / 1 skipped**;
Chromium: **56 passed** после отдельной пересборки стенда. Typecheck/lint/architecture/contracts прошли;
Кандидат Windows beta 22 собран из 81e4007 и проверен как NSIS-архив: **73 899 690 байт**,
SHA-256 53266aeaa2f5d7d3d626830f9fc6df360cb8b91283ebb1d41fbe2b06d4c0db60.
[Релиз beta 22](https://github.com/KeinReno/ORION/releases/tag/v0.1.0-windows-beta.22).
Арка не закончена: Goals и остальные мосты остаются следующей очередью.
[Контракты](platform-api/TASK_PLANNING_LINKS.md), [выпуск и продолжение](WINDOWS_BETA22_2026-10-25.md).

## Finance → Projects: ссылки и валюта — 25.10.2026

В `codex/finance-project-contract` Finance не читает Project напрямую. Операции и шаблоны используют
ProjectReferences; затраты — ProjectFinanceReader ({currency} либо null) в исходной транзакции/RLS.
Прямой запрос удалён также из finance-refs.util.ts. Права, 400, null, архив/отключение Projects и
расчёты валют сохранены. SDK не импортируют полный ProjectsModule. ADR-0031; Integration API 1.6.0 /
Platform API 1.7.0. Исключения: **19 → 18 файлов / 53 → 52 model entries**, service entries — 19.
Focused: **17 passed**, в том числе Finance без полного ProjectsModule. Unit: **1476 passed**;
typecheck, architecture/registry/docs/map passed; lint — 0 ошибок / 30 прежних предупреждений.
Production API/web build (54 страницы) и **44 Chromium** сценария прошли; полный integration
на пересозданной БД — **610 passed / 1 skipped**. Приёмка локальная; CI имеет известный billing-блок.
[Контракт](platform-api/PROJECT_FINANCE_READER.md), [проверки](FINANCE_PROJECT_CONTRACT_2026-10-25.md).

## Time и Calendar → Tasks / Projects — 25.10.2026

В `codex/time-calendar-contracts` Time и Calendar (EventsService) больше не читают Task/Project.
TaskIntegrationReader предоставляет только ссылку с projectId и поля исходящего ICS; ProjectReferences
проверяет проекты. Исходная транзакция/RLS, права, null, 404, наследование проекта, feed token и guards
сохранены. SDK не импортируют полные доменные модули. ADR-0030; Integration API 1.5.0 / Platform API 1.6.0.
Исключения: **21 → 19 файлов / 57 → 53 model entries**, service entries — 19. Focused: **19 passed**,
в том числе Time + Calendar без полных TasksModule/ProjectsModule. Unit: **1476 passed**; typecheck,
architecture/registry/docs/map passed; lint — 0 ошибок / 30 прежних предупреждений.
Production API/web build (54 страницы) и **46 Chromium** сценариев прошли; полный integration
на пересозданной БД — **603 passed / 1 skipped**. Проверки выполнены локально; CI имеет известный billing-блок.
[Контракт](platform-api/TASK_INTEGRATION_READER.md), [проверки](TIME_CALENDAR_CONTRACTS_2026-10-25.md).

## Пять потребителей → Projects: публичная проверка ссылки — 25.10.2026

В `codex/project-reference-contract` Notes, Documents, Inbox, Inventory и Milestones больше не читают
Project напрямую. `ProjectReferences` возвращает boolean в исходной транзакции/RLS; SDK независим
от ProjectsModule/ProjectsService. Права, null и прежние ошибки остаются у потребителей; Inbox сохраняет
проверку включённости Projects, HTTP Milestones остаётся за guard. ADR-0029; Integration API 1.4.0 /
Platform API 1.5.0. Исключения сокращены: **26 → 21 файл / 62 → 57 model entries**, service entries — 19.
Focused integration: **22 passed** (в том числе запуск пяти потребителей без полного ProjectsModule).
Полный unit: **1476 passed**; typecheck, architecture/registry/docs/map passed; lint — 0 ошибок /
30 прежних предупреждений. Production API/web build (54 страницы) и **44 Chromium** сценария прошли;
полный integration на пересозданной БД — **596 passed / 1 skipped**. GitHub CI не стартует из-за billing.
[Контракт](platform-api/PROJECT_REFERENCES.md), [проверки и границы](PROJECT_REFERENCE_CONTRACT_2026-10-25.md).
В опубликованный установщик beta 21 этот этап не входит.

## Health → Contacts: проверка ссылки врача — 25.10.2026

В `codex/health-contact-contract` HealthService больше не читает Contact напрямую. Публичный ContactReferences
передаёт проверку владельцу Contacts, возвращает только boolean и сохраняет исходную транзакцию/RLS. Права на
медицинские данные проверяются до вызова. Архивные/выключенные контакты сохраняют прежнюю семантику ссылок;
Contacts CRUD остаётся за guard. SDK не импортирует ContactsModule/ContactsService. ADR-0028; Integration API
1.3.0 / Platform API 1.4.0. Health удалён из exceptions: **26 файлов / 62 model entries / 19 service entries**.
Focused Health + Contacts: 29 passed; полный unit: 1476 passed; production Chromium: 47 passed (панели
default-full/plugins-off, контакты и выбор врача). Полный integration на пересозданной тестовой БД:
**587 passed / 1 skipped**, включая все шесть новых сценариев и явный случай удалённого врача.
Typecheck, production API/web build (54 страницы), architecture/registry/docs/map passed; lint — 0 ошибок /
30 прежних предупреждений. [Контракт](platform-api/CONTACT_REFERENCES.md), [проверки](HEALTH_CONTACT_CONTRACT_2026-10-25.md).

## Tasks → Time: следующий перенос границы — 25.10.2026

В `codex/reference-moves-stage2` TasksService больше не обращается к TimeEntry. Публичный
TaskClosureRegistry передаёт синхронную остановку таймера владельцу Time в транзакции закрытия задачи;
ошибка откатывает всю команду, пустой registry допускается. UI, schema, права и outbox-подписки не меняются.
Погашено одно model-исключение: 64 → 63; файлов остаётся 27, service-исключений 19. Новый handler входит
в проверяемые `.service.ts`. Integration API 1.2.0 / Platform API 1.3.0, карта и snapshot обновлены.
Focused integration: 8 passed; полный unit: **1476 passed**; полный integration на пересозданной тестовой БД:
**581 passed / 1 skipped**. Production API/web build (54 страницы), typecheck, architecture/registry/docs/map
passed; lint — 0 ошибок / 30 прежних предупреждений. Браузер: 43 сценария панелей/публикаций и отдельный
финальный повтор 2 новых task/timer сценариев — passed (всего 45 различных). Снимки действий не менялись.
GitHub CI не стартует из-за billing; подробности оснастки и границы проверки сохранены в отчёте.
[Контракт](platform-api/TASK_CLOSURE.md), [проверки и ограничения](TASK_TIME_BRIDGE_2026-10-25.md).
В опубликованный установщик beta 21 этот этап не входит.

## Укрепление платформы — 25.10.2026

В `codex/platform-hardening` реализованы независимые границы modules-ext, сохранение source version/requires, проверка совместимости до включения и в guards, транзакционный перенос Capture anchors через владельца вместо прямой записи Contacts. Одно архитектурное исключение удалено. Карта возможностей генерируется из кода (`pnpm platform-map --component <id>`), CI/unit контролируют актуальность. Контракты: ADR-0025/0026.

Полный эксперимент отдельного модуля прошёл: generator → Prisma/БД → API/RLS → production UI, 20 файлов / 0 ручных Core-правок. В продолжении исправлены удержание невидимой подложки Modal/Sheet внутренними layout-анимациями и обратный порядок блокировок fan-out/удаления пространства. Проверки: 1474 unit; полный integration **573 passed / 1 skipped**, deadlock не повторился; production API/web build и typecheck passed; lint — 0 ошибок / 30 прежних предупреждений. Chromium: **50 passed** (панели default-full/plugins-off, Knowledge, настройки и shell), затем **7 passed** (повтор контактов, Modal в двух режимах движения, публикации, питомцы); всего 54 различных сценария. Исходные отказы и проверка блокировок сохранены в [отчёте](PLATFORM_HARDENING_2026-10-25.md). GitHub CI не стартует из-за billing. В опубликованный установщик beta 21 этот последующий этап не входит.

## Windows beta 21 опубликована — 25.10.2026

[Скачать Windows beta 21](https://github.com/KeinReno/ORION/releases/tag/v0.1.0-windows-beta.21), исходники `ecd7ac7`, PR #66 merged. NSIS собран и проверен как архив; скачанный с GitHub EXE совпал по SHA-256 с локальным. Чистая Windows/установленный runtime остаются непроверенными; CI на релизном commit не стартовал из-за ограничения оплаты.

После диагностики обновлены тесты ответа дневника питомцев и матрица отключения модулей (добавлен Knowledge). Полный integration на отдельной БД: **568 passed, 1 skipped**, 104 passed-файла, 495.44 с; неожиданный HTTP 500 создания grant не повторился, первопричина исходного отказа не установлена. В его сценарии включён error logger. Typecheck, lint (0 ошибок / 30 прежних предупреждений), architecture/registry/docs и 11 plugin contracts прошли. Production API/web build и финальный Chromium-прогон **47/47** прошли (панели default-full/plugins-off, Knowledge, публикации, питомцы и настройки). Доказательства и границы упаковки фиксируются в [отчёте beta 21](WINDOWS_BETA21_2026-10-25.md). Платформенные исправления отложены до выпуска; исторический срез ниже сохраняется.

## Диагностический срез 24.10.2026

На `030c253` проведена [перепроверка платформенных тезисов](PLATFORM_DIAGNOSTIC_2026-10-24.md): 1451 unit passed, реестры и architecture-check passed, но найдены два воспроизводимых сбоя интеграционных проверок и слепая зона контроля границ между подключаемыми модулями. Полная интеграционная и установочная приёмка не закрыта. GitHub job не стартовал из-за ограничения оплаты/расходов, а не из-за исполнения тестов. Отчёт содержит доказательства, пределы проверки и очередь исправлений; это не завершение всех пяти направлений аудита и не выпуск beta.

## Дополнение 24.10.2026: первый этап общих публикаций

В ветке `codex/shared-publications-stage1` добавлены ручные публикации задач и Knowledge поверх существующих общих пространств: предварительный просмотр, ограниченный набор полей, личные закрепления и самостоятельные копии. Делегируется только статус задачи; операция атомарна с оригиналом и защищена ревизией/operationId. Отзыв, отключённые модули и восстановление источника не должны возвращать доступ. Старый механизм grants сохранён.

Контракт: [ADR-0024](adr/ADR-0024-shared-publications.md). Проверки и ограничения: [отчёт первого этапа](SHARED_PUBLICATIONS_STAGE1.md). Это реализация для клиентов одного сервера; межузловой транспорт, общая модерация правок и Windows/Android-приёмка не заявляются завершёнными. Раздел ниже сохраняет историческое состояние master.

## Что в master

Сведение всех копий 17.10 (PR #2): локальный master (LAN, личные и общие пространства, Agent Gateway, MCP, Agent Manager, гибридная синхронизация, здоровье, цели, финансы), редизайн KAIDEN (PR #1, [HANDOFF](KAIDEN_ORION_REDESIGN_2026/HANDOFF.md)), Opportunity Hub, перенесённые исправления 27.09 (PR #3), пробелы Agent Manager (PR #4). Подробности сведения — в истории этого файла (`git log docs/STATUS.md`).

Дальше 17–18.10 влиты по одному PR:

| PR | Что |
| --- | --- |
| #8 | ТЗ 01: библиотека цветовых тем, свои темы, тема пространства ([отчёт](KAIDEN_REDESIGN_CURSOR_5_AGENTS_2026-10-17/reports/AGENT_01.md)) |
| #9 | ТЗ 02: вкладки проекта на узкой ширине, матрица задач по вехам ([отчёт](KAIDEN_REDESIGN_CURSOR_5_AGENTS_2026-10-17/reports/AGENT_02.md)) |
| #10 | ТЗ 03: деталь задачи — многострочное название, свойства одним блоком ([отчёт](KAIDEN_REDESIGN_CURSOR_5_AGENTS_2026-10-17/reports/AGENT_03.md)) |
| #11 | ТЗ 04: редактор заметок и список документов ([отчёт](KAIDEN_REDESIGN_CURSOR_5_AGENTS_2026-10-17/reports/AGENT_04.md)) |
| #12 | ТЗ 05: неделя и день календаря, ночные события через полночь ([отчёт](KAIDEN_REDESIGN_CURSOR_5_AGENTS_2026-10-17/reports/AGENT_05.md)) |
| #13 | Этап 1: [аудит платформы](PLATFORM_AUDIT.md) — пробелы G1–G26 с приоритетами и критериями; закрыты G8 (граница ошибок вокруг каждой панели и каждого вклада плагина), G18 (проверка жёстких цветов в плагинах), G23 (проверка каталога плагинов и слотов в `architecture-check`); G9 (обёртка `BackgroundJobsService` для всех `@Cron` с учётом по `componentId`, диагностика `GET system/jobs`) |
| #14 | Этап 2: манифест компонента (`component-manifest.ts`, `PLATFORM_API_VERSION = 1.0.0`, манифесты всех модулей и плагинов строятся из каталогов) и контракты платформы [`docs/platform-api/`](platform-api/README.md): модули, события, разрешения, хранилище, пространства, поверхности, темы, интеграции, Agent Gateway; [ADR-0019](adr/ADR-0019-event-api-outbox.md) (Event API через outbox, предложено) |

Этап 3 по аудиту (18–19.10), PR #15–#44 ([PLATFORM_AUDIT.md](PLATFORM_AUDIT.md) — строка по каждому пробелу):

| Что | Пробел |
| --- | --- |
| Изоляция ошибок фоновых задач, outbox доменных событий (ADR-0019), реестр разрешений и `@RequirePermission` | G9, G3, G12 |
| Границы модулей в `architecture-check`, провайдеры поиска и входящих, динамическое подключение модулей каталогом (образец «Питомцы»), жизненный цикл и зависимости, поверхности, комплект разработчика `create:module` | G4, G19, G5, G6, G7, G17, G15 |
| Версии контрактов платформы и тест-снимок публичной поверхности | G2 |
| Инструменты ИИ-агентов, объявляемые модулем; шаблон RLS и статус миграций компонентов; `createModuleClient`; диагностика компонентов в настройках | G13, G10, G11, G24, G16 |
| Данные Compass в резервной копии; WebDAV с инъекцией сбоев (исправлено зависание чтения); `revision` при прямых записях заметок | G22, G26 |
| Предохранитель токенов агента на сервере; **чат-ассистент внутри ORION** по ключу владельца (вариант C, ADR-0017) | G14 |
| **Личные заметки в общих пространствах** (ADR-0021, RESTRICTIVE-политики БД, включая историю и вложения) | G21 (первый срез) |

## Проверено на этой ревизии

Дополнение 19.10 после beta.5 / PR #50: локальный вход «имя + PIN» и самостоятельное пустое пространство проверены отдельно ([отчёт](LOCAL_REVIEW_2026-10-19.md)). Следующий срез упрощает поиск компьютеров в сети и заменяет iframe в desktop-браузере отдельным WebView с изолированным профилем: 1336 unit, typecheck, архитектура/контракты и отдельный нативный smoke пройдены. [Границы проверки и повтор](LAN_BROWSER_FOLLOWUP_2026-10-19.md): реальная выдача/антибот на ноутбуке и LAN двух физических ПК пока не подтверждены. Эта проверка не заменяет перечисленную ниже историческую полную интеграционную приёмку.

Проверено на `master` после слияния PR #29–#42: `pnpm typecheck` (кроме незавершённой работы над Orion Link в рабочем дереве), `pnpm test` — 1310 тестов зелёные, `architecture-check`, `module-registry --check`, `module-docs:check`; интеграционные тесты затронутых областей (агенты, ассистент, личные заметки, RLS, резервные копии, Compass, миграции модулей) — зелёные на чистой PostgreSQL. **GitHub Actions в этот период не запускались:** задания не стартуют из-за платёжного ограничения аккаунта (`The job was not started because recent account payments have failed`) — CI не подтверждает эти слияния, проверка была локальной.

Прежняя проверка (18.10, облачная среда, Linux)

CI на каждом PR зелёный: typecheck, lint, architecture-check, plugin-contract-check, unit-тесты, `test:integration` на чистой PostgreSQL после всех миграций, build, полный e2e и `build:desktop-export`. Локально тогда: `pnpm test` — 1182 теста; `pnpm test:e2e:local` — 122 из 124 (два сценария импорта папки HH в Opportunity Hub не проходят только в облачном Chromium — он не передаёт выбранную папку; в CI проходят).

**Не проверено:** Tauri-окно и установщик на Windows (в облаке нет Rust/WebView2), открепление окон, несколько мониторов и DPI, LAN между двумя реальными машинами, гибридная синхронизация между устройствами.

## Не сделано и известные пробелы

**Этап 0.** Пять экранов ТЗ 01–05 переведены. Остальные модули и плагины в новом виде и при смене темы глазами не проверены (волна 2.4). История переходов (Alt+←/→, `orion.nav.history.v1:<пространство>`), прокрутка главного скроллера панели (`orion.scroll.v1:<пространство>`) и несохранённый текст быстрого ввода и комментария к задаче (`orion.draft.v1:<пространство>:<поле>`) переживают перезапуск и аварийное закрытие. Не переживают: несохранённые формы новой заметки/задачи и прочие черновики (хранятся только как пометка «есть несохранённое»), прокрутка внутри вложенных областей и мастер-детальных панелей без `PanelBody`; тело заметки по-прежнему спасает только автосохранение на сервер.

**Открытые пробелы платформы** ([PLATFORM_AUDIT.md](PLATFORM_AUDIT.md)): G20 — гибридная синхронизация остальных моделей и приёмка на двух реальных установках (методика — [SYNC_TWO_INSTALL_ACCEPTANCE.md](SYNC_TWO_INSTALL_ACCEPTANCE.md)); G21 — личные записи для остальных сущностей, личные папки документов, рабочие сессии (по решению владельца позже); G14 — удалённый доступ по варианту A (OAuth) появится вместе с постоянным сервером; G16 — установка и обновление компонентов из API; G11 — версии данных компонента и откат миграций из API; G10 — DDL по манифесту. Чат-ассистент и личные заметки в интерфейсе визуально и в e2e не проверялись.

**Opportunity Hub.** Серверные реализации R0 и протокола R1 ранее проверялись синтетическими тестами; реальная отправка в hh.ru и живой браузерный адаптер не подтверждены. См. [обзор 16.10](OPPORTUNITY_HUB_REVIEW_2026-10-16.md) и [журнал реализации](OPPORTUNITY_HUB_PROGRESS.md). Приёмка на текущем Windows-клиенте и с реальными сервисами не проведена.

**Выпуск.** Установщика с этой ревизии нет: Tauri собирается только на машине с Rust. Сборка: `pnpm install`, `pnpm build`, `pnpm build:desktop-export`, затем `pnpm --filter @orion/desktop tauri:build`; проверять на отдельной учётной записи Windows, не трогая рабочий каталог `com.orion.desktop`.

## Порядок дальше

1. Восстановить GitHub Actions (платёжное ограничение аккаунта) и прогнать CI на `master`.
2. Проверить установленную Tauri-версию с master на Windows; пройти [SYNC_TWO_INSTALL_ACCEPTANCE.md](SYNC_TWO_INSTALL_ACCEPTANCE.md) на двух ПК (G20).
3. Пройти остальные модули и плагины при смене темы.
4. Личные записи для задач и остальных сущностей (G21), панель «Ассистент» и личные заметки — глазами и в e2e.

## Tasks 2.0 — backend (задание 02) — 11.11.2026

Реализован серверный срез Tasks 2.0. Фронтенд не менялся; единственная правка вне API/контрактов —
тестовые фикстуры `Task` в `apps/web/lib/*.test.ts`: в них добавлены новые поля DTO, иначе `typecheck` веба
не сходится.

- **Рекуррентность.** Модели `TaskRecurrence` (владелец — задача-шаблон) и `TaskRecurrenceInstance`
  (уникальный `ordinal` внутри правила). Завершение создаёт **ровно один** следующий экземпляр;
  идемпотентность держится уникальным `(recurrenceId, ordinal)` и условным
  `UPDATE ... WHERE generatedCount = <прочитано>`, поэтому два одновременных завершения не дают дубля.
  Режимы `daily | weekly | monthly | weekdays` + интервал, конец `count | until | never`; `weekly` умеет
  явный список дней от `anchorAt`. `skip` сохраняет историю (экземпляр `skipped`, задача удалена,
  `taskId → null`) и продолжает цепочку. События `tasks.recurrence.instance_completed`,
  `tasks.recurrence.skipped`.
- **Массовые операции.** `POST workspaces/:id/tasks/bulk`: complete/set-status/set-priority/move-to-project/
  delete/archive/change-dates, лимит 200. `dryRun` (и отсутствие `confirm: true`) не пишет ничего; без
  `allowPartial` частичное применение отклоняется целиком (409 `bulk_partial_not_allowed`); по каждой
  позиции причина (`not_found | blocked | archived | in_publication | no_permission | invalid`). Сводное
  событие `tasks.task.bulk_applied` + обычные события на каждую задачу.
- **Пользовательские статусы.** `TaskStatusDefinition` (категория open/in_progress/done/cancelled, цвет,
  порядок, `systemKey` для встроенных) + `Task.statusId`. `Task.status` остаётся категорией: закрытость,
  отчёты и напоминания не переписаны. Миграция создаёт дефолтный набор (Бэклог / К выполнению / В работе /
  Готово / Отменено) для всех существующих пространств и бэкфилит `statusId`; новые пространства получают
  набор лениво. Удаление занятого статуса без `confirm=true` — 409 `task_status_in_use` с числом задач и
  статусом переноса.
- **Пользовательские поля.** `TaskFieldDefinition` (text/number/date/select/multi/checkbox/url,
  обязательность, `all | project`) и `TaskFieldValue` (`valueJson` + `valueText`); GIN-индекс по
  `valueText`, значения участвуют в общем поиске задач. Типы проверяет общая чистая
  `validateTaskFieldValue`.
- **Плановые свойства.** `importance`/`urgency` (0–3), `complexity` (low/medium/high) — независимы от
  `priority`; `executorSource` (none/human/agent). Взаимное исключение «человек ИЛИ агент»: Tasks уже
  спрашивает `TaskAgentAssignmentRegistry`, добавлен обратный guard `assertAgentAssignmentAllowedTx`.
- **Контракты/события.** `task-planning.ts` в `shared-types` (схемы + чистые помощники сдвига дат, тесты
  `task-planning.test.ts`), события `tasks.task.updated`, `tasks.task.status_changed`,
  `tasks.task.bulk_applied`, `tasks.recurrence.*`; разрешения `tasks.status.manage`, `tasks.field.manage`,
  `tasks.recurrence.manage`. Plugin contract tasks 1.5.0 не менялся (`plugin-contract-check` — 11 passed).
- **Данные/бэкап.** Модели внесены в `MODEL_OWNERS`; `TaskStatusDefinition`, `TaskFieldDefinition`,
  `TaskFieldValue`, `TaskRecurrence`, `TaskRecurrenceInstance` классифицированы в snapshot-registry и
  SNAPSHOT_MODELS (справочники — до задач, значения/экземпляры — после), RLS `ENABLE + FORCE` на всех пяти
  таблицах. Публичное чтение полей для планирования — `tasks/public/task-field-reader.ts`.

Проверено локально: все миграции (166+) применяются к чистой PostgreSQL, включая `..._tasks_20`; новый
`apps/api/test/tasks-20.integration.test.ts` — **5 passed** (идемпотентность завершения, skip, bulk
dryRun/confirm/allowPartial, статусы с переносом, поля и поиск, плановые свойства); затронутые
integration-сьюты (revision, comments, planning-links, time-bridge, RLS, domain-events) — зелёные.
Unit: `task-planning` — 12 passed, патченные web-фикстуры — 90 passed; `module-docs:check`,
`plugin-contract-check` — зелёные; eslint по изменённым файлам — 0 ошибок; `architecture-check` по задачам
чист. **Не проверено в этой среде:** полный `pnpm typecheck`/`architecture-check` красный из-за
незавершённых правок соседних волн (planning/projects/time/knowledge — чужие файлы), а `platform-map` не
запускается: сервис esbuild в песочнице получает `Access is denied` на чтение каталогов, поэтому
`capabilities.generated.json` не перегенерирован. Граница: `TaskFieldDefinition.projectId` проверяется
через публичный `ProjectTaskLinks`; таблицы чужих модулей Tasks не читает.

## Orion Tools — Tables, Global Search, команды (задание 10) — 11.11.2026

Реализован серверный срез общих инструментов. Фронтенд не входит в задание; вне API
затронуты только два словаря `SearchableEntityType` (метка/иконка материала в
`apps/web/lib/entity-type-meta.ts`) — иначе typecheck веба не сходится на новом типе.

- **Orion Tables.** `TableDefinition` + `TableRow` (jsonb-схема колонок и значения строк),
  RLS `ENABLE + FORCE` и политика членства, миграция `20261111193000_orion_tools_tables_key_bindings`.
  Типы колонок `text|number|date|select|checkbox|url|formula|link`; значения проверяет общая
  чистая `validateTableRowValues` из `shared-types`, ссылки — публичные `TaskReferenceReader`
  и `ProjectReferences` (не прямые запросы в чужие таблицы). Формулы: `sum/avg/count/min/max`
  по колонке и выражения по ячейкам строки; разбор/вычисление — `shared-types/src/table.ts`.
  Неизвестная функция/ссылка на формулу — 422 при записи схемы, sum считается на чтении
  (`totals` + `computed` строк). CSV: импорт с явным `sourceHeader`-маппингом и приведением
  типов, экспорт с BOM; XLSX осознанно отложен — в `apps/api` нет рантайм-зависимости.
  События `table.row_changed` (publisher `core`), права `core.table.*`.
- **Global Search.** Единый вход `GET /search?workspaceId=&q=&types=&from=&to=&limit=`:
  фильтры по типам и окну `updatedAt`, общий лимит, `module`/`moduleLabel` и `deepLink`
  (`ObjectRef`) в каждом результате. Провайдеры модулей не менялись по контракту; добавлен
  `KnowledgeSearchProvider` (tsvector задания 06, архивные и приватные чужие материалы не
  отдаются) и тип `knowledge_item`. Старый `GET /workspaces/:id/search` сохранён. Выключенный
  модуль по-прежнему не опрашивается (`accessibleTypesTx`), проверено интеграционным тестом.
- **Команды и горячие клавиши.** Реестр `CommandRegistry` (модули регистрируют команды в
  `onModuleInit`; неизвестное разрешение/дубль падают при старте), `GET /commands` для
  включённых модулей, `POST /commands/:id/execute` — серверная команда исполняется, UI-команда
  возвращает маршрут. `KeyBinding` (per-user+workspace, RLS, уникальность команды) с
  нормализацией сочетаний и **предупреждением** о конфликтах (`keyBindingConflicts`), а не
  блокировкой. Права `core.command.*`, `core.key_binding.manage`.
- **Данные/бэкап.** `TableDefinition`/`TableRow` — `included` в snapshot-registry и
  `SNAPSHOT_MODELS` (определения до строк), `KeyBinding` — `identity-excluded` (личная
  настройка), модели внесены в `MODEL_OWNERS`. Контракты: `event` 1.3.0, `permission` 1.5.0,
  снимок `contracts.snapshot.json` обновлён.

Проверено локально: миграции с нуля (отдельная БД, 175 миграций, включая
`20261111193000_orion_tools_tables_key_bindings`) — PASS; у трёх новых таблиц `ENABLE`+`FORCE`
RLS и политика членства. Новый
`apps/api/test/orion-tools.integration.test.ts` — **6 passed** (sum на чтении и 422 на
неизвестную формулу, проверка link на задачу через контракт, импорт/экспорт CSV с типами,
поиск задачи+заметки+материала и отсутствие заметки при выключенном модуле, фильтр `types`,
исполнение `core.create-table`, скрытие команд выключенного модуля, конфликты клавиш);
`rls-coverage` — зелёный (новые таблицы учтены). Unit: `table.test.ts` — 11, `commands.test.ts` — 3,
`command.registry.test.ts` — 4, реестр провайдеров — 3. `module-docs:check`, `plugin-contract-check`
(11) — зелёные; `architecture-check` падает только на незавершённых файлах `development/`
(соседняя волна 11), по файлам задания чист. **Не проверено в этой среде:** полный
`pnpm typecheck`/`build` (те же чужие незавершённые файлы), `pnpm platform-map` — esbuild не может
читать каталог (`Access is denied`); `capabilities.generated.json` перегенерирован эквивалентной
логикой без esbuild-бандлера и проверен по содержимому (события/права/контракты на месте).
`snapshot.integration.test.ts` красный из-за неклассифицированных моделей соседних волн
(`KnowledgeItemRevision`, `KnowledgeSettings`, `AgentMemberEvent`), не из-за таблиц задания;
`sync-classification`/`ops`-инвентари также красные из-за моделей соседних волн (наши три строки
добавлены: `TableDefinition`/`TableRow` — LWW «later», `KeyBinding` — `not-synced`).
Граница: link-колонки первой срез — задачи и проекты; новый тип = адаптер на публичном
контракте владельца. Синхронизация таблиц поверх Sync Core, плагины-хранилища и SQL-режим — вне
задания.

## ORION-R — стабилизация Rust-shell и сборка установщика — 15.11.2026

Срез: ветка `experiment/orion-rust-foundation`, рабочее дерево. Цель волны — ускорение
запуска (боль ≥1 мин против 15 с у Classic), гигиена антивируса и рабочий установщик
ORION-R из прямого Rust lifecycle.

**Код (orion-rust и оболочка):**
- `ring` удалён из зависимостей (C-сборка при `cargo build` на этой машине стабильно
  падала в cl с D8050 при любом способе spawn). Замена — чистый Rust:
  `ed25519-dalek` (верификация подписи payload, `rust_payload.rs`) и `getrandom`
  (nonce UI-ACK, `rust_api_supervisor.rs`). Сборка orion-runtime стала hermetic,
  MSVC больше не нужен. `Cargo.lock` обновлён.
- identity-проверка кластера и provisioning слиты в один Node-процесс (`PG_SETUP_JS`,
  `lifecycle.rs`) — минус один холодный старт Prisma на каждом запуске.
  `PROVISION_JS`/`IDENTITY_JS` остаются только в тестах.
- health-проба API (`local_health`) переписана: читает ответ до EOF, парсит CRLF и LF,
  понимает `Content-Length` и `Transfer-Encoding: chunked` (добавлены unit-тесты).
- Tauri (`apps/desktop/src-tauri/src/main.rs`): ожидание выхода runtime в
  `ExitRequested` раньше висело бесконечно после дедлайна 540 с — теперь жёсткий выход
  через `EXIT_ALLOWED` + `handle.exit(0)` (Job Object закрывает дерево).
- `write_json_atomic`: удалены дублирующиеся идентичные `cfg(windows)`/`cfg(not)` ветки.
- Устаревшие шапки «deliberately not registered» в `rust_payload.rs`/
  `rust_payload_supervisor.rs` заменены на актуальные (модули — часть production-пути
  supervise-direct).
- Clippy под toolchain 1.100 приведён к чистоте (как в CI: `cargo clippy -- -D warnings`):
  `bool_assert_comparison`, `needless_borrows_for_generic_args`, `single_match`,
  `needless_return`, `type_complexity` (type alias `PrepareHook`), ручной `div_ceil`,
  лишний pointer-cast, `items_after_test_module` (`restore_staged_backup` перенесён выше
  `mod tests`), `assert_eq!(…, false/true)` в тестах.

**Скрипты и сборка:**
- `scripts/db-grants.mjs` + `pnpm db:grants` (`package.json`): идемпотентное повторное
  создание ролей orion_app/orion_system и grants после `migrate reset`. Проверен на
  живом dev-кластере (127.0.0.1:5433, 175 миграций на месте), двойной прогон — чистый.
- `scripts/defender-exclusions.ps1`: исключения Windows Defender (репо,
  `%LOCALAPPDATA%\ORION-Rust`, `~/.cargo`, `~/.rustup`) для dev-машины; от админа.
- `scripts/measure-launch.ps1`: замер холодного/тёплого запуска supervise-direct по
  этапам (startup-stage elapsed-ms), штатная остановка через EOF, проверка портов.
- `scripts/build-desktop-installer.mjs`: git rev-parse обёрнут в try/catch — сборка не
  падает на хосте без git (commit = `unknown-commit` или `ORION_BUILD_COMMIT`).
- **Установщик собран**: `apps/desktop/src-tauri/target/release/bundle/nsis/
  ORION Rust_0.1.48_x64-setup.exe` (≈100 МиБ; предыдущий 0.1.47 — ≈97.6 МиБ).
  Stage runtime полный: node.exe (настоящий Node 24.21.0), orion-runtime.exe,
  postgres, api (+Prisma client), web, habitat (dotnet smoke — PASS), build.json
  (tag `v0.1.0-dev-build`). ORION_BUILD_TAG для релиза задавать явно.

**Проверено:** `cargo test --locked` — 40 passed / 7 failed / 8 ignored; все 7 падений —
артефакты песочницы агентской среды (запрет spawn node/дочерних exe и записи вне
workspace для неподписанных свежесобранных бинарников), не дефекты кода: тесты на
изменённые модули зелёные. `cargo clippy -- -D warnings` — чисто (как в CI).
`cargo check` Tauri-приложения — чисто. `pnpm db:grants` — идемпотентен на живом кластере.
Полный pipeline установщика — PASS end-to-end.

**Не проверено в этой среде (песочница):** сквозной запуск GUI/runtime (spawn node.exe
из orion-runtime блокируется) — замер запуска и приёмка установленного приложения —
на машине пользователя через `scripts\measure-launch.ps1` и ручной установкой NSIS.
LAN-репетиция, unicode-пути, restore/migration center — не реализованы (restore —
заглушка). Подпись бинарников: установщик не подписан, на чужих машинах будет
SmartScreen — нужен EV code-signing сертификат (закупка вне этой волны).

Известные ограничения среды (для будущих волн в этом агенте): нет `ProgramFiles*`/
`ProgramFiles(x86)` в env — dotnet/NuGet падает с «path1 null», выставлять вручную;
node в PATH — шим Kimi, для сборки установщика нужен настоящий Node (в `.tools/`);
git из дочерних процессов node блокируется песочницей.

## 2026-11-15 (вечер) — приёмка 0.1.48 на машине пользователя

**Факты приёмки.** Старая установленная копия (ORION 0.1.39, `%LOCALAPPDATA%\ORION`)
удалена вручную (штатный uninstall.exe в агентской среде не отработал — см. ограничения
песочницы ниже). Установщик 0.1.48, запущенный **вне каталога workspace**
(`D:\ORION-install\`), установился штатно; GUI появляется за **~3 с** (эталон Classic —
15 с). Стабильно работает: orion-desktop.exe, embedded postgres (порт 5433), API
(`runtime\node.exe → api\dist\main.js`, порт 14000).

**Корневая причина сбоев установки/запуска на этой машине.** Процессы, запущенные
из-под каталога workspace (`C:\Users\Reno\Desktop\ORION-Rust\...`), в агентской среде
Kimi ограничиваются: неподписанные exe не могут писать файлы и спавнить дочерние
процессы (NSIS из workspace: «Error opening file for writing» на первом же файле,
дерево установки подчищается после выхода; извне workspace — работает штатно).
**Вывод для сборок/установок на этой машине:** запускать установщики и свежесобранные
exe только из каталогов вне workspace. На чистых машинах пользователей ограничений нет.

**Действия пользователя, выполненные на машине:** исключения Defender
(`scripts\defender-exclusions.ps1` + `D:\ORION Rust` вручную) — добавлены.

## 2026-11-15 (вечер, вторая волна) — починка отсоединённых сайдбаров (0.1.49)

**Симптомы:** второй сайдбар не функционален; размеры окна сбиваются, полный экран
невозможен, мерцание; после закрытия главного окна сайдбар (и весь процесс) остаётся.

**Причины и правки:**
1. Не выданы IPC-разрешения на чтение мониторов: `capabilities/nav-sidebar.json` —
   добавлен `core:window:allow-available-monitors`; `capabilities/default.json` —
   добавлены `allow-current-monitor` + `allow-available-monitors`. Без них определение
   «свой/чужой монитор» молча падало в unknown → клики не маршрутизировались,
   локальный воркбенч не поднимался.
2. Форс-ресайз 280px на каждый host-bounds тик (раз в секунду) — теперь ресайз только
   при смене отношения к монитору хоста (`nav-sidebar-window.tsx`,
   `lastAppliedRelationRef`).
3. Tauri не завершает приложение, пока живо любое окно: закрытие главного окна теперь
   закрывает все дочерние (`main.rs`, `on_window_event` → `webview_windows().close()`),
   далее штатный graceful-путь `ExitRequested`.
4. `payload_ui.rs` rollback-перезагрузка распространена на `nav-sidebar-*`.

**Проверки:** web `tsc --noEmit` — чисто; `cargo check`/`clippy` — новых замечаний нет
(дебаговые dead-code/needless-borrow предупреждения crate'а — предсуществующие);
`payload_ui` тесты зелёные; падения `process_supervisor` тестов — артефакты песочницы
(запрет spawn). Установщик 0.1.49 собран; версия поднята в tauri.conf.json + Cargo.toml.

## 2026-11-15 (ночь, третья волна) — окна сайдбаров не закрывались по X (0.1.50)

**Симптом:** крестик окна отсоединённого сайдбара не закрывает его (только диспетчер
задач), перетащенные в него разделы не возвращаются в основное окно.

**Корневая причина (двойная):**
1. Tauri при наличии JS-обработчика `tauri://close-requested` всегда предотвращает
   нативное закрытие (`manager/window.rs`: `has_js_listener → api.prevent_close()`),
   а JS-обёртка `@tauri-apps/api` после обработчика вызывает `destroy()`. Команды
   `close`/`destroy` входят в `core:window:default` — их нужно выдавать явно. В
   capabilities их не было → `destroy()` отклонялся → окно висело навсегда.
2. Окно «второй сайдбар» (`secondary-dock-*`, `lib/secondary-dock-window.ts`) вообще
   не попадало ни под одну capability (main/panel-*/workspace-*/nav-sidebar-*) →
   работало с нулевыми правами, `close()` при возврате дока отклонялся тем же путём.

**Правки:** `capabilities/nav-sidebar.json` — добавлены `allow-close`, `allow-destroy`;
новый `capabilities/secondary-dock.json` для `secondary-dock-*` (core:default +
мониторы + close/destroy). Диагностика: цепочка регистрации обработчиков окна в
`nav-sidebar-window.tsx` больше не глотает ошибки молча (catch → console.error).
Версия 0.1.50. Проверки: tsc — чисто; `cargo check` — без новых замечаний.

**Урок:** для каждой метки WebviewWindow нужна явная capability; любые отказы прав
в Tauri проявляются как зависания, а не как ошибки — регистрацию обработчиков
окна закрытия/событий нельзя оставлять без .catch.

## Бэклог решений (2026-11-15)

- **Подпись кода — отложена (решение владельца).** До переезда в публичный репозиторий
  релизы идут без подписи: на чужих машинах SmartScreen покажет предупреждение
  («Подробнее → Выполнить в любом случае»). Когда ORION станет публичным под
  OSI-лицензией — подать заявку в **SignPath Foundation** (бесплатный сертификат для
  OSS): потребуется LICENSE-файл, публичный репозиторий, страница «Code signing policy»
  с обязательными формулировками (Authors/Reviewers/Approvers, privacy), CI со
  сборкой верифицируемым образом (GitHub Actions + Trusted Publishing), ручное
  одобрение каждого релиза, метаданные product name/version в бинарниках. Условия:
  signpath.org/terms.html. Альтернатива на случай проприетарности: EV-сертификат
  ~$300–700/год.
- **Релизный тег: v0.1.1** (ORION_BUILD_TAG). build.json установщика несёт этот тег.
