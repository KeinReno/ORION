# Порядок выполнения и задания агентам

Статусы задач находятся только в 12-PROGRESS. Здесь нормативные карточки. Размер: S — одна узкая сессия, M — несколько связанных изменений, L — разделить на перечисленные подэтапы. Это относительная сложность, не обещание часов/токенов.

## Зависимости

```text
S00 → S01 → S02 → S03 → S04
         ↘ S05
S01 → S06 → S07
S08, S09, S10 — после S00, независимы от миграций команды
S01 + S06 → S11
S08 + S09 → S12 → S13 → S14
S01 → S15 → S16
S00 → S21 (до выпуска финансового модуля)
S00 → S22 (блокер desktop export)
S01 + S07 + S11 → S17
S04 + S05 → S18
все обязательные → S19 → S20
```

По умолчанию исполнять последовательно. Параллельность разрешена лишь по явному указанию владельца и с владением файлами; schema/shared contracts не редактируются двумя агентами одновременно.

## S00 · M · Зафиксировать baseline и карту реализации

**Читать:** README, CLAUDE, релевантные главы PLAN, 01-AUDIT. **Править:** только новый progress/evidence и тестовую инфраструктуру при необходимости.

1. Снять git status; не коммитить чужой dirty tree.
2. Повторить baseline только если код изменился после аудита.
3. Подготовить отдельную БД и отдельный storage fixture, запустить существующий integration suite. Не подменять рабочие .env.
4. Получить populated screenshots Сегодня/Задачи/Проект/Заметки/Документы/Настройки и narrow сценарий. Демо seed только в fixture.

**Done:** воспроизводимые команды, версии, результаты и явно указанные skipped; существующий пользовательский контент не изменён.

## S01 · L · Единая проверка доступа в агрегаторах

**Файлы:** ModulesService, SearchService, ProjectsService, note-attachments, notifications, shared-types DTO, core-react keys. **Основание:** A01/A14.

1. Написать падающий тест owner+member, restricted finance/documents, search/project/links.
2. Добавить actor-aware accessible set; протянуть actor в rollups и entityTitle.
3. Исключать запрещённые queries, а не только фильтровать готовый JSON.
4. Проверить module off/restricted в уже открытых панелях и query cache.

**Done:** member не получает суммы, названия, snippets, versions/content через обходные endpoints; owner/lead сохраняют разрешённый доступ; disabled=409, restricted=403 на direct routes. Snapshot/export покрывает S02. **Не делать:** новый RBAC DSL.

## S02 · M · Owner-only резервные копии и управление ими

**Файлы:** sync.service/controller, SyncPanel, hooks/contracts при необходимости.

Защитить get/put remote, test, backup, list, preview и restore owner policy. Проверить role повторно на финальном apply. У member скрыть owner actions и данные remote. **Done:** прямые HTTP-запросы member/lead отвергнуты; owner работает; role change между preview/apply приводит к отказу. **Тест:** owner/member/lead в одном workspace.

## S03 · L · Snapshot coverage и safe restore preflight

**Файлы:** snapshot.service, sync.service, Prisma schema/migrations, shared-types/sync, integration tests.

Подэтапы: S03a реестр каждой модели с inclusion/exclusion; S03b validated новый manifest/schema; S03c запрет опасного применения старого формата; S03d data-only roundtrip fixtures. Включить inventory/milestones/document versions/annotations и workspace config по 09-RELIABILITY.

**Done:** новая модель без классификации ломает тест; missing table не превращается в пустую; invalid reference не меняет DB; task→milestone восстановлены; counts совпадают. **Не объявлять full backup**, пока S04 не готов.

## S04 · L · Файловые бэкапы и восстановление с recovery

**Зависит:** S02/S03. **Файлы:** storage adapters, sync, DocumentsService, SyncPanel.

Подэтапы: immutable blob export/checksums; complete manifest publish; plan/preview; staging+journal; restore+fault tests. UI честно описывает включённое и исключённое. **Done:** backup удалённого позже файла восстанавливает байты и версии; partial network failure оставляет last good backup; recovery после прерывания определён; stale preview отвергнут. Отдельно не обещать перенос identity на новую установку.

## S05 · L · Разделить local/server и закрыть сетевые риски

**Файлы:** main/configure-app, auth, shared-types/auth, login/register, .env.example, launcher; calendar connections/storage remote utilities.

Подэтапы: явный mode+binding; private account picker only local; server password policy/регистрация; brute-force protection; исходящие URL/redirect/size constraints. Не переносить секреты в документы. **Done:** server mode не выдаёт directory и не принимает PIN; local запускается на loopback; rejected remote URL не делает сетевой запрос; retries ограничены. Внешние системы тестируются локальными stub-серверами.

## S06 · L · Личные таймеры и записи времени

**Файлы:** TimeEntry schema+RLS/index migration, shared-types/time, core/client, use-time, TimePanel/timer chip/Projects.

Добавить actor ownership и legacy policy из 03-ARCHITECTURE. Разделить my list/running и team report. **Done:** A/B одновременно ведут время; A не останавливает B; одна identity не запускает два таймера в workspace; legacy totals не теряются; null rate остаётся unknown. Проверить unique index настоящим concurrency test.

## S07 · L · Адресные уведомления

**Файлы:** Notification schema/RLS, notification-policy/center, due checker, events/finance/inventory producers, hooks/bell/desktop reminders.

Адресат, eventKey, per-user read state, recipient preferences; legacy archive. **Done:** A прочёл — B unread; self-action не спамит; quiet hours адресата; revoked member не получает сообщения; repeated cron не дублирует. Внешнюю доставку заменить test sink, не посылать реальные Telegram сообщения.

## S08 · S · Честные состояния входа и оболочки

**Файлы:** login/page, use-auth, spaces/page, auth shell.

Отделить accounts loading/error/empty и session unauthenticated/unavailable. Не перенаправлять на login при временном 500/network и не терять dirty editor. Retry сохраняет selection, секрет после auth failure можно очищать намеренно. Проверить недоступный API и восстановление. **Done:** network error не предлагает создать первого пользователя как диагноз; keyboard focus корректен; заявленные состояния видны screenshot/E2E. Основание A06/A17.

## S09 · M · Надёжные intent и ссылки

**Файлы:** panel-bus, app layout, command-center, notification links, entity links, panel focus consumers.

Pending/replay/ack intent с workspace scope; не переезжать на другой state framework. Затем URL adapter без remount workbench. **Done:** cold/warm open конкретной сущности, повторный click, browser back, invalid/deleted/denied entity, switch workspace во время lazy load. Исключить двойное применение.

## S10 · S · Реактивный локальный день

**Файлы:** DashboardPanel, today helpers, use-now, sidebar badges/habits/calendar ranges.

Общий day-boundary hook учитывает timezone, timer до следующей полуночи, visibility/focus wake. **Done:** fake clock 23:59→00:01 меняет диапазоны и группы без refetch side effect; DST day не считается всегда 24h; 8-часовой sleep обновляет день.

## S11 · L · Черновики и CAS контента

**Файлы:** Note schema/DTO/service, NoteEditor/NotesPanel, core-react; затем задачи/проекты отдельными подэтапами.

Atomic expectedRevision, serialized autosave с trailing drain последнего dirty snapshot, conflict UI, local draft lifecycle, navigation guard. **Done:** два клиента не теряют изменения; slow response не затирает и не оставляет неотправленным новый ввод; timeout сохраняет draft; restored revision конфликтует корректно. Управляемый promise reproduces A15. Сначала notes, не вводить универсальный CRDT.

## S12 · M · Design foundations без дубликатов

**Файлы:** globals.css, tailwind config, primitives/panel-shell/overlays, density/preferences.

Инвентаризация существующих semantic/type tokens. Убрать двойное shrink; единая высота controls, focus, status/error patterns. Проверить overlays keyboard. **Done:** body/control text читаем в compact, contrast измерен, 200% zoom, reduced motion, никаких новых UI-библиотек без необходимости. Существующие appearance preferences сохранены.

## S13 · M · Сегодня, Входящие, Задачи

**Файлы:** три панели и подкомпоненты. **Зависит:** S08–S12 и командные contracts при отображении их данных.

Применить 04-UX/05-VISUAL/06-MODULES; общий capture behavior; ясный my/team scope; список/доска; independent block errors. **Done:** acceptance U01/U02/U03/U09; desktop+narrow screenshots, клавиатура, empty/filtered/error. Не добавлять ещё один dashboard framework.

## S14 · L · Проекты и материалы

Подзадачи отдельно: S14a проект/план/cascade preview; S14b notes layout и attachments; S14c documents upload/move/versions/trash. **Файлы:** соответствующие panels/services. **Done:** acceptance U04/U05/U06; no nested modals; resizable panel layout; data/storage partial failure recovery проверен.

## S15 · L · Полнота списков и отчётов

**Файлы:** time/finance/search/projects services, DTO, ApiClient, hooks, summary panels.

Выявить реальные unbounded/truncated queries; versioned pagination + independent server totals. Стабильный tie-breaker по id. Inbox >250 не отображается как полная очередь/count. Измерить состав auth chunks: baseline `/login` 495 kB First Load JS; убрать доказанные ненужные eager imports, не угадывая виновную библиотеку. **Done:** >500 time entries дают правильный итог; фильтры/страницы не теряют и не дублируют строки; cross-workspace cursor запрещён; fixture performance и build delta записаны. Не внедрять новый search engine без измеренной причины.

## S16 · M · Доведение Finance/Inventory/Habits/Lists/Calendar

Не одна гигантская сессия: по одному модулю, по 06-MODULES. **Done:** finance totals/currency labels; inventory concurrency/append-only; habit day/idempotency; Lists: тексты разрушительных действий («Очистить выполненное» — число элементов и обратимость; различать архивирование списка и удаление его элементов), не функция копирования списков; calendar recurrence/timezone/readonly. Закрыть реальные lint warnings в соответствующих panels с проверкой stale closures, не eslint-disable.

## S17 · L · Комментарии и журнал задач

**Файлы:** новая schema с RLS, tasks service/contracts/hooks/detail UI, notification producers.

Минимум task comments + audit status/assignee/due edits. API pagination, author ownership, accessible mentions. **Done:** запрет чужого edit; XSS-safe rendering; member removal history; notification rights/dedup. Не строить чат/presence.

## S18 · M/L · Desktop, диагностика, production policy

**Файлы:** launcher, Tauri config/capabilities, configure-app, docs runbook.

Readiness вместо fixed sleeps; повторный запуск; safe logs; production CSP по реально используемым ресурсам; web/desktop feature parity. **Done:** занят порт/БД не поднялась/API умер — понятный экран; PDF/attachments/popout работают; build не обещает bundled backend без его поставки.

## S19 · L · Сквозная приёмка и fault matrix

Набор 13-ACCEPTANCE на отдельной среде, production build, desktop export/native smoke. Повторить security/restore fault tests после финальных миграций. **Done:** все обязательные сценарии PASS либо release явно BLOCKED с причиной; нет «готово» при skipped P0.

## S20 · S · Документация выпуска

Синхронизировать README/CLAUDE/MODULES_AND_PLUGINS/UI_UX_DESIGN с реальным кодом, PLAN дополнить историей решений. Удалять старые утверждения о reserved только после проверки. Финальный release note: что работает, известные ограничения, обновление/backup/rollback. **Done:** новый агент запускает проект по документу и не вынужден угадывать.

## Отложенные задачи

Перед отложенными функциями выполнить дополнительную найденную задачу:

## S21 · M · Idempotency recurring finance и обработки inbox

**Приоритет:** P1, после S00, до выпуска финансов/командной работы. **Файлы:** finance/recurring checker, Transaction schema при occurrence key, inbox service, тесты.

Для recurring: сериализовать rule, повторно читать nextRunAt под lock, материализовать уникальное occurrence. Рекомендуемый durable ключ `(recurringRuleId, scheduledFor)` с уникальностью; определить историю после удаления rule. При retry вернуть факт уже созданной операции, не создать новую. Для inbox сначала воспроизвести concurrent process; при наличии гонки lock/recheck processedAt до создания target. **Done:** два конкурентных запуска создают одну операцию/target; rollback не продвигает расписание; downtime catch-up имеет заданный лимит и не блокирует бесконечно worker; архив/paused rule не материализуется после recheck. Не «чинить» только локальным boolean-флагом процесса.

## S22 · M · Исправить static export и возврат к приглашению

**Приоритет:** P0 desktop release. **Файлы:** `apps/web/app/invite/[token]/page.tsx`, новый static invite entry, login/register flow, `invites.service.ts`, integration URL parsing, CI.

Рекомендуемый контракт новой ссылки: `/invite?token=...`, один статический маршрут с runtime client lookup. Это предложение миграции; проверить Suspense/client boundaries в установленном Next 14. Динамический legacy route не должен оставаться обязательной частью desktop export: выбрать явный совместимый web-only alias/серверный redirect вне static bundle или согласованную миграцию старых ссылок. Не добавлять фиктивный token в generateStaticParams.

Сохранить return-to intent через login/register; разрешать только внутренний ожидаемый маршрут, не произвольный redirect URL. Принять invite можно только явным действием текущего правильного пользователя. Tests должны извлекать token через URL parser по новому контракту, а не split('/invite/'). Не логировать полный bearer invite URL в production.

**Done:** web build и desktop export оба PASS; произвольный новый token lookup работает после сборки; expired/used/wrong-email/network states различаются; вход возвращает к приглашению; desktop smoke открывает экспортированную страницу. Добавить desktop export в CI как отдельный gate. Native installer test остаётся S18/S19.

## После обязательного backlog

Импорт CSV, шаблоны проектов, автоматизации, AI, новые providers, light theme, offline sync — отдельный backlog после S19. Не подменять ими исправление блокеров.

## Офисный этап · O01–O06 · согласован 2026-09-22, пересмотрен 2026-09-22 (поздняя правка)

После перепроверки и устранения дефектов 18-REVIEW-FINAL-PASS выполнить [21-OFFICE-IMPLEMENTATION](21-OFFICE-IMPLEMENTATION.md). Владелец пересмотрел направление в тот же день: **native-путь (Tiptap + spreadsheet-библиотека с формульным движком + `docx`/`exceljs`) снова в силе, интеграция с ONLYOFFICE Docs/Document Server отменена** — внешний сервис/Docker не нужен, а совместная работа в реальном времени, ради которой был нужен Document Server, владельцем явно не требуется. O01 — выбор и обоснование библиотек, изолированный спайк round-trip DOCX/XLSX; O02 — модель сериализации и сопряжение с DocumentVersion; O03 — клиентский парсинг/сохранение; O04 — редактор в UI; O05 — последовательные сохранения и история (не совместное редактирование); O06 — совместимость и эксплуатация. Начальный статус всех задач TODO. Состав и зависимости — в 21; приёмка OF01–OF10. См. [14-DECISIONS](14-DECISIONS.md) о причине пересмотра.

## Связанное ядро · U00–U10 · новый согласованный этап

Точка входа — 26-SONNET-START. Спецификация — 23, порядок работ и UC-приёмка — 24. Сначала U00 и защита офисного содержимого F01–F05 из 25, затем U01/U02 и последующие зависимости. Все новые U-карточки TODO, изменения документации не считаются реализацией. Текущий office native выбор сохраняется. Предыдущие определения O-DONE уточнены независимой проверкой 25; диаграммы/pivot требуют видимого UI и повторного round-trip.
