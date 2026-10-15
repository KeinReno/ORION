# ADR-0014 — Контекстная панель «Ресурсы / Связи / Свойства» и слот `shell.context.resources`

Статус: **принято для MVP (этап A), реализовано** (15 октября 2026). Источники: [CONTEXTUAL_RESOURCES_PANEL.md](../CONTEXTUAL_RESOURCES_PANEL.md), [TZ-01](../tz/TZ-01-resources-panel.md).

## Этап 0 — инвентаризация (факты на момент начала работ)

1. **Правого инспектора как общей поверхности нет.** `FRONTEND_WORKSPACE_SPEC.md` §2 описывает его как цель; в коде есть лишь `Sheet` внутри конкретных редакторов (`note-editor.tsx` «Свойства, связи и доступ»; `GoalInspector` в «Целях»). Оболочка (`app/(app)/layout.tsx`) — sidebar + один `<Workbench />`. Значит, панель — **новый элемент оболочки**, а не расширение существующего.
2. **`EntityLink`** (`sourceType/sourceId/targetType/targetId/kind`, типы — строки в БД) принимает `SearchableEntityType`: `project, task, note, event, document, transaction, contact, list`. Тип `document` есть; **типа «счёт» нет**, а сценарий «Финансы → счёт → документ» его требует. Каталог видов: `related_to` (любая пара разных типов), `supports` (note|document → task), `evidence_for` (document → transaction). `openEntity` открывает каждый тип через panel-bus (`focusTask/Note/Event/Document/Transaction/Contact`, `openProject`, `openList`).
3. **Кто привязывает `Document`:** вложения заметок (отдельный `NoteAttachment`), материалы проекта (`projectId`), и `EntityLinksSection` (документ ↔ любая сущность через глобальный поиск). Новых таблиц не нужно.
4. **Новый typed slot нужен.** Ресурсы должны отдавать провайдеры (Documents не зависимость панели) → `NEW_EXTENSION_POINT_REQUIRED`: этот ADR.

## Решение

1. **Тип связи `account`** (счёт Финансов) добавлен в `searchableEntityTypeSchema` аддитивно: `SEARCH_TYPE_MODULE.account = "finance"`, адаптер в `ENTITY_REGISTRY` (владение проверяется по `workspaceId`, имя не раскрывается чужому). Данные не мигрируются, таблиц нет, RLS не меняется. Вид связи — `related_to`.
2. **`EntityRef { moduleId, entityType, entityId }`** (`shared-types/src/resources.ts`); `workspaceId` берётся из контекста, межпространственных ссылок нет. `moduleId` выводится из `SEARCH_TYPE_MODULE`, а не доверяется клиенту.
3. **Слот `shell.context.resources`** (`SlotContracts`): провайдер получает `{ workspaceId, context }` и рисует содержимое вкладки «Ресурсы». Панель не импортирует Documents. Провайдер MVP — встроенный плагин `documents-resources` (`extendsModuleId: "documents"`, включён по умолчанию, как `documents-history`). Если вкладку никто не наполняет (плагин или «Документы» выключены), панель показывает «Ресурсы недоступны», а «Связи» и «Свойства» работают.
4. **Контекст** (`apps/web/lib/resource-context.ts`, чистая логика с тестами): активная dock-панель задаёт **раздел**; панель, у которой есть выбранный объект, **публикует** его (`usePublishResourceContext`). Приоритет: закреплённый > опубликованный объект активной панели > раздел. Смена пространства сбрасывает публикации и закрепление (с сообщением) и убирает из кэша react-query ключи `links/documents/document-blob/search` прежнего пространства.
5. **Доступ** проверяется сервером по целевому объекту при каждом чтении: `listLinks` отбрасывает связи, чей модуль недоступен актору, и не возвращает имя недоступного объекта; байты читает `documents/:id/content` со своей проверкой. Видимость связи права на чтение не даёт.
6. **Размещение:** правая колонка оболочки (не Dockview), закрыта по умолчанию, ширина 260–560 px (по умолчанию 300, клавиатурный разделитель), на viewport < 768 px — шторка. Перенос в dock/Tauri-окно, закрепление между сессиями, внешние локальные файлы — этап B.

## Extension Proposal

```text
Requested extension point:
  shell.context.resources — { workspaceId: string; context: ResourceContext }

Plugin: documents-resources (provider of the «Ресурсы» tab)

Reason:
  Панель живёт в оболочке и не должна импортировать Documents;
  провайдер ресурсов — вклад модуля через публичный контракт.
```

## Границы MVP

- «Свойства» показывают то, что известно о ссылке (название, тип, модуль, id, число связей) и кнопку «Открыть». «История» и «Доступ» не рисуются — у панели нет данных, имитировать их нельзя.
- Для **раздела без объекта** вкладка «Ресурсы» показывает файлы пространства (поиск, виртуальный список); связать/открепить можно только для выбранного объекта.
- Не делалось: второе хранилище, копирование файлов, индексирование содержимого, абсолютные пути Windows в схеме.
