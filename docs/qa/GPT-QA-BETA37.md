# KAIDEN ORION — независимый QA-пакет для beta37

**Дата подготовки:** 2026-11-06  
**Исходный код:** `821e694370f44485442edcdfe83de23709b1a8d8` (Windows beta37)  
**Рабочая ветка:** `qa/gpt-qa-beta37-20261106`  
**База для чистого PR:** `qa/beta37-baseline-821e694` (ровно исходный SHA)  
**Принцип:** только тесты, проверочный локальный запускатель и документация. Production-код не изменён.

## Фактическое исполнение

**НИ ОДИН тест из этого пакета в авторской изолированной среде не был запущен.** Из GitHub прочитаны исходники, конфигурации, старые тесты; изменения записаны в отдельную QA-ветку. У этой среды нет работающего Windows/Node/pnpm/PostgreSQL/Playwright checkout данного приватного репозитория и доступа к тестовому процессу Orion. Результаты `pnpm test`, `typecheck`, `build`, PostgreSQL, Windows и Playwright **не подтверждены**.

Различать:

- **FAIL (source contract):** исходники заведомо не соответствуют требованию; это статический факт, не выдуманный результат запуска.
- **NOT_RUN:** написанный тест/сценарий не исполнялся, поэтому не может быть PASS.
- **BLOCKED:** для исполнения в среде автора отсутствует локальный checkout и тестовое окружение.
- **PASS:** ставится исключительно после фактического запуска нужных этапов с кодом 0. В данном отчёте новых PASS нет.

`master` (`cf3feabc1dd4d0544c5dcbf7982734872bb6149c`) отстаёт от beta37 на 209 коммитов. Поэтому PR для Sol направлен на отдельную точную baseline-ветку, **не на master**. Sol должен переносить только QA diff на актуальную интеграционную ветку.

## Ведомость: все восемь направлений

| Направление | Итоговая оценка по доступным фактам | Новые сценарии | Уже существующее покрытие | Что не покрыто |
|---|---|---|---|---|
| **QA-01** | **BLOCKED**; запуск **NOT_RUN** | QA-01-01..10: защита тестовой БД; 6-этапный запускатель | `vitest.config.mts`, `vitest.integration.config.mts`, `playwright.config.ts`, `scripts/e2e-local.mjs` | Windows запуск и реальные коды завершения |
| **QA-02** | **BLOCKED**; запуск **NOT_RUN** | QA-02-01: spoofed token identity; QA-02-02: revoked worker | `agent-manager.integration.test.ts`, `agent-remote-policy.integration.test.ts`, `permission-api.integration.test.ts` | Сквозная матрица MCP/API/UI и сценарии ограничений удаления |
| **QA-03** | **FAIL (source contract)**; запуск **NOT_RUN** | QA-03-01: note trash/restore; 02: foreign workspace; 03: task restore (RED) | `note-cas.integration.test.ts`, `documents-trash.integration.test.ts`, `events-all-day.integration.test.ts` | Групповое удаление, все разновидности recurring scope, interrupted operations |
| **QA-04** | **FAIL (source contract)**; запуск **NOT_RUN** | QA-04-01..03: независимость важности/срочности от priority/dueAt (RED) | `project-matrix.test.ts`, `e2e/theme-matrix.spec.ts` | API сохранение новых осей, DnD по 4 квадрантам, batch-permission rollback |
| **QA-05** | **FAIL (source contract)**; запуск **NOT_RUN** | QA-05-01: XLSX preservation; 02: DOCX merged cells (RED) | `office-documents.integration.test.ts`, codec tests | Большие файлы, multiuser save conflict, визуальный E2E обеих таблиц |
| **QA-06** | **BLOCKED**; запуск **NOT_RUN** | QA-06-01: competing claims; 02: cancel/submit race; 03: expired heartbeat (RED if accepted) | `agent-hub-agent.integration.test.ts`, `agent-hub-runtime-registry.integration.test.ts`, `agent-hub-lifecycle.test.ts` | Настоящий supervisor/process identity; automated retry/independent review |
| **QA-07** | **FAIL (source contract)**; запуск **NOT_RUN** | QA-07-01: import→delegate→submit→reimport; 02: independent review (RED) | `development-apply.integration.test.ts`, `development-consent.integration.test.ts`, `e2e/orion-dev.spec.ts` | Конкретный git commit ↔ task provenance, conflict/dependency end-to-end |
| **QA-08** | **BLOCKED**; запуск **NOT_RUN** | QA-08-01: 1200 строк/чанки/повтор/повреждённый конец | `hybrid-sync.integration.test.ts`, `e2e/hybrid-sync.spec.ts`, `node-backup.integration.test.ts`, `blob-backup.integration.test.ts` | Два физических ПК, WebDAV fault injection, полный archive-backup restore |

Слово **RED** означает специально написанный контрактный тест, рассчитанный обнаружить известное расхождение, а не «успешный тест». Фактический статус каждого нового теста до исполнения — **NOT_RUN**.

## Добавленные / затронутые файлы

- `scripts/qa-preflight.mjs` и `scripts/qa-preflight.test.mjs`: строгое именование `orion_qa_*`, локальные PostgreSQL URLs, подтверждение сброса.
- `scripts/qa-local.mjs`: 6 последовательных стадий, отдельные логи каждого шага, `summary.json`, `summary.md`, корректные коды 0/1/2 и `NOT_RUN`.
- `apps/api/test/qa-agent-hub-regression.integration.test.ts`: QA-02/06.
- `apps/api/test/qa-delete-restore.integration.test.ts`: QA-03.
- `apps/web/lib/eisenhower-independent.contract.test.ts`: QA-04.
- `apps/web/plugins/documents-office/codecs/qa-office-roundtrip.test.ts`: QA-05.
- `apps/api/test/qa-orion-dev-journey.integration.test.ts`: QA-07.
- `apps/api/test/modules-ext/chat-archive/chat-archive.integration.test.ts`: добавлен QA-08-01.

Итого **26 тестовых случаев** с учётом параметризованного preflight (10 случаев) и **16 новых прикладных регрессий**. Новые RED-тесты не должны исключаться из стандартного запуска только ради зелёного отчёта.

## Подтверждённые статическим анализом несоответствия

### QA-03-D01 — P0: удаление задачи необратимо в пользовательском API

**Источник:** `apps/api/src/tasks/tasks.service.ts`, `remove()` вызывает `tx.task.delete()`; в `tasks.controller.ts` отсутствует маршрут восстановления. Заметки отдельно поддерживают soft delete и `POST /notes/:id/restore`.

**Минимальное воспроизведение для Sol (только тестовая БД):** создать задачу через `POST /workspaces/:ws/tasks`; сохранить `id`; вызвать `DELETE /workspaces/:ws/tasks/:id`; выполнить `POST /workspaces/:ws/tasks/:id/restore`; ожидать идентичные `id` и `title` после восстановления. В beta37 этот контракт не реализован. Проверка: `QA-03-03`.

**Ограничение:** нужно явно утвердить контракт корзины задач и календарных событий; в текущем сервере у них может быть намеренная семантика hard-delete. Требование workpack — восстановление, поэтому расхождение не скрываем.

### QA-04-D01 — P1: квадранты вычисляются из посторонних характеристик

**Источник:** `apps/web/lib/project-matrix.ts`:
`eisenhowerImportance` использует только `priority === "high"`; `eisenhowerUrgency` смотрит на `dueAt` в пределах трёх дней; комментарий модуля подтверждает изменение `priority` при перетаскивании.

**Минимальное воспроизведение:** две задачи без установленной самостоятельной важности, с разными приоритетами, должны иметь одинаковую важность по умолчанию. Аналогично две задачи без явной срочности, но с разным `dueAt`. Текущая модель меняет квадрант. Проверки: `QA-04-01..03`.

**Для Sol/CORE-01:** сначала определить в shared-types и БД самостоятельные поля (включая `unset` и миграцию), затем переписать матрицу и drag handlers; не переписывать ожидания под legacy behaviour.

### QA-05-D01 — P1: DOCX codec не переносит объединение ячеек

**Источник:** `apps/web/plugins/documents-office/codecs/docx-codec.ts`, `docxTableFromNode()` создаёт `DocxTableCell` без переноса `attrs.colspan/rowspan`. Код не выдаёт пользователю предупреждения перед сохранением, что структуры таблицы могут быть утрачены.

**Минимальное воспроизведение:** DOCX с двумя таблицами, во второй объединить две ячейки; открыть → сохранить через codec → открыть; сравнить `attrs.colspan = 2` и несвязанные абзацы. Проверка: `QA-05-02`.

### QA-07-D01 — P0: нет завершённого пути независимой приёмки Agent Hub

**Источник:** human `agent-hub.controller.ts` предоставляет список/создание/отмену/reconcile, но не approve/reject переход из `review`. Агентский report подтверждает только переход `working→review`, не независимую приёмку.

**Минимальное воспроизведение:** импортировать каталог ORION DEV в тестовый workspace; делегировать задачу; получить `submit` с `evidenceRefs`; попытаться независимо одобрить через `POST /workspaces/:ws/agent-hub/executions/:id/review`, с записью `verifiedBy`. Контракт не реализован. Проверка: `QA-07-02`.

**Важно:** отсутствующий approve endpoint — не свидетельство ложной автоприёмки. В исходниках submit не переводит задачу в done — это существующая защита, которую проверяет `QA-07-01`.

### QA-01-R01 — P0: тесты могут использовать общую локальную БД

**Источник:** `apps/api/test/setup-integration.ts` при отсутствии переменных использует `postgresql://.../orion`; `scripts/e2e-db.mjs` сбрасывает целевую БД целиком. Поэтому в `qa-local.mjs` разрешены только явные тестовые `orion_qa_*` и обязательное `--confirm-reset`.

**Оператору:** никогда не запускать integration с дефолтной базой `orion`, не применять QA runner на удалённую БД, не сохранять реальные учётные данные в отчёте.

## Локальный запуск для Sol и Qoder

Требуется рабочая копия репозитория на целевом beta37/QA-commit, Node.js версии, совместимой с CI (там Node 24), pnpm 9.12, `corepack`, выделенный PostgreSQL 16 на локальном хосте, установленный Playwright Chromium.

**Быстрый запуск без базы, браузера и инсталлятора:**

```powershell
corepack pnpm install --frozen-lockfile
node scripts/qa-local.mjs --only=static,architecture,unit,build
```

**Полный прогон (PowerShell; примеры строк подключения — только при уже поднятом локальном тестовом сервере PostgreSQL):**

```powershell
$env:DATABASE_URL = "postgresql://QA_ADMIN:LOCAL_PASSWORD@127.0.0.1:5433/orion"
$env:APP_DATABASE_URL = "postgresql://QA_APP:LOCAL_PASSWORD@127.0.0.1:5433/orion"
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
corepack pnpm exec playwright install chromium
node scripts/qa-local.mjs --db-name=orion_qa_gpt --confirm-reset=orion_qa_gpt
```

Это **примеры**: должны использоваться настоящие локальные роли и пароли только тестовой среды (предварительно создать роли и убедиться, что права не выходят за пределы разрешённого тестового кластера). `e2e-db.mjs` сбрасывает БД с именем `orion_qa_gpt`, если она существует. Подключение администратора указывает на отдельную базу `orion` только для управления кластером; сами тесты направляются в `orion_qa_gpt`. При отсутствии корректной конфигурации DB-этапы получат BLOCKED, не PASS.

**Отчёты:** `tmp/qa-reports/<UTC timestamp>/summary.md`, `summary.json`, отдельные `.log` каждого шага. Коды завершения: `0` — все выбранные этапы PASS; `1` — хотя бы один FAIL; `2` — BLOCKED без FAIL. Невыбранные этапы всегда NOT_RUN.

Запуск `unit` включает все новые RED-контракты. Ожидаемый красный результат на beta37 не является «ошибкой теста»: нужно зафиксировать fail trace и передать соответствующему исполнителю. **Не исключать тест и не менять ожидание под ошибку.** На текущем SHA программа / тесты ещё не проверены исполнением.

## CI после восстановления лимитов

Не продолжать держать долгий E2E в одном монолитном `quality` job:

1. `quality-fast`: typecheck, lint, architecture, registry/contract и unit; без Playwright и без внешней БД.
2. `integration-postgres`: отдельный PostgreSQL 16 service, миграции и интеграционные тесты; отдельный timeout и артефакты.
3. `browser-e2e`: отдельная job с `needs: [quality-fast, integration-postgres]` **или** изначально по `workflow_dispatch` / ночному расписанию, с отдельным timeout и загрузкой Playwright traces.
4. `build`: отдельная job, не зависящая от браузерного шага; Windows установщик — отдельный запуск Windows runner, если понадобится.
5. Артефакты отчётов загружать при `always()`. Не ставить `continue-on-error: true` на требуемые проверки и не маскировать ненулевой exit code через `|| true`.

Браузерная job может быть негейтинговой для быстрых PR только **по явно принятой политике**: её статус должен оставаться видимым `NOT_RUN`/`BLOCKED`, а не подменяться `PASS`.

## Обязательные дополнения следующего захода

- QA-02: перепроверить одинаковые запреты удаления во всех MCP/API/UI; permission matrix по `owner/lead/member`, expires/revoked и запрет подмены `workspaceId` (часть уже в существующих файлах).
- QA-03: scoped delete `one/following/all` событий и связь с исключениями recurrence; групповые операции и rollback после отказа.
- QA-04: приёмка четырёх квадрантов через API и E2E DnD после ввода самостоятельных полей; частичные отказы multi-select.
- QA-05: импорт и повторная запись внешних XLSX/DOCX более сложной структуры, формулы и несвязанные стили, конкретный список unsupported.
- QA-06: различать зарегистрированную runtime-сессию и реальный OS-процесс; ручная/автоматическая re-lease политика, self-review denial.
- QA-07: фактическое связывание задач с репозиторием, evidence commit SHA и независимое approve/rework с журналом причин.
- QA-08: проверить две реальные машины и прерывания WebDAV/backup restore. Нынешние два клиента `ReplicaEngine` — **логическое моделирование**, не пара физических Windows машин.

## Правила передачи Sol

**Решение до запуска:** независимую приёмку beta37 НЕ выдавать за PASS; статус всего QA-пакета — **BLOCKED/NOT_RUN по исполнению, FAIL по четырём статическим контрактам**. Sol получает draft PR, исправляет production-код только через отдельные CORE/UI задания, запускает проверку на реальной локальной среде и прикладывает исходные логи, ссылки на проверенный commit, воспроизведение и честный вердикт каждого направления. Только после этого возможен merge.
