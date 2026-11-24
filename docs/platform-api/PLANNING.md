# Планирование — публичный контракт (задание 04)

Статус: реализовано в текущем checkout 11.11.2026. Модуль `planning` (id
`planning`, дополнительный, по умолчанию включён), API —
`workspaces/:workspaceId/planning`, `@RequireModule("planning")`.

Матрица, Гантт и календарь планирования — **представления существующих задач,
вех, событий и проектов**, а не новые сущности. Собственных таблиц у модуля
три: `planning_blocks`, `planning_matrix_presets` и `time_plans` (последняя
числится за модулем `time`, потому что план/факт — часть учёта времени).

## Инварианты

1. **Ни одной чужой таблицы.** Задачи и их пользовательские поля читаются
   публичными контрактами `TaskOperations`, `TaskFieldReader`; вехи —
   `MilestoneTimelineReader`; события — `EventOperations`; проект проверяется
   `ProjectReferences`. `architecture-check` подтверждает: в
   `apps/api/src/planning/*.service.ts` нет `tx.task`/`tx.milestone`/`tx.event`.
2. **Выключенный сосед — нормальное состояние.** Если календарь выключен,
   конфликты блоков с событиями не считаются (а не падают); если задач нет,
   Гантт и матрица возвращают пустые представления, а тайм-блоки живут сами.
3. **Ссылки блоков — не внешние ключи.** `PlanningBlock.taskId`/`projectId`
   проверяются при записи через контракты владельцев. Удаление задачи не удаляет
   блок: время в календаре остаётся фактом (тот же принцип, что у
   `Capture.anchorId` и `AgentTaskAssignment`).
4. **Идемпотентность переноса.** `clientMutationId` (8–120 символов) хранится в
   `PlanningBlock.clientMutationId` — ключ последней принятой операции. Повтор с
   тем же ключом возвращает сохранённое окно с `replayed: true`, не меняет
   ревизию и не публикует событие второй раз. Ключ, уже занятый другим блоком,
   — 409 `planning_block_mutation_conflict`. Конкурентная правка — `revision` /
   `expectedRevision`, несовпадение — 409 `planning_block_revision_conflict`.
5. **Конфликты — предупреждение, не запрет.** Пересечения с событиями и другими
   блоками возвращаются в `conflicts` (минуты наложения), запись всё равно
   проходит: наложение буфера на встречу бывает осознанным.

## Маршруты

| Метод | Путь | Право | Что делает |
|---|---|---|---|
| GET | `planning/blocks?from&to&taskId&projectId&state` | `planning.block.read` | Блоки в окне (по умолчанию −7…+30 дней) с конфликтами |
| POST | `planning/blocks` | `planning.block.create` | Создать блок; повтор `clientMutationId` идемпотентен |
| GET | `planning/blocks/:blockId` | `planning.block.read` | Один блок с конфликтами |
| PATCH | `planning/blocks/:blockId` | `planning.block.update` | Правка полей/окна, CAS по `expectedRevision` |
| POST | `planning/blocks/:blockId/move` | `planning.block.update` | Перенос окна; без `endAt` длительность сохраняется |
| POST | `planning/blocks/:blockId/move-preview` | `planning.block.update` | Предпросмотр нового окна, пересечений и зависимостей без записи и события |
| DELETE | `planning/blocks/:blockId` | `planning.block.delete` | Удалить блок (204) |
| GET | `planning/gantt?projectId=` | `planning.view.read` | Задачи и вехи проекта, зависимости, CPM |
| POST | `planning/reschedule-impact` | `planning.view.read` | **Только расчёт** последствий переноса задачи |
| GET | `planning/matrix?presetId&projectId` | `planning.view.read` | Распределение открытых задач по квадрантам |
| POST | `planning/matrix/assign` | `planning.block.update` | Записать квадрант в поля задачи |
| GET/POST | `planning/presets` | `planning.preset.manage` | Встроенный Эйзенхауэр + свои пресеты |
| PATCH/DELETE | `planning/presets/:presetId` | `planning.preset.manage` | Свои пресеты; встроенный — 409 `planning_preset_builtin` |

Ошибки `planning_axis_unavailable` (ось на несуществующем пользовательском поле)
и `planning_preset_name_taken` — 409 с `code` и текстом для человека.

## Гантт и критический путь

`GET planning/gantt?projectId=` берёт открытые задачи проекта
(`TaskOperations.list` → фильтр `projectId`, без архивных), вехи проекта
(`MilestoneTimelineReader`) и считает CPM:

- длительность задачи — `dueAt − startAt`; если окна нет — `estimatedMinutes`;
  задача с одной датой — точка (0 минут), чтобы не рвать цепочку;
- зависимости — `TaskDependency` (`dependsOn`), только внутри проекта: ссылка на
  задачу другого проекта попадает в `conflicts` (`dependency_outside_project`) и
  в путь не входит;
- `earliestStartAt`/`earliestFinishAt` переводятся в даты от самого раннего
  начала среди поставленных на шкалу задач;
- `criticalPath` — в топологическом порядке (нулевая по длительности веха не
  должна оказаться после зависимой от неё задачи);
- `totalFloat` — минуты запаса по каждой задаче;
- `unscheduled` — задачи без дат и без оценки; `cycles` — задачи в цикле
  зависимостей (расчёт для них не выполняется, а не «зависает»);
- `conflicts`: нарушение порядка зависимостей, цикл, отсутствие дат,
  пересечение окон у одного исполнителя.

Эталонный граф из 8 задач и ручной расчёт — `packages/shared-types/src/planning.test.ts`.

### Оценка последствий переноса

`POST planning/reschedule-impact { taskId, newStartAt?, newDueAt? }` — dry-run.
Возвращает `task` (сдвиг переносимой задачи), `tasks` (транзитивные зависимые,
в хронологическом порядке), `milestones` (вехи затронутых задач и предлагаемая
дата), `blocks` (блоки этих задач) и `events` (события, связанные с задачей
через `EntityLink`). Ничего не пишет: как и `milestoneCascadeImpact`, сначала
показываются последствия, применение — отдельным действием.

## Матрица

Оси: `importance`, `urgency`, `priority`, `status`, `customFieldId`. Значения
приводятся к 0–3, «высокая» половина — от 2.

- `importance`/`urgency` берутся из полей задачи Tasks 2.0; пока они не заданы,
  важность — проекция приоритета (`high→3`, `normal→1`, `low→0`), срочность — по
  сроку (`просрочено→3`, `≤24 ч→2`, `≤72 ч→1`). Источник значения всегда указан
  в `x.source`/`y.source` (`field`/`priority`/`dueAt`/`status`/`customField`/`none`),
  а `degraded` + `notes` объясняют проекцию: расчёт не выдаётся за введённое
  значение.
- `customFieldId` — ось на поле `TaskFieldDefinition` (Tasks 2.0), читается
  `TaskFieldReader`. Поля нет — 409 `planning_axis_unavailable` (и при создании
  пресета, и при чтении матрицы).
- Квадранты: `q1` важно+срочно, `q2` важно, `q3` срочно, `q4` ни то ни другое.
  В ячейке не больше `MATRIX_CELL_LIMIT` (60) карточек, `truncated` сообщает об
  усечении.
- Запись квадранта — обычное обновление задачи через `TaskOperations.update`
  (`importance`/`urgency`, `priority` или `fieldValues` для пользовательского
  поля), с `expectedRevision` и историей задачи. Оси, которые нельзя записать
  (например `status` — представление, а не поле квадранта), перечислены в
  `skipped`; если не записывается ни одна — 409 `planning_axes_unavailable`.

## Учёт времени (расширение в модуле `time`)

- `POST time/pause` / `POST time/resume` — пауза без переписывания истории:
  `pausedAt` фиксирует момент, снятие паузы переносит разницу в `pausedSeconds`.
  `entryMinutes` вычитает паузу, поэтому работающий таймер, отчёт и панель
  считают одинаково.
- `POST time/switch { taskId, projectId?, note?, at? }` — переключение: закрывает
  текущий таймер и открывает новый в одной транзакции, публикует
  `time.entry.switched`. Это отдельный маршрут, а не новое поведение `start`:
  у `start` остаётся 409 на второй таймер того же человека (защита S06).
  Частичный уникальный индекс `(workspaceId, userId) WHERE endedAt IS NULL`
  по-прежнему гарантирует не более одного запущенного таймера.
- `PATCH time/:entryId` пишет `editedAt` и журнал правок (`edits`, не более
  `TIME_ENTRY_EDIT_LOG_LIMIT` = 20 записей) и публикует `time.entry.edited`
  (только имена полей, без значений).
- `GET time/analytics?from&to&projectId` — факт по проектам/задачам, свободное
  и привязанное время, план/факт по оценкам задач (`estimatedMinutes`;
  `null` — не оценена, а не ноль) и недельный план.
- `GET/PUT/DELETE time/plans/:week` — `TimePlan` на ISO-неделю `2026-W45`
  (`isoWeekKey`/`isoWeekRange`, UTC). Нет строки — `plannedMinutes: null`.
- Свободный секундомер (`taskId = null`) — законный сценарий; в аналитике он
  попадает в `freeMinutes`, а не приписывается проекту/задаче.

## Данные, права, события, резервные копии

- Таблицы: `planning_blocks`, `planning_matrix_presets`, `time_plans`; RLS —
  `ENABLE` + `FORCE` + политика членства (та же плоская проверка, что у
  остальных workspace-таблиц). `time_entries` получила `pausedSeconds`,
  `pausedAt`, `editedAt`, `edits`.
- Права: `planning.block.{read,create,update,delete}` (основной ресурс),
  `planning.view.read`, `planning.preset.manage`, `time.plan.manage`.
- События: `planning.block.moved`, `time.entry.switched`, `time.entry.edited`.
- Бэкап: все три таблицы — `included` в реестре снапшота; `time_plans`,
  `planning_blocks`, `planning_matrix_presets` классифицированы как `strict`
  для гибридной синхронизации (конфликты окон и единственность имени проверяет
  узел).
- Модуль отключается: `PATCH workspaces/:id/modules/planning` → API отвечает
  409, данные сохраняются.

## Ограничения

- Встроенный «Эйзенхауэр» не хранится в таблице и не редактируется — только по
  коду; свои пресеты можно менять.
- Матрица показывает только незакрытые и неархивные задачи: закрытая задача —
  факт, а не план.
- Гантт игнорирует вехи при расчёте CPM (вехи — отдельные строки шкалы; их
  собственные зависимости сейчас не участвуют в критическом пути задач).
- Фронтенд (панель `planning`) в это задание не входит: панель с таким id
  появится отдельной работой; модуль уже виден в каталоге и в настройках.
