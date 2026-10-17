# ADR-0008 — Opportunity Hub: дополнительный модуль, расширения и внешнее исполнение

Дата: 13 октября 2026.
Статус: **Base принят к поэтапной реализации по запросу владельца; R0.1 реализован 14 октября 2026**. Предложения slots и plugin contracts ниже ещё не реализованы; их конкретизация относится к R0.2/R1.
ТЗ: [OPPORTUNITY_HUB_SPEC.md](../OPPORTUNITY_HUB_SPEC.md).

## Контекст

Нужен единый процесс работы с вакансиями и заказами, личными/командными профилями, подготовкой ответа и ограниченным ИИ-менеджером. В `HH` существуют материалы и browser-скрипты, но перенос их в Base сохранил бы смешение кандидатов, слабое подтверждение отправки и непостоянные лимиты.

Текущие реестры ORION compiled-in; типизированные slots заданы в `apps/web/lib/extensions/contracts.ts`, composition — в `registry.ts`. Opportunity Hub отсутствует. AI Bridge ограничивает токены и имеет generic jobs/messages; proposals поддерживают удаления задач/заметок, а не внешнюю отправку. Документы Core/Module/Plugin не дают разрешения молча добавлять отсутствующий hook.

## Предлагаемое решение

1. Дополнительный модуль `opportunities` владеет возможностями и минимальным ручным жизненным циклом.
2. Профили, файловый импорт HH, ассистент и browser-исполнение — отдельные compiled-in плагины, каждый расширяет `opportunities`.
3. Связи с Tasks/Calendar/Documents/Notes/Projects — публичные Module Bridges. Base работает без них.
4. ИИ не исполняет внешнюю команду из текста. Отправка требует domained typed grant, immutable payload и повторной проверки прав, лимита и аккаунта.
5. Generic AgentJob не объявляется durable executor. Hub владеет специализированными attempts/leases/reconciliation; общий auth/audit переиспользуется через публичный bridge.
6. Новые плагины default-off; настройка Hub явно включает выбранные capabilities. Никакого автоматического импорта HH/подключения browser/отправки.

Не меняется ownership существующих функций из AI_REFACTOR_MIGRATION_MAP. Этот ADR добавляет новую предметную область и её границы, не переклассифицирует Tasks/Notes/AI Core.

## Extension Proposal

**NEW_EXTENSION_POINT_REQUIRED**

### Запрашиваемые frontend slots v1

| Slot | Назначение | Минимальный публичный контекст |
| --- | --- | --- |
| `opportunities.toolbar` | Импорт и контекстные команды плагинов | workspaceId, viewer capabilities, selected opportunity IDs, refresh callback |
| `opportunities.views` | Представления профилей/черновиков/истории исполнения | workspaceId, navigation callback; metadata id/label/order |
| `opportunities.details.sections` | Материалы, оценка и доказательства выбранной возможности | workspaceId, immutable Opportunity DTO, active profile ID?, revision, refresh callback |
| `opportunities.settings.sections` | Настройка ассистента/подключений/политик | workspaceId, current capabilities; plugin owns its form/API |

Ни один slot не получает Prisma, credentials, внутренний store/сервис или произвольную функцию submit. Slot контекст содержит только данные, разрешённые текущему viewer. Компоненты плагинов используют contracts/host-api/`@orion/ui` и публичный domain client.

Host владеет layout и lifecycle selection, plugin — своим содержимым. Contract data и UI metadata типизируются; неизвестный slot/contribution отклоняются. При disabled plugin contribution исчезает и API блокируется. Если выбран отключённый plugin view, host возвращает в Base с объяснением и сохранением разрешённого draft state.

### Backend contracts v1

| Контракт | Владение и ограничение |
| --- | --- |
| `OpportunityCaptureAdapter` | Plugin выдаёт normalized records/provenance; Base не знает HH-file layout |
| `OpportunityAssessmentProvider` | Assistant выдаёт typed requirements/evidence/gaps; provider не получает send authority |
| `OpportunityExecutionAdapter` | Browser plugin принимает фиксированные действия; возвращает typed state/evidence; только конкретный connection/grant |
| `OpportunityBridgeProvider` | Публичные references/commands соседних модулей, checked workspace/access/enabled-state |
| `OpportunityAgentBridge` | Новые narrow scopes и DTO через текущий AI auth/audit; grant на внешнюю запись отдельный |

Нормализация определяется Zod-contract в shared-types; реализации регистрируются в composition root, без imports конкретного HH/LLM plugin в Base. Не выдавать существующий frontend registry за готовый backend capability runtime: эту часть создать ограниченным отдельным срезом.

### Почему существующих точек недостаточно

Slots Tasks/Finance/Documents дают доменный контекст соответствующих сущностей и не подходят для вакансий/заказов. Добавлять HH-интерфейс в task details означало бы навязать Tasks чужую предметную модель. Общая панель/browser ORION не гарантирует выбранный аккаунт, grant или evidence.

`task.delete`/`note.delete` proposal содержит target/action/reason, но не неизменяемый текст ответа, аккаунт, material hashes, limit reservation и внешний uncertain-result lifecycle. Расширять его ad hoc action string нельзя; контракт внешней отправки и публичный bridge сначала задаются отдельно.

### Совместимость и миграция

- Контракты v1 additive; не менять смысл текущих slots/scopes и permissions.
- Манифесты регистрируются в существующих MODULE/PLUGIN catalogs. Не создавать marketplace/runtime загрузку кода.
- Все доменные таблицы workspace-scoped с ENABLE/FORCE RLS; доступ к plugin сущности требует host module + plugin enabled.
- Backup registry обновляется явно; credentials/grants/leases excluded, восстановленные policies paused.
- Отключение сохраняет данные; re-enable не восстанавливает отправку автоматически.
- Existing default-full и соседние панели сохраняют behavior; новый модуль не является причиной побочного рефакторинга.

### Приёмка предложения

До реализации зафиксировать DTO/versioning, metadata/props slots и manifest IDs; tests registry проверяют неизвестные IDs, disabled host/plugin, deterministic contribution order и отсутствие concrete plugin imports в Base.

Для backend проверить unauthorized/disabled/cross-workspace отказ, immutable payload, concurrency/idempotency и uncertain-send behavior. Критерии G01–G20 определены в ТЗ.

## Рассмотренные альтернативы

| Альтернатива | Причина не выбирать сейчас |
| --- | --- |
| Внести всё в Tasks | Возможность/профиль/внешняя попытка не являются задачей; модуль теряет самостоятельность |
| Добавить бизнес-логику в Core AI | Нарушает доменное владение; Core не должен знать HH и резюме |
| Копировать HH-скрипты в API | Жёсткие персональные факты, session state и несовершенная верификация становятся серверной обязанностью |
| Обязательный API каждой платформы | Не соответствует выбранному подходу; capture/import и browser adapters должны быть заменяемыми |
| Сразу сторонний plugin runtime/очередь общего назначения | Не нужен для R0 и расширяет scope; выбрать только измеренно необходимые контракты |

## Последствия

Потребуется новый предметный срез, профили/импорт как расширения и специализированный executor перед R1. Сложность внешней отправки не маскируется generic jobs и UI-флагом.

Полезный R0 можно выпустить отдельно; ИИ-менеджер не считается готовым до проверенной R1. Для live acceptance нужен явный выбор аккаунта и конкретного внешнего действия владельцем.

Подготовка этого ADR не означает принятие proposal и не включает никакой существующий модуль/плагин.

## Реализация R0.2, 14 октября 2026

В рамках разрешённого владельцем продолжения реализованы typed slots `opportunities.views` (workspaceId/workspaceLabel/canManage/onDirtyChange; meta tabId/label/ownerOnly) и `opportunities.details.sections` (workspaceId/readonly Opportunity DTO/canManage). Реальные портовые контракты v1: `opportunities/public.ts` / OPPORTUNITIES_IMPORT_PORT и `opportunities-profiles/public.ts` / PROFILE_IMPORT_PORT. Composition отдельная, HH/profile логика не включена в Base.

Два compiled-in default-off plugin: profiles и HH file import. Остальные предложенные слоты/assessment/execution/bridges остаются proposal, не заявляются как готовые. Фактический объём, лимиты и проверка — `docs/OPPORTUNITY_HUB_PROGRESS.md` R0.2; полный внешний runtime/approvals этот срез не создаёт.

## Реализация R0.3, R1.1, R1.2 (15–16 октября 2026)

Добавлены три compiled-in plugin, все default-off и расширяющие `opportunities`: `opportunities-assistant` (оценка с основаниями, черновики, пробный запуск), `opportunities-execution` (подключение аккаунта HH, разрешение на точное содержимое, протокол локального исполнителя, сверка) и `opportunities-manager` (политика ограниченной автономности, цикл по команде владельца, отчёт). Паспорта — `apps/api/src/opportunities-{assistant,execution,manager}/MODULE.md`.

**Новые слоты не потребовались:** UI подключён к уже существующим `opportunities.views` (вкладки «Отправка», «Менеджер») и `opportunities.details.sections` (раздел «Ассистент»). Предложенные ранее `opportunities.toolbar` и `opportunities.settings.sections` по-прежнему **не реализованы** (`NEW_EXTENSION_POINT_REQUIRED` остаётся открытым для них).

**Публичные порты v1** (плагины не обращаются к чужим сервисам и таблицам): `OPPORTUNITIES_READ_PORT` (чтение карточки и список кандидатов), `PROFILE_EVIDENCE_PORT` (подтверждённые/непроверенные факты, треки, активное резюме), `ASSISTANT_DRAFT_PORT` (актуальный пробный запуск черновика), `ASSISTANT_AUTOMATION_PORT` (оценка, черновик, одобрение от имени политики), `EXECUTION_AUTOMATION_PORT` (поставить/отменить/посчитать отправки политики). Протокол исполнителя `opportunities-executor/v1` — отдельный контроллер с capability-токеном, не пользовательский JWT.

**Не реализовано и остаётся предложением:** `OpportunityAgentBridge` и новые AI-scopes (`opportunities:*`) — ИИ-агенты через AI Bridge с этими областями не подключены; мосты Tasks/Calendar/Documents/Notes/Projects; внешний LLM-провайдер (нужно решение владельца); браузерный адаптер hh.ru (нужно разрешение владельца на конкретный аккаунт и действие); фоновый планировщик менеджера; публикация событий v1 (`import.completed`, `attempt.confirmed`…). Не выдавать наличие портов и протокола за готовый внешний runtime.
