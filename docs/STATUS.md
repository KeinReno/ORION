<!-- Android branch alpha.23 (26.10.2026): compare only replica identity fields;
workspaceName metadata no longer rejects valid copy as offline. Physical task
phone→installed PC→phone/reload/delete PASS; see android/SYNC_LIVE_ALPHA23.md. -->
<!-- Android branch alpha.22 (26.10.2026): compact task/note filters, readable
Markdown excerpts, finance hierarchy and safe-area fix. Physical OPPO Android15
upgrade/SQLite CRUD/keyboard PASS; LAN requires hybrid mode. See android/RELEASE_ALPHA22.md. -->
<!-- Android branch alpha.21 (25.10.2026): progressive connection UI, truthful host
indicator, finance disclosure/reflow and draft navigation feedback fixes.
See android/RELEASE_ALPHA21.md; physical OPPO acceptance pending. -->
<!-- Android alpha.20 (24.10.2026): scoped foreground sync driver and explicit
pairing/login/workspace/local-only states. Desktop task/note query polling aligned.
See android/SYNC_FOREGROUND_ALPHA20.md; physical LAN acceptance pending. -->
<!-- Android branch alpha.19 (23.10.2026): native NSD, pinned remembered-host
readdressing, desktop LAN identity/guidance. See android/LAN_DISCOVERY_ALPHA19.md.
Hardware OPPO/Windows/VPN acceptance and new Windows installer pending. -->
<!-- Android branch update 23.10.2026: alpha.18, 0.1.17/code18.
Restore draft/transfer/duplicate-ID and fenced-code extraction fixes.
See android/RELEASE_ALPHA18.md; physical OPPO/LAN acceptance pending. -->
# ORION — состояние на 26 октября 2026

Android branch alpha.24: совместимое чтение старых задач без checklist в snapshot,
replica и backup; индикатор свежего обмена независим от часов ПК; удаление общего
списка после архива с защитой от concurrent unarchive. Физический OPPO upgrade
сохранил данные; список phone→PC и checkbox PC→phone прошли автоматически;
QA cleanup завершён pending0/conflicts0. 64 профильных теста после миграции,
typecheck/lint, browser и Android Gradle checks прошли. Подробности и ограничения:
[Android alpha.24](android/RELEASE_ALPHA24.md).

Android branch / Windows beta.25: workspace exchange link in network settings;
causal HLC watermark fix for device clock skew;15 real PostgreSQL sync tests pass.
Installer runtime boots on an isolated profile. The MSIX profile mismatch was
resolved; the obsolete virtualized profile was archived and the phone-linked
Kaiden retained as the sole active workspace. Beta.25 files installed in the real
installation; OPPO reconnected with existing trust and delivered its offline
note once, then synthetic cleanup ended with pending0/conflicts0. See
[recovery acceptance](android/PROFILE_CLEANUP_2026-10-26.md) and
[earlier scoped report](android/SYNC_WINDOWS_BETA25.md).


> **Статус документа:** оперативная сводка с изменениями по 26.10.2026; для факта выполнения требуется проверка на конкретном HEAD. [Политика документации](DOCUMENTATION_LIFECYCLE.md) разграничивает действующие требования и исторические отчёты. Изменения документации сами по себе не подтверждают готовность продукта или Windows-приёмку.

> Направление и приоритеты задаёт [PLATFORM.md](PLATFORM.md) (KAIDEN Orion Platform 1.0). Этот файл — только факт: что в коде и что проверено.

Единая точка входа: что лежит в master, что проверено на этой ревизии и что осталось. Отчёты по отдельным этапам — архив; при расхождении верен этот файл и проверка на текущем коммите.

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

### Android: отдельная ветка alpha, 23.10.2026

Alpha.17 на Android-ветке (0.1.16/code17): восстановление задач, заметок, списков
и финансов из переносимой копии с предпросмотром и режимами добавления/замены;
чек-лист прямо при создании задачи с переносом строк описания; лёгкое
Markdown-форматирование; исправлено одновременное выделение текста при долгом
нажатии. 52 mobile-core + 9 task тестов, browser smoke, workspace checks и
Android build/lint/JVM PASS; физическая установка на OPPO/LAN NOT RUN.
[RELEASE_ALPHA17](android/RELEASE_ALPHA17.md).

Alpha.16 на Android-ветке (0.1.15/code16): чек-листы внутри задач на существующем
`parentId` — добавление, переименование, выполнение, каскадное удаление и прогресс,
локально и в синхронизируемой копии. Focused unit/API, workspace typecheck/lint,
architecture/plugin, browser smoke и Android build/lint/JVM PASS; физическая
установка на OPPO/LAN NOT RUN. [RELEASE_ALPHA16](android/RELEASE_ALPHA16.md).

Alpha.15 на Android-ветке (0.1.14/code15): безопасный lazy Markdown preview,
сортировки задач/заметок, начало и плановые минуты задачи через существующий SyncOp.
50 focused unit/12 browser scripts/11 plugin, workspace checks и Android builds/lint/JVM
PASS; physical OPPO/LAN NOT RUN, tilt unchanged. [RELEASE_ALPHA15](android/RELEASE_ALPHA15.md).


Alpha.14 на Android-ветке (0.1.13/code14): статусы/сроки задач и фильтры;
summary/tags/pin заметок, независимый поиск. Optional draft fields без очистки
legacy metadata; local/remote public SyncOp unchanged. 47 focused tests,
11 browser scripts, 11 plugin, workspace typecheck/lint/architecture/module-docs
и Android build/lint/JVM PASS. Физические OPPO/LAN NOT RUN, tilt не менялся.
[Подробности alpha.14](android/RELEASE_ALPHA14.md).

Alpha.13 на Android-ветке (0.1.12/code 13): bundled registry и typed routes,
нижняя навигация с иконками, «Ещё», семь страниц настроек с поиском и независимыми
записями полей; Lists с офлайн CRUD/черновиком/архивом и существующим SyncOp.
44 focused unit, 11 plugin, 10 browser scripts, workspace typecheck/lint,
architecture/module-docs и native build/lint/JVM PASS. OPPO/LAN физически NOT RUN.
Полный dynamic SDK, остальные домены и media migration не реализованы.
[Результаты alpha.13](android/RELEASE_ALPHA13.md),
[архитектура](android/FRONTEND_ARCHITECTURE.md), [настройки](android/SETTINGS_SPEC.md).

Alpha.12 на Android-ветке (0.1.11/code 12): явные действия edit/delete для task/note,
durable delete через существующий протокол, цельная плоскость interactive cards,
усиление depth до 28°/32px. 36 mobile-core и 11 plugin tests, 9 browser scripts,
workspace typecheck/lint, architecture/module-docs и native build/lint/JVM PASS;
физические OPPO sensor/UX и настоящий LAN exchange NOT RUN в этом сеансе.
Подробности: [RELEASE_ALPHA12](android/RELEASE_ALPHA12.md).

Alpha.2 (0.1.1/code 2): настройки темы, автоматическая проверка и
необязательная загрузка по Wi-Fi, проверяемый APK и системная установка.
Источник APK отдельно от приватных исходников, по разрешению владельца.
[Результаты и ограничения](android/RELEASE_ALPHA2.md).

Ветка `feature/android-foundation-20261021` добавляет самостоятельный клиент
для OPPO Reno8 5G: задачи, заметки, черновик, нативное SQLite-хранилище,
общие контракты операций и LAN-профиль подготовки. Серверные API, desktop
и миграции не меняются. LAN-клиент реализован начиная с alpha.3; физический обмен требует отдельной приёмки.
Документы и точные границы проверок: [Android](android/README.md),
[релиз](android/RELEASE.md). Это сводка ветки, не утверждение о слиянии в master.

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
