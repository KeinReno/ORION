# Opportunity Hub — реализация и передача следующему агенту

Обновлено: 14 октября 2026. Исходная ревизия: `d590fc3`.
ТЗ: [OPPORTUNITY_HUB_SPEC.md](OPPORTUNITY_HUB_SPEC.md); архитектура: [ADR-0008](adr/ADR-0008-opportunity-hub.md).

## Состояние

Реализован первый самостоятельный срез **R0.1 Base**: вакансии и заказы, локальные условия/источник, статусы, история действий, поиск/фильтры, постраничное чтение, архив/восстановление, JSON/CSV экспорт. Это не завершённый R0/R1 и не автономный ИИ-менеджер.

Данные сохраняются в PostgreSQL, включены в snapshot registry и восстановление. Новая additive migration `20261013220000_opportunities` применена к локальной разработческой базе; сброса базы не было.

HH не изменялся и не импортировался. Внешних сообщений/откликов не было. Профили, факты, материалы, imports, LLM, подключения HH, grants/runner пока не реализованы. Новые frontend slots из ADR-0008 пока не добавлены; Base не импортирует плагины.

## Код и контракты

- `packages/shared-types/src/opportunity.ts`: строгие input DTO, явные response DTO, kinds/statuses/conditions/query; отсутствие суммы = null, диапазон валидируется, source URL только HTTP(S).
- `apps/api/src/opportunities`: API/service/module, [MODULE.md](../apps/api/src/opportunities/MODULE.md), [AI_CONTEXT.md](../apps/api/src/opportunities/AI_CONTEXT.md).
- Prisma Opportunity: workspace FK, unique source/external ID, revision, conditions/history JSON; ENABLE/FORCE RLS.
- `@orion/core`: методы CRUD/read/export; `@orion/core-react`: scoped infinite-query и mutations.
- `apps/web/panels/OpportunitiesPanel.tsx`: существующий PanelShell/UI, отдельный workspace context, input сохранён при ошибке, guard смены пространства/закрытия панели и beforeunload.
- `apps/web/lib/opportunity-export.ts`: CSV с BOM/semicolon, escaping и neutralization формул; JSON содержит schemaVersion/exportedAt/workspaceId.
- Catalog/panel registry/AppModule/snapshot registries обновлены только для новой сущности.

## API R0.1

Prefix `/workspaces/:workspaceId/opportunities`:

| Method/path | Поведение |
| --- | --- |
| GET `/` | query/kind/status/includeArchived/cursor/limit; 50 default, 200 max; items/nextCursor |
| GET `/:id` | Только карточка текущего workspace |
| POST `/` | Создание; duplicate source/external ID →409 |
| PATCH `/:id` | expectedRevision обязателен; пустой patch →400; конфликт →409 |
| POST `/:id/archive` | expectedRevision; данные/история сохраняются |
| POST `/:id/restore` | expectedRevision; вернуть из архива |
| GET `/export` | Owner-only, до 10 000 записей, включая архив; без тихого truncation |

Каждый service method проверяет membership/роль и module enabled/restricted внутри withUser. Controller guard — дополнительная защита, не замена проверки сервиса. Row lookup всегда workspace-scoped.

## Важные решения первого среза

1. Cursor упорядочен по стабильному `id asc`, а не updatedAt/id из исходного проектируемого API: правки не сдвигают уже открытый cursor. Это явно ограниченный выбор R0.1; для сортировки «свежие сверху» нужен отдельный устойчивый контракт.
2. История хранит actor/time/action/fromStatus/toStatus, не полный diff всех полей. Ни ручной статус, ни запись истории не свидетельствуют об отправке на HH.
3. При конфликте редактор сохраняет локальный ввод; кнопка загрузки свежей revision не отправляет patch. Повторное сохранение передаёт только локально изменённые поля, остальные правки второго клиента остаются. Conditions объединяются по изменённым полям.
4. Whole-workspace export ограничен owner по ТЗ. Действия агента и внешняя отправка в этом API отсутствуют.
5. Новый модуль следует текущей catalog-модели, defaultEnabled true; existing defaults не менялись. Опциональных плагинов пока нет.
6. Условия хранятся как данные карточки; финансовых проводок, валютных конверсий и связи с балансом нет. Дополнительные структурированные требования/дедлайн и специализированные представления расширять отдельным срезом, сохраняя версии.

## Проверка

| Проверка | Результат |
| --- | --- |
| Prisma generate / migrate deploy | Пройдены, новая миграция применена |
| Workspace typecheck | Пройден; последующие frontend изменения проверяются сборкой |
| Полный unit suite | 71 файл, 552 теста, все пройдены |
| CSV и opportunity boundaries | 4 целевых теста пройдены, включая формулы/кавычки/переводы строк |
| Новый integration suite | 5 тестов пройдены: CRUD/filter/page/export/archive/history, CAS race, чужой workspace/raw RLS, restricted member/owner export, реальный snapshot roundtrip |
| Общие API-RLS и snapshot integration | 30 тестов пройдены |
| architecture-check | Пройден |
| plugin-contract-check | 10 тестов пройдены |
| lint | 0 ошибок; два существующих hook warnings в CalendarPanel/DocumentsPanel |
| Полная сборка | Пройдена; после финальных изменений CSV/подписей повторно пройдены workspace typecheck и production web build |

Команды для повторения:

```text
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm architecture-check
corepack pnpm plugin-contract-check
corepack pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/opportunities.integration.test.ts apps/api/test/snapshot.integration.test.ts apps/api/test/api-rls.integration.test.ts
corepack pnpm build
```

Для выбора файлов vitest использовать прямой `pnpm exec vitest run ...`; первоначальная обёртка с дополнительным `--` была остановлена без результата и не считается пройденной проверкой.

### Живой UI smoke

Создана отдельная синтетическая учётная запись и workspace. Проверены:

- вход и доступ к новой панели через обычную навигацию;
- создание вакансии с суммой 80 000–100 000 и описанием;
- архивирование и восстановление; история сохранилась;
- range validation: неправильная верхняя граница отклоняется, введённые значения остаются;
- параллельная HTTP-правка компании, конфликт локального title, загрузка свежей revision без потери ввода и сохранение только своей правки; компания второго клиента сохранена;
- видимое оформление в оболочке ORION.

После проверки выполнен logout; созданные только для smoke user/workspace удалены с проверкой их идентичности. Временный файл с токеном удалён. Скриншот результата сохранён как пользовательский output чата; реальные личные материалы в тест не переносились.

Не проверены: установленный EXE, clean machine, мобильный/320px/full keyboard проход, все визуальные parity-сценарии соседних модулей. Lint/typecheck/живой desktop-sized браузер не подменяют эти проверки.

## R0.2 — реализованный первый срез, 14 октября 2026

Добавлены два самостоятельных расширения `opportunities-profiles` и `opportunities-hh-import`, оба выключены по умолчанию. Включение — в настройках модуля «Возможности» для нужного пространства. Основной список вакансий/заказов работает без них. Реальные материалы из `C:\Users\Reno\Desktop\HH` в пространство не переносились, исходники HH не изменялись, внешних отправок не было.

### Профили

- Профиль человека и команды/студии; имя, город, форматы работы, минимальная сумма на руки, исключённые компании/роли.
- Факты с источником: новый факт непроверенный; только явное действие владельца подтверждает/оспаривает его с CAS revision.
- Треки со ссылками только на факты того же профиля; материалы только в треке того же профиля/пространства.
- Неизменяемые текстовые версии резюме, портфолио и предложения; список с постраничной загрузкой и просмотр содержимого. Импорт резюме не создаёт подтверждённых фактов и не выбирает активную версию автоматически.
- Профили читают разрешённые участники пространства, меняет владелец. Создание и импорт требуют подтверждения видимости материалов участникам. Это workspace-wide доступ, отдельного приватного ACL на профиль пока нет.
- Архив/восстановление с CAS, выключение расширения сохраняет данные. Ошибка сохраняет ввод; переходы/смена формы используют общий `@orion/ui ConfirmDialog`, не native window.confirm.

### Импорт HH

- Выбор папки или отдельных файлов, исключение служебных файлов/кода/браузерных сессий **до чтения и загрузки**; сервер повторно применяет allowlist.
- MD/TXT резюме, поддерживаемые JSON снимков вакансий и журналов. Папка кандидата задаёт принадлежность материала; одинаковые имена в разных исходных папках не объединяются. Выбор одной вложенной папки «Резюме» отклоняется с пояснением.
- Предпросмотр с примерами, пропусками и сроком 24 часа сохраняет план, не предметные записи. После изменения файлов/опций нужен новый предпросмотр. Применяется загруженный снимок, локальная папка повторно не читается.
- Порции по 25 операций: блокировка строки ImportRun, CAS revision, атомарные checkpoint/report/inserts. После прерывания можно открыть сохранённый импорт и явно продолжить; открытие не запускает apply.
- Повторный импорт дедуплицируется по стабильным ключам. Ручные названия/условия/предпочтения не перезаписываются. Изменённое содержимое резюме создаёт новую версию; изменённая зарплата в снимке вакансии создаёт новый capture, не переписывает карточку.
- Снимки содержат sourcePath, исходный vacancy file SHA-256, record SHA-256, normalized conditions/text и historical flag. Дата загрузки не выдаётся за дату актуальности вакансии. Для материала сохранены sourcePath и hash нормализованного текста.
- История остаётся `already_exists`, `legacy_claimed_verified`, `failed` или `unconfirmed`; новое `confirmed` не создаётся. Возможный дубль помечается. Профиль для истории выбирается явно или остаётся пустым; аккаунт по имени файла не угадывается.
- Отмена останавливает последующие порции, уже записанное сохраняется. Импорт/журналы/источники доступны только владельцу через отдельный API.

### Границы и резервные копии

Typed slots `opportunities.views` и `opportunities.details.sections`; frontend plugins используют public contracts и typed `@orion/core` API. Серверный адаптер использует `OPPORTUNITIES_IMPORT_PORT.v1` и `PROFILE_IMPORT_PORT.v1`, Base не импортирует concrete plugins. Composition — `OpportunityExtensionsModule`.

Добавлены семь моделей, FORCE RLS и composite workspace/profile foreign keys, additive migration `20261014010000_opportunity_profiles_import`. Snapshot включает все модели в порядке родителей перед детьми. Восстановленный ImportRun принудительно `canceled` с повышением revision: старый предпросмотр не получает право продолжить импорт из резервной копии.

### Практические ограничения среза

Это работающий текстовый путь R0.2, а не выполнение всех пунктов большого ТЗ. Максимум 250 поддерживаемых файлов за пакет, browser limit 1 МБ, serialized input 500 000 символов, отдельное резюме 50 000 символов. Большую папку выбирать меньшими подпапками/пакетами. PDF/DOC/RTF, OCR, сложные двоичные портфолио и неизвестные категории пока пропускаются. Лимит 100 МБ из целевого ТЗ не реализован.

Нет полного редактирования/архива треков и фактов, выбора активного резюме, roster команды, private profile ACL, анализа резюме/fit, генерации писем, live HH refresh, внешних approvals/runner и отправки. Для details API показываются до 50 captures и 50 history записей; recent imports — последние 20. Исторические записи без связанной карточки сохранены в БД и snapshot; отдельный UI общего журнала ещё не добавлен.

### Проверка R0.2

- Unit suite текущего репозитория: 77 файлов / 574 теста пройдены (включая 6 parser/boundary tests).
- Profiles/import PostgreSQL integration: 6 тестов пройдены — disabled retention/Base parity, ownership/RLS/foreign references/CAS, concurrent checkpoints/replay/manual preservation, manifest/expiry/cancel, immutable versions/legacy outcomes/полный snapshot, foreign runs/owner-only access/canceled restore.
- Base + общие RLS/snapshot integration: 35 тестов пройдены. Изменённая зарплата в source capture также проверена.
- Workspace typecheck, architecture-check, plugin-contract-check (10 тестов) пройдены. Lint: 0 ошибок; существующие 2 hook warnings CalendarPanel/DocumentsPanel.
- Live browser на синтетических данных: профиль человека, факты/подтверждение/трек/версия, профиль студии, повторное сохранение предпочтений, портфолио, Cancel с сохранностью черновика, отдельные файлы и folder import, исключение скрипта, legacy outcome в карточке, импорт без выдуманных фактов.
- Responsive: профили на 390 px, importer на 320 px, начало/конец scroll content и клавиатурный Tab; устранён min-content overflow fieldset. Это не полный screen-reader/keyboard/parity аудит всех модулей.
- Тестовая учётка/workspace удалены после logout с проверкой exact id/email/name/ownership; временные token/fixture файлы удалены. Browser console error log пуст.
- Повторный `prisma generate` сталкивался с блокировкой DLL запущенным API. Существующий generated client включает новые модели и успешно прошёл typecheck/integration; сервис пользователя ради повторной генерации не останавливали.

Скриншоты: `opportunity-hub-r02-import.png`, `opportunity-hub-r02-profile.png`, `opportunity-hub-r02-mobile.png` в output-папке этого чата. Полная production build (API + web, 43 static pages) пройдена. Итоговый combined PostgreSQL integration: 4 файла / 41 тест, все пройдены; полный workspace typecheck повторно пройден после финальных изменений. После финального изменения parser отдельно повторены его 6 unit tests. Production frontend запущен на `http://localhost:3010/`; API продолжает работать на 4000. Установленный EXE и clean machine в этом срезе не проверялись.

## R0.2 — явный выбор активного резюме, 15 октября 2026

В расширении профилей добавлены «Сделать активным», просмотр выбранной версии и снятие выбора. Новое резюме не выбирается автоматически; импорт другой версии, изменение обычных предпочтений, архив/восстановление и выключение расширения сохраняют выбор. Несохранённая форма блокирует смену/снятие выбора. Ранее сохранённые версии остаются неизменными.

API POST `opportunity-profiles/:id/active-resume`: `{ expectedRevision, materialId: UUID | null }`. Только владелец, только неархивный профиль, только резюме того же профиля/пространства; portfolio/proposal и чужие версии запрещены. Два клиента используют общую revision профиля и не перезаписывают выбор молча. Detail возвращает activeResume metadata отдельно от страницы материалов, поэтому выбор доступен и за пределами первых 50 версий.

Хранение: reserved `_activeResumeMaterialId` в существующем JSON настроек профиля; отдельное public DTO поле activeResumeMaterialId. Public preferences input не принимает reserved key; обычное обновление настроек сохраняет его. Это дополнение контракта расширения, без изменения Base, Prisma schema и миграций. Snapshot уже включает профиль с этим JSON; восстановление выбора проверено. Выбор версии не даёт разрешения на внешнюю отправку.

Проверка: 20 integration tests в 4 файлах (active-resume, extensions, Base opportunities, snapshot) пройдены в отдельной временной БД с актуальными миграциями и синхронизацией незавершённой общей схемы. Временная БД удалена; рабочая БД не мигрировалась. Новые тесты проверяют same-profile/type/owner guards, CAS race, preferences/archive/disable/restore retention, независимость от пагинации (52 версии), импорт новой версии без автоматического переключения и снятие выбора без удаления материалов. API typecheck и API production build пройдены; architecture-check и 10 plugin-contract tests пройдены; scoped lint изменённого кода без ошибок.

Общие проверки всего checkout на момент прогона не зелёные из-за параллельных изменений: web typecheck — отсутствующий role в settings/members-section.tsx:59 и неверный вызов request в api-client.ts (listProjectGoalsHistory); production web build остановилась на members-section. Общий lint — no-control-regex в lib/note-export.ts:6. Эти участки не исправлялись в данном срезе. Unit suite: 902 passed / 1 timeout (DOCX codec); отдельный повтор DOCX suite — 4/4 passed. Это не объявляется полностью зелёным общим прогоном.

Живая UI-проверка активного выбора не завершена: изолированные API 4107 / web 3017 подняты, synthetic account с двумя версиями создан и вход проверен; во время долгой компиляции панели общий PostgreSQL остановился, API потерял соединение. Повторный запуск тестового API отклонён автоматической проверкой без подробной причины. Отдельная временная UI-БД `hub_resume_c419e9378e194e1bbea474ab179ee2c8` затем удалена с проверкой точного имени/localhost/порта; временный файл соединения и helper удалены, добавленная Next запись .next-resume-smoke в tsconfig убрана. Тестовая вкладка закрыта. Установленный EXE не обновлялся. Для завершения среза остаётся живая проверка выбора/смены/снятия, состояния конфликта и сохранности формы при работающем тестовом сервере; API-проверки этих данных прошли.

## Следующий срез

Продолжение R0.2: большие пакеты/двоичные документы и общий исторический журнал; затем R0.3 assistant assessment как отдельный optional plugin с evidence/gaps и управляемыми черновиками. Не помещать profile/HH/LLM бизнес-логику в Base и не исполнять импортируемые скрипты.

Перед продолжением: git status/history, этот progress, паспорта и actual contracts. ТЗ/ADR не выдавать за реализованный plugin runtime или систему внешних approvals. Режим ИИ-менеджера остаётся закрыт до G11–G20 и явного разрешения владельца конкретного внешнего аккаунта.
