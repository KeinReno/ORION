# ORION — AI refactor migration map

## 1. Статус документа

Этот документ является **нормативной картой миграции** текущего ORION к архитектуре `Core → Modules → Extension Points → Plugins`.

Он дополняет:

- `docs/MODULES_AND_PLUGINS.md`;
- `docs/AI_FIRST_EXTENSION_ARCHITECTURE.md`.

Главная задача документа — снять с AI-агента архитектурное решение вида «а это Base или plugin?». Во время рефакторинга агент должен следовать этой карте, а не заново классифицировать существующие возможности.

Если функция отсутствует в карте или агент считает классификацию ошибочной, он не меняет ownership молча. Он создаёт ADR / Extension Proposal и отдельно обосновывает изменение.

---

## 2. Нерушимое правило миграции: parity before redesign

Архитектурный рефакторинг **не является редизайном ORION**.

После завершения рефакторинга при стандартной конфигурации ORION должен визуально и функционально воспроизводить текущее приложение настолько точно, насколько это возможно:

- те же основные панели;
- те же доступные действия;
- те же tabs / views / фильтры;
- те же пользовательские сценарии;
- существующие данные не теряются;
- существующие связи сущностей продолжают работать;
- порядок и смысл основных элементов интерфейса не меняется только потому, что код был вынесен в plugin.

### 2.1. Default-full profile

Функция, которая **сегодня встроена в ORION и видна пользователю без отдельной установки**, но во время рефакторинга становится plugin, должна быть включена в стандартном профиле по умолчанию.

То есть:

```text
ORION before refactor
≈
ORION after refactor + default built-in plugins enabled
```

Пользователь после этого может отключить отдельные плагины и получить более простой интерфейс.

Пример:

```text
Сегодня Tasks:
List + Board + Subtasks + Saved Views + Comments + advanced planning

После рефакторинга, по умолчанию:
Tasks Base
+ tasks-kanban
+ tasks-planning
+ tasks-saved-views
+ нужные built-in extensions

Внешне пользователь получает тот же набор возможностей.
```

### 2.2. Важное исключение

Это правило не означает «включать вообще все плагины ORION».

Если plugin и до рефакторинга был реальной опциональной возможностью и по умолчанию был выключен, его исходный default сохраняется. Например, текущий `team` уже является отдельным plugin и сейчас имеет `defaultEnabled: false`; архитектурный рефакторинг сам по себе не должен неожиданно включать командный режим.

### 2.3. Миграция существующих workspace

Рефакторинг не должен менять effective feature set существующего workspace.

Миграция должна вычислить состояния новых built-in plugins так, чтобы после обновления пользователь получил функциональность, эквивалентную состоянию до обновления.

Отключение plugin:

- скрывает/останавливает только его contribution;
- не удаляет пользовательские данные автоматически;
- не ломает host module;
- при повторном включении восстанавливает его возможности.

---

## 3. Сначала baseline, потом перенос

До первого переноса функции в plugin необходимо зафиксировать baseline:

1. screenshots / visual regression snapshots ключевых панелей;
2. перечень доступных действий и tabs;
3. smoke-сценарии;
4. API behavior, который уже используется UI;
5. текущие defaults modules/plugins;
6. тестовые workspace: solo, team-off, modules partially disabled.

После каждого extraction действует проверка:

> `all required default built-in extensions ON` должен давать тот же пользовательский результат, что и baseline.

Нельзя одновременно:

- выносить функцию в plugin;
- менять её UX;
- менять модель данных;
- менять API-контракт;
- «заодно» переписывать соседний модуль.

Эти изменения делаются отдельными этапами после parity.

---

# 4. Core surfaces — не превращать в доменные модули

Следующие поверхности остаются частью Core / Shell и **не являются предметными модулями**:

## Dashboard

Core владеет layout, размещением и widget slots.

Доменные данные приходят contribution-ами от modules/plugins.

Не переносить логику конкретного Tasks/Finance напрямую в Core Dashboard.

## Inbox

Core владеет intake/capture/routing surface.

Modules предоставляют target adapters: создать Task, Note, Event и т.п.

## Overview

Межпространственный агрегатор остаётся Core surface.

Tasks/Finance и другие domains предоставляют публичные providers/contributions.

## Shared / «Доступно мне»

Core access/sharing surface. Не отдельный предметный module.

## Search

Core владеет поисковой оболочкой и registry providers.

Каждый module регистрирует свои searchable entities.

## Notifications

Core владеет delivery/feed infrastructure.

Modules/plugins регистрируют события и notification providers.

## Settings

Core владеет settings shell.

Modules/plugins добавляют settings sections через extension points.

## Sync / Backups

Platform/data-management surface Core. Не plugin отдельного domain module.

---

# 5. Tasks

## 5.1. Tasks Base

Base обязан оставаться пригодным для простой персональной задачи типа «помыть посуду».

Base ownership:

- Task identity;
- title;
- description;
- basic status;
- due date;
- priority;
- create/edit/complete/archive/delete;
- простой list view;
- базовый поиск;
- базовая сортировка/фильтрация, необходимая для обычного списка.

Base не должен требовать Projects, Team, Time или Calendar.

## 5.2. Вынести в plugins / extensions

### `tasks-kanban`

- board view;
- колонки;
- drag-and-drop между колонками;
- board-specific grouping/presentation.

Current source: логика board внутри `apps/web/panels/TasksPanel.tsx`.

Contribution: `tasks.views`.

### `tasks-planning`

- subtasks / parent-child structure;
- manual task ordering;
- dependencies;
- start date;
- estimated duration;
- planning-specific fields;
- advanced planning operations.

Current source includes:

- `apps/web/panels/tasks/subtasks.tsx`;
- advanced fields currently exposed through `task-form.tsx` / Tasks panel.

### `tasks-saved-views`

- saved views;
- advanced reusable filter/group presets.

Current source:

- `apps/web/panels/tasks/saved-views.tsx`.

### `tasks-recurrence`

- recurring-task behavior and recurrence-specific UI.

Base Task must not need recurrence to exist.

### `team` / collaboration plugin

Existing plugin remains responsible for team-specific behavior:

- assignee;
- «Мои задачи»;
- team role/workflow;
- collaboration-specific task behavior.

Task comments should be treated as collaboration capability and migrated into this ownership unless a separate generic `tasks-comments` plugin is intentionally accepted by ADR.

Current source:

- `apps/web/panels/tasks/task-comments.tsx`;
- team branches inside `TasksPanel.tsx`.

## 5.3. Module Bridges, а не Tasks ownership

- Tasks ↔ Projects: project relation, project-scoped task presentation;
- Tasks ↔ Calendar: task due dates shown/rescheduled in calendar;
- Tasks ↔ Time: task selection/time association.

Эти возможности не должны заставлять Tasks импортировать internals соседнего module.

---

# 6. Notes

## Notes Base

- note identity;
- title/body;
- create/edit;
- autosave;
- basic tags;
- search;
- archive/trash/restore;
- pin/duplicate допустимы как lightweight note operations.

## Plugins

### `notes-templates`

- template mode;
- create-from-template.

### `notes-daily`

- daily-note semantics;
- open/create daily note.

### `notes-history`

- revisions;
- restore revision;
- history UI.

Current source includes `apps/web/panels/note-history.tsx`.

### Future `notes-knowledge`

Wiki-link / curated knowledge behavior should not автоматически разрастаться внутри Notes Base. Если ORION вводит Knowledge layer, он должен появиться как отдельная capability/module/plugin по принятому ADR.

## Bridges

- Notes ↔ Projects;
- Notes ↔ Documents attachments;
- Notes ↔ Calendar source, если заметка имеет temporal representation.

---

# 7. Calendar

## Calendar Base

- Event identity;
- title/description;
- start/end/all-day;
- basic CRUD;
- базовые calendar views;
- создание и перенос обычного события.

## Plugins

### `calendar-recurrence`

- recurrence rules;
- occurrence scope edit/delete.

### `calendar-reminders`

- reminder rules and reminder-specific behavior.

### `calendar-external`

- ICS/feed;
- external calendar connections;
- connection configuration.

Current source includes:

- `apps/web/panels/calendar-connections.tsx`;
- feed logic currently consumed by `CalendarPanel.tsx`.

## Bridges / source contributions

Current Calendar агрегирует Tasks, Notes и Finance recurring items. После рефакторинга Calendar Base не должен напрямую знать internals этих modules.

Нужно заменить прямое знание на source contributions, например:

```text
calendar.sources
```

Providers:

- Tasks provider;
- Notes provider;
- Finance provider;
- Projects provider if required.

---

# 8. Documents

## Documents Base

- file/folder identity;
- upload/download;
- folder navigation;
- rename/move;
- delete/trash/restore;
- basic list/grid presentation;
- basic search/sort.

## Plugins

### `documents-preview`

- preview pane;
- rich preview behavior;
- thumbnails when they belong to preview pipeline.

Current source:

- `apps/web/panels/documents/preview-pane.tsx`;
- `apps/web/panels/documents/thumbnail.tsx`.

### `documents-history`

- document version/history UI;
- version restore behavior.

Current source:

- `apps/web/panels/documents/document-history.tsx`.

### `documents-office`

- create/edit DOCX;
- create/edit XLSX;
- codecs;
- spreadsheet/document editor dependencies.

Current source includes:

- `apps/web/components/office/*`;
- `apps/web/lib/office/*`.

This plugin is especially important to isolate because it carries significant UI/runtime dependencies that should not become part of minimal Documents Base.

## Bridges

Attachments/references from Tasks, Notes, Projects are cross-module relations, not Documents Base ownership of those entities.

---

# 9. Projects

Projects remains an **additional module**, not a Tasks plugin: Project is its own domain entity and container.

## Projects Base

- project identity;
- name/description;
- status;
- start/due;
- archive;
- basic project list;
- basic project workspace overview;
- project-owned fields.

## Plugins

### `projects-planning`

- milestones;
- Gantt;
- plan tab;
- planning-specific timeline behavior.

Current source includes:

- `apps/web/panels/projects/gantt.tsx`;
- milestone-related UI/data;
- `plan` tab in `ProjectWorkspacePanel.tsx`.

### `projects-insights`

Potential ownership for advanced project rollups, risk/forecast/analytics that are not universal project CRUD.

Do not force this extraction during first parity pass if it creates unnecessary risk; it can be a second-wave plugin after the extension runtime is stable.

## Bridges / contributions

Current Project Workspace directly assembles many modules. После рефакторинга это должны быть contributions:

- Tasks ↔ Projects → tasks tab;
- Notes/Documents ↔ Projects → materials;
- Finance/Time ↔ Projects → money/cost/time section;
- Core Sharing → access section.

Project Base должен владеть компоновкой и slots, но не внутренностями соседних modules.

---

# 10. Time

## Time Base

- start/stop timer;
- manual time entry;
- duration;
- basic log;
- edit/delete entry.

## Plugins

### `time-insights`

- today/7-days/all aggregate dashboards beyond minimal log;
- team/authorship splits;
- advanced analytical summaries.

### `time-billing`

- hourly rate interpretation;
- monetary cost calculation;
- billable/cost-oriented presentation.

## Bridges

- Time ↔ Tasks;
- Time ↔ Projects.

Task/project selectors must come through public contracts, not internal imports.

---

# 11. Finance

Finance remains an additional domain module.

## Finance Base

- Accounts;
- Transactions;
- Categories;
- basic balance summary;
- transaction CRUD.

## Plugins

### `finance-budgeting`

Current source:

- `apps/web/panels/finance/budgets-view.tsx`;
- `budget-form.tsx`.

### `finance-goals`

Current source:

- `goals-view.tsx`;
- `goal-form.tsx`.

### `finance-recurring`

Current source:

- `recurring-view.tsx`;
- `recurring-form.tsx`;
- recurring materialization behavior.

### `finance-reports`

Current source:

- `reports-view.tsx`.

### Future finance integrations

Bank import, exchange-rate providers, tax/report exports and similar capabilities are plugins, not Base growth.

## Bridge

Finance ↔ Projects is a cross-module relation.

---

# 12. Habits

## Habits Base

- habit definition;
- schedule;
- daily check-in;
- current streak/basic Today state;
- archive/restore.

## `habits-insights`

- week grid;
- 12-week heatmap;
- advanced activity analytics.

Current source:

- `apps/web/panels/habits/week-grid.tsx`;
- `apps/web/panels/habits/heatmap.tsx`;
- analytical parts of `HabitsPanel.tsx`.

The default-full profile keeps this plugin enabled so the post-refactor panel initially looks the same.

---

# 13. Lists

Lists is intentionally lightweight today and already has a clean domain boundary.

For the first refactor pass, **keep current Lists functionality in Base**:

- list CRUD;
- list items;
- check/uncheck;
- clear completed;
- archive/restore.

Do not invent plugins just to satisfy a pattern. Plugin extraction is justified by optional complexity, not by file count.

---

# 14. Inventory

## Inventory Base

- inventory item;
- movement ledger;
- receipt/issue/adjustment;
- current balance;
- archive/restore.

## Plugins

### `inventory-alerts`

- low-stock notifications;
- configurable alerting rules.

### `inventory-costing`

Average cost / valuation can become a separate plugin if it can be detached without destabilizing ledger semantics. During the first parity pass it is acceptable to leave costing in Base temporarily and extract it later by ADR.

## Bridge

Inventory ↔ Projects is a cross-module relation.

---

# 15. Concrete current-file extraction map

This table is an implementation guide, not permission to move everything in one PR.

| Current code | Target ownership |
|---|---|
| `panels/tasks/saved-views.tsx` | `tasks-saved-views` |
| `panels/tasks/subtasks.tsx` | `tasks-planning` |
| `panels/tasks/task-comments.tsx` | `team` / collaboration |
| Board/DnD logic in `TasksPanel.tsx` | `tasks-kanban` contribution |
| Advanced planning fields in task UI | `tasks-planning` |
| Recurrence in task UI/domain | `tasks-recurrence` |
| `panels/projects/gantt.tsx` | `projects-planning` |
| Project milestones / plan tab | `projects-planning` |
| `finance/budgets-view.tsx` + form | `finance-budgeting` |
| `finance/goals-view.tsx` + form | `finance-goals` |
| `finance/recurring-view.tsx` + form | `finance-recurring` |
| `finance/reports-view.tsx` | `finance-reports` |
| `documents/document-history.tsx` | `documents-history` |
| `documents/preview-pane.tsx`, `thumbnail.tsx` | `documents-preview` |
| `components/office/*`, `lib/office/*` | `documents-office` |
| `calendar-connections.tsx` + feed integration | `calendar-external` |
| Calendar recurrence behavior | `calendar-recurrence` |
| Calendar reminder behavior | `calendar-reminders` |
| `habits/week-grid.tsx`, `heatmap.tsx` | `habits-insights` |
| Time analytical/team summaries | `time-insights` |
| Time monetary/rate logic | `time-billing` |

Where functionality is currently embedded inside one large panel, extraction must first introduce a typed slot/registry contract, then move the code behind that contract.

---

# 16. Required migration order

## Phase 0 — Freeze baseline

No architectural extraction yet.

Create parity screenshots, smoke tests and behavior inventory.

## Phase 1 — Build extension infrastructure

Add:

- contribution registry;
- typed extension points;
- Plugin SDK;
- Module SDK;
- UI context contracts;
- architecture import rules.

Current UI can still be monolithic during this phase.

## Phase 2 — Convert one current feature at a time

Recommended first reference implementation: Tasks.

Suggested sequence:

1. `tasks-saved-views`;
2. `tasks-kanban`;
3. `tasks-planning`;
4. collaboration/comments alignment with `team`.

Each extraction must pass parity before the next begins.

## Phase 3 — Project Workspace bridges

Replace direct cross-module composition by registered contributions.

## Phase 4 — Documents / Finance / Calendar / Habits / Time

Repeat the same proven pattern.

## Phase 5 — Only now consider UX simplification

Once architecture and parity are stable, a separate product/UX phase may decide which default plugins remain enabled for a specific ORION edition or profile.

Do not mix this decision with the refactor.

---

# 17. Acceptance criteria for every extraction

A migration PR is incomplete unless all relevant conditions hold:

- Base Module works with the new plugin disabled;
- plugin can be enabled/disabled without reload corruption;
- disabling plugin does not delete its data;
- re-enabling restores its contribution;
- default-full profile matches pre-refactor behavior;
- existing workspace preserves effective features after migration;
- plugin imports only public Core/Module contracts;
- Base Module contains no import of the concrete plugin;
- UI contribution uses a registered slot;
- no unrelated UX redesign;
- no silent schema break;
- lint/typecheck/tests pass;
- architecture checks pass;
- visual/smoke parity tests pass.

---

# 18. Rules for AI agents

1. **This ownership map is authoritative for the migration.** Do not reclassify existing features ad hoc.
2. If a requested feature is optional/advanced and not in the map, prefer a plugin and create an Extension Proposal if a slot is missing.
3. Do not modify Core/Base merely to make plugin implementation easier.
4. Do not import another module's internals.
5. Do not redesign UI while extracting architecture unless the task explicitly requests a redesign.
6. One extraction concern per PR/commit whenever practical.
7. Preserve data and defaults first; optimize structure second.
8. With standard built-in extensions enabled, ORION after migration must reproduce the current product experience.
9. A smaller Base does not mean a poorer default ORION. Complexity is moved behind capabilities, not removed from the product.

---

# 19. Target mental model

The user should be able to start ORION and see the familiar full application.

Then, if desired, progressively simplify it:

```text
Full ORION (default)
  ↓ disable tasks-planning
Tasks become simpler
  ↓ disable tasks-kanban
Only lightweight task list remains
  ↓ disable documents-office
Documents become file storage without office editors
  ↓ disable habits-insights
Habits become simple daily tracking
```

This is the intended product model:

> **Base defines the stable minimum. Built-in plugins reconstruct the rich ORION experience. User configuration decides how much complexity is visible.**
