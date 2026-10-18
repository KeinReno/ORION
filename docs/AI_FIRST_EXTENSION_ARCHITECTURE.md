# ORION — AI-first architecture for modules, plugins and frontend extensions

## 1. Назначение документа

Этот документ фиксирует архитектурные правила разработки ORION с расчётом на работу AI-агентов.

Цель — сделать так, чтобы новый агент мог безопасно модифицировать систему без необходимости понимать весь репозиторий и без риска размыть исходную модель `Core → Modules → Plugins`.

Документ дополняет `docs/MODULES_AND_PLUGINS.md` и описывает прежде всего:

- как удерживать архитектурные границы при разработке AI-агентами;
- как проектировать модули так, чтобы они были легко расширяемыми;
- как плагины должны расширять существующие модули, а не создавать параллельные версии;
- как безопасно подключать расширения во frontend;
- какие правила должны проверяться автоматически.

---

## 2. Главный принцип

ORION строится в следующем направлении зависимостей:

```text
Core
  ↓
Contracts / SDK
  ↓
Base Modules
  ↓
Extension Points
  ↓
Plugins
```

При этом:

- Core не знает о конкретных плагинах;
- базовый модуль не знает о конкретных плагинах;
- плагин знает только публичные контракты Core и Module SDK;
- сложные возможности по умолчанию реализуются как plugin capability, а не как разрастание базового модуля.

### Архитектурное правило

> Если новую функцию можно реализовать как расширение существующего модуля — сначала рассматривается вариант плагина. Изменение Base допускается только тогда, когда функция объективно нужна практически всем пользователям базового модуля.

---

## 3. Core должен быть стабильным

Core отвечает только за платформенные механизмы:

- users / sessions / auth;
- workspaces;
- permissions;
- events;
- storage;
- module registry;
- plugin runtime;
- module runtime;
- navigation shell;
- background jobs;
- configuration;
- contracts;
- diagnostics;
- migration lifecycle.

Core не должен содержать предметную логику Tasks, Finance, Documents, Projects и других доменов.

AI-агент не должен менять Core как побочный эффект разработки новой функции модуля или плагина.

---

## 4. Base Module должен оставаться простым

Базовый модуль хранит только минимальную универсальную функцию предметной области.

Пример для Tasks.

### Base Tasks

Допустимо:

- создать задачу;
- изменить название и описание;
- изменить статус;
- указать срок;
- архивировать;
- связать с проектом через публичный контракт, если Projects доступен.

Не должно автоматически попадать в Base:

- Gantt;
- task dependencies;
- critical path;
- workload;
- team capacity;
- advanced assignment model;
- burndown;
- velocity;
- forecasting;
- portfolio planning;
- advanced analytics.

Такие возможности должны подключаться через плагины.

---

## 5. Паспорт каждого модуля

Каждый модуль должен иметь `MODULE.md` рядом с кодом.

Минимальная структура:

```text
# Tasks

Purpose
Краткое назначение модуля.

Owns
Task
TaskStatus

Base capabilities
- create
- edit
- complete
- archive
- due date

Does NOT own
- Gantt
- dependencies
- team workload
- advanced analytics

Public API
...

Events
...

Extension points
...

Forbidden
- importing plugin code
- reading internals of another module
- adding team logic directly to Base Task
```

Это является каноническим контекстом для AI-агентов.

---

## 6. AI context должен быть локальным

AI не должен получать весь репозиторий как основной контекст задачи.

Для задачи вида «добавить Gantt к Tasks» рекомендуемый порядок контекста:

1. `ORION_CONSTITUTION.md`;
2. `modules/tasks/MODULE.md`;
3. `modules/tasks/contracts/*`;
4. `modules/tasks/extension-points/*`;
5. Plugin SDK;
6. UI SDK;
7. один похожий существующий plugin;
8. текущая задача.

Принцип:

> Minimum sufficient context is better than uncontrolled full-repository context.

Для каждого модуля рекомендуется также иметь `AI_CONTEXT.md`.

Пример:

```text
If working on Tasks:

Read first:
- MODULE.md
- contracts/task.schema.ts
- extension-points.ts
- plugin-sdk.md

Do not modify:
- core/*
- tasks/base/domain/* without explicit architectural reason
- unrelated modules

Preferred approach:
new capability -> plugin

Before changing Base:
prove that the capability is required by almost all Tasks users.
```

---

## 7. Frontend: плагины не должны искать место в интерфейсе

Главный риск frontend-архитектуры — позволить AI-агенту самому решать, куда вставлять новую кнопку, панель, tab или view.

Так делать нельзя.

Base Module должен заранее объявлять разрешённые UI extension points.

Для Tasks это могут быть:

```text
tasks.header.actions
tasks.views
tasks.filters
tasks.card.badges
tasks.card.actions
tasks.details.main
tasks.details.sidebar
tasks.details.tabs
tasks.bulk-actions
tasks.analytics
```

Плагин не изменяет `TasksPanel.tsx` напрямую.

Он регистрирует contribution.

Пример:

```ts
registerUI({
  slot: "tasks.views",
  id: "gantt",
  label: "Гант",
  component: GanttView,
});
```

Базовый Tasks только читает registry:

```ts
const views = uiRegistry.get("tasks.views");
```

Таким образом AI решает не вопрос:

> Куда вставить новую функцию?

а вопрос:

> Какой существующий extension point соответствует этой функции?

Это принципиально снижает риск разрушения frontend-архитектуры.

---

## 8. UI slots должны иметь контракты

Extension point обязан описывать не только место, но и допустимый тип contribution.

Пример:

```ts
interface TaskBadgeContribution {
  id: string;
  priority: number;
  render(task: TaskPublic): BadgeDescriptor | null;
}
```

`tasks.card.badges` не должен принимать произвольный full-screen React component.

А `tasks.views`, наоборот, может предоставлять полноценную рабочую область.

Это защищает UX от злоупотребления slot-ами.

---

## 9. Plugin не должен импортировать internals модуля

Разрешено (целевая схема; SDK-пакеты планируется выделить в G24, сегодня плагины работают через контракты `apps/web/lib/extensions`):

```ts
import { useTasksApi } from "@orion/tasks-sdk"; // планируется (G24), пакета пока нет
import { registerView } from "@orion/plugin-sdk"; // планируется (G24), пакета пока нет
import { Button, Panel } from "@orion/ui";
```

Запрещено:

```ts
import TaskCard from "../../modules/tasks/components/TaskCard";
import { taskStore } from "../../modules/tasks/internal/store";
```

AI-агент физически не должен иметь возможности привязать plugin к внутренней реализации модуля.

Это должно проверяться ESLint / architecture-check.

---

## 10. Public UI Context

Plugin получает ограниченный публичный контекст вместо доступа к внутреннему state модуля.

Пример:

```ts
interface TasksUIContext {
  query: TaskQueryApi;
  commands: TaskCommandApi;
  selection: TaskSelectionApi;
  navigation: TaskNavigationApi;
  capabilities: CapabilityApi;
}
```

Plugin может использовать:

```text
query.list()
commands.update()
selection.current()
navigation.openTask()
```

Но не знает, как Tasks хранит local state, какие компоненты использует и как устроен internal store.

---

## 11. Design System обязателен

AI-агенты не должны каждый раз изобретать UI-паттерн заново.

ORION должен предоставлять единый UI SDK / Design System, например:

```text
OrionButton
OrionToolbar
OrionTabs
OrionViewSwitcher
OrionFilterBar
OrionSheet
OrionDialog
OrionEntitySheet
OrionDataView
OrionEmptyState
OrionFormField
OrionMetric
OrionCard
```

Рекомендуемые UX-правила:

- entity editing → `EntitySheet`;
- переключение представлений → `ViewSwitcher`;
- фильтры → `FilterBar`;
- secondary actions → overflow menu;
- modal используется только для сценариев, действительно требующих modal interaction.

Это позволяет разным AI-агентам создавать визуально и поведенчески согласованный ORION.

---

## 12. Plugin manifest

Каждый plugin имеет machine-readable manifest.

Пример:

```json
{
  "id": "tasks-gantt",
  "version": "1.0.0",
  "type": "plugin",
  "extends": ["tasks"],
  "requires": {
    "tasks": ">=1.2.0",
    "orion-core": ">=2.0.0"
  },
  "permissions": [
    "tasks.read",
    "tasks.write"
  ],
  "contributions": {
    "tasks.views": ["gantt"]
  }
}
```

Manifest должен быть валидируемым схемой.

---

## 13. Стандартная структура кода

Все модули должны выглядеть одинаково.

```text
/modules/<module>
  manifest
  api
  contracts
  domain
  services
  extension-points
  ui
  tests
  MODULE.md
  AI_CONTEXT.md
```

Все плагины также должны иметь одинаковый шаблон:

```text
/plugins/<plugin>
  manifest
  backend
  frontend
  migrations
  contributions
  tests
  PLUGIN.md
```

AI-агент должен изучить одну структуру и затем применять её повторно.

---

## 14. Scaffolding вместо ручного создания структуры

Рекомендуется добавить команды:

```text
orion create-module <name>
orion create-plugin <name> --extends <module>
orion validate
```

Например:

```text
orion create-plugin tasks-gantt --extends tasks
```

Команда должна создать правильный manifest, директории, тестовый skeleton и пример contribution.

AI не должен придумывать структуру нового plugin с нуля.

---

## 15. Нет extension point — нет прямой правки Base

Если plugin требует интерфейс или backend-hook, которого пока нет, AI-агент не должен самостоятельно модифицировать Base Module.

Он формирует `Extension Proposal`.

Пример:

```text
Requested extension point:
tasks.details.footer

Plugin:
tasks-pomodoro

Reason:
Persistent contextual controls are required.

Existing points considered:
- tasks.details.sidebar
- tasks.card.actions

Why insufficient:
...
```

После этого отдельно принимается архитектурное решение о добавлении нового универсального extension point.

Изменение Base становится явным архитектурным событием.

---

## 16. ADR защищают намеренные решения

Важные решения необходимо фиксировать в Architecture Decision Records.

Пример:

```text
ADR-0042 — Why task assignees are not part of Tasks Base

Decision:
Assignees belong to Team plugin.

Reason:
Solo users should not receive collaboration complexity.

Consequences:
Base Task does not contain team-specific UI or workflow.
```

Это особенно важно для AI, потому что агент может ошибочно принять намеренное отсутствие функции за технический долг.

---

## 17. Автоматические архитектурные проверки

Архитектура должна удерживаться не памятью агента, а CI.

Минимальный набор проверок:

```text
Core imports no plugins
Modules import no plugins
Plugins use public APIs only
No circular mandatory module dependencies
Plugin manifest schema is valid
Unknown extension points are rejected
Permission declarations are valid
Cross-module internal imports are rejected
UI contributions match slot contracts
```

Рекомендуемые команды:

```text
npm run lint
npm run typecheck
npm run test
npm run architecture-check
npm run plugin-contract-check
```

AI-агент обязан прогонять эти проверки после изменения.

---

## 18. Frontend conflict handling

Даже два архитектурно правильных plugin могут ухудшить UX, если оба перегружают один toolbar.

Поэтому UI registry должен поддерживать метаданные:

```text
priority
group
order
maxVisible
overflow
```

Пример:

```json
{
  "slot": "tasks.header.actions",
  "id": "analytics-report",
  "group": "analytics",
  "priority": 40,
  "overflow": true
}
```

Решение о том, что показать сразу, а что убрать в overflow, принимает ORION shell / Base Module, а не plugin.

---

## 19. Visual contract tests

Frontend нужно проверять в комбинациях:

```text
Tasks без плагинов
Tasks + Team
Tasks + Gantt
Tasks + Analytics
Tasks + Team + Gantt + Analytics
максимально допустимый набор совместимых plugins
```

Рекомендуется использовать component / screenshot / visual regression tests.

Цель — выявлять не только технические ошибки, но и UX degradation.

---

## 20. Требуемая архитектурная конституция

В корне репозитория рекомендуется иметь короткий `ORION_CONSTITUTION.md`.

Он должен содержать несколько нерушимых правил:

1. Core не содержит domain-specific business logic.
2. Modules не импортируют internals других modules.
3. Base Modules не импортируют plugins.
4. Plugins используют только public API / contracts / events / extension points.
5. Новая capability сначала рассматривается как plugin.
6. UI plugins подключаются только через зарегистрированные UI extension points.
7. Нет подходящего extension point — создаётся proposal, Base не патчится напрямую.
8. Public contract change требует versioning / migration.
9. Архитектурные ограничения проверяются CI.
10. AI использует локальный канонический контекст, а не пытается интерпретировать весь репозиторий целиком.

---

## 21. Рекомендуемый workflow AI-агента

Пример задачи:

> Добавить прогнозирование сроков проекта в Tasks.

Ожидаемый workflow:

1. прочитать `ORION_CONSTITUTION.md`;
2. прочитать `Tasks/MODULE.md`;
3. проверить существующие extension points;
4. определить, что capability не относится к Base;
5. создать plugin;
6. объявить permissions и dependencies;
7. использовать публичный Task API;
8. зарегистрировать contribution в `tasks.analytics` или `tasks.views`;
9. не изменять Core и Base Tasks;
10. добавить тесты;
11. прогнать architecture checks;
12. только если extension point отсутствует — создать Extension Proposal.

---

## 22. Целевой критерий зрелости ORION

Хороший показатель архитектуры:

> Base Module может не изменяться месяцами, хотя вокруг него появляются новые плагины и новые представления.

Например `TasksPanel` не должен редактироваться при каждом появлении Gantt, Pomodoro, Analytics, Team, Forecasting и других расширений.

Если новая capability почти всегда требует прямой правки Base, extension architecture считается недостаточной.

---

## 23. Что требуется внедрить в ORION дальше

В текущей архитектурной модели рекомендуется последовательно внедрить:

1. `ORION_CONSTITUTION.md`;
2. `MODULE.md` и `AI_CONTEXT.md` для каждого модуля;
3. единый Plugin Manifest schema;
4. Module SDK / Plugin SDK;
5. UI SDK / Design System;
6. Extension Registry;
7. typed frontend UI slots;
8. запрет внутренних cross-boundary imports;
9. architecture tests;
10. plugin contract tests;
11. scaffolding команд для modules/plugins;
12. ADR процесс;
13. visual regression tests для комбинаций plugins.

---

## 24. Итог

AI-first ORION должен держать архитектуру не за счёт того, что конкретная модель «помнит задумку», а за счёт системы ограничений.

Формула:

```text
Core
→ Contracts
→ Modules
→ Extension Points
→ Plugins

+ Manifests
+ SDK
+ Design System
+ Module Passports
+ AI Context
+ ADR
+ Architecture Tests
```

Frontend должен следовать отдельному жёсткому правилу:

```text
Base Module owns layout
Design System owns UX language
UI Registry owns extension integration
Plugin provides contributions
AI selects contracts instead of inventing integration points
```

Это превращает разработку AI-агентами из свободного изменения кода в работу внутри формально заданной платформенной модели.
