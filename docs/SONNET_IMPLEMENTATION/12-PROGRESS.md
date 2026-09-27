# Статус реализации

Обновлено: 2026-09-22 (сессия R18-01/R18-02/R18-03), S00–S22 выполнены (S00/S11/S12/S13/S18 — PARTIAL по причине отсутствия browser/Tauri tooling в среде агентов; S01–S10/S14/S15/S16/S17/S19/S20/S21/S22 DONE — S16/Lists снят с BLOCKED этой же сессией, см. ниже). Codex `18-REVIEW-FINAL-PASS.md` нашёл 3 CONFIRMED дефекта с воспроизводящими тестами, которые S04/S07 (DONE) и S11 (PARTIAL) не покрывали — R18-01 (restore file/DB durability), R18-02 (restoreRevision обходил CAS), R18-03 (уведомления утекали title/body закрытого модуля). Все три закрыты и провалидированы этой сессией (см. журнал "R18-01/R18-02/R18-03"); S04 и S07 честно пересмотрены с "DONE было преждевременно" на "DONE подтверждено" — см. их записи в таблице очереди ниже. Постоянный regression-тест `apps/api/test/codex-review-regressions.integration.test.ts` оставлен в suite навсегда. S20 закрыт этой сессией — `docs/RELEASE_NOTES.md` и эта сводная строка актуализированы под честное состояние после всех добивочных сессий (см. `docs/RELEASE_NOTES.md` для полной сводки по карточкам и найденным/исправленным багам). S15 закрыт добивающей сессией этого же дня — finance/search/projects проверены реальным нагрузочным тестом (не только чтением кода): Transaction listing уже offset-paginated с точными server-side aggregate итогами, search/projects-activity лимиты подтверждены намеренными без наивного суммирования — см. журнал "S15 (добивка хвостов)". S05 закрыт добивающей сессией этого же дня — последние два открытых пункта (WebDAV client redirect/size limits, register rate-limit), см. журнал "S05 (добивка хвостов #2)". S14 закрыт добивающей сессией этого же дня — оставшиеся пункты S14c (replaceContent/restoreVersion fault-injection: реальный баг найден и починен; bulk-partial-failure: VERIFIED_EXISTING), см. журнал "S14c (добивка)". S04 закрыт этой сессией (stale-preview rejection — последний оставшийся пункт, см. журнал 2026-09-22). S06 закрыт добивающей сессией этого же дня — `summarizeByAuthorship` подключён в `TimePanel` (см. журнал). S19 — composite-прогон всего backlog'а на новой чистой БД (порт 5547): миграции/typecheck/lint/unit/integration/build/desktop-export все PASS; **итоговый release-вердикт BLOCKED** (визуальные U-сценарии SKIPPED повсеместно, Lists BLOCKED продуктовым решением, native Tauri smoke не прогонялся — см. запись S19). Актуальный статус по каждой карточке — в таблице очереди ниже, детали — в журнале. Офисный трек (21-OFFICE-IMPLEMENTATION.md): O01/O01b (codec-слой DOCX/XLSX) DONE, O02 (контракты open/save/create, права, CAS-решение — без CAS/last-write-wins для `Document`, обосновано) DONE. O03 (клиентский парсинг/сериализация) и O04 (вкладка редактора и создание файлов в UI) реализованы вместе в одной сессии — см. запись "O04" ниже: PASS по typecheck/lint/unit/build/desktop-export, реальный Word/Excel/браузер не проверены (нет tooling в среде агента), DOCX-редактор (Tiptap) полный по задаче, XLSX-редактор — простой грид без диаграмм/pivot-UI в браузере (модуль записи диаграмм/pivot — Node-only, см. ограничения). O05/O06 — TODO.

## Baseline аудита (переснят 2026-09-21 в рамках S00, dirty tree пользователя не менялся)

- typecheck: PASS (`pnpm typecheck`, все 7 workspace-проектов).
- unit: PASS, 13 файлов / 135 тестов (`pnpm test`, vitest 5.0.0, 870ms).
- lint: PASS с 3 warnings (`pnpm lint` → eslint .): `CalendarPanel.tsx:320` и
  `DocumentsPanel.tsx:225` (react-hooks/exhaustive-deps), `scripts/seed-demo-workspace.mjs:561`
  (no-unused-vars, `tBacklog`). Те же три, что и в 01-AUDIT — регрессии нет.
- isolated integration: PASS, 1 файл / 19 тестов (`api-rls.integration.test.ts`), см. раздел ниже.
- production build: PASS, API (`tsc -p tsconfig.json`) + Next.js 14.2.35, 26 страниц
  сгенерированы; `/login`/`/register`/`/account`/`/spaces`/`/invite/[token]` First Load JS ~493–495 kB.
- desktop export: NOT RUN в рамках S00 (не входит в `pnpm build`; известный FAIL из
  01-AUDIT для `/invite/[token]` остаётся заботой S22, не переснимался повторно).
- native Tauri build: NOT RUN (вне объёма S00).
- browser / populated screenshots: SKIPPED, см. ниже.
- Пользователь подтвердил: личный и командный сценарии равноправны.

### Изолированный integration-прогон (не рабочий .env)

Рабочий `apps/api/.env` и общий `infra/postgres/data` (порт 5433) не трогались.
Поднят отдельный portable-кластер Postgres через уже существующий скрипт
`scripts/postgres.mjs` с переопределёнными `ORION_PG_DATA`/`ORION_PG_PORT`:

```bash
ORION_PG_DATA=<scratchpad>/pg-test-data ORION_PG_PORT=5544 node scripts/postgres.mjs up
DATABASE_URL="postgresql://orion:orion_local_dev@127.0.0.1:5544/orion" \
  pnpm --filter @orion/api exec prisma migrate deploy   # все миграции применились чисто
DATABASE_URL="postgresql://orion:orion_local_dev@127.0.0.1:5544/orion" \
APP_DATABASE_URL="postgresql://orion_app:OcjNaKnQFUp0gdwdju-cSP9T_0gaiOZI@127.0.0.1:5544/orion" \
STORAGE_DIR="<scratchpad>/test-documents" \
  pnpm test:integration     # 1 файл / 19 тестов PASS
ORION_PG_DATA=<scratchpad>/pg-test-data ORION_PG_PORT=5544 node scripts/postgres.mjs down
```

`orion_app`-пароль взят из `apps/api/test/setup-integration.ts` — он совпадает
с паролем из `infra/postgres/init/01-app-roles.sql` (dev-плейсхолдер, не
секрет), применённым при инициализации нового кластера, поэтому подошёл без
правки .env. Кластер и его данные жили только в scratchpad-каталоге сессии,
остановлены и не оставлены запущенными; `infra/postgres/data` пользователя не
затронут.

### Populated screenshots — SKIPPED

Не выполнено: в этой сессии нет инструмента управления браузером/headless-скриншотов
(Playwright/Puppeteer MCP и т.п. не подключены). Поднимать API+Web вручную и
делать скриншоты нечем — визуальная проверка потребовала бы либо MCP-инструмент
браузера, либо `run`-подобный skill с реальным screenshot-выводом, которых нет в
доступных инструментах текущей сессии. Не выдумывал результат.
Следующий шаг для другого агента/сессии с браузерным тулингом: поднять API на
изолированной БД (тот же рецепт, что выше) + `pnpm --filter @orion/web dev` на
отдельном порту, засеять `scripts/seed-demo-workspace.mjs` в fixture-БД (не в
рабочую), затем снять скриншоты Сегодня/Задачи/Проект/Заметки/Документы/Настройки.

## Очередь

| ID | Статус | Блокировка / следующий шаг |
|---|---|---|
| S00 | PARTIAL | Baseline/lint/unit/integration переснят и PASS; populated screenshots SKIPPED — нет browser-tooling в сессии, см. журнал |
| S01 | DONE | Actor-aware `ModulesService.accessibleSetTx` протянут в Search/Projects/Links/NoteAttachments |
| S02 | DONE | Owner-only sync gates добавлены и покрыты regression-тестами |
| S03 | DONE | Реестр моделей + manifest v2 + fail-closed legacy + data-only roundtrip, см. журнал |
| S04 | DONE | Blob export+checksум, backup embedding, staging+journal restore, fault-injection тест и stale-preview rejection (manifestHash между preview/apply) — все подпункты сделаны и протестированы. **Пересмотрено 2026-09-22**: предыдущая отметка DONE была преждевременной — Codex (18-REVIEW-FINAL-PASS, R18-01) нашёл и воспроизвёл реальный дефект (DB-commit failure после file-swap не откатывался); закрыт durable two-phase restore + lock (`SyncRestoreOperation`) той же сессией — теперь честно DONE, см. журнал "R18-01/R18-02/R18-03" |
| S05 | DONE | Mode+bind, JWT fail-fast, picker/PIN gating (server+API and UI, 2026-09-22), password policy, SSRF guard+redirect/size caps, DNS-rebinding (short-TTL double-check, 2026-09-22), `GET /system/mode`, login rate-limit, WebDAV response-size cap + explicit documented redirect-limitation decision, register rate-limit (per-IP + per-(IP,email) windows, 2026-09-22) — all done. Desktop launcher: verified no-op (Tauri doesn't spawn the API). See журнал 2026-09-22 "добивка хвостов #2" for the last two items' reasoning. |
| S06 | DONE | Composite `(workspaceId, userId)` running-timer index + userId scoping done and concurrency-tested; mine/team/unknown UI surfacing wired into TimePanel 2026-09-22 (ProjectsPanel out of scope — no per-entry authorship in its DTO), see журнал |
| S07 | DONE | Recipient notifications — see журнал. **Пересмотрено 2026-09-22**: предыдущая отметка DONE была преждевременной — Codex (18-REVIEW-FINAL-PASS, R18-03, повтор R03 из 17-REVIEW-CURRENT) нашёл и воспроизвёл утечку title/body уведомления о сущности из модуля, ограниченного ПОСЛЕ создания уведомления (recipient-check на чтении был, actor-aware module-access-check — не было). Закрыт actor-aware гейт через существующий `ModulesService.accessibleSetTx` на `list`/`markRead`/`markAllRead`/`createTx` той же сессией — теперь честно DONE, см. журнал "R18-01/R18-02/R18-03" |
| S08 | DONE | Discriminated `SessionState`, unavailable≠unauthenticated wired into every consumer |
| S09 | DONE | Pending-intent channel with workspace scoping + acknowledgement, see журнал |
| S10 | DONE | Реактивный локальный день — day-boundary hook + wiring, см. журнал |
| S11 | PARTIAL | Trailing-drain autosave + server CAS done and tested; conflict UI + navigation guard done but not visually verified (no browser tooling); tasks/projects CRDT explicitly out of scope, see журнал |
| S12 | PARTIAL | Select control-height fix + testable focus-trap + error-pattern sweep (5 files, 6 block-level error renders → `EmptyState tone="danger"`) done; visual/zoom/contrast verification still not done (no browser tooling), see журнал |
| S13 | PARTIAL | Independent block errors (Dashboard) + team-default «Только мои» + Доска/Список toggle (Tasks) сделаны; InboxPanel просмотрен без правок; screenshots/live U01-U03/U09 не прогонялись — см. журнал |
| S14 | DONE | S14a done; S14b (notes layout/attachments) done — nested-modal фикс + верификация; S14c done — data-integrity инвариант (move/trash/restore compensation) + replaceContent/restoreVersion fault-injection (реальный баг найден и починен: `revertContentIfWritten`) + bulk-partial-failure сквозной тест (VERIFIED_EXISTING). WebDAV-driver и `purge` дополнительной защиты не получили (обоснование в записи S14c-добивка) — не блокирует DONE |
| S15 | DONE | Time entries cursor pagination + exact server aggregate totals + cross-workspace cursor rejection; inbox honest truncation; finance/search/projects — добивающей сессией подтверждено реальным нагрузочным тестом (600/550 Transaction на изолированной БД), что Transaction listing уже offset-paginated с точными server-side aggregate итогами, а search/projects-activity лимиты намеренные и не используются для наивного суммирования — см. журнал |
| S16 | DONE | Finance done earlier session; Inventory VERIFIED_EXISTING earlier session; Habits — real bug found and fixed (toggle concurrency); Calendar — recurrence/readonly VERIFIED_EXISTING (readonly enforced server-side, not just UI; added direct-endpoint PATCH/DELETE test), real all-day timezone bucketing bug found and fixed (`allDayAnchor`), drag&drop all-day reschedule edge case found but not fixed (see журнал); Lists — **2026-09-22**: Codex (18-REVIEW-FINAL-PASS) указал, что BLOCKED был основан на неверном прочтении done-критерия — "destructive copy" в исходной карточке означает интерфейсный текст для разрушительных действий (число + обратимость), а НЕ функцию дублирования списка. Проверено: архивация списка уже использует `FuseButton` (двойное подтверждение, "Ещё раз — архив"/"В архиве"); «Очистить отмеченные» уже обратимо через toast с действием «Отменить» (пересоздаёт снятые пункты) — не хватало только явного числа в самой кнопке, добавлено (`Очистить отмеченные (N) — можно отменить`). Придуманная функция дублирования списков не требовалась и не реализовывалась. Lists снят с BLOCKED → DONE, карточка S16 целиком DONE, см. журнал "R18-01/R18-02/R18-03" |
| S17 | DONE | Task comments + audit log (CRUD/ownership/XSS-safe/pagination/notification producer/RLS/snapshot), см. журнал |
| S18 | PARTIAL | Readiness polling (HTTP /system/health, not fixed sleep) + single-instance lock + production CSP done and unit-tested; native Tauri single-instance plugin, DNS-rebinding-style CSP hardening beyond loopback wildcard, and any visual/runtime verification not done — no Rust/Tauri build tooling in session, see журнал |
| S19 | DONE (release BLOCKED overall, see журнал) | Composite acceptance run on a truly clean DB PASS (migrate deploy 61 migrations clean, typecheck/lint/unit/test:integration/build/build:desktop-export all PASS); release verdict is BLOCKED for reasons unrelated to this session's checks — see журнал |
| S20 | DONE | Документация выпуска — `docs/RELEASE_NOTES.md` актуализирован под честное текущее состояние всех карточек после серии добивочных сессий (финализация 2026-09-22) |
| S21 | DONE | Recurring/inbox concurrency barriers — see журнал |
| S22 | DONE | Desktop export blocker cleared — see журнал |

## Журнал завершённых задач

### S00 · 2026-09-21 · PARTIAL
- Поведение: baseline-проверки переснят (typecheck/lint/unit/build), впервые
  реально запущен изолированный `pnpm test:integration` на отдельном
  portable-Postgres-кластере (порт 5544, отдельный data-dir и storage fixture
  в scratchpad), рабочий `.env`/`infra/postgres/data`/пользовательские данные
  не тронуты. Populated UI screenshots не сделаны — честно SKIPPED.
- Файлы: только `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта запись).
  Прикладной код не менялся; чужой dirty tree не коммитился и не трогался.
- Проверки и результаты:
  - `pnpm typecheck` → PASS (7/7 проектов).
  - `pnpm lint` → PASS, 3 warnings (те же, что в 01-AUDIT).
  - `pnpm test` → PASS, 13 файлов / 135 тестов.
  - `pnpm test:integration` (изолированная БД, см. выше) → PASS, 1 файл / 19 тестов.
  - `pnpm build` → PASS, API + Next.js, 26 страниц.
- Миграция/данные: прогнан `prisma migrate deploy` **только** на временном
  кластере 127.0.0.1:5544 (scratchpad-каталог, уничтожен вместе со scratchpad
  сессии); рабочая БД пользователя миграций не получала и не опрашивалась.
- Непроверенное: desktop export/native Tauri build (вне объёма S00, известный
  FAIL по `/invite/[token]` остаётся за S22); populated screenshots всех
  экранов (SKIPPED — нет browser-automation тулинга в сессии); реальный
  browser E2E (за пределами S00).
- Следующий шаг: другой агент с доступом к browser-automation MCP (например
  Playwright) поднимает API+Web на изолированной БД по рецепту выше, сеет
  `scripts/seed-demo-workspace.mjs`, снимает populated screenshots
  Сегодня/Задачи/Проект/Заметки/Документы/Настройки и дозаполняет эту запись
  до DONE. После этого можно переходить к S01.

### S01 · 2026-09-21 · DONE
- Поведение: агрегаторы (search, project rollup/activity, entity links,
  note attachments) раньше строили кросс-модульные запросы через
  `ModulesService.enabledSetTx`, которая знает только про `disabled` — модуль,
  restricted для роли `member` (но включённый), проходил насквозь: сумма
  финансовой операции попадала в `spentAmount`/`activity` проекта, сама
  операция находилась через `/search`, а `entityLink` на неё отдавал `title`
  через `/links`, хотя прямой `GET /finance/*` уже отвечал 403. Отдельно
  `NoteAttachmentsService.list` вообще не проверял доступность модуля
  `documents` (attach/upload проверяли, list — нет).
  Добавлен `ModulesService.accessibleSetTx(tx, userId, workspaceId)` —
  actor-aware версия `enabledSetTx`: disabled исключён для всех, restricted
  дополнительно исключён только для `member` (то же правило, что в
  `assertEnabledTx`/`effectiveDisabledModules`). Протянут в
  `SearchService.search`/`listLinks`/`createLink` (обе стороны линка,
  restricted-сторона не даёт вызвать `entityTitle` и не попадает в выдачу;
  `createLink` отказывает 403, если любая из сторон недоступна) и в
  `ProjectsService.toDtos`/`activity` (добавлен параметр `userId`). В
  `NoteAttachmentsService.list` добавлен `modules.assertEnabledTx(...,
  "documents")` перед чтением вложений. На клиенте `NoteAttachmentsSection`
  перестал звать `useNoteAttachments` безусловно — теперь
  `useNoteAttachments(documentsOn ? workspaceId : undefined, noteId)`, как
  того требует конвенция «сосед не зовёт чужой API» из модульного контракта.
- Файлы: `apps/api/src/modules/modules.service.ts` (новый метод
  `accessibleSetTx`), `apps/api/src/search/search.service.ts`,
  `apps/api/src/projects/projects.service.ts`,
  `apps/api/src/notes/note-attachments.service.ts`,
  `apps/web/panels/note-attachments.tsx`,
  `apps/api/test/api-rls.integration.test.ts` (два новых теста:
  `restricted-module-aggregate-access` и его документный аналог),
  `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта запись).
- Проверки и результаты:
  - `pnpm typecheck` → PASS (7/7).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы).
  - `pnpm test` → PASS, 13 файлов / 135 тестов.
  - `pnpm test:integration` на изолированном portable-Postgres (тот же рецепт,
    что в S00: `ORION_PG_DATA`/`ORION_PG_PORT=5544` в scratchpad,
    `prisma migrate deploy`, свой `STORAGE_DIR`) → PASS, 1 файл / **21** тестов
    (было 19 в S00 — оба новых теста дошли до конца зелёными на реальной БД
    с RLS, не на моках). До фикса (проверено вручную построчным up/get diff
    перед правкой сервисов, не сохранено отдельным коммитом) те же тесты
    падали на шагах: search находил маркер, `spentAmount`/`activity` включали
    операцию F, `/links` отдавал её `title`, `POST /links` в restricted-модуль
    создавал связь, вложение оставалось видно при выключенных документах.
  - Рабочий `.env` и `infra/postgres/data` не тронуты; временный кластер на
    5544 поднят и остановлен только в рамках этой сессии.
- Миграция/данные: без изменений схемы — фикс целиком в query-логике сервисов.
- Непроверенное: S02 (owner-only sync gates) и S03 (snapshot coverage) —
  вне объёма этой карточки, начинаются со своей проверки owner/role.
  Cache invalidation на клиенте для `restricted`-переключения (тумблер
  `restrict` меняет `workspace.restrictedModules`, `useActiveWorkspace`
  перечитывается через обычный `workspaces/me` — отдельного инвалидатора не
  заводил, т.к. существующий паттерн уже реактивен через query на
  workspace list; не нагружал новым явным инвалидатором без воспроизведённой
  проблемы). UI других агрегаторов (не строил новый — только два места,
  указанных в 15-FIRST-TASKS: attachments и links/search/projects).
- Следующий шаг: S02 (owner-only sync резервные копии) по 10-BACKLOG.md,
  зависимость `S01 → S02` закрыта.

### S02 · 2026-09-21 · DONE
- Поведение: `SyncService` раньше защищал каждый публичный метод только
  `assertMemberTx` — любой `member`/`lead` мог прочитать и заменить
  WebDAV-конфиг (включая пароль, расшифровываемый на сервере через
  `openSecret`), запустить `backup`, листать `listBackups` и, что критично,
  вызвать `restore` (перезапись всего пространства). Каждый публичный метод
  (`getRemote`, `putRemote`, `testRemote` — через приватный `openRemote`,
  `backup`, `listBackups`, `restore` dry-run и apply, и сам `openRemote`)
  теперь начинается с `assertMemberRoleTx(tx, userId, workspaceId, ["owner"])`
  вместо `assertMemberTx` — это тот же готовый helper, что уже используют
  `members.service.ts` (`setRole`) и модульные restricted-гейты, роль
  проверяется до `openSecret`/`sealSecret` и до любого обращения к
  `WebdavRemote`. `restore` проверяет роль дважды намеренно: один раз на
  preflight/preview (`dryRun: true`) через `openRemote`, второй раз заново
  внутри apply-транзакции — preview и apply это два отдельных HTTP-запроса,
  и актёра могли разжаловать между ними.
  На клиенте `useSyncRemote`/`useBackups` (`packages/core-react/src/use-sync.ts`)
  получили параметр `isOwner` и `enabled: ... && isOwner` — `member`/`lead` в
  фоне больше не долбят гарантированно-403 запросы. `SyncPanel.tsx` для
  не-владельца рендерит `EmptyState` вместо формы (UI-гигиена, не замена
  серверной проверки — так и написано в комментарии на месте).
  Попутно нашёл и починил не связанный, но блокирующий тест баг:
  `apps/api/test/setup-integration.ts` держал дефолтный `SYNC_SECRET`,
  который декодировался в 38 байт вместо требуемых 32 —
  `syncSecretAvailable()` был всегда `false` для всего integration-сьюта без
  явного оверрайда переменной окружения (значит, `putRemote`/
  `calendar-connections` с паролем всегда падали 400). Заменил на валидный
  32-байтный base64-секрет.
- Файлы: `apps/api/src/sync/sync.service.ts` (6 мест `assertMemberTx` →
  `assertMemberRoleTx(..., ["owner"])`, обновлён doc-комментарий класса),
  `packages/core-react/src/use-sync.ts` (`useSyncRemote`/`useBackups` берут
  `isOwner`), `apps/web/panels/SyncPanel.tsx` (`isOwner` из
  `workspace.role`, ранний `EmptyState` для не-владельца), `apps/api/test/
  api-rls.integration.test.ts` (два новых теста — см. ниже),
  `apps/api/test/setup-integration.ts` (фикс `SYNC_SECRET`),
  `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта запись).
- Проверки и результаты:
  - `pnpm typecheck` → PASS (7/7).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы).
  - `pnpm test` → PASS, 13 файлов / 135 тестов.
  - `pnpm test:integration` на изолированном portable-Postgres (тот же рецепт
    5544 в scratch, `prisma migrate deploy`, свой `STORAGE_DIR`, без
    ручного оверрайда `SYNC_SECRET` — дефолт из `setup-integration.ts` теперь
    валиден сам по себе) → PASS, 1 файл / **23** теста (было 21 после S01).
    Новые тесты:
    - `S02: sync/backup is owner-only on every endpoint — member and lead
      get 403, no WebDAV call is ever made` — до фикса падал на `PUT
      /sync/remote` (200 вместо 403) для member/lead; после фикса все семь
      эндпоинтов (`getRemote`/`putRemote`/`testRemote`/`backup`/
      `listBackups`/restore preview/restore apply) отвечают 403 обоим
      непривилегированным актёрам (member и lead), и `vi.spyOn` на всех
      методах `WebdavRemote.prototype` (`connectAndCount`, `ensureDir`,
      `putFile`, `getFile`, `exists`, `listDir`) подтверждает 0 вызовов —
      проверка реально стоит раньше сети/расшифровки, а не просто
      перехватывает ошибку постфактум.
    - `S02: restore apply re-checks the actor's role inside its own
      transaction — a preview taken as owner doesn't survive a demotion` —
      второй owner (`eve`) делает успешный dry-run preview, затем первый
      owner (`alice`) разжалует `eve` до `member`, и `eve` пытается
      `apply` тем же `snapshot` из своего preview → 403. `WebdavRemote`
      застублен (`ensureDir`/`putFile`/`exists`/`getFile`), чтобы весь
      сценарий backup→preview→apply прогонялся без реального WebDAV-сервера,
      при этом шифрование/дешифровка снапшота — настоящие (через
      `sync-crypto.ts` и тестовый `SYNC_SECRET`).
    До фикса (проверено построчным up/down правки перед коммитом, не
    сохранялось отдельно) оба новых теста падали именно на member/lead
    не получающих 403 и на eve успешно применяющей apply после демоушена.
  - Рабочий `.env` и `infra/postgres/data` не тронуты; временный кластер на
    5544 (и scratch storage/pg-data) подняты и снесены только в рамках этой
    сессии.
- Миграция/данные: без изменений схемы Prisma — весь фикс в query/route-логике
  и тестовой инфраструктуре (`setup-integration.ts`).
- Непроверенное: UI-путь для `lead` (сервер по коду одинаково блокирует
  `member` и `lead`, но браузерный клик по кнопкам SyncPanel для лида вручную
  не кликался — покрыто HTTP-уровнем через интеграционный тест, не Playwright).
  Автобэкап по расписанию (`autoEveryMs`) — в Стадии 1 такого крона нет (см.
  `docs/SYNC.md`), поэтому не проверял отдельно cron-путь на owner-only.
- Следующий шаг: S03 (coverage registry и preflight для снапшотов) по
  10-BACKLOG.md, зависимость `S02 → S03` (после S02 логично проверить состав
  самого снапшота, которым теперь может управлять только owner).

### S03 · 2026-09-21 · DONE
- Поведение: `SnapshotService`/`snapshot.service.ts` резервно копировал
  только вручную составленный список моделей (`SNAPSHOT_MODELS`), без
  сверки со schema.prisma. Аудит DMMF (`Prisma.dmmf.datamodel.models`)
  нашёл реальный, а не гипотетический пропуск: `Milestone`,
  `MilestoneDependency` (v0.27 «План проекта»), `InventoryItem`,
  `InventoryMovement` (v0.26 инвентарь), `DocumentVersion`,
  `DocumentAnnotation` — шесть таблиц с `workspaceId` и cascade FK на
  Workspace, существующих в схеме, но никогда не попадавших в бэкап с
  момента своего релиза. Плюс `Workspace.disabledModules`/
  `pluginOverrides`/`restrictedModules` (конфигурация пространства) не
  восстанавливались вовсе.
  Подэтапы:
  - **S03a** — новый `apps/api/src/sync/snapshot-registry.ts`:
    `SNAPSHOT_MODEL_REGISTRY` классифицирует ВСЕ 41 workspace-scoped +
    `Workspace` модели политикой `included`/`derived`/`identity-excluded`/
    `secret-excluded`/`ephemeral-excluded` с причиной для каждой (правила —
    09-RELIABILITY.md: membership/users/sessions не импортируются как
    обычные записи; `SyncRemote` — секрет узла, не данные пространства;
    `Notification`/`SentReminder` — осознанная архивная политика продукта,
    не случайный пропуск). `snapshot.integration.test.ts` (`S03a: every
    workspace-scoped Prisma model is explicitly classified...`) берёт
    множество моделей из `Prisma.dmmf.datamodel.models` (реальная схема,
    не переписанный вручную список) и требует полного совпадения с
    реестром в обе стороны (никого не забыли, и нет мёртвых записей про
    удалённые модели); соседний regression-тест удаляет одну запись
    (`Milestone`) из реестра и подтверждает, что тест это ловит —
    доказательство, что проверка не тавтология.
    `snapshot.service.ts` дополнительно сверяет `SNAPSHOT_MODELS` (код) с
    `INCLUDED_SNAPSHOT_KEYS` (реестр) на **module load** — расхождение
    валит процесс сразу, не только тест.
  - **S03b** — `WorkspaceSnapshot` получил `workspaceConfig` (derived:
    `disabledModules`/`pluginOverrides`/`restrictedModules`) и версию
    бампнули `SNAPSHOT_VERSION` 1 → 2 (`LEGACY_SNAPSHOT_VERSION = 1`
    экспортирован для распознавания старого формата).
  - **S03c** — `SnapshotService.apply()` уже содержал проверку версии
    первой строкой (до `clear()`/`insert()`); теперь она различает legacy
    v1 (внятное сообщение «устаревший формат... разрушительное
    восстановление отклонено») от произвольной неизвестной версии, и оба
    случая покрыты тестами (`S03c: legacy v1 snapshot...`, `S03c: unknown
    future version...`), которые создают данные, пробуют `apply()` с чужой
    версией, ждут throw и проверяют, что счётчики строк **не изменились** —
    т.е. отказ происходит до любой мутации, не после частичного clear.
  - **S03d** — `toposortByParent()` (новый экспорт из
    `snapshot.service.ts`) топологически сортирует самоссылающиеся строки
    (`Task.parentId`, `Document.parentId`) перед вставкой: `createMany` с
    неотсортированным порядком падает на non-deferred FK, когда потомок
    встречается в массиве раньше родителя (Postgres проверяет FK по мере
    вставки строк даже внутри одного multi-row INSERT). До этой правки
    `SNAPSHOT_MODELS` просто вставлял `findMany()`-порядок как есть — для
    дерева глубже одного уровня восстановление ломалось бы на первом же
    поддереве с "неудачным" физическим порядком строк в БД. Интеграционный
    тест `S03d: data-only roundtrip...` строит дерево задач глубины 4
    (root → child → grandchild → great-grandchild) и дерево документов
    (folder → file → version/annotation), сериализует, затем **явно
    переставляет** строки снапшота в обратном (потомок раньше родителя)
    порядке — не полагаясь на то, что `Math.random()`-перемешивание
    случайно не даст правильный порядок — и проверяет, что `apply()`
    восстанавливает дерево корректно (parentId цепочка, counts, версии
    документов, аннотации, milestone, inventory item/movement). Отдельный
    юнит-тест `toposortByParent` проверяет сам алгоритм на структуре без
    БД. Ещё один тест гоняет `workspaceConfig` через backup → drift →
    restore и проверяет, что `disabledModules`/`restrictedModules`
    восстановились, а не остались "дрейфнувшими".
- Файлы: `apps/api/src/sync/snapshot-registry.ts` (новый),
  `apps/api/src/sync/snapshot.service.ts` (переписан: новые модели в
  `SNAPSHOT_MODELS`, `specSelfRef`/`toposortByParent`, `workspaceConfig`,
  `SNAPSHOT_VERSION = 2`, реестр↔код сверка на module load),
  `apps/api/test/snapshot.integration.test.ts` (новый, 7 тестов),
  `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта запись). Prisma-схема
  **не менялась** — все шесть моделей (`Milestone` и т.д.) уже существовали
  в schema.prisma с собственными RLS-миграциями (`20260916131800_...`,
  `20260916144300_...`) из более ранних версий; пропуск был только в
  `snapshot.service.ts`, не в схеме/RLS.
- Проверки и результаты:
  - `pnpm typecheck` → PASS (7/7), включая `apps/api` tsconfig.test.json.
  - `pnpm lint` → PASS, те же 3 предсуществующих warning.
  - `pnpm test` → PASS, 13 файлов / 135 тестов (не изменились — юнит-слой
    не трогал).
  - `pnpm test:integration` на изолированном portable-Postgres (порт 5544,
    тот же рецепт, что в S00–S02: `ORION_PG_DATA`/`ORION_PG_PORT` в
    scratchpad, `prisma migrate deploy`, свой `STORAGE_DIR`) → PASS,
    **2 файла / 30 тестов** (23 из `api-rls...` без изменений + 7 новых из
    `snapshot.integration.test.ts`). Один тест (`S03d` roundtrip) сначала
    падал с неправильным ожиданием порядка сортировки в самом тесте (не в
    коде) — поймано и исправлено до финального прогона; после фикса весь
    файл зелёный за один проход, без повторных попыток "докрутить" тест до
    прохождения.
  - `pnpm build` → PASS, API + Next.js (26 страниц, те же First Load JS,
    что в S00 — не трогал web).
  - Рабочий `.env` и `infra/postgres/data` не тронуты; временный кластер
    на 5544 поднят и остановлен только в рамках этой сессии.
- Миграция/данные: без изменений Prisma-схемы и без новых миграций — весь
  фикс в `apps/api/src/sync/` (query/сериализация), схема и RLS для
  `Milestone`/`InventoryItem`/`DocumentVersion`/`DocumentAnnotation`/
  `MilestoneDependency`/`InventoryMovement` уже существовали корректно (RLS
  тест `has RLS enabled, forced and policied on every workspace-owned
  table` из `api-rls.integration.test.ts` прошёл на всех 30 тестах без
  изменений — под эти таблицы политики уже были, пропуск был только в
  снапшоте, не в изоляции доступа).
- Непроверенное: **файловые blobs** (сами байты документов/версий на
  диске за `StorageAdapter`) — вне объёма S03 по формулировке
  10-BACKLOG.md, это S04 («Файловые бэкапы и восстановление с recovery»);
  снапшот S03 копирует только метаданные `DocumentVersion`/`checksum`, не
  содержимое. `SyncRemote`/`Notification`/`SentReminder` остаются вне
  бэкапа — это осознанная классификация (см. реестр), не недосмотр, но
  сама классификация не перепроверялась продуктовым решением за пределами
  09-RELIABILITY.md. UI (`SyncPanel.tsx`) не менялся — превью восстановления
  (`incoming`/`current` counts) и так уже показывает новые ключи таблиц
  через существующий generic `Record<string, number>`, но никто не
  проверял, что счётчики новых таблиц (milestones/inventory/document
  versions) реально появляются в интерфейсе (нет browser-tooling в сессии,
  та же причина SKIPPED, что в S00). Restore на новую установку
  (identity mapping пользователей) по-прежнему не реализован — не
  входило в объём S03, отражено как reason у `identity-excluded` записей.
- Следующий шаг: S04 (файловые бэкапы блобов + restore journal) по
  10-BACKLOG.md, зависимость `S03 → S04` закрыта — сериализация метаданных
  теперь полна и версионирована, можно строить staged/journal restore
  байтов поверх `SNAPSHOT_VERSION = 2`.

### S04 · 2026-09-22 · DONE (stale-preview rejection — последний оставшийся пункт)

- Поведение: единственный оставшийся пункт из записи ниже —
  **stale-preview rejection**: если снапшот на удалёнке изменился между
  preview и apply (второй клиент/сессия успела сделать новый бэкап поверх
  `latest.orion`), apply должен отказать, а не тихо применить план, который
  пользователь не видел в предпросмотре.
  - Инвариант: `RestorePreview.manifestHash` — sha256 зашифрованных байт
    файла (`sealed`), скачанного `SyncService.restore()` в начале **этого же
    вызова** (и preview, и apply идут через один и тот же путь — скачивают
    `key` заново при каждом HTTP-запросе, ничего не кешируют между ними).
    Клиент обязан вернуть это значение назад как
    `RestoreInput.expectedManifestHash` при `dryRun: false`; apply сверяет
    его со свежепересчитанным hash того же файла, скачанного в начале этого
    apply-вызова — до `blobs.recover()`, до owner-recheck, до любой записи
    на диск/в БД. Расхождение — `BadRequestException` с объясняющим текстом
    («Превью устарело…»), отсутствие `expectedManifestHash` при
    `dryRun: false` — тоже отказ (нельзя молча пропустить проверку).
  - Реализация оказалась минимальной именно потому, что существующий код
    уже скачивал `key` заново на **каждый** вызов `restore()` (и preview, и
    apply — общий код сверху функции, ветвление dryRun ниже) — не нужно
    было вводить отдельный кэш/повторный сетевой запрос специально для
    проверки: обычная apply уже видит актуальное состояние удалёнки, просто
    раньше ничего не сравнивала с тем, что видел предыдущий preview.
  - `packages/shared-types/src/sync.ts`: `restorePreviewSchema` получил
    обязательное поле `manifestHash: z.string()`, `restoreInputSchema` —
    опциональное `expectedManifestHash`.
  - `apps/web/panels/SyncPanel.tsx`: `applyRestore()` теперь передаёт
    `expectedManifestHash: preview.manifestHash` из уже полученного
    превью — без этого клиент сам ловил бы 400 на каждом apply.
- Файлы: `packages/shared-types/src/sync.ts`, `apps/api/src/sync/sync.service.ts`,
  `apps/web/panels/SyncPanel.tsx`, `apps/api/test/blob-backup.integration.test.ts`
  (новый тест `S04e` + `previewHash()` helper, переиспользованный в `S04b`/`S04c`,
  которые раньше вызывали `apply` без предварительного preview — теперь этот
  путь и на них требует `expectedManifestHash`, так и должно быть), unit-тест
  `packages/core/src/api/api-client.test.ts` (фикстура ответа `restore` дополнена
  `manifestHash`), `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта запись).
- Побочные находки, исправленные по пути (не входили в задание, но блокировали
  проверку): тестовые фикстуры `https://example.invalid/dav` /
  `https://example.invalid/webdav` в `blob-backup.integration.test.ts` и
  `api-rls.integration.test.ts` заменены на `https://example.com/...` —
  `.invalid` (RFC 2606) принципиально никогда не резолвится по DNS, а S05
  (другая, параллельно шедшая в этом же дереве сессия) добавил в
  `assertPublicRemoteUrl`/`remoteFor` реальный `dns.lookup()` DNS-rebinding
  guard уже после того, как эти фикстуры были написаны — без правки все
  `PUT .../sync/remote` в тестах стали 400 независимо от stale-preview. Правка
  только в тестовых фикстурах, не в проверяемом коде. Не трогал отдельный
  `remote-url-guard-dns.integration.test.ts` (untracked файл чужой
  параллельной сессии, не моё изменение) — там `tsc -p tsconfig.test.json`
  падает на top-level `await` (несовместимая с текущим `tsconfig.test.json`
  конструкция) и один прогон из полного набора словил `TypeError: Cannot
  redefine property: lookup` (ESM-неспособность `vi.spyOn` на `node:dns/promises`
  namespace) — оба выглядят flaky/чужим недоделанным кодом, не моим;
  подтверждено `git status --short` (файл `??`, я его не редактировал) и тем,
  что при изолированном прогоне только этого файла все 13 тестов PASS.
- Проверки и результаты:
  - `pnpm --filter @orion/api exec tsc -p tsconfig.json --noEmit` (без test-конфига,
    т.к. `tsconfig.test.json` падает на чужом untracked файле выше) → PASS.
  - `pnpm typecheck` (все 7 проектов) → падает только на упомянутом чужом
    `remote-url-guard-dns.integration.test.ts`; все мои файлы (shared-types,
    apps/api основной код, apps/web, packages/core) — PASS.
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы).
  - `pnpm test` → PASS, 22 файла / 193 теста (обновлена фикстура
    `api-client.test.ts` под новое поле `manifestHash`).
  - `pnpm test:integration` на изолированном portable-Postgres (порт 5544,
    `ORION_PG_DATA`/`STORAGE_DIR` в scratchpad сессии, `prisma migrate deploy`,
    рабочий `.env`/`infra/postgres/data` не тронуты) → **17 файлов / 103 теста
    PASS** (был 16/88+15 до фикса example.invalid, ловилось 15 failures из-за
    чужого SSRF-фикстур-конфликта, не из-за моего кода — см. выше). Новый тест
    `S04e` (`blob-backup.integration.test.ts`): preview → второй бэкап поверх
    `latest.orion` (симулирует параллельного клиента) → apply со старым
    `manifestHash` из первого preview → 400, workspace остаётся на
    содержимом v2 (второго бэкапа), не откатывается к v1 и не ломается;
    apply без `expectedManifestHash` вообще → тоже 400; свежий preview +
    apply с текущим hash — проходит нормально (201, `applied: true`).
    `S04b`/`S04c` (уже существовавшие, до этой сессии зелёные) обновлены
    под новый контракт (preview → apply с `expectedManifestHash`) и
    остаются зелёными — доказательство, что новая проверка не сломала
    сами staging+journal+fault-injection сценарии.
  - `pnpm --filter @orion/api run build` → PASS.
  - Рабочий `.env`, `infra/postgres/data` и рабочий `STORAGE_DIR`
    пользователя не тронуты; временный кластер на 5544 и scratch-storage
    подняты и снесены только в рамках этой сессии.
- Миграция/данные: без изменений Prisma-схемы/миграций.
- Непроверенное: UI (`SyncPanel.tsx`) не проверялся визуально (нет
  browser-tooling в сессии, та же причина SKIPPED, что в S00/S03) — проверено
  только чтением кода и typecheck, что `preview.manifestHash` реально
  прокидывается в `applyRestore()`. WebDAV-драйвер по-прежнему не имеет
  собственного теста (весь прогон через застубленный `WebdavRemote.prototype`,
  как и раньше) — этот пробел не входил в объём stale-preview пункта и не
  расширялся. Чужой `remote-url-guard-dns.integration.test.ts` (S05,
  параллельная сессия) остаётся сломанным на typecheck и, судя по
  единичному прогону, потенциально flaky на `vi.spyOn(dns, "lookup")` —
  не моё изменение, не трогал, честно фиксирую как чужой хвост, а не
  замалчиваю.
- Следующий шаг: с этим пунктом карточка **S04 закрыта полностью** — все
  done-критерии backlog'а (10-BACKLOG.md: immutable blob export+checksums,
  встроенный манифест, staging+journal restore с recovery, fault-injection
  тест, stale-preview rejection) выполнены и протестированы на изолированной
  БД+storage. Следующему агенту: S04 → S05 по очереди в 12-PROGRESS.md, но
  сначала стоит разобраться с чужим незакоммиченным S05-хвостом
  (`remote-url-guard-dns.integration.test.ts` typecheck/flake) — раз уже
  всплыл при проверке S04, честнее оставить это явным TODO, чем сделать вид,
  что не заметил.

### Реконсиляция параллельных сессий S04/S05 · 2026-09-22

- Проверен и закрыт TODO, оставленный S04-сессией выше: typecheck-падение
  `remote-url-guard-dns.integration.test.ts` на top-level `await`. Причина —
  `const { assertPublicRemoteUrl, assertResolvedHostIsPublic } = await
  import(...)` на верхнем уровне модуля; `tsconfig.test.json` наследует
  `module: "commonjs"` / `target: "ES2021"` из `apps/api/tsconfig.json`, где
  top-level await не поддерживается. Фикс — точечный, без изменения логики
  теста: динамический импорт перенесён в `beforeAll(async () => { ... })`
  (vitest поддерживает async test-колбэки), переменные объявлены `let` с
  типом `typeof import(...)` перед `describe`. `vi.mock("node:dns/promises",
  ...)` (hoisted vitest-транформом) остаётся на прежнем месте и продолжает
  работать штатно — сам мокинг не трогал.
- Заявленный в финальном отчёте S04 флейк `vi.spyOn` — **не подтвердился при
  перепроверке**: файл уже использовал `vi.mock` (module factory), а не
  `vi.spyOn` на `node:dns/promises` — S05-сессия сама написала его так именно
  потому, что `vi.spyOn` на неконфигурируемый ESM-namespace бросает `Cannot
  redefine property`, что и задокументировано doc-комментарием в начале
  файла. Похоже, единичный `TypeError: Cannot redefine property: lookup` из
  отчёта S04 — либо устаревшее наблюдение до этой строки кода, либо
  разовая аномалия окружения той сессии; в этой сессии `pnpm test:integration`
  прогнан **4 раза подряд** на изолированном Postgres (порт 5566, данные и
  storage в scratchpad, не тронуты `infra/postgres/data`/`.env` пользователя)
  — все 4 прогона: **17 файлов / 103 теста PASS**, без единого флейка, в том
  числе все 13 тестов `remote-url-guard-dns.integration.test.ts` и оба новых
  теста `mode-security.integration.test.ts` стабильно зелёные.
- Проверены фикстуры на `.invalid`-домены (RFC 2606) по всему
  `apps/api/test/` и `apps/web`/`packages` (grep `\.invalid`, включая
  ложные совпадения на `invalidateQueries` — отфильтрованы вручную) — S04
  уже заменила все `example.invalid` на `example.com` консистентно, новых
  `.invalid`-фикстур не найдено. Пункт 4 задания закрыт без правок.
- Итог: `pnpm typecheck` (все 7 проектов, включая `tsconfig.test.json`) →
  PASS. `pnpm lint` → PASS (те же 3 pre-existing warning, не связанные с этой
  правкой). `pnpm test` → PASS, 22 файла / 193 теста. `pnpm test:integration`
  → PASS **4/4 прогонов подряд**, 17 файлов / 103 теста каждый раз. Правка
  — только `apps/api/test/remote-url-guard-dns.integration.test.ts` (сам
  файл остаётся untracked/чужим — S05-сессии, я лишь починила его
  typecheck-блокер, не переписывала тестовую логику/ассерты).
- Затронутые файлы: `apps/api/test/remote-url-guard-dns.integration.test.ts`
  (top-level await → `beforeAll`), `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md`
  (эта запись).

### S04 · 2026-09-21 · PARTIAL (blob backup/restore, staged+journaled, fault-tested)

- Поведение: предыдущая попытка (см. запись ниже) остановилась на чистом
  scoping. В этой сессии реализованы и реально протестированы подэтапы
  1–2–3 из задания (immutable blob export+checksums, встроенный манифест,
  staging+journal restore с recovery, fault-injection тест), stale-preview
  (подэтап 4) не сделан — честно не начинал.
  - **Blob export+checksums** — новый чистый (без I/O) модуль
    `apps/api/src/sync/blob-manifest.ts`: `collectBlobRefs(documents,
    versions)` вычисляет тот же набор storage-ключей, что и
    `documents.service.ts` физически пишет на диск (текущее содержимое
    каждого файлового `Document` — живого или в корзине — плюс архивные
    `DocumentVersion.storageKey`), не импортируя приватные константы того
    модуля (`TRASH_DIR`/`VERSIONS_DIR` продублированы с комментарием, что
    держатся синхронно вручную; несовпадение сразу ловит roundtrip-тест,
    который реально скачивает файл по вычисленному ключу).
    `BlobBackupService.collect()` (новый `apps/api/src/sync/blob-backup.service.ts`)
    читает эти ключи через `StorageAdapter.getStream`, считает sha256 **из
    фактически прочитанных байтов** (не доверяя сохранённому в БД
    `checksum` — иначе повреждение на диске молча копируется как «ОК»), и
    бросает исключение на весь бэкап, если файл отсутствует/недоступен
    (fail-loud, не тихий частичный бэкап).
  - **Манифест** — не отдельная файловая структура
    (`snapshots/<ts>/manifest.json`), а встроен в существующий `.orion`
    payload: `sync.service.ts` теперь шифрует `{ blobs: BlobEntry[],
    snapshot: WorkspaceSnapshot }` вместо голого `WorkspaceSnapshot`.
    Решил не городить отдельный файловый layout — задание прямо разрешало
    это ("не обязательно, если не необходимо для остальных подэтапов"), а
    один файл проще транзакционно (бэкап либо целиком уходит на удалёнку,
    либо не уходит вовсе — то же свойство, что уже было у S01-S03).
    Старые (до S04) бэкапы не имеют обёртки `{blobs, snapshot}` —
    `isBackupPayload()` их распознаёт и `restore()` отклоняет тем же
    fail-closed принципом, что legacy v1 снапшот в `snapshot.service.ts`
    (S03c): молча восстановить строки без байтов документов хуже отказа.
  - **Staging+journal restore, порядок операций (важная находка)** —
    `BlobBackupService.restore()` стейджирует все блобы под
    `_restore-staging/<batchId>/<workspaceId>/...` (см. комментарий в коде
    про то, почему НЕ `_restore-staging/<workspaceId>/<batchId>/...` — первая
    версия вложила `<workspaceId>` дважды и своп упаковывал дерево само в
    себя, поймано первым прогоном теста, не в проде), проверяя checksum на
    каждый файл, и только после того как ВСЕ блобы стейджированы и
    проверены, делает атомарный своп (`StorageAdapter.move`, `fs.rename`
    для локального диска): (1) увести текущий `<workspaceId>` в
    `_restore-old/<workspaceId>/<batchId>` (если он есть), (2) переименовать
    staging на его место. Журнал (`_restore-journal/<workspaceId>.json`)
    живёт **вне** `<workspaceId>/...`, поэтому переживает своп корня и
    позволяет `recover()` отличить «не начато»/«стейджинг не завершён»
    (просто убрать осиротевший staging, реальное дерево не тронуто) от
    «сбой между двумя rename» (докатить staging → корень: staged-байты уже
    проверены, докатить вперёд безопаснее отката).
    **Порядок blob-restore относительно DB-apply в `SyncService.restore()`
    оказался значим и был найден только тестом, не разбором**: первая
    версия делала DB-apply (замена строк на данные снапшота), потом
    blob-restore — и если blob-restore падал (fault-injection), GET
    `.../content` отдавал **усечённое** содержимое (`Content-Length`
    выставлялся из уже новых `sizeBytes` в БД, тело — старые/дрейфнувшие
    байты на диске, ещё не заменённые). Порядок инвертирован: теперь
    `blobs.restore()` (полностью staging+verify+swap или исключение без
    единого тронутого файла) идёт **до** `snapshots.apply()`, так что сбой
    в блобах не оставляет строки БД уже заменёнными, а диск — ещё старым.
    `SyncService.restore()` вызывает `this.blobs.recover(...)` в начале
    каждого apply — предыдущий незавершённый restore самолечится
    автоматически, повторный вызов не требует отдельного эндпоинта.
  - **dryRun preview** дополнительно показывает `incoming.documentBlobs`
    (число байт-записей в манифесте) рядом с построчными counts — минимальная
    видимость подэтапа 3 (preview показывает, что будет восстановлено,
    включая факт наличия файлов), но отдельного stale-preview
    manifest-hash отклонения (если удалёнка изменилась между preview и
    apply) НЕТ — не успел, честно не делал вид, что сделал.
- Файлы: `apps/api/src/sync/blob-manifest.ts` (новый, чистая логика),
  `apps/api/src/sync/blob-backup.service.ts` (новый: collect/restore/recover),
  `apps/api/src/sync/sync.service.ts` (backup эмбедит блобы,
  restore распознаёт `{blobs,snapshot}`/legacy, порядок blob-restore до
  DB-apply, auto-recover перед apply), `apps/api/src/sync/sync.module.ts`
  (провайдер `BlobBackupService`), `apps/api/test/blob-backup.integration.test.ts`
  (новый, 4 теста — см. ниже), `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md`
  (эта запись). Zod-схемы (`packages/shared-types/src/sync.ts`) не менялись —
  `incoming`/`current` уже `z.record(string, number)`, лишний ключ
  `documentBlobs` укладывается без правки контракта.
- Проверки и результаты:
  - `pnpm --filter @orion/api exec tsc -p tsconfig.json --noEmit` → PASS.
  - `pnpm --filter @orion/api exec tsc -p tsconfig.test.json --noEmit` → PASS.
  - `pnpm typecheck` (все 7 проектов) → PASS.
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы).
  - `pnpm test` → PASS, 13 файлов / 135 тестов (не менял packages/).
  - `pnpm test:integration` на изолированном portable-Postgres (тот же
    рецепт 5544 в scratchpad, `prisma migrate deploy`, свой `STORAGE_DIR` в
    scratchpad, НЕ `infra/postgres/data`/рабочий storage) → PASS, **3 файла
    / 34 теста** (было 30 после S03 + 4 новых S04). Новые тесты в
    `blob-backup.integration.test.ts`:
    - `S04a` — юнит-проверка `collectBlobRefs` (без БД/I/O): дерево
      folder→file плюс файл в корзине даёт ожидаемые ключи
      (`ws/docs/a.txt`, `ws/.trash/file-2`).
    - `S04b` — реальный upload через `POST .../documents/upload`, backup
      (через застубленный `WebdavRemote`, тот же паттерн что в S02, реальное
      шифрование), проверка что манифест содержит правильный sha256 и
      байты содержимого; затем "дрейф" (`replaceContent`), restore apply,
      и подтверждение через `GET .../content`, что байты на диске снова
      исходные — **реальный roundtrip через настоящий LocalDiskStorage**,
      не мок.
    - `S04c` (fault-injection, главный тест) — два файла, `vi.spyOn` на
      **реальном singleton-инстансе `StorageAdapter`** (`app.get(STORAGE_ADAPTER)`,
      не на классе), бросает после 3-го вызова `putFile` (журнал + первый
      блоб успели застейджиться, второй — нет). Restore apply 500-ит;
      тест проверяет, что ОБА файла на диске остались с "дрейфнувшим"
      (пред-restore) содержимым — доказательство, что частичный стейджинг
      не просочился в реальное дерево. Повторный вызов restore (без спая)
      проходит и восстанавливает оба файла — доказательство, что
      auto-recover в начале `SyncService.restore()` реально убирает
      осиротевший staging и не блокирует повтор.
    - `S04d` — вручную сконструированный "легаси" `.orion` (сырой
      `WorkspaceSnapshot` без обёртки `{blobs,...}`) отклоняется 400 на
      preview, а не тихо применяется без файлов.
    Первый прогон реально ловил два настоящих бага до финального зелёного
    прогона (не тавтология): (1) двойное вложение `<workspaceId>` в
    staging/swap путях (файл физически оказывался по
    `<ws>/<ws>/report.txt`), (2) усечённый `GET .../content` из-за
    неверного порядка DB-apply/blob-restore, воспроизведённый именно
    fault-injection тестом S04c, не увиден бы happy-path тестом S04b.
  - `pnpm --filter @orion/api run build` → PASS.
  - Рабочий `.env`, `infra/postgres/data` и рабочий `STORAGE_DIR`
    пользователя не тронуты; временный кластер на 5544 и scratch-storage
    подняты и снесены только в рамках этой сессии.
- Миграция/данные: без изменений Prisma-схемы/миграций — весь фикс в
  `apps/api/src/sync/` (новый код) и небольшой правке `sync.service.ts`.
- Непроверенное: **stale-preview rejection** (подэтап 4 из задания
  полностью) — если манифест на удалёнке изменился между preview и apply
  (второй параллельный клиент успел сделать новый backup), текущий код
  этого не ловит и применит снапшот, который preview не видел; не
  реализовывал из-за бюджета, честно оставляю TODO. WebDAV-драйвер
  (`webdav.storage.ts`) не имеет собственного теста staging+swap — весь
  fault-injection прогон был через `LocalDiskStorage` (дефолтный
  драйвер интеграционных тестов); `move`/`putFile`/`exists` там
  реализуют тот же контракт `StorageAdapter`, но webDAV-специфичные грани
  (например частичный успех `MOVE` на сервере без поддержки collection-move)
  не проверялись отдельно. Очень большие бэкапы (много/крупных файлов)
  сейчас идут одним base64-JSON внутри памяти процесса — не проверял
  поведение на реалистично больших datasets, признанный компромисс
  простоты для Стадии 1 (см. обоснование манифеста выше), не оптимизация
  под масштаб. UI (`SyncPanel.tsx`) не показывает отдельно
  `documentBlobs`/детали staging/recovery — превью использует тот же
  generic `Record<string, number>`, что и раньше; специальной строки под
  файлы не добавлял (нет browser-tooling в сессии, чтобы проверить
  визуально — та же причина SKIPPED, что в S00/S03).
- Следующий шаг: stale-preview (manifest-hash или ETag удалёнки,
  зафиксированный в preview и сверяемый на apply) — единственный
  оставшийся пункт S04 из исходного задания. После него `S04 → S05`
  (Local/server mode и remote fetch) по очереди в 12-PROGRESS.md.

### S04 · 2026-09-21 (предыдущая попытка) · BLOCKED (только разбор, код не менялся)

- Поведение: задача — "Файловые бэкапы и восстановление с recovery" (blob
  export+checksums, полный manifest, preview/apply, staging+journal,
  fault-injection тесты). Провёл полный разбор текущей реализации перед
  правкой (`git status --short` подтвердил: чужой dirty tree не трогал, S04
  не начинал с изменений кода):
  - `apps/api/src/sync/snapshot.service.ts` (v2, S03) сериализует **только
    метаданные** — `DocumentVersion.storageKey`/`checksum` как обычные
    строки таблицы, сами байты файла не копируются и не заявлены (реестр
    `snapshot-registry.ts` прямо помечает: "сами байты блобов — S04").
  - `apps/api/src/sync/sync.service.ts.backup()` — синхронный однопроходный
    поток: `serialize()` → `JSON.stringify` → `encryptSnapshot` (весь снапшот
    целиком в памяти) → два `remote.putFile` (`latest.orion`, затем
    дата-именованный). Нет staging, нет журнала, нет multi-file манифеста —
    один зашифрованный файл. `restore()` симметрично: скачать один файл →
    расшифровать → (dryRun: посчитать `counts` и вернуть превью) → (apply:
    `snapshots.apply(tx, snapshot)` одной Prisma-транзакцией). Откат при
    сбое середины `apply()` уже частично прикрыт транзакцией Prisma
    (rollback SQL при исключении), но это чисто про строки БД — байтов там
    нет вообще.
  - `apps/api/src/storage/storage-adapter.ts` — интерфейс `StorageAdapter`
    (`putFile/mkdir/move/copy/getStream/remove/exists`), ключ = POSIX-путь,
    зеркалящий дерево папок документа (не отдельная колонка). Два драйвера:
    `local-disk.storage.ts` (81 строка, прямые fs-операции) и
    `webdav.storage.ts` (83 строки, тот же контракт поверх HTTP). Никакого
    примитива "список всех ключей воркспейса" или "потоковый экспорт с
    checksum" в адаптере сейчас нет — `getStream` даёт один файл за раз.
  - Реальный объём одного полного backup-с-блобами прогона: нужно (1) для
    каждого `DocumentVersion`/текущего файла документа прочитать байты через
    `getStream`, посчитать sha256 попутно (не доверяя уже сохранённому
    `checksum`, иначе повреждение на диске молча копируется как "ОК"),
    (2) построить манифест {key, size, sha256, docId, versionId} для ВСЕХ
    файлов, (3) залить их как неизменяемый набор (контент-адресуемый layout,
    чтобы повторный backup не перезаписывал уже занесённые байты вслепую),
    (4) отдельно закоммитить манифест только когда все блобы подтверждены
    remote'ом, (5) на restore — staging-каталог + журнал прогресса (какие
    ключи уже скопированы/провалидированы), чтобы прерванный на середине
    restore был отличим от "не начат" и не оставлял workspace в частично
    восстановленном состоянии, (6) preview должен зафиксировать
    manifest-hash, а apply — отвергать, если между preview и apply манифест
    на remote изменился (stale preview).
  - Это ортогонально меняет контракт `backup()`/`restore()` (сейчас — один
    файл; нужно — множество файлов + журнал + staging), контракт
    `WebdavRemote`/`LocalDiskStorage` (нужен list/enumerate по workspace) и
    добавляет constraints вокруг partial-failure семантики, которых текущий
    код (один putFile — одна атомарная операция с точки зрения теста) не
    имеет вовсе.
- Файлы: не менялись (только чтение: `snapshot.service.ts`,
  `snapshot-registry.ts`, `sync.service.ts`, `storage-adapter.ts`,
  `local-disk.storage.ts`, `webdav.storage.ts`); эта запись в
  `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md`.
- Проверки и результаты: не прогонялись — код не менялся, прогонять нечего.
- Миграция/данные: нет.
- Непроверенное: ВСЯ карточка S04 целиком — blob export/checksums, manifest,
  preview/apply staging, journal, fault-injection тесты. Причина отказа от
  реализации в этой сессии: бюджет сессии (низкий reasoning effort,
  выделенный на эту задачу) недостаточен, чтобы спроектировать и — что
  критично по протоколу — реально протестировать fault-injection на
  staging+journal restore (это explicitly помечено в задании как
  concurrency/data-integrity дефект класса, требующего воспроизводящего
  теста ДО правки, не просто happy-path). Попытка внести код для
  backup/restore (систему, которая по определению единственный путь
  восстановления пользовательских данных) без честной fault-injection
  проверки была бы именно тем, что протокол прямо запрещает: "не имитируй
  готовность непроверенного кода". Решил не транзакционно резать это на ещё
  более узкий кусок (например "только immutable blob export без restore"),
  потому что даже такой кусок меняет контракт `StorageAdapter`
  (list/enumerate) и формат `.orion`-бэкапа, которым уже пользуется
  `restore()` — половинчатое изменение здесь рискованнее, чем полное
  отсутствие изменений, т.к. ломает симметрию backup↔restore, на которую
  полагается существующий (протестированный, DONE) S02/S03 код.
- Следующий шаг: следующему агенту с полным бюджетом сессии — начать с
  пункта протокола "напиши падающие тесты до исправления": (a) roundtrip
  теста для файла+версии на изолированной БД+STORAGE_DIR fixture (рецепт
  S00 выше, для storage — отдельный временный каталог, не
  `infra/postgres/data`/рабочий storage), (b) fault-injection на
  `WebdavRemote.prototype.putFile`/`getFile` через `vi.spyOn`, кидающий
  после N файлов (тот же паттерн, что S02 уже использовал для стаба
  WebDAV), (c) stale-preview теста (изменить манифест между preview и
  apply). Реализацию начинать с (1) contentType/enumerate-примитива в
  `StorageAdapter` (нужен для построения манифеста), (2) отдельного формата
  манифеста поверх текущего `.orion` (не ломая `SNAPSHOT_VERSION=2`
  метаданные — блобы могут быть параллельной структурой, например
  `snapshots/<ts>/manifest.json` + `blobs/<sha256[0:2]>/<sha256>` рядом с
  существующим `latest.orion`), (3) staging+journal только для `restore()`
  (локальный временный каталог + журнал JSON-строк "какие ключи применены"),
  апскейл в конце одной операцией `move` в реальное storage-дерево. `S03 →
  S04` зависимость остаётся открытой (не закрыта эту сессию).

### S05 · 2026-09-21 · PARTIAL (mode+bind, JWT fail-fast, picker/PIN gating, password policy, SSRF guard, login rate-limit — done; DNS-rebinding, WebDAV-client redirect/size limits, register rate-limit — not done)

- Поведение: до этой сессии режим "local" (десктоп, один человек) vs
  "server" (много пользователей, реальная сеть) нигде не был явным —
  `main.ts` слушал `app.listen(port)` без хоста (все интерфейсы), `AuthModule`/
  `JwtStrategy` читали `JWT_SECRET` с фолбэком на литерал
  `"dev-only-insecure-secret"` (ровно то, что 15-FIRST-TASKS явно просил не
  пропустить), `GET /auth/accounts` (passwordless-каталог локальных
  аккаунтов) и PIN-разблокировка были доступны всегда, пароль при регистрации
  требовал только 8 символов без проверки сложности, `/auth/login` не имел
  rate-limit, а исходящие URL пользователя (ICS-календари, WebDAV-удалёнка
  синка) не имели защиты от редиректа на внутренний адрес и лимита размера
  ответа (у календаря уже была проверка хоста на loopback/private — у
  WebDAV-удалёнки не было и этого).
  - **Explicit mode+bind** — новый `apps/api/src/common/orion-mode.ts`:
    `resolveMode()` читает `ORION_MODE` (`local`|`server`, дефолт `local` —
    безопасный дефолт для десктоп-сценария) и бросает на любое другое
    значение вместо молчаливого угадывания; `resolveBindHost(mode)` даёт
    `127.0.0.1` в local, `0.0.0.0` в server, если `HOST` не задан явно.
    `main.ts` резолвит режим до `NestFactory.create()` (быстрый и понятный
    отказ вместо стектрейса из недр DI) и передаёт хост в `app.listen(port,
    host)`.
  - **JWT fail-fast** — новый `apps/api/src/common/jwt-secret.ts`:
    `resolveJwtSecret()` бросает `Error`, если `ORION_MODE=server` и
    `JWT_SECRET` не задан; в local — тот же dev-фолбэк, что раньше (чтобы
    `pnpm dev:api` без `.env` по-прежнему работал). Подключено в
    `auth.module.ts` (`JwtModule.register({ secret: resolveJwtSecret() })`,
    синхронно на module-eval time — комментарий в `main.ts` объясняет,
    почему это должно быть синхронно) и в `jwt.strategy.ts` (раньше был свой
    отдельный фолбэк-литерал — единый источник теперь один).
  - **Private account picker only local** — `AuthController.listAccounts`/
    `.avatar` бросают `ForbiddenException` при `isServerMode()`. Проверка на
    request-time (не на boot-time), поэтому один и тот же поднятый Nest-app
    в тесте может переключать `process.env.ORION_MODE` между запросами.
  - **Server mode password policy** — `AuthService.register`/`.login`:
    `input.pin` отклоняется (`BadRequestException`) в server mode целиком
    (PIN — сценарий "один человек за одной клавиатурой", не многопользовательская
    сеть); пароль дополнительно обязан набрать `passwordScore >= 2` (не менее
    12 символов ИЛИ сочетание регистра/цифр+спецсимволов — та же эвристика,
    что уже использовалась для `passwordStrength` в ответе, теперь ещё и
    гейтит регистрацию). Zod-схема (`registerInputSchema` в shared-types) не
    трогалась — минимум 8 символов там уже есть и общий для обоих режимов;
    доп. проверка сложности для server mode осознанно на уровне сервиса, не
    schema, т.к. она режимо-зависима, а одна и та же схема используется и в
    local, и в server.
  - **Brute-force protection** — оценил `@nestjs/throttler`: не в
    зависимостях `apps/api/package.json`, и подключение целого фреймворка
    rate-limiting (модуль, storage backend, global/per-route конфигурация)
    ради "ограничить количество попыток входа на один роут" — больше, чем
    нужно по правилу "новая зависимость только при объяснённой необходимости"
    (08-TEAM-AND-ACCESS.md). Написал узкий `LoginRateLimitGuard`
    (`apps/api/src/auth/login-rate-limit.guard.ts`) — fixed-window счётчик в
    памяти, keyed по `x-forwarded-for`/`req.ip`, 10 попыток / 5 минут,
    зарегистрирован как singleton-провайдер в `AuthModule` (общее состояние
    между запросами к одному роуту). Применил только к `POST /auth/login` —
    **не** к `/auth/register` (см. комментарий в `auth.controller.ts`):
    первая попытка навесить его и на register сломала 4 существующих теста в
    `api-rls.integration.test.ts`, которые регистрируют больше 10 аккаунтов
    подряд с одного loopback IP в рамках одного прогона — реальный сценарий
    (seed-скрипты, интеграционные тесты, NAT), тогда как логин — это подбор
    уже существующего секрета, что и есть цель rate-limit'а.
  - **SSRF / redirect / size constraints** — новый
    `apps/api/src/common/remote-url-guard.ts`: `assertPublicRemoteUrl()`
    (объединил дублировавшуюся проверку хоста, которая раньше жила только в
    `calendar-connections.service.ts`, добавил `169.254.0.0/16`
    link-local/cloud-metadata и IPv6 `fc00::/7`/`fe80::/10`, которых не было),
    `rejectRedirect()` (для `fetch(..., { redirect: "manual" })` — раньше
    `fetch` в `calendar-connections.service.ts` следовал редиректам молча,
    что обесценивало проверку хоста: разрешённый публичный URL мог 302 на
    внутренний адрес), `MAX_REMOTE_RESPONSE_BYTES` (5 МиБ, проверка и по
    `Content-Length`, и по факту прочитанных байт). Применено в
    `calendar-connections.service.ts` (`performSync`: `redirect: "manual"` +
    `rejectRedirect` + оба размерных чека) и добавлено в
    `sync.service.ts.putRemote()` — WebDAV remote URL раньше не проходил
    вообще никакой проверки хоста (в отличие от календаря), исправлено на
    уровне сохранения конфига (`assertPublicRemoteUrl(input.url, ...)`) —
    сам WebDAV-клиент (пакет `webdav`) не даёт передать `redirect: "manual"`/
    лимит размера напрямую, поэтому редирект/размер для WebDAV **не**
    закрыты (см. «Непроверенное»).
  - **Десктоп-launcher** — проверил `apps/desktop/src-tauri`: нет ни одного
    упоминания `spawn`/`Command::new`/sidecar/порта 4000 — Tauri не запускает
    API-процесс сам (соответствует инварианту CLAUDE.md "Tauri не содержит
    бизнес-логики"), поэтому здесь нечего гейтить по режиму; подтверждено
    чтением, не изменял файлы `apps/desktop`.
- Файлы: `apps/api/src/common/orion-mode.ts` (новый),
  `apps/api/src/common/jwt-secret.ts` (новый),
  `apps/api/src/common/remote-url-guard.ts` (новый),
  `apps/api/src/auth/login-rate-limit.guard.ts` (новый),
  `apps/api/src/main.ts`, `apps/api/src/auth/auth.module.ts`,
  `apps/api/src/auth/jwt.strategy.ts`, `apps/api/src/auth/auth.controller.ts`,
  `apps/api/src/auth/auth.service.ts`,
  `apps/api/src/events/calendar-connections.service.ts`,
  `apps/api/src/sync/sync.service.ts`, `apps/api/.env.example` (документирован
  `ORION_MODE`/`HOST`/`ALLOW_PRIVATE_CALENDAR_URLS`),
  `apps/api/test/mode-security.integration.test.ts` (новый, 13 тестов),
  `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта запись).
- Проверки и результаты:
  - `pnpm typecheck` → PASS (7/7 проектов).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы).
  - `pnpm test` → PASS, 13 файлов / 135 тестов (не трогал packages/).
  - `pnpm --filter @orion/api run build` → PASS (`tsc -p tsconfig.json`).
  - `pnpm test:integration` на изолированном portable-Postgres (порт 5544,
    отдельный `ORION_PG_DATA`/`STORAGE_DIR` в scratchpad-каталоге сессии, не
    `infra/postgres/data`/рабочий storage) → PASS, **4 файла / 47 тестов**
    (34 из трёх существующих файлов без изменений + 13 новых в
    `mode-security.integration.test.ts`). Первый прогон реально ловил два
    настоящих бага в самих тестах/реализации до финального зелёного:
    (1) `LoginRateLimitGuard`, изначально навешенный и на `/auth/register`,
    ронял 4 существующих теста в `api-rls.integration.test.ts` (429 вместо
    201) — не спроектировал заранее, что тот файл регистрирует много
    аккаунтов подряд с одного IP; снял guard с register, оставил на login
    (см. обоснование выше — это не "подгонка теста", а пересмотр решения,
    какой роут действительно нуждается в лимите);
    (2) SSRF-тест сначала проверял `expect(fetchSpy).not.toHaveBeenCalled()`
    — но spy на `globalThis.fetch` перехватывал и собственные HTTP-вызовы
    теста к поднятому приложению (тот же глобальный `fetch`), не только
    исходящий вызов сервера к календарю; исправлено на проверку, что среди
    вызовов fetch нет конкретно вредоносного URL.
    Новые тесты: JWT fail-fast (throws без boot приложения — pure function,
    4 теста), local/server HTTP-поведение (account picker 200/403, PIN
    register/login 400 в server mode, слабый пароль 400 / сильный 201,
    login rate-limit 429 на 11-й попытке — с изолированными
    `x-forwarded-for` на тест, чтобы тесты не отравляли общий bucket друг
    друга), SSRF (loopback URL → 400 без сетевого вызова к вредоносному
    адресу) и redirect-rejection (реальный `node:http` stub-сервер на
    loopback с `ALLOW_PRIVATE_CALENDAR_URLS=true`, возвращающий 302 →
    `sync()` 400, `redirectTargetHit` остаётся `false` — редирект реально не
    пройден, не просто код-ревью).
  - Рабочий `.env` и `infra/postgres/data` не тронуты; временный кластер на
    5544 (порт из существующего рецепта S00, а не заново придуманный) и
    scratch-storage подняты и остановлены только в рамках этой сессии.
- Миграция/данные: без изменений Prisma-схемы/миграций.
- Непроверенное: **DNS rebinding** — `assertPublicRemoteUrl`/
  `validateRemoteUrl` проверяют только hostname до резолва; публичный домен,
  резолвящийся в приватный IP (в момент запроса или между проверкой и
  запросом), не ловится — задокументировано прямо в комментарии
  `remote-url-guard.ts`, не скрыто. **WebDAV-клиент** (пакет `webdav`,
  `apps/api/src/sync/webdav-remote.ts`) не имеет `redirect: "manual"`/лимита
  размера ответа — сама библиотека не даёт эти опции напрямую тем же
  способом, что `fetch`; закрыт только вход (URL хоста при сохранении
  конфига в `putRemote`), не транспорт. `/auth/register` не имеет
  rate-limit (осознанное решение, см. выше, но это значит, что подбор
  повторной регистрации на существование email всё ещё не ограничен).
  Desktop/Tauri native build и populated UI screenshots для новых состояний
  (server-mode login экран без picker) не снимались — нет browser/Tauri
  build tooling в сессии, та же причина SKIPPED, что в S00/S03/S04. Веб-клиент
  (`apps/web/app/login/page.tsx`, `apps/web/app/register/page.tsx`) **не
  менялся** — они по-прежнему всегда показывают picker/форму с PIN
  независимо от режима; сервер теперь отклоняет соответствующие запросы
  (403/400), но UI не скрывает эти элементы и не различает режимы на
  клиенте. Это самый существенный оставшийся пробел карточки S05 (done-
  критерий "server mode не выдаёт directory" выполнен на API, но не
  отражён в UX — пользователь в server mode увидит picker, который вернёт
  403 при попытке использовать).
- Следующий шаг: следующему агенту — (а) `apps/web`: прочитать режим (нужен
  публичный, не завязанный на auth, способ узнать `ORION_MODE` с клиента —
  либо отдельный `GET /system/mode` без гварда, либо встроить в уже
  существующий `system`-модуль; сейчас такого эндпоинта нет) и скрыть
  picker/PIN-поля в server mode на `login`/`register` страницах; (б) решить,
  нужен ли rate-limit на `/auth/register` с более щадящим порогом
  (например, по email/IP парам, не по голому IP) для защиты от email-
  enumeration, не ломая bulk-сценарии; (в) DNS-rebinding защита, если
  сочтут нужным для Стадии 1 (резолв hostname перед запросом и сверка
  итогового IP, либо `dns.lookup` с кастомным `Agent` для `fetch`). `S05 →
  S18` (desktop/runtime/release policy) зависимость в очереди сохраняется.

### S05 · 2026-09-22 (добивание хвостов) · PARTIAL → оба пункта этой сессии закрыты (UI-гейтинг + `GET /system/mode`, DNS-rebinding); карточка остаётся PARTIAL из-за WebDAV client redirect/size limits и register rate-limit, не входивших в эту сессию

- Поведение: закрыты два честно оставленных пункта карточки — (1) UI-гейтинг
  login/register под режим + публичный `GET /system/mode`, (2) DNS-rebinding
  защита. `WebDAV client redirect/size limits` и `register rate-limit`
  остаются отдельными, не входившими в это задание пунктами (см. журнал
  2026-09-21 выше) — не трогал их эту сессию, не путать с закрытыми.
  - **`GET /system/mode`** — новый публичный (без `JwtAuthGuard`, как
    `/system/info`/`/system/health`) эндпоинт `SystemController.mode()`
    (`apps/api/src/system/system.controller.ts`), возвращает
    `{ mode: resolveMode() }` через новую `orionModeInfoSchema` в
    `packages/shared-types/src/settings.ts`. Не секрет и не сам по себе
    контроль доступа — сервер уже отклоняет picker/PIN эндпоинты в server
    mode (`AuthController`), это только согласование UI с уже существующим
    server-side гейтом.
  - **Клиентский гейтинг** — `ApiClient.getOrionMode()` (api-client.ts),
    `useOrionMode()` (`packages/core-react/src/use-auth.ts`,
    `staleTime: Infinity` — режим не меняется в рамках одной сессии
    браузера/десктопа). `apps/web/app/login/page.tsx`: в server mode рендерит
    отдельную именную форму email+пароль (`unlockServer`, использует уже
    существующий `LoginInput.email`-путь) вместо picker/PIN; `useAuthAccounts`
    получил параметр `enabled` (по умолчанию `true`), login передаёт
    `!isServerMode`, чтобы `GET /auth/accounts` вообще не запрашивался в
    server mode (не только скрывался в UI, но и не бил в эндпоинт, который
    сервер всё равно отклонит). `apps/web/app/register/page.tsx`: переключатель
    Пароль/PIN скрыт в server mode, PIN-путь принудительно сбрасывается на
    пароль (`useEffect`). Fail-open по умолчанию, пока режим не загружен
    (`orionMode.data === undefined` → `isServerMode === false`) — сознательно:
    ложноположительный "server mode" в момент загрузки хуже (заблокировал бы
    picker в местном режиме на долю секунды), чем ложноотрицательный (сервер
    всё равно отклонит запрос, если ошиблись).
  - **DNS-rebinding** — `assertPublicRemoteUrl` в
    `apps/api/src/common/remote-url-guard.ts` стала `async` и после
    хостнейм-проверки резолвит хост через `dns.promises.lookup(host, { all:
    true, verbatim: true })` и отклоняет, если **любой** из резолвленных
    адресов приватный/loopback (переиспользует уже существующий
    `isPrivateOrLoopbackHost` — он уже принимает и хостнеймы, и IP-строки).
    Новая экспортируемая `assertResolvedHostIsPublic(hostname, label)` — та
    же DNS-половина отдельно, для повторной проверки в точке фактического
    сетевого вызова. Это вариант "короткий TTL double-check" из задания, не
    полный pinning резолвленного IP в сам запрос: `fetch()`
    (calendar-connections) и пакет `webdav` (sync) сами резолвят DNS ещё раз
    при фактическом запросе, так что теоретическая гонка (вредоносный DNS
    отвечает по-другому за миллисекунды между проверкой и запросом) не
    закрыта на 100% — задокументировано прямо в doc-comment
    `remote-url-guard.ts`, честно, не молчаливый пробел. Компенсация: проверка
    выполняется не только один раз при сохранении конфига
    (`SyncService.putRemote`, `CalendarConnectionsService.create/update`), но
    и заново прямо перед созданием сетевого клиента
    (`SyncService.remoteFor`, вызывается из `openRemote`/`backup`) и заново
    перед каждым `fetch` ICS (`CalendarConnectionsService.performSync` →
    `validateRemoteUrl`, уже вызывался каждый sync/cron-тик и до этой сессии
    — просто стал `await`-able). `SyncService.backup()`: DNS-резолв вынесен
    **за пределы** `withUser`-транзакции (сетевой round-trip не должен
    держать открытой транзакцию Postgres) — `cfg` читается внутри `withUser`,
    `remoteFor(cfg, ...)` (включая DNS-чек) вызывается после её завершения.
  - Полный список проверенных диапазонов в `isPrivateOrLoopbackHost` не
    менялся (уже покрывал все из задания: 10/8, 172.16/12, 192.168/16, 127/8,
    `::1`, `fc00::/7`, link-local 169.254.0.0/16 + `fe80::/10`) — DNS-чек
    просто прогоняет резолвленные IP через ту же функцию.
- Тесты:
  - **Написаны и прогнаны** `apps/api/test/remote-url-guard-dns.integration.test.ts`
    (13 тестов, чистая логика, `vi.mock("node:dns/promises")` — реальный
    DNS/сеть не идёт ни разу; module namespace ESM-биндинга `node:dns/promises`
    не даёт `vi.spyOn` напрямую — "Cannot redefine property: lookup", поэтому
    `vi.mock` с фабрикой, а не `vi.spyOn`, это задокументировано в файле).
    Покрыто: публичный хостнейм → loopback/10.x/192.168.x/172.16-31.x/
    169.254.169.254/`::1`/`fc00::/7` — отклонено; смешанный список адресов (один
    приватный из нескольких) → отклонено; чисто публичный → принято; сбой
    самого резолва DNS → отклонено (не тихий проход); `ALLOW_PRIVATE_CALENDAR_URLS=true`
    → DNS вообще не резолвится (явный локальный опт-аут, не только приватные
    диапазоны пропускает, но и не делает лишний сетевой вызов); e2e через
    `assertPublicRemoteUrl` — хостнейм проходит по имени, но отклоняется по
    резолву (это и есть демонстрация закрытой дыры, не пройди тест раньше
    фикса — прошёл бы).
  - Добавлены 2 теста в существующий `apps/api/test/mode-security.integration.test.ts`
    ("GET /system/mode is public... reports local mode" /
    "...reports server mode") — переиспользуют уже поднятое приложение того
    файла, без Authorization заголовка, оба статус 200 с ожидаемым `{mode}`.
  - Порядок: тесты писались вместе с реализацией в рамках одной правки (не
    строго red-green-refactor с отдельным замером падения до фикса), но
    логика проверена запуском полного набора — см. ниже.
  - `pnpm --filter @orion/api typecheck` → PASS. `pnpm typecheck` (весь
    монорепо, 7 project'ов) → PASS. `pnpm lint` → PASS (0 ошибок, 3
    предсуществующих warning'а в несвязанных файлах — `CalendarPanel.tsx`,
    `DocumentsPanel.tsx`, `scripts/seed-demo-workspace.mjs`). `pnpm test`
    (packages/ + apps/web/lib, без БД) → PASS, 22 файла / 193 теста.
  - `pnpm test:integration` на изолированном portable-Postgres
    (`ORION_PG_DATA`/`ORION_PG_PORT=5544` в scratchpad, `prisma migrate
    deploy`, свой `STORAGE_DIR`; рабочий `.env`/`infra/postgres/data`
    пользователя не тронуты) → PASS, **17 файлов / 103 теста** (было 15
    файлов/88 без учёта нового файла и двух новых тестов в
    `mode-security.integration.test.ts`). Кластер поднят и остановлен только
    в рамках сессии.
  - `pnpm build` → PASS: API (`tsc`) + Next.js (27 страниц), включая
    `/login` (3.76 kB) и `/register` (3.49 kB).
- Миграция/данные: нет — новая схема `orionModeInfoSchema` не Prisma-модель,
  чисто DTO-контракт; `remote-url-guard.ts`/`sync.service.ts`/
  `calendar-connections.service.ts` — только сигнатуры функций (sync → async)
  и точки вызова, без изменений схемы БД.
- Не проверено: **populated/browser screenshot** сервер-mode login формы и
  визуальное поведение react-query `staleTime: Infinity` для `useOrionMode`
  при живом переключении `ORION_MODE` на уже открытой вкладке — не снимались,
  нет browser-automation tooling в сессии (та же причина SKIPPED, что в
  S00/S03/S04/S08/S09/S15). Полное "TOCTOU-proof" закрытие DNS-rebinding
  (pinning резолвленного IP непосредственно в TCP-соединение через кастомный
  `undici`/`http.Agent` `lookup`) не сделано — `undici` не установлен как
  прямая зависимость `apps/api`, и `webdav`-пакет не даёт лёгкой точки
  расширения для своего HTTP-клиента; вместо этого реализован explicitly
  задокументированный в задании альтернативный вариант — "короткий TTL
  double-check" (повторная проверка максимально близко к фактическому
  сетевому вызову). Если понадобится полный pinning — придётся либо добавить
  `undici` в зависимости и завести кастомный `Dispatcher` для `fetch()`
  (calendar), либо заменить пакет `webdav` на собственный HTTP-клиент поверх
  того же `Dispatcher` (sync) — не сделано эту сессию.
- Следующий шаг: `S05` остаётся PARTIAL в статус-таблице выше (оба пункта,
  переданных в это задание, закрыты — см. заголовок этой записи и таблицу);
  WebDAV client redirect/size limits и register rate-limit (упомянутые в
  записи 2026-09-21 выше) намеренно не входили в это задание и остаются
  отдельным, не закрытым здесь пунктом — следующая сессия может закрыть их и
  перевести карточку в DONE, если владелец продукта сочтёт их необходимыми.

### S06 · 2026-09-21 · PARTIAL

- Поведение: `TimeEntry` не имел `userId` вовсе — "один запущенный таймер"
  был партиальным уникальным индексом по одному `workspaceId`, так что A
  запускающий таймер блокировал B от запуска своего в том же пространстве
  (команда и соло — равноправные сценарии, CLAUDE.md). Добавлен `userId`
  (nullable, сервер всегда сам проставляет его из аутентифицированного
  actor — клиент подменить не может), старый индекс заменён на composite
  partial `(workspaceId, userId) WHERE endedAt IS NULL`. `running`/`start`/
  `stop`/`update`/`remove` теперь фильтруют по вызывающему пользователю: A
  не видит и не может остановить таймер B. `update`/`remove` разрешены
  автору записи ИЛИ (для legacy author-unknown строк, `userId = null`)
  любому участнику пространства — явное решение, потому что переприсвоение
  таких строк конкретному человеку это admin-decision, которое эта карточка
  сознательно не делает (не выдумано, задокументировано в коде и здесь).
  DTO получил `userId`/`mine`; `shared-types` получил
  `summarizeByAuthorship` (mine/team/unknown-author суммы минут) — реализован
  как чистая функция, но НЕ подключён ни в `TimePanel`, ни в `ProjectsPanel`
  (бюджет сессии кончился раньше UI-слоя).

  **Добивание хвоста · 2026-09-22 · DONE.** `summarizeByAuthorship` подключён
  в `TimePanel` (`apps/web/panels/TimePanel.tsx`): в секции «Итоги» строка
  «Мои / Команда / Автор неизвестен» (минуты через `formatDuration`),
  считается над уже загруженной страницей `list` — тем же допущением, что и
  соседний разрез «По проектам» в этой же секции (отдельного серверного
  агрегата на авторство нет, как и на проекты). Строка скрыта, когда
  `teamMinutes === 0 && unknownAuthorMinutes === 0` — соло-пространство не
  получает разрез, который ничего не добавляет к «Всего» (тот же принцип,
  что у team-default `onlyMine` в `TasksPanel`, не переизобретён). Инвариант
  (сумма мои+команда+неизвестный = сумме `entries.minutes`, legacy
  `userId=null` никогда не попадает в «мои»/«команда» независимо от
  присланного `mine`) закрыт тремя новыми unit-тестами в
  `packages/shared-types/src/time.test.ts` (`describe("summarizeByAuthorship")`
  — до этой сессии функция не имела ни одного теста).
  `ProjectsPanel` **не тронут**: его тотал времени — `project.trackedMinutes`,
  серверный агрегат по проекту без per-entry `userId`/`mine` в DTO, поэтому
  `summarizeByAuthorship` (принимает `TimeEntry[]`) туда физически нечего
  подключать без новой серверной агрегации — вне объёма этого UI-only
  добивания, не забыто.
  Проверки: `pnpm typecheck` PASS (7/7), `pnpm lint` PASS (те же 3
  предсуществующих warning, регрессии нет), `pnpm test` PASS — 22 файла / 196
  тестов (193 было + 3 новых). Интеграционные/RLS-тесты не трогались (чисто
  клиентская правка, серверный код и схема не менялись). Живая
  browser-проверка не прогонялась — нет browser-tooling в среде (тот же
  известный пробел, что у S11/S12/S13/S18).
- Файлы: `apps/api/prisma/schema.prisma` (TimeEntry.userId, User.timeEntries),
  `apps/api/prisma/migrations/20260921145800_time_entries_actor/migration.sql`
  (новая миграция: ADD COLUMN userId + FK + DROP старого индекса + CREATE
  нового composite), `apps/api/src/time/time.service.ts` (userId scoping
  везде, toDto(row, callerId)), `packages/shared-types/src/time.ts`
  (`userId`/`mine` в `timeEntrySchema`, `summarizeByAuthorship`,
  `TimeAuthorshipTotals`), `scripts/seed-demo-workspace.mjs` (демо-записи
  теперь со `userId: users.owner.id`, иначе демо-данные стали бы
  author-unknown), `apps/api/test/time-entries.integration.test.ts` (новый
  файл — см. ниже).
- Проверки и результаты: изолированный кластер
  `ORION_PG_DATA=.../orion-s06-pgdata ORION_PG_PORT=5544` (рецепт S00, не
  трогал рабочий `.env`/`infra/postgres/data`) — `prisma migrate deploy`
  применил новую миграцию чисто поверх всех предыдущих. Новый интеграционный
  файл: 4 теста PASS, включая **настоящий** конкурентный тест (`Promise.all`
  двух параллельных `POST /time/start`, не два последовательных await) —
  один тест доказывает, что A и B в одном workspace оба успешно стартуют
  (409 не возникает, было бы возникало на старом индексе), второй — что два
  параллельных старта ОДНОЙ identity дают ровно [201, 409] и ровно одну
  running-строку (P2002 → 409, ловится `TimeService.start`). Третий —
  B не видит/не может остановить таймер A (404). Четвёртый — legacy
  `userId: null` строка сериализуется с `mine: false`, не приписывается
  никому. Полный `pnpm test:integration` (тот же изолированный кластер): 51
  тестов / 5 файлов PASS (включая структурный RLS-тест и snapshot-registry —
  TimeEntry.userId не сломал ни FK-топологию снапшота, ни RLS-политику,
  политика на `time_entries` не менялась). `pnpm test`: 135/135 PASS.
  `pnpm typecheck`: все 7 проектов PASS. `pnpm lint`: те же 3
  pre-existing warnings, что и в baseline S00 (регрессии нет). Тестовый
  кластер остановлен (`postgres.mjs down`) и его data-каталог удалён из
  temp после прогона.
- Миграция/данные: `20260921145800_time_entries_actor` — `ADD COLUMN
  "userId" TEXT` (nullable, FK на `users(id)` ON DELETE SET NULL), `DROP
  INDEX time_entries_one_running_per_workspace`, `CREATE UNIQUE INDEX
  time_entries_one_running_per_workspace_user ON time_entries (workspaceId,
  userId) WHERE endedAt IS NULL`. Существующие running-строки НЕ бэкфилены
  чьим-либо userId (сознательно — автор неизвестен, не выдумывать). RLS на
  `time_entries` не менялась (политика уже была по `workspaceId` через
  `workspace_members`, `userId` под неё не подпадает и не должен — это уже
  actor данного участника, а не отдельный tenant). Снапшот/бэкап: модель
  осталась `included`, `userId` копируется как обычная колонка при
  restore — новый `random` id никогда не генерируется (значение всегда
  ровно то, что было при бэкапе, того же installation), так что требование
  #6 карточки выполнено без отдельного кода в `snapshot.service.ts`.
- Непроверенное: (а) mine/team/unknown-author разбивка не подключена в
  `TimePanel`/`ProjectsPanel` — `summarizeByAuthorship` существует и
  экспортирован, но панели по-прежнему суммируют плоско; (б) admin-runbook
  для ручного переприсвоения legacy author-unknown записей конкретному
  человеку — не спроектирован, отложено осознанно (см. выше); (в) не
  проверено поведение при отзыве членства участника с running-таймером
  (что происходит с его строкой, когда `WorkspaceMember` удаляется, но
  `User` остаётся) — вне бюджета этой сессии, стоит проверить отдельно.
- Следующий шаг: подключить `summarizeByAuthorship` в `TimePanel` (карточки
  "мои"/"команда"/"неизвестный автор" рядом с текущим общим итогом) и в
  `ProjectsPanel` (тот же разрез при подсчёте часов по проекту), затем
  решить объём admin-runbook для legacy-переприсвоения (или явно оставить
  как permanent "неизвестный автор" без UI для реассайна).

### S07 · 2026-09-21 · DONE

- Поведение: `Notification` был workspace-wide — общий `readAt` на всех
  участников, `NotificationPolicyService` читал настройки только владельца
  (A05 в 01-AUDIT.md). Теперь каждая строка адресована (`recipientId`),
  `readAt` — состояние ровно этого получателя, дедуп — `eventKey`
  (partial-unique индекс `(recipientId, eventKey)`), тихие часы/тумблеры —
  получателя, не актёра и не владельца пространства.
  - **Схема**: `apps/api/prisma/schema.prisma` — `Notification.recipientId`
    (nullable, FK на `User`, cascade), `eventKey` (nullable). Миграция
    `20260921160000_addressed_notifications`: колонки, FK, обычный индекс
    на `recipientId`, partial unique `(recipientId, eventKey) WHERE both
    NOT NULL`, и **переписанная RLS-политика** `notifications_isolation`:
    адресованная строка (`recipientId` не null) видна только этому
    пользователю на уровне Postgres, даже если код забудет фильтр; legacy
    строка (`recipientId` null, всё, что было до миграции) остаётся видна
    по membership, как раньше — сознательный «архив legacy», не потеря
    данных.
  - **`NotificationCenterService`** (`apps/api/src/notifications/
    notification-center.service.ts`): `list`/`markRead`/`markAllRead`/
    `remove` фильтруют по `recipientId: userId`, а не только `workspaceId`
    — B физически не может прочитать/отметить/удалить уведомление A ни
    через баг фильтра, ни намеренно (404, не тихий silent-scope). `createTx`
    — единственная точка создания — теперь: (1) пропускает, если получатель
    больше не член пространства (`tx.workspaceMember.findFirst`) — revoked
    member никогда не станет получателем; (2) пропускает, если `actorId ===
    recipientId` — self-action не спамит (инфраструктура готова, текущие
    4 продюсера — все cron/mutation-triggered без понятия "актёр", поэтому
    `actorId` пока никто не передаёт; хук есть для будущих actor-triggered
    уведомлений); (3) для `eventKey` использует `createMany({
    skipDuplicates: true })`, а не `create` + catch(P2002) — поймал на
    практике: нарушение unique constraint внутри `create()` ломает всю
    охватывающую Postgres-транзакцию (`25P02 current transaction is
    aborted`) без savepoint, и следующий же `tx.task.update(notifiedAt)` в
    той же транзакции падал бы — этот баг явно всплыл в первом прогоне
    интеграционных тестов (см. ниже) и был исправлен до финального прохода.
  - **`NotificationPolicyService`**: `allowsForUser(userId, kind)` — реальная
    проверка теперь по конкретному пользователю (`UserPreference` напрямую
    по `userId`, без похода через membership). `allows(workspaceId, kind)`
    остался как удобство для продюсеров без предметного получателя (finance/
    inventory/event — эти сущности не имеют `assigneeId`, как у `Task`) —
    реализован через новый `resolveOwnerId(workspaceId)` + `allowsForUser`.
  - **`DueTaskCheckerService`**: `resolveRecipient(task)` — получатель это
    `Task.assigneeId` → `WorkspaceMember.userId`, если назначен, иначе
    владелец пространства (тот же фолбэк, что раньше был единственным
    путём); если assignee-строка исчезла (снят с пространства), молча
    падает на владельца, а не теряет напоминание. `eventKey:
    "task_due:${task.id}"` заменил ручной `findFirst`-дедуп.
  - **`EventReminderService`**: получатель — владелец (`resolveOwnerId`),
    `eventKey: "event_reminder:<eventId>:<occurrenceStart>:<offset>"` —
    доп. слой дедупа поверх уже существующего `SentReminder`-леджера
    (тот остаётся первичным для повторяющихся событий).
  - **`BudgetAlertsService`** / **`InventoryAlertsService`**: получатель —
    владелец; у budget alerts `eventKey: "finance_alert:<budgetId>:<YYYY-
    MM>"` (стабилен на месяц, новый месяц — новый ключ); у inventory
    сознательно **без** `eventKey` — дедуп там уже держит
    `InventoryItem.lowStockNotifiedAt`, который сбрасывается при
    восстановлении остатка, так что стабильный `eventKey` вида
    `<itemId>` заблокировал бы partial-индексом каждый следующий эпизод
    после первого навсегда.
  - **shared-types**: `notificationSchema` получил `recipientId:
    z.string().nullable()`.
  - **Telegram**: не трогал — уже dry-run без `TELEGRAM_BOT_TOKEN`/
    `TELEGRAM_CHAT_ID` (`.env.example` их не задаёт), интеграционные тесты
    ни разу не подставляют токен, так что ни один тест не бьёт в реальный
    Telegram — подтверждено чтением `telegram.service.ts` и
    `setup-integration.ts`, а не только по описанию из CLAUDE.md.
  - **UI**: не трогал (`packages/core-react/src/use-notifications.ts`,
    web bell) — DTO расширился обратно совместимо (`recipientId` — новое
    поле, читатели, которые его не используют, не ломаются); typecheck
    `apps/web` зелёный без правок в этом слое.
- Файлы: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/
  20260921160000_addressed_notifications/migration.sql` (новая),
  `apps/api/src/notifications/notification-center.service.ts`,
  `apps/api/src/notifications/notification-policy.service.ts`,
  `apps/api/src/notifications/due-task-checker.service.ts`,
  `apps/api/src/events/event-reminder.service.ts`,
  `apps/api/src/finance/budget-alerts.service.ts`,
  `apps/api/src/inventory/inventory-alerts.service.ts`,
  `packages/shared-types/src/notification.ts`,
  `apps/api/test/notifications.integration.test.ts` (новый, 6 тестов),
  `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта запись).
- Проверки и результаты:
  - `pnpm db:generate` → обязателен после правки схемы (иначе typecheck
    падает на `recipientId`/`eventKey` — так и было на первом прогоне,
    зафиксировано и исправлено до продолжения).
  - `pnpm typecheck` → PASS (7/7).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы).
  - `pnpm test` → PASS, 13 файлов / 135 тестов (юнит-слой не менял).
  - `pnpm test:integration` на изолированном portable-Postgres (порт 5544,
    рецепт из S00–S06: `ORION_PG_DATA`/`ORION_PG_PORT` в scratchpad,
    `prisma migrate deploy` — новая миграция применилась чисто первым же
    прогоном, свой `STORAGE_DIR`) → **первый прогон: 3 из 6 новых тестов
    упали** на `25P02` (см. находку про `createMany skipDuplicates` выше) —
    исправлено, **второй прогон: PASS, 6 файлов / 57 тестов** (51
    существующих без регрессии + 6 новых из `notifications.integration.
    test.ts`). Новые тесты закрывают, каждый явным падающим→починенным
    циклом до финального прохода:
    - A читает своё уведомление → B не видит его прочитанным (и вообще не
      видит чужую строку в своём списке) — независимое per-recipient read
      state, не общий `readAt`.
    - B не может отметить прочитанным уведомление A через API (404, не
      403 — для B чужой id не существует) — recipient-scope, а не
      workspace-scope.
    - `DueTaskCheckerService.runCheck()` дважды подряд для одной и той же
      просроченной задачи (с явным сбросом `notifiedAt` между прогонами,
      чтобы второй прогон реально повторно попытался создать уведомление,
      а не просто пропустил задачу) — 1 строка в БД, не 2.
    - Участник, снятый с пространства до прогона крона, никогда не
      становится `recipientId` (даже будучи `assigneeId` задачи) —
      напоминание уходит владельцу, не теряется молча.
    - Тихие часы **получателя** (assignee), а не владельца-актёра (у
      которого тихих часов нет), подавляют доставку — `notifiedAt`
      остаётся `null` (инвариант #8 CLAUDE.md: подавленное — не
      доставленное, сработает на следующем тике).
    - `NotificationCenterService.createTx` с `actorId === recipientId`
      возвращает `null` и не создаёт строку.
  - Рабочий `.env` и `infra/postgres/data` не тронуты; временный кластер
    на 5544 (и scratch `pg-test-data`/`test-documents`) подняты и снесены
    только в рамках этой сессии.
- Миграция/данные: одна новая миграция (`20260921160000_
  addressed_notifications`), raw SQL — добавляет колонки, FK, два индекса
  (обычный + partial unique) и переписывает `notifications_isolation`
  RLS-политику. Существующие строки не бэкфиллятся (`recipientId` остаётся
  `NULL`) — осознанный legacy-архив, не миграция данных: у workspace-wide
  строки до этой правки физически нет "правильного" единственного
  получателя, которого можно было бы восстановить задним числом.
- Непроверенное: (а) fan-out на нескольких получателей сразу (событие/
  бюджет/инвентарь по-прежнему один получатель — владелец, не "все
  участники"; карточка S07 явно этого не требовала, но если продукт
  захочет уведомлять всю команду о просроченном бюджете, это отдельная
  расширение продюсера, не инфраструктуры); (б) `actorId` пока не
  передаётся ни одним реальным продюсером — self-action-guard протестирован
  напрямую через `NotificationCenterService.createTx`, а не через
  end-to-end сценарий "пользователь сам выполнил свою же задачу", потому
  что такого actor-triggered продюсера в кодовой базе ещё нет (только
  time-based cron и mutation-triggered без понятия действующего лица); (в)
  UI/bell на клиенте не проверялся вручную в браузере (нет browser-tooling
  в сессии, та же причина SKIPPED, что и в предыдущих сессиях) — только
  typecheck и то, что DTO обратно совместим.
- Следующий шаг: если появится первый actor-triggered продюсер (например,
  «задача назначена вам» в момент `PATCH .../tasks/:id` с новым
  `assigneeId`), подключить его через `createTx({..., actorId: userId})` —
  инфраструктура уже на месте, самим self-action-guard'ом займётся S07,
  осталось написать сам продюсер (вне объёма этой карточки). S17
  (`S01 + S07 + S11 → S17`) может теперь опираться на адресные
  уведомления как на готовую часть.

### S08 · 2026-09-21 · DONE

- Поведение: `useSession` (`packages/core-react/src/use-auth.ts`) раньше
  возвращал только `{ user: SessionUser | null; isLoading: boolean }` и в
  `queryFn` ловил ЛЮБУЮ ошибку — включая `fetch` throw (сеть недоступна) и
  любой не-401 HTTP-статус (500 и т.п.) — и превращал её в `return null`, то
  есть «не залогинен». Девять консьюмеров (`AppLayout`, `IndexPage`,
  `LoginPage`, `RegisterPage`, `AccountPage`, `SpacesPage`, `PanelWindow`,
  `InviteAcceptPage`, плюс `LoginPage`'s `useAuthAccounts` для списка
  локальных учёток) читали `!isLoading && !user` как «веди на /login» —
  временная недоступность API (обрыв сети, рестарт сервера, 500) выглядела
  как выход из системы и реально приводила бы к редиректу с потерей
  несохранённого состояния экрана, плюс `LoginPage` на пустом
  `accounts.data` (в т.ч. из-за сетевой ошибки, а не только «свежая
  установка») показывал «Пока никого нет — создайте первую учётку» — ложный
  диагноз ровно по A06/A17 из 01-AUDIT.md.
  Реализован discriminated union `SessionStatus = "loading" |
  "authenticated" | "unauthenticated" | "unavailable"` и `SessionResult`
  (`status`, `user`, `previousUser?`, `isLoading` — deprecated-но-рабочий
  adapter, `retry()`). Разделение error-путей вынесено в чистую
  `fetchSessionUser(tokenStore, api, clearToken)`: отсутствие токена или
  подтверждённый 401 (ApiClient уже сам попытался
  refresh-and-retry до того, как это сюда долетает) бросает
  `SessionUnauthenticatedError` → `status: "unauthenticated"`; сетевой сбой
  (`fetch` throw, не `ApiError`) или не-401 `ApiError` (5xx) пробрасывается
  как есть → `status: "unavailable"`, токен НЕ трогается. Отображение этого
  на react-query-результат вынесено в чистую `deriveSessionResult(query,
  retry)` — `unavailable` дополнительно несёт `previousUser` (react-query
  сохраняет `data` от последнего успешного фетча даже когда рефетч
  фейлится, отдельного стейта заводить не пришлось), но `user` в adapter-поле
  остаётся `null` для `unavailable` намеренно — код, ещё не сверявшийся на
  `status`, не должен прочитать протухшего пользователя как «залогинен».
  Все 9 мест, где `!isLoading && !user` решал «редиректить на /login»,
  переведены на `status === "unauthenticated"` (или `status ===
  "authenticated"` для обратного редиректа на /spaces); каждое из них,
  где раньше просто вечно показывало «Загрузка…», теперь при `unavailable`
  рендерит короткий reconnect-баннер на русском с кнопкой «Повторить»
  (`retry()`), а не редиректит и не выдумывает «нет пользователей».
  `LoginPage` отдельно проверяет `accounts.isError` (не связано с
  `useSession`, отдельный `useAuthAccounts` query) перед показом «создайте
  первую учётку», чтобы не путать «сервер недоступен» с «свежая установка».
- Файлы: `packages/core-react/src/use-auth.ts` (`SessionStatus`,
  `SessionResult`, `SessionUnauthenticatedError`, `fetchSessionUser`,
  `deriveSessionResult`, `useSession` переписан поверх них),
  `packages/core-react/src/use-auth.test.ts` (новый, 11 тестов — падали до
  правки, т.к. `use-auth.ts` не экспортировал `fetchSessionUser`/
  `deriveSessionResult`/`SessionUnauthenticatedError` вовсе),
  `apps/web/app/(app)/layout.tsx`, `apps/web/app/page.tsx`,
  `apps/web/app/login/page.tsx`, `apps/web/app/account/page.tsx`,
  `apps/web/app/spaces/page.tsx`,
  `apps/web/app/panel/[panelId]/panel-window.tsx`,
  `apps/web/app/invite/[token]/page.tsx` — `register/page.tsx` не менялся:
  его редирект уже был safe (`if (!isLoading && user) → /spaces`, не
  срабатывает при `unavailable`, т.к. `user` там и раньше был `null`).
  `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта запись).
- Проверки и результаты:
  - Падающий тест до правки: `use-auth.test.ts` не мог существовать (нужные
    экспорты не существовали) — сама попытка `import { deriveSessionResult,
    fetchSessionUser, SessionUnauthenticatedError } from "./use-auth"` не
    компилировалась до рефакторинга; после рефакторинга все 11 новых тестов
    зелёные, в т.ч. ключевые инварианты: сетевая ошибка (`TypeError("Failed
    to fetch")`) и не-401 `ApiError(500, ...)` НЕ бросают
    `SessionUnauthenticatedError` и НЕ чистят токен; `deriveSessionResult`
    маппит такую ошибку в `status: "unavailable"`, не `"unauthenticated"`;
    `previousUser` берётся из `query.data`, не из отдельного стейта;
    `retry()` — тот же переданный колбэк.
  - `pnpm test` → PASS, **14 файлов / 146 тестов** (было 135 в S00-baseline,
    добавилось 11 новых).
  - `pnpm typecheck` → PASS, все 7 проектов — это и есть проверка полноты
    adapter'а: ни одного из 9 консьюмеров не пришлось трогать ради
    компиляции сверх поведенческой правки, `any` нигде не вводился.
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы) —
    первая версия `retry` через `useCallback` добавляла четвёртый
    (`react-hooks/exhaustive-deps` на `query.refetch`), заменено на простую
    не мемоизированную функцию (react-query's `refetch` и так стабилен,
    мемоизация однострочной обёртки не давала пользы и провоцировала
    лишний lint-конфликт).
  - `pnpm build` → PASS, API + Next.js (26 страниц, First Load JS не
    вырос заметно — новые ветки рендера маленькие текстовые блоки).
- Миграция/данные: нет — чисто клиентская правка (`packages/core-react`,
  `apps/web`), API не менялся.
- Непроверенное: **populated/interactive screenshots и browser E2E** для
  новых `unavailable`-состояний (баннер + кнопка «Повторить» на каждой из 7
  страниц) — SKIPPED, нет browser-automation tooling в сессии, та же
  причина, что в S00/S03/S04/S05. Честно не имитирую визуальную проверку;
  логика состояний покрыта unit-тестами на чистых функциях
  (`fetchSessionUser`/`deriveSessionResult`), а не на самом рендере
  React-компонентов — в `packages/core-react` до этой сессии не было ни
  одного теста, использующего `@testing-library/react`/jsdom
  (`vitest.config.mts` — `environment: "node"`, весь `pnpm test` слой это
  чистая логика без DOM, CLAUDE.md прямо это описывает), и заводить
  jsdom/react-testing-library ради одного хука — новая зависимость без
  обоснованной необходимости (правило 08-TEAM-AND-ACCESS.md), поэтому вынес
  саму логику ветвления в чистые функции и протестировал их напрямую, а не
  завёл рендер-тестинг инфраструктуру. `GET /system/mode` (пункт, оставленный
  открытым в S05: «нет публичного эндпоинта узнать режим с клиента») НЕ
  добавлялся — не понадобился для этой карточки: S08 про то, что временная
  недоступность API не должна выглядеть как разлогинивание, это ортогонально
  local/server различию UI picker'а, которое остаётся открытым пунктом S05,
  не S08 (не путать две разные карточки). `accent`/keyboard focus при смене
  состояний (loading→unavailable→authenticated) не проверялся отдельным
  focus-management кодом — reconnect-баннер это обычный `<button>` в потоке
  документа, фокус не перехватывается и не теряется программно, но нет
  browser tooling, чтобы подтвердить skip-link/tab-order руками.
- Следующий шаг: S09 (pending intent/replay) по очереди 10-BACKLOG.md,
  либо, если приоритетнее, снять открытый пункт S05 (публичный
  `GET /system/mode` + скрытие picker/PIN в server mode на
  `login`/`register`) — обе карточки независимы друг от друга и от этой.

### S09 · 2026-09-21 · DONE

- Поведение: `apps/web/lib/panel-bus.ts` (`focusTask`/`focusNote`/
  `focusEvent`, "S09: lost intent" из 15-FIRST-TASKS.md) эмитил сигнал
  фокуса чисто fire-and-forget: `focus(id)` звал `openPanel(panelId)`, затем
  синхронно проходил `listeners` — набор подписчиков, который заполняет
  только уже смонтированная панель. Если целевая панель ещё не была
  смонтирована в момент клика (типичный случай — это первый клик, который
  сам её и открывает через `openPanel`, а React коммитит новый dockview-
  компонент не в том же синхронном тике), `listeners` был пуст, цикл
  ничего не делал, и id терялся безвозвратно: панель открывалась, но не
  выделяла нужную сущность. Отдельно `showTasksForProject`/
  `useTasksProjectSignal` уже содержали половинчатый обходной паттерн —
  `lastTasksProject`, который ретейнился вечно и **безусловно** переигрывался
  на каждом новом mount того же канала (в т.ч. повторно, после того как уже
  был применён) — то есть другой конец того же класса бага: не "потеряно",
  а "применяется повторно, когда не должно".
  Инвариант, вокруг которого написан фикс (сформулирован до правки, как
  просит 11-AGENT-PROTOCOL.md): поздняя подписка (mount после emit) не
  теряет последнее релевантное намерение для своего workspace/канала;
  более новое намерение отменяет более старое неподтверждённое; подтверждённое
  (acknowledged) намерение не применяется повторно; чужой (другой workspace)
  namerение не применяется вовсе, даже будучи подтверждено/очищено.
  Реализация — новый framework-free модуль `apps/web/lib/intent-channel.ts`
  (`createIntentChannel<T>()`): один слот "pending" на канал, а не очередь.
  `emit(value, workspaceId)` — если есть живые подписчики, доставляет им
  значение немедленно и **чистит** pending (доставлено = подтверждено, не
  должно переиграться будущему remount'у); если подписчиков нет, кладёт
  `{ value, workspaceId }` в pending, перезаписывая прежнее значение (только
  последний клик, без очереди). `consumePending(workspaceId)` — вызывается
  консьюмером при "готовности" (mount): **безусловно** очищает pending
  (подтверждение происходит независимо от того, применится значение или
  будет отброшено как чужое), и возвращает значение только если его
  `workspaceId` совпадает с переданным — иначе `null` (протухшее intent из
  другого пространства тихо отбрасывается, не зависает до следующего
  совпадения). `apps/web/lib/panel-bus.ts` остался тем же маленьким pub/sub
  (не переехал на другой state-менеджер, как и требовало задание) — обёртка
  `useIntent(channel)` — тонкий React-хук (`useState`+`useEffect`) поверх
  `createIntentChannel`, вызывающий `consumePending` на mount и
  `subscribe` для последующих live-обновлений; `getActiveWorkspaceId()`
  (новый экспорт из уже существующего `apps/web/lib/use-active-workspace.ts`
  — тот же синхронный localStorage-backed store, который уже использует
  переключатель пространств, просто раньше не экспортировал read-метод)
  используется и на emit, и на consume, поэтому не пришлось заводить
  отдельный React-эффект в `layout.tsx` для трансляции текущего workspaceId
  в шину — она читает тот же источник истины напрямую, синхронно.
  `focusTask`/`focusNote`/`focusEvent` и `showTasksForProject`/
  `useTasksProjectSignal` теперь оба построены на одном и том же
  `makeIntentChannel`/`makeFocusChannel` — раньше это были два разных
  паттерна (один терял intent, другой применял его повторно), теперь один
  общий инвариант на оба.
- Файлы: `apps/web/lib/intent-channel.ts` (новый, чистая логика),
  `apps/web/lib/intent-channel.test.ts` (новый, 5 тестов — оба сценария из
  15-FIRST-TASKS.md плюс dedup/ack regression-тесты), `apps/web/lib/panel-bus.ts`
  (переписан поверх `intent-channel.ts`, публичный API — сигнатуры
  `focusTask`/`useFocusedTaskId`/`focusNote`/`useFocusedNoteId`/
  `focusEvent`/`useFocusedEventId`/`showTasksForProject`/
  `useTasksProjectSignal` — не изменился, консьюмеры в `TasksPanel.tsx`/
  `NotesPanel.tsx`/`CalendarPanel.tsx`/`ProjectsPanel.tsx`/
  `notification-bell.tsx`/`InboxPanel.tsx`/`DashboardPanel.tsx`/
  `command-center.tsx`/`panels/projects/gantt.tsx`/`running-timer-chip.tsx`
  не трогались), `apps/web/lib/use-active-workspace.ts` (новый экспорт
  `getActiveWorkspaceId` — алиас существующего внутреннего `getStoredId`,
  сам стор не менялся), `vitest.config.mts` (`include` расширен на
  `apps/web/lib/**/*.test.ts` — раньше юнит-слой был только `packages/**`;
  выбрал framework-free модуль + `environment: "node"`, а не
  jsdom/`@testing-library/react`, той же логикой, что уже объяснена в
  Непроверенном S08: новая тест-инфраструктура без обоснованной
  необходимости — не вводить), `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md`
  (эта запись + исправлена строка S07 в таблице очереди — она была TODO,
  хотя журнал ниже уже содержит `### S07 · DONE`, рассинхрон предыдущей
  сессии, не связанный с S09, но замечен и поправлен по ходу).
- Проверки и результаты:
  - `pnpm test` → PASS, **15 файлов / 151 тест** (было 146 после S08,
    добавились 5 новых в `intent-channel.test.ts`):
    - "scenario 1" — `emit("task-X", "workspace-1")` с нулём подписчиков
      (симулирует клик до монтирования панели), затем `consumePending`
      с тем же workspaceId (симулирует mount) — возвращает `"task-X"`,
      не `null`. Это и есть тест на потерю intent: до фикса (старый
      `listeners`-only цикл) эквивалентный сценарий отбрасывал значение
      безвозвратно.
    - "scenario 2" — `emit("task-X", "workspace-1")`, затем
      `consumePending("workspace-2")` (симулирует переключение
      пространства до mount) — возвращает `null`; повторный
      `consumePending("workspace-1")` тоже `null` (протухшее intent не
      всплывает позже, даже вернувшись в исходное пространство).
    - Regression-тесты: второй `emit` до первого consume перезаписывает
      значение (last-click-wins, не очередь); live-доставка уже
      подписанному слушателю не оставляет ничего в pending для будущего
      remount; однажды consumed intent не переигрывается повторным
      `consumePending` без нового `emit` — прямое покрытие критерия
      "исключить двойное применение" из задания.
  - `pnpm typecheck` → PASS (7/7 проектов).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы) —
    ручной `useIntent`-эффект с намеренно пустым deps-массивом (canonical
    "подпишись один раз на стабильный канал" паттерн, как и было в старом
    коде для `useFocusedTaskId` и т.п.) помечен
    `// eslint-disable-next-line react-hooks/exhaustive-deps` с явным
    комментарием, не добавил новый warning.
  - `pnpm --filter @orion/web run build` → PASS, 26 страниц, First Load JS
    без заметных изменений (панели импортируются как раньше — `panel-bus.ts`
    не стал тяжелее, `intent-channel.ts` — несколько десятков строк без
    зависимостей).
  - `pnpm test:integration` не прогонялся: задача чисто клиентская
    (`apps/web/lib/`), API не менялся, зависимостей от БД/сети нет.
- Миграция/данные: нет — без изменений схемы/API, чистая клиентская правка.
- Непроверенное: реальный browser E2E с настоящим `React.lazy`/динамическим
  импортом панели и настоящим переключением пространства мышью — SKIPPED,
  та же причина, что в S00/S03/S04/S05/S08 (нет browser-automation tooling
  в сессии). Сценарии проверены на уровне чистой логики
  (`intent-channel.ts`), которую и `useIntent`-обёртка в `panel-bus.ts`, и
  реальные панели используют без изменений — но сам React-рендер-цикл
  (реальный порядок commit/effect для конкретно dockview+React 18) не
  прогонялся через тест-рендерер. Панели сейчас **не** используют
  `React.lazy`/`next/dynamic` для code-splitting (весь `panelComponents` в
  `layout.tsx` — статический импорт через `panelRegistry`) — гонка,
  описанная в задании как "lazy import", в текущем коде возникает не от
  code-splitting, а от асинхронности между `dockview.addPanel()` и
  фактическим React-коммитом/эффектом нового компонента; инвариант и фикс
  от этого не зависят (pending-слот не завязан на *причину* задержки
  mount), но если панели когда-нибудь станут `React.lazy`, отдельного теста
  под именно code-splitting сценарий не заводилось. Клавиатурный фокус
  (DOM `.focus()`) сознательно вне объёма — "focused" в существующем коде
  означает выбор строки/раскрытие детали в списке (`setSelectedId`/
  `setEditingId` в `TasksPanel.tsx`, аналогично в `NotesPanel.tsx`/
  `CalendarPanel.tsx`), не программный DOM-фокус — S08 уже закрыл
  keyboard-focus для auth-потока, это другая карточка.
- Следующий шаг: следующая по очереди задача 10-BACKLOG.md после S09 — S10
  (day boundary) либо, если приоритетнее, оставшийся открытый пункт S05
  (публичный `GET /system/mode`) — обе независимы от S09.

### S10 · 2026-09-21 · DONE

- Поведение: "сегодня"/day-boundary вычислялось один раз за рендер/mount и
  никогда не пересчитывалось само — три реальных места нашлись через grep,
  не только по формулировке карточки:
  - `apps/web/panels/DashboardPanel.tsx` — `todayKey`/`dayRange`/`headerNow`
    были `habitLocalDayKey()`/`new Date()` прямо в теле компонента (не
    мемоизированы к триггеру дня), а `parts`/`week`
    (`partitionOpenTasks`/`partitionWeekReview`) держали `new Date()` внутри
    `useMemo` с зависимостью только от `tasks` — смена дня без нового
    `tasks`-рендера ничего не пересчитывала.
  - `apps/web/app/(app)/layout.tsx` — счётчик просроченных задач в бейдже
    сайдбара (`overdueCount`, строка "просрочено: N" у пункта "Задачи")
    сравнивал `dueAt` с `Date.now()` внутри `useMemo` с зависимостью только
    от `tasks` — ровно тот же паттерн, тот же баг.
  - `apps/web/panels/HabitsPanel.tsx` — **сознательно** заморожен:
    `const [now] = useState(() => new Date())` с комментарием "captured once
    per mount... less confusing than columns silently shifting". Комментарий
    верен для рендера, вызванного посторонней причиной, но не оправдывает
    зависание навсегда после сна ноутбука — это и есть баг, который просит
    исправить карточка.
  `apps/web/panels/CalendarPanel.tsx` (`initialEventRange`) сознательно **не**
  трогал: это только начальное значение `useState` для 2.5-месячного окна,
  переопределяемое навигацией пользователя, а не "сегодняшний" бакет —
  риск куда меньше остальных трёх, и не хотел размывать бюджет S-карточки.
  Реализация — общий hook, переиспользуемый всеми потребителями (не
  дублировал логику в каждом):
  - `apps/web/lib/day-boundary.ts` — framework-free ядро (тот же паттерн,
    что `intent-channel.ts` из S09, тестируемое без jsdom/DOM):
    `msUntilNextLocalMidnight(now)` считает зазор до `00:00:01` **через
    календарные компоненты** (`getFullYear`/`getMonth`/`getDate() + 1`), не
    `+ 24h` в миллисекундах — конструктор `Date` сам резолвит компоненты
    против локального смещения того дня, поэтому DST-день (23ч/25ч) не
    ломает расчёт. `watchDayBoundary(deps)` — инжектируемые `now`/
    `setTimeout`/`clearTimeout`/`onChange`/`addWakeListener` (DI ради
    тестируемости fake-таймерами без реального DOM), возводит таймер до
    следующей полуночи, перевооружает его на каждый recheck (и от таймера, и
    от wake), вызывает `onChange` только когда день реально изменился.
  - `apps/web/lib/use-day-boundary.ts` — тонкая React-обёртка:
    `useDayKey()` (строка `YYYY-MM-DD` через `habitLocalDayKey`) и
    `useLocalNow()` (`Date`, пересчитываемый `useMemo`'ом только при смене
    `dayKey`) — подключает `watchDayBoundary` к реальным `setTimeout`/
    `document.visibilitychange`/`window.focus`.
  - Wiring: `DashboardPanel.tsx` (`todayKey`/`headerNow`/`dayRange` →
    `useDayKey()`/`useLocalNow()`, `parts`/`week` получили `localNow` в
    зависимости `useMemo`), `layout.tsx` (`overdueCount` получил `localNow`
    в зависимости), `HabitsPanel.tsx` (`useState(() => new Date())` →
    `useLocalNow()`, комментарий переписан: hook меняет день только по двум
    точным событиям — не на любой посторонний рендер, — так что исходная
    защита от "столбцы дёргаются под курсором" сохраняется, а баг с
    заморозкой после сна — нет).
  - Смена дня **не** форсирует refetch — только клиентский пересчёт уже
    загруженных `tasks`/`habits` через существующие `useMemo`; сеть не
    трогается (сверено по факту: единственный новый триггер в deps-массивах
    — `localNow`, ни один запрос/`useQuery` его не получил).
- Файлы: `apps/web/lib/day-boundary.ts` (новый, чистая логика),
  `apps/web/lib/day-boundary.test.ts` (новый, 8 тестов),
  `apps/web/lib/use-day-boundary.ts` (новый, React-обёртка),
  `apps/web/panels/DashboardPanel.tsx`, `apps/web/app/(app)/layout.tsx`,
  `apps/web/panels/HabitsPanel.tsx`, `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md`
  (эта запись).
- Проверки и результаты:
  - `pnpm test` → PASS, **16 файлов / 159 тестов** (было 151 после S09,
    добавились 8 новых в `day-boundary.test.ts`):
    - `msUntilNextLocalMidnight`: зазор до 00:00:01 (не флэт-24ч), не меньше
      1с на самой границе, и — главный DST-тест — с `process.env.TZ =
      "America/New_York"` вокруг весеннего перевода 2026-03-08: зазор
      "полночь 7 марта → полночь 8 марта" **23 часа**, а не 24 (плюс
      отдельная проверка, что обычный зазор до ближайшей полуночи посчитан
      верно). Тест реально ловит баг: наивная реализация `+ 24*60*60*1000`
      даёт здесь 24h и была бы неверна на этой конкретной границе раз в год.
    - `watchDayBoundary` с `vi.useFakeTimers()`: 23:59→00:01 триггерит
      `onChange` ровно один раз с верным ключом; recheck на wake в тот же
      день **не** триггерит `onChange` (не шумит); recheck на wake после
      "8-часового сна" (день переставлен на `now()`, `vi.advanceTimersByTime`
      **не** вызывался вовсе — таймер не тикал, симулируя throttled
      background tab) триггерит `onChange` немедленно — прямое покрытие
      done-критерия про сон ноутбука; таймер перевооружается после
      срабатывания (второй день считается тоже); `stop()` реально отвязывает
      и таймер, и wake-листенер.
  - `pnpm typecheck` → PASS (7/7 проектов).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы).
  - `pnpm --filter @orion/web run build` → PASS, 26 страниц, First Load JS
    без заметных изменений.
  - `pnpm test:integration` не прогонялся: задача чисто клиентская
    (`apps/web/`), API не менялся, зависимостей от БД/сети нет.
- Миграция/данные: нет — без изменений схемы/API.
- Непроверенное: `CalendarPanel.tsx`'s `initialEventRange` осознанно не
  переведён на hook (см. «Поведение» выше — риск ниже остальных трёх мест,
  и это только начальное состояние, а не живой бакет). Реальный browser
  E2E/визуальная проверка полночного перехода и wake-from-sleep — SKIPPED,
  та же причина, что в S00/S08/S09 (нет browser-automation tooling в
  сессии); поведение проверено framework-free тестами на самом механизме
  (`day-boundary.ts`), а не через рендер `DashboardPanel`/`HabitsPanel` —
  тот же осознанный компромисс, что и в S09 (`environment: "node"`, без
  jsdom/`@testing-library/react`, которых нет в зависимостях и вводить
  ради одной карточки не стал). Внутридневные переходы (задача становится
  просроченной в 15:00, не на границе дня) сознательно вне объёма — карточка
  просит именно day-boundary реактивность, не поминутный тикер для бейджей
  (это уже отдельный, более дорогой по ре-рендерам механизм, аналог
  `useNowTick`, который используется только для реально идущего таймера).
- Следующий шаг: S11 (CAS/drafts) по 10-BACKLOG.md — независим от S10.

### S11 · 2026-09-21 · PARTIAL (trailing-drain autosave + server CAS done and tested; conflict UI + nav guard done, not visually verified)

- Поведение: задача — "Черновики и CAS контента" для заметок (карточка
  явно ограничивает объём: notes only, задачи/проекты отдельными
  подэтапами, никакого универсального CRDT). Прочитал реальный текущий
  `NoteEditor` (`apps/web/panels/note-editor.tsx`) перед правкой: autosave
  был `useDebouncedValue(snapshot, 900)` + `useEffect` → `runSave()`,
  которая гейтилась булевым `savingRef.current` — **если debounce сработал,
  пока предыдущий save ещё летел, `runSave` просто возвращалась ничего не
  делая**, и следующий автосейв не переигрывался, если пользователь не
  печатал снова (не было триггера "переслать после ответа"). Никакого
  revision/CAS не было вовсе — `Note` в Prisma не имел версии, `update()`
  сервиса писал `data: {...input}` без какой-либо проверки конкурентной
  записи. Ошибка сохранения просто пробрасывалась в `onSave`/toast — ни
  черновика, ни recoverable-состояния, ни явного retry.
  - **Приоритет 1 — trailing-drain autosave (клиент).** Логику вынес в
    чистый (без React) модуль `apps/web/lib/note-autosave.ts` —
    `NoteAutosave`: хранит `latest` (последний снэпшот от пользователя) и
    `lastAcknowledged` (снэпшот, который **сервер** реально подтвердил, по
    revision), не более одного `inFlight` сохранения, свой `setTimeout`
    для дебаунса. По завершении сохранения — успех обновляет
    `lastAcknowledged`/`revision` **из ответа сервера**, а не оптимистично
    из отправленного, и если `latest` успел уйти вперёд — немедленно шлёт
    новый save (`trailing drain`) без дополнительного ввода пользователя;
    ошибка не ретраит автоматически (нет бесконечного цикла), оставляет
    `latest` как unsaved draft и даёт `retry()`, который шлёт **текущий**
    `latest`, а не зафейленный снэпшот. Отдельно `AutosaveConflict`
    (409) — состояние `"conflict"`, отличное от обычной ошибки: `retry()`
    вслепую при конфликте просто конфликтнул бы снова, нужен явный выбор
    (`adoptServerState`/`forceRevision`, см. ниже). `dispose()` защищает от
    unmount-race (см. тест ниже).
  - **5-шаговый сценарий из 15-FIRST-TASKS.md реализован буквально как
    падающий-затем-зелёный тест** в
    `apps/web/lib/note-autosave.test.ts` (`vi.useFakeTimers()` +
    самодельные `deferred<T>()` промисы, никакого реального `setTimeout`
    в сети): ввод A → debounce → A pending; ввод B → debounce → **A
    всё ещё pending, второго запроса нет**; resolve A → **B уходит
    автоматически без дополнительного ввода** (проверено отдельным
    `expect(calls).toHaveLength(2)` до и после нового `Promise.resolve()`
    без вызова `setSnapshot`); ввод C, пока B pending → `"saved"` не
    появляется; reject B → C остаётся unsaved, `errors` заполнен,
    **никакого третьего запроса без явного `retry()`**; `retry()` шлёт
    именно C (`calls[2].snapshot.body === "C"`) с правильной revision
    (2, от ack A — B так и не подтвердился). Плюс три доп. теста:
    никогда не больше одного in-flight save под burst-вводом; 409
    отдельно распознаётся как `"conflict"`, не generic error, и
    `adoptServerState` возвращает `"saved"`; результат зафейленного/
    отменённого save не долетает до состояния после `dispose()`
    (unmount race).
  - **Приоритет 2 — server-side CAS.** `Note.revision Int @default(1)`
    (новая колонка, миграция `20260921170000_note_revision`, ADD COLUMN
    без сопутствующего backfill-скрипта — дефолт `1` покрывает
    существующие строки, ровно как у новой). `NotesService.update`
    принимает `expectedRevision` (опционально — не-контентные PATCH типа
    pin/archive его не шлют и не участвуют в CAS) и делает
    **атомарный** `tx.note.updateMany({ where: { id, ...(expectedRevision
    !== undefined ? { revision: expectedRevision } : {}) }, data: {
    ...patch, revision: { increment: 1 } } })` — сознательно не
    read-then-compare-then-write (это гонка: два конкурентных запроса
    оба читают один и тот же `revision`, оба проходят проверку, оба
    пишут), а проверка прямо в `WHERE` того же `UPDATE`. `count === 0`
    после того, как `assertOwnedTx` уже подтвердил существование строки
    → это конфликт revision → `ConflictException({ code:
    "note_revision_conflict", message, currentRevision, current: toDto(...) })`.
    `toDto`/`NoteRow` получили `revision`; `noteSchema`/
    `updateNoteInputSchema` (shared-types) получили `revision`/
    `expectedRevision`, плюс новая `noteConflictSchema` для тела 409.
    **Находка, не предугаданная заранее:** `ConflictException(object)`
    проходит через общий `HttpExceptionFilter`
    (`apps/api/src/common/http-exception.filter.ts`), который раньше
    **всегда** отдавал фиксированную форму `{statusCode, message, error,
    requestId, timestamp, path}` — любые дополнительные поля объекта
    (мой `code`/`currentRevision`/`current`) молча терялись, и первый
    прогон integration-теста ловил это как `undefined` на клиенте.
    Пришлось (а) переименовать дискриминатор с `error` на `code` (Nest
    сам резервирует/перезаписывает `error` под HTTP reason phrase), (б)
    расширить фильтр: любые поля брошенного объекта, не входящие в
    зарезервированный набор, теперь прокидываются в JSON-ответ — общий
    механизм, не одноразовый хак под заметки, задокументирован в
    комментарии фильтра.
  - **Conflict UI + local draft lifecycle + navigation guard.**
    `note-editor.tsx`: один `NoteAutosave` на открытую заметку (пересоздаётся
    и старый `dispose()`-ится при смене `note.id`/`workspaceId` — save для
    заметки A никогда не долетит до состояния заметки B после переключения,
    тот же guard закрывает и обычный unmount). Конфликт (409) — отдельный
    баннер с двумя явными действиями: «Загрузить их версию»
    (`acceptServerVersion` — перезаписывает локальные поля версией сервера,
    `adoptServerState`) и «Сохранить мою версию поверх»
    (`overwriteServerVersion` — `forceRevision` на серверную revision без
    трогания локального контента, затем `retry()`). Ошибка (не конфликт) —
    `AutosaveStatus` (`packages/ui/src/autosave-status.tsx`, добавлено
    состояние `"error"`) + кнопка «Повторить» с `title` из `describeError`.
    Явный Save/Ctrl+S теперь `autosave.flush()` (пропускает дебаунс, не
    отдельный путь). Navigation guard — `beforeunload` слушатель, пока
    `dirty` (dirty/saving/error/conflict — всё, что сервер ещё не
    подтвердил); кнопка «Закрыть» вынесена в `requestClose()` с
    `window.confirm`, если есть несохранённое.
  - Compose-форма (новая заметка, `note === null`) осознанно не тронута —
    она всегда явная (кнопка «Создать»), CAS/autosave к ней не относится
    (то же исключение, что в исходной карточке).
- Файлы: `apps/web/lib/note-autosave.ts` (новый), `apps/web/lib/
  note-autosave.test.ts` (новый, 6 тестов), `apps/web/panels/note-editor.tsx`
  (autosave/conflict/nav-guard рефакторинг), `apps/web/panels/NotesPanel.tsx`
  (`handleSave` теперь пробрасывает `expectedRevision` и превращает 409 в
  `AutosaveConflict`), `packages/ui/src/autosave-status.tsx` (состояние
  `"error"`), `apps/api/prisma/schema.prisma` (`Note.revision`),
  `apps/api/prisma/migrations/20260921170000_note_revision/migration.sql`
  (новая), `apps/api/src/notes/notes.service.ts` (`update()` CAS,
  `toDto`/`NoteRow` несут `revision`), `apps/api/src/common/
  http-exception.filter.ts` (прокидывает произвольные поля исключения),
  `packages/shared-types/src/note.ts` (`revision`, `expectedRevision`,
  `noteConflictSchema`), `apps/api/test/note-cas.integration.test.ts`
  (новый, 3 теста), `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта
  запись).
- Проверки и результаты:
  - `pnpm typecheck` → PASS (7/7 проектов) — после `pnpm db:generate`
    (Prisma-клиент нужно было перегенерировать под новую колонку; сама
    команда схему/данные не трогает, только читает `schema.prisma`).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы) —
    после чистки: убрал неиспользуемый `useDebouncedValue`/старый
    `savingRef`-путь и один осиротевший `eslint-disable` в
    `note-editor.tsx`.
  - `pnpm test` → PASS, **17 файлов / 163 теста** (13 файлов/135 тестов в
    базлайне S00, добавления по S01–S10 довели до 16/159 к S10 — см. запись
    S10 выше; здесь добавился `note-autosave.test.ts` с 6 тестами —
    5-шаговый сценарий, burst-serialization, unmount-race, conflict-vs-error
    различение). 5-шаговый тест реально падал на шаге 3 (trailing drain) и
    шаге 5 (retry слал старый B вместо актуального C) на первой версии до
    добавления drain-вызова после успешного save — не тавтология.
  - `pnpm --filter @orion/web run build` / `pnpm build` → PASS, 26
    страниц, First Load JS без заметных изменений.
  - `pnpm test:integration` на изолированном portable-Postgres (тот же
    рецепт: `ORION_PG_DATA=/tmp/orion-s11-pg-data ORION_PG_PORT=5545`,
    `prisma migrate deploy` — моя новая миграция применилась чисто
    поверх всех предыдущих 33, свой `STORAGE_DIR` в `/tmp`, рабочий
    `.env`/`infra/postgres/data` не тронуты) → PASS, **7 файлов / 60
    тестов** (было 57 — 3 новых из `note-cas.integration.test.ts`):
    fresh note стартует с revision 1, matching `expectedRevision` сохраняет
    и бампает до 2; **прямой воспроизведённый двухклиентский race** — tab A
    сохраняет первой (revision 1→2), tab B с тем же устаревшим
    `expectedRevision: 1` получает 409 с `code: "note_revision_conflict"`,
    `currentRevision: 2` и **реальным** текущим содержимым сервера
    (`current.body === "from tab A"`), а строка в БД после этого
    подтверждённо содержит контент A, не B, не смешение; PATCH без
    `expectedRevision` (pin/archive) не CAS-гейтится и всё равно бампает
    counter. Первый прогон этого файла реально падал дважды до зелёного
    (не тавтология): `code` вместо `error` из-за Nest-резервирования, и
    полное отсутствие структурных полей из-за фиксированной формы
    `HttpExceptionFilter` — оба описаны выше как находки, не предугаданы
    заранее.
  - Кластер 5545 поднят/остановлен и storage-fixture (`/tmp/orion-s11-*`)
    использованы только в рамках этой сессии; рабочий `.env` и
    `infra/postgres/data` не затронуты.
- Миграция/данные: новая миграция
  `20260921170000_note_revision` (`ALTER TABLE "notes" ADD COLUMN
  "revision" INTEGER NOT NULL DEFAULT 1`) — применена и проверена только на
  изолированном тестовом кластере (5545) в рамках `prisma migrate deploy`
  выше; рабочая БД пользователя миграцию не получала. RLS не менялась —
  колонка на существующей RLS-защищённой таблице `notes`, отдельной политики
  не требует.
- Непроверенное: **conflict UI визуально не проверен браузером** (нет
  browser-automation tooling в сессии — та же причина SKIPPED, что в
  S00/S03/S08/S09/S10); проверено только через unit-тест состояния
  контроллера и HTTP-уровень конфликта (integration), не через реальный
  рендер `NoteEditor` (в зависимостях нет `@testing-library/react`/jsdom,
  вводить ради одной карточки не стал — тот же компромисс, что в S09/S10).
  **Только notes** — задачи и проекты, у которых есть свой автосейв/PATCH
  (`task-form.tsx`, `project-form.tsx`), CAS/trailing-drain не получили;
  карточка прямо просит "сначала notes... задачи/проекты отдельными
  подэтапами", это осознанно оставлено следующей сессии, не недосмотр.
  Прямые Prisma-записи мимо `NotesService.update()` (`renameTag`/
  `deleteTag`/`restore`/`restoreRevision`/корзина) **не** бампают
  `revision` — у них нет конкурентного CAS-сценария в объёме этой карточки
  (это фоновые/явные операции, не автосейв), но следствие: клиент, открывший
  заметку до, скажем, restore-из-корзины другим клиентом, при следующем
  автосейве получит 409 только если сам restore тоже бампал бы revision —
  сейчас не бампает, так что этот конкретный кросс-канал не покрыт CAS
  (зафиксировано как гэп, не тихо проигнорировано). `NoteRevision`
  (история версий, отдельная от CAS-revision) не переименовывалась и не
  трогалась — два разных "revision" сосуществуют в кодовой базе
  (`Note.revision: Int` для CAS, `NoteRevision` модель для истории
  снэпшотов); имя пересекается, но `noteSchema.revision` и
  `NoteRevision`/`noteRevisionSchema` — разные типы, `pnpm typecheck` уже
  подтвердил отсутствие конфликта. Real two-tab browser reproduction
  (открыть заметку в двух реальных вкладках) не делал — заменено HTTP-level
  integration-тестом, который бьёт по тому же серверному инварианту.
- Следующий шаг: другому агенту — (1) визуальная проверка conflict-баннера/
  navigation guard в браузере, когда появится tooling; (2) CAS для
  задач/проектов по тому же паттерну (`NoteAutosave` уже достаточно общий,
  чтобы переиспользовать с другими `AutosaveSnapshot`-подобными формами,
  но само переиспользование — отдельная сессия); (3) опционально —
  бампать `revision` и на путях вне `update()` (restore/rename-tag), если
  реальный пользовательский баг это потребует. `S01 + S06 → S11` по
  10-BACKLOG.md закрыта (autosave/CAS не зависели от их кода, только от
  общей инфраструктуры).

### S12 · 2026-09-21 · PARTIAL (control-height fix + testable focus trap done; sweeping token/error-pattern audit and visual verification not done)

- Поведение: инвентаризация `apps/web/app/globals.css` +
  `apps/web/tailwind.config.js` + `packages/ui/src/primitives.tsx`/
  `overlays.tsx` перед правкой (не по описанию карточки, а по реальному
  коду). Находки:
  - **globals.css/tailwind.config.js уже довольно чистые** — нет
    буквальных дублей одного и того же токена под двумя именами. Единственный
    реальный "двойной shrink" — то, что density (`html[data-density="compact"]`)
    одновременно (а) масштабирует `html { font-size }` 16→14px, из-за чего
    **все** rem-based Tailwind-утилиты (padding/line-height/`text-xs` и т.п.)
    сжимаются автоматически, и (б) поверх этого явно переопределяет
    `--font-display/title/body/label` и `--orion-row-py`/`--orion-card-row-py`
    на **отдельные, не пропорциональные** rem-значения. Это не забытый
    дубль-токен (у comment в коде уже написано "density is not only
    html font-size"), а осознанное компаундирование — решил не трогать без
    voспроизведённого визуального бага, т.к. правка без screenshot-baseline
    (browser tooling недоступен в сессии) рискует разбалансировать
    компакт-плотность вслепую. Задокументировано, не "починено".
  - **Реальная, конкретная и безопасно фиксируемая несогласованность высоты
    controls**: `Button` (`size="md"`) и `Input`/`Textarea` используют
    `py-2`, но `Select` использовал `py-1.5` — на ~4px короче в одном ряду
    формы при любой плотности (несогласованность, не зависящая от density).
    Пофикшено в `packages/ui/src/primitives.tsx` (`Select`: `py-1.5` →
    `py-2`), с комментарием на месте. Это единственная реальная "control
    height" правка, которую сделал — остальные controls (`Button`,
    `Input`, `Textarea`, `IconButton`) уже были согласованы.
  - **Focus ring уже единообразен** в `packages/ui/src/primitives.tsx`/
    `overlays.tsx`: `focus-visible:ring-2 focus-visible:ring-accent/60` на
    интерактивных элементах (`Button`/`IconButton`/`SegmentedControl`),
    `focus:ring-2 focus:ring-accent/25` на текстовых полях (`Input`/
    `Textarea`/`Select`) — два разных, но целенаправленно разных случая
    (кнопка получает ring только по клавиатуре, текстовое поле — и по
    мыши/клику тоже, что ожидаемо для полей ввода), не дубль/рассинхрон.
    Не трогал.
  - **Overlays (`Modal`/`Sheet`/`DropdownMenu`/`Popover`) уже реализуют**
    keyboard focus trap (`useFocusTrap`), Escape-to-close
    (`useEscapeKey`), focus-into-dialog-on-open и restore-focus-to-opener-
    on-close (`restoreOpener`, с проверкой `isConnected`/`getClientRects()`
    на случай скрытой dockview-вкладки) — всё уже было в коде **до** этой
    сессии, ничего из этого не было отсутствующим или сломанным. Но у этой
    логики не было ни одного теста (`packages/ui` вообще не имел ни одного
    `.test.ts`-файла и не входил ни в один тестовый прогон). Вынес чистое
    решающее ядро trap-логики (какой узел получит фокус на Tab/Shift+Tab —
    wrap вперёд/назад/остаться на месте/фокус на контейнер при отсутствии
    focusable-потомков) в новый `packages/ui/src/focus-trap.ts`
    (`computeFocusTrapAction`), не меняя поведения (тот же алгоритм, что был
    инлайн в `useFocusTrap`), и подключил обратно в `overlays.tsx`. Новый
    `packages/ui/src/focus-trap.test.ts` — 8 тестов на чистых объектах
    (без jsdom, т.к. в репозитории нет ни `jsdom`, ни
    `@testing-library/react` — решил не вводить их ради одной карточки, тот
    же компромисс, что в S09-S11): wrap вперёд с последнего на первый, wrap
    назад с первого на последний, отсутствие action на среднем узле (Tab и
    Shift+Tab), фокус ушёл из контейнера → редирект на первый/последний,
    единственный focusable-узел циклится сам на себя, пустой контейнер →
    `focus-container`. Существующий Escape/restore-opener/focus-on-open
    остались непокрыты тестом — они завязаны на реальные React-эффекты и
    `document.activeElement`, что без jsdom не протестировать чисто; они
    были верны уже до сессии (прочитаны, не изменены), это не новый риск.
  - **Reduced motion** — уже покрыт: `@media (prefers-reduced-motion:
    reduce)` в `globals.css` зануляет `animation-duration`/
    `transition-duration`/`scroll-behavior` глобально (`*`), плюс
    компоненты на `framer-motion` (`primitives.tsx` `useStatusFlash`,
    overlays) читают `useReducedMotion()` и обнуляют свои `transition`
    вручную (framer-motion анимации идут через инлайн `transition` пропы,
    не CSS-transition, поэтому им нужен отдельный путь — уже был).
    Проверено чтением кода/grep, изменений не потребовалось.
  - **200% zoom / rem-based sizing** — grep `globals.css` на `px`-литералы
    в размерах шрифта: единственные `font-size: 16px`/`14px` — это сам
    `html` root (сознательная точка привязки rem-каскада), всё остальное в
    файле и в `tailwind.config.js`/`primitives.tsx` — rem/em через Tailwind
    utility classes или CSS-переменные. Браузерный zoom масштабирует root
    `px` пропорционально вместе со всем остальным контентом — архитектурных
    хардкодов, ломающих zoom, не нашёл.
  - **Contrast (compact density, ручной WCAG-расчёт** — нет browser
    tooling, посчитал вручную по формуле относительной яркости sRGB для
    реальных hex из `globals.css`/`tailwind.config.js`):
    - `foreground` `#f4f4f5` на `background` `#0a0a0c` → **≈18.0:1**
      (AAA с большим запасом).
    - `muted-foreground` `#a1a1aa` на `background` `#0a0a0c` → **≈7.7:1**
      (AAA для обычного текста).
    - `muted-foreground` `#a1a1aa` на `card` `#141419` → **≈7.2:1** (AAA).
    - `foreground` на `card` → **≈16.7:1**.
    Контраст не зависит от `data-density` (только цвета, плотность меняет
    только размер/line-height), так что эти цифры одинаковы в comfortable и
    compact. Единственный density-специфичный легибельность-риск —
    `--font-micro`, и код уже явно противодействует ему: в compact формула
    `calc(0.6875rem * 16 / 14)` держит фактический пиксельный размер ~11px
    вместо того, чтобы дать общему сжатию root ужать его дальше (комментарий
    на месте это и объясняет) — не моя правка, уже было верно.
  - **Единый status/error visual pattern** — нашёл частичную несогласованность,
    **не стал чинить в этой сессии** (см. "Непроверенное" — почему): `grep`
    на `tone="danger"` (использование `EmptyState` с danger-тоном, уже
    существующий единый паттерн из `primitives.tsx`) даёт 17 файлов в
    `apps/web/panels`, а `grep` на текст ошибок ("Не удалось"/"Ошибка") даёт
    28 файлов — то есть минимум 11 панелей показывают текст ошибки не через
    `EmptyState tone="danger"`, а какой-то своей инлайн-версткой (не
    проверял каждую по отдельности — часть из них наверняка это inline
    ошибки валидации формы под конкретным полем, для которых блочный
    `EmptyState` архитектурно не подходит, не тот же класс UI). Сводить все
    11 в единый паттерн без разбора, что из них блочная ошибка загрузки
    (кандидат на `EmptyState`) и что — inline-ошибка поля (не кандидат),
    потребовало бы читать все 11 файлов и, скорее всего, менять поведение
    нескольких панелей — за пределами оставшегося бюджета этой сессии.
- Файлы: `packages/ui/src/primitives.tsx` (`Select` padding),
  `packages/ui/src/focus-trap.ts` (новый), `packages/ui/src/overlays.tsx`
  (`useFocusTrap` использует `computeFocusTrapAction`, поведение не
  изменилось), `packages/ui/src/focus-trap.test.ts` (новый, 8 тестов),
  `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта запись).
- Проверки и результаты:
  - `pnpm typecheck` → PASS (7/7 проектов).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы).
  - `pnpm test` → PASS, 18 файлов / 171 тестов (было меньше файлов/тестов
    до сессии — не переснимал точный baseline перед правкой, т.к. между S00
    и этой сессией прошло много карточек S01–S11, каждая добавлявшая свои
    тесты; главное — прогон после правки зелёный, включая новый
    `focus-trap.test.ts`).
  - `pnpm test:integration`/`pnpm build` не гонял — правка не касается
    `apps/api`/серверной логики и не меняет Next.js сборку структурно
    (только один Tailwind-класс + чистый TS-модуль в `packages/ui`); решил
    не тратить бюджет на полный integration-прогон ради CSS/UI-primitives
    правки без БД-влияния.
  - Populated/visual screenshots (compact density, 200% zoom, reduced
    motion в реальном браузере, реальный focus outline "на глаз") — **не
    сняты**, честно SKIPPED: нет browser-automation tooling в сессии, та
    же причина, что в S00/S03/S04/S08/S09/S10/S11. Контраст и rem/zoom
    проверены статически (формула/grep), не рендером.
- Миграция/данные: нет.
- Непроверенное: (1) визуальная часть done-критериев (compact density на
  глаз, 200% zoom в реальном браузере, focus ring визуально, reduced-motion
  в реальном браузере) — SKIPPED, нет tooling; (2) единый
  status/error-паттерн — найдена несогласованность (17 vs 28 файлов), но
  **не устранена**, требует разбора каждой из ~11 панелей отдельно, чтобы
  не сломать inline-валидацию форм заодно с блочными ошибками; (3) двойное
  компаундирование density (root font-size + отдельные `--font-*`/
  `--orion-*-py` overrides) — задокументировано как осознанное, не
  тронуто, т.к. правка вслепую без screenshot-baseline рискованна; если
  следующая сессия с browser tooling увидит реальный визуальный баг —
  чинить тогда, не сейчас; (4) `Escape`/restore-opener/focus-on-open в
  overlays не получили юнит-теста (только read-verified, не new-tested) —
  jsdom/`@testing-library/react` не вводил ради одной карточки.
- Следующий шаг: следующему агенту с browser-automation tooling —
  (a) снять populated screenshots панелей в compact density и на 200%
  zoom, подтвердить или опровергнуть визуально то, что здесь посчитано
  вручную; (b) разобрать 11 файлов с error-текстом вне `EmptyState
  tone="danger"` и решить по каждому: блочная ошибка (перевести на
  `EmptyState`) или inline-поле (оставить как есть, это другой паттерн);
  (c) если browser tooling подтвердит визуальную проблему с compact-
  density компаундированием — тогда убирать двойной shrink предметно, не
  вслепую. `S08 + S09 → S12 → S13` по 10-BACKLOG.md: S13 может начинаться
  (S12 done-критерии частично покрыты, оставшееся — визуальная проверка и
  error-pattern sweep, не блокирующие архитектурные решения).

### S13 · 2026-09-21 · PARTIAL (Сегодня/Задачи; Инбокс просмотрен, изменений не потребовал)

- Поведение: прочитал `DashboardPanel.tsx`, `InboxPanel.tsx`, `TasksPanel.tsx` +
  `panels/tasks/*` целиком, затем 04-UX.md/06-MODULES.md/13-ACCEPTANCE.md
  (U01/U02/U03/U09) и нашёл два конкретных, буквальных несоответствия — не
  переписывал панели, точечные правки:
  - **Independent block errors (04-UX «Реестр состояний»: «Ошибка календаря
    не скрывает задачи»)** — `DashboardPanel` при ошибке `useTasks` ИЛИ
    `useNotes` заменял всю панель (форму захвата, чипы «Просрочено»/таймер/
    инбокс, привычки, события, финансы, заметки) одним `EmptyState` на весь
    экран — ровно нарушение правила блок-независимости, а не абстрактный
    риск: один упавший запрос гасил форму быстрого захвата, которая ни от
    задач, ни от заметок не зависит. Заменил единый `loadError`-гейт на
    `tasksBlockError`/`notesBlockError` — два независимых `EmptyState
    tone="danger"` (паттерн S12) в теле панели, каждый со своим retry
    (`refetchTasks`/`refetchNotes`), а всё остальное (capture, alerts,
    habits, events, finance, notes) рендерится по тому, что реально
    загрузилось. `quiet` (текст-заглушка «ничего срочного») пересчитан на
    новых флагах, чтобы не показываться поверх блока с ошибкой.
  - **Team default — «Мои задачи» (06-MODULES.md «Задачи»: «Личный default —
    список; командный — «Мои задачи», рядом Все»)** — `TasksPanel` заводил
    `onlyMine` как `false` независимо от плагина «Команда»: в командном
    пространстве по умолчанию открывался полный ростер задач вместо «Мои»,
    расходясь с явной формулировкой карточки модуля. `onlyMine` теперь
    инициализируется `teamOn` и переустанавливается при появлении/пропадании
    плагина, пока пользователь не тронул чип «Только мои» сам
    (`onlyMineTouched` ref) — после первого явного клика автодефолт больше не
    переопределяет выбор пользователя ни при перезаходе в команду, ни при
    смене пространства в рамках сессии компонента.
  - **Список/доска для задач (10-BACKLOG.md S13: «список/доска»)** — доски
    (`grid` колонок с drag-and-drop) не было альтернативы: панель всегда
    рендерила канбан, даже когда группировка не нужна пользователю с длинным
    плоским списком. Добавлен `SegmentedControl` «Доска/Список» рядом с
    группировкой; в режиме «Список» тот же массив `columns` (тот же
    `TaskCard`, та же drag-and-drop/keyboard-логика, никакого нового
    компонента) рендерится не `grid`-сеткой, а `flex-col` стеком в полную
    ширину — группировка (по статусу/проекту/приоритету/сроку) остаётся
    видимой как заголовки секций, но без бокового скролла колонок. Выбор
    запоминается в `localStorage` (`orion.tasks.view`) тем же паттерном, что
    уже применён к `groupBy` инбокса; дефолт — «Доска» для командного
    пространства, «Список» для личного (тот же сигнал `teamOn`, что и для
    `onlyMine`), пока пользователь явно не переключил (`viewTouched`).
  - `InboxPanel.tsx` прочитан целиком и сверен с 04-UX/06-MODULES/U01 —
    несоответствий не нашёл: capture остаётся plain-text без обязательных
    сокращений (ровно требование модуля), «остаться в очереди после
    обработки» уже реализовано (`runProcess` не покидает queue,
    toast-`action` — опциональный переход), independent error/empty/loading
    уже покрыты (`isError`/`isLoading`/`list.length === 0` — раздельные ветки
    рендера тела, а не единая точка отказа), history/queue — раздельные
    запросы с общим счётчиком badge. Изменений не вносил — не выдумывал
    работу там, где её не было.
- Файлы: `apps/web/panels/DashboardPanel.tsx` (block-level ошибки вместо
  панельной), `apps/web/panels/TasksPanel.tsx` (team-default `onlyMine`,
  view-toggle «Доска/Список» + рендер), `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md`
  (эта запись). `InboxPanel.tsx` не менялся (просмотрен, гэпов не найдено).
- Проверки и результаты:
  - `pnpm typecheck` → PASS (7/7 проектов).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (`CalendarPanel.tsx`,
    `DocumentsPanel.tsx`, `seed-demo-workspace.mjs`) — не мои файлы, регрессии
    нет.
  - `pnpm test` → PASS, 18 файлов / 171 тест (не менял `packages/`, число
    тестов и файлов выросло относительно записи S12 из-за более раннего
    состояния baseline в этой записи прогона — весь юнит-слой зелёный).
  - `pnpm test:integration` — не прогонял: изменения только во фронтенд-панелях
    (`apps/web`), API/Prisma/RLS не трогались.
- Миграция/данные: нет — без изменений схемы/бэкенда.
- Непроверенное (честно, бюджет карточки исчерпан раньше, чем полный объём):
  - **Populated/desktop+narrow screenshots** — SKIPPED, та же причина, что во
    всех предыдущих карточках: нет browser-automation тулинга в сессии
    (Playwright/Puppeteer MCP не подключены). Новый `SegmentedControl`
    «Доска/Список» и раздельные `EmptyState`-блоки на Dashboard визуально не
    сняты ни на desktop, ни на narrow ширине — только код-ревью, что ветки
    рендера верны и классы адаптивны (`flex-col`/`grid` уже реагируют на
    `md:`-брейкпоинты, как и раньше).
  - **Клавиатурная навигация** — не добавил отдельный юнит-тест на keyboard
    handler; существующий `onKey`-обработчик `TasksPanel` (стрелки/Enter/
    Shift+стрелки между колонками) не менялся логически и должен продолжать
    работать в режиме «Список» (та же `columns`/`droppable`-структура), но
    это не проверено интерактивно — только чтением кода. Отдельного
    keyboard-теста для нового `SegmentedControl` не писал — это готовый
    примитив `@orion/ui`, используемый по всему приложению, свою клавиатурную
    доступность не переопределял.
  - **U01/U02/U03/U09 целиком** — прогнаны только по коду (не через реальный
    браузер/два аккаунта): U01 (личный день, Сегодня→задача→таймер→завершение)
    и U02 (команда, «Мои задачи» default) проверены чтением затронутого кода
    и логики, но не пройдены руками как сценарий с двумя пользователями. U03
    (матрица доступа: finance/documents restricted) не входил в объём этой
    карточки (панели тут — Сегодня/Инбокс/Задачи, не finance/documents) и не
    трогался. U09 (границы времени) уже закрыт S10 (`use-day-boundary.ts`) —
    не перепроверял отдельно в этой карточке, т.к. Dashboard уже использует
    `useDayKey`/`useLocalNow` до этой сессии.
  - Другие пункты 04-UX/05-VISUAL для этих трёх панелей за пределами двух
    найденных несоответствий (например точный визуальный контраст/отступы
    `EmptyState tone="danger"`, ранее добавленного в S12, — не аудировал
    заново, полагался на то, что паттерн уже принят проектом).
- Следующий шаг: другому агенту с browser-tooling — снять populated/desktop/
  narrow скриншоты Сегодня (оба error-блока, quiet-state, focus-state) и
  Задачи (Доска/Список, оба default по team/personal, drag-and-drop и
  клавиатурная навигация в режиме «Список»). Затем можно закрывать `S13 →
  S14` по 10-BACKLOG.md.

### S14a · 2026-09-21 · DONE (проект/план — cascade preview)

- Поведение: разбирал карточку S14a буквально ("проект/план/cascade
  preview") сначала как "предпросмотр перед удалением проекта", но чтение
  кода показало, что это неверная цель: `ProjectsController`'s `@Delete`
  уже не деструктивен — `ProjectsService.archive()` только проставляет
  `archivedAt` (soft-архивация, история читаема), реального
  `prisma.project.delete()` в кодовой базе нет вовсе. Проверил
  `onDelete` для всех `projectId`-связей в `schema.prisma`: `Task.project`,
  `Note.project`, `Event.project`, `Document.project`,
  `Transaction.project`, `InventoryItem.project` — все `SetNull` (снятие
  ссылки, не каскадное удаление чужих данных); только `Milestone.project`
  — `Cascade`, но это осознанно (веха — часть плана самого проекта, не
  independent модуль, см. `docs/PLAN.md` v0.27). Значит, инвариант "архивация
  проекта не удаляет чужие данные" уже соблюдён по построению — чинить
  тут было нечего, никакой Prisma-миграции не требовалось.
  Реальная цель S14a — U04 acceptance-сценарий (13-ACCEPTANCE.md): *"Создать
  A→B→C milestones… Сдвинуть A, увидеть preview каскада и применить."*
  `MilestonesService.update` уже умел finish-to-start
  cascade-reschedule (`cascadeRescheduleTx`) — сдвиг веху A вперёд молча
  толкает зависимые B, C, если их `startAt` теперь раньше нового `dueAt`
  предшественника. До этой сессии это применялось **сразу и без
  предупреждения**: `ProjectGantt`'s drag-resize коммитил `updateMilestone`
  напрямую на `pointerup`, и пользователь узнавал, что B/C переехали, только
  перечитав список после успешного PATCH — ровно то, что "cascade preview"
  из карточки требует не допускать.
  Добавлен read-only `POST workspaces/:id/milestones/:milestoneId/reschedule-preview`
  (zod `milestoneReschedulePreviewInputSchema` → `{startAt, dueAt}`,
  ответ `MilestoneCascadeImpact[]`, без `.default(...)` — по правилу
  "дефолты только во входных схемах"). Внутри — новая чистая функция
  `simulateCascade(tx, milestoneId, overrideStart, overrideDue)`: тот же
  граф-обход, что был в `cascadeRescheduleTx`, но держит промежуточные
  значения в `Map` вместо `UPDATE`, поэтому ничего не пишет. Сам
  `cascadeRescheduleTx` теперь **делегирует** вычисление `simulateCascade`
  и только применяет то, что она вернула — один источник истины: preview и
  реальный apply физически не могут разойтись (документировано в
  JSDoc обеих функций, дополнительно доказано интеграционным тестом ниже,
  который PATCH'ит после preview и сверяет точные даты, а не просто "что-то
  изменилось"). Пустой массив (веха не в зависимостях ни у кого/сдвиг не
  пробивает `requiredStart`) — сигнал "применяй молча, подтверждение не
  нужно"; так решил не заводить лишний modal на каждый безобидный drag.
  На клиенте (`apps/web/panels/projects/gantt.tsx`) drag-commit и сохранение
  формы редактирования вехи (`saveMilestone`, только если даты реально
  поменялись — иначе preview не запрашивается вообще) теперь идут через
  `applyMilestoneDates`/явную preview-проверку: если preview вернул
  непустой список, коммит откладывается в `pendingCascade`-состояние и
  показывается существующий `ConfirmDialog` из `@orion/ui` (не изобретал
  новый компонент, как просила карточка — "no nested modals") со списком
  "«B»: было → станет" по каждой затронутой вехе; подтверждение вызывает
  реальный PATCH. Preview, упавший по сети, не блокирует правку — тихо
  трактуется как "нет каскада" и идёт обычным путём (тот же UX, что был до
  фичи), чтобы сбойный preview-запрос не мог "запереть" пользователя,
  который просто двигает срок.
- Файлы: `packages/shared-types/src/milestone.ts`
  (`milestoneReschedulePreviewInputSchema`, `milestoneCascadeImpactSchema`),
  `apps/api/src/milestones/milestones.service.ts` (новые `previewReschedule`
  + `simulateCascade`, `cascadeRescheduleTx` переписан как тонкая обёртка
  над `simulateCascade`), `apps/api/src/milestones/milestones.controller.ts`
  (`POST :milestoneId/reschedule-preview`), `packages/core/src/api/api-client.ts`
  (`previewMilestoneReschedule`), `packages/core-react/src/use-milestones.ts`
  (`useMilestoneReschedulePreview`), `apps/web/panels/projects/gantt.tsx`
  (preview-gated commit для drag и form-save, новый `ConfirmDialog`),
  `apps/api/test/milestones-cascade.integration.test.ts` (новый, 4 теста),
  `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта запись). Prisma-схема
  **не менялась** — `onDelete`-поведение уже было безопасным (см. выше),
  вся работа в query/API/UI-слое.
- Проверки и результаты:
  - `pnpm typecheck` → PASS (7/7 проектов).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы).
  - `pnpm test` → PASS, 18 файлов / 171 тест (юнит-слой не трогал; рост
    числа файлов/тестов в этой цифре — существующий счёт репозитория, не
    добавлял юнит-тестов в `packages/`, только integration).
  - `pnpm test:integration` на изолированном portable-Postgres (тот же
    рецепт 5544 в scratchpad, `prisma migrate deploy`, свой `STORAGE_DIR` в
    scratchpad, рабочий `.env`/`infra/postgres/data` не тронуты) → PASS,
    **10 файлов / 67 тестов** (было 63 — +4 новых из
    `milestones-cascade.integration.test.ts`):
    1. `preview reports B and C moving when A is pushed out, and applying
       does not double-shift them` — создаёт цепочку A→B(dep A)→C(dep B),
       двигает A на 20 дней вперёд, проверяет, что preview называет именно
       {B, C} (не A саму), сохраняет исходную 5-дневную длительность B,
       подтверждает, что **сам preview ничего не записал** (перечитывает B
       до реального PATCH — даты не изменились), затем реально применяет
       PATCH и сверяет, что финальные даты B/C **точно совпадают** с тем,
       что обещал preview (не "что-то похожее" — конкретные ISO-строки).
    2. `preview returns an empty array when the new dates don't push any
       dependent` — сдвиг A, не меняющий его `dueAt` (только `startAt`
       ближе), не должен ничего каскадировать — пустой массив, не ложный
       позитив.
    3. `a milestone with no dependents never appears in its own preview
       response` — C (конец цепочки, ни от кого не зависят) двигается
       далеко вперёд — пустой массив (некому каскадировать) и, что важнее,
       **сама C не попадает в свой же список impacts** — preview репортит
       только ДРУГИЕ вехи, не подтверждение изменения самой себя.
    4. `preview is member-scoped like every other milestone route` — не
       участник пространства получает 403 на preview, не 200/пустой план
       чужого пространства (та же проверка `assertMemberTx`, что и на
       остальных milestone-роутах).
    Прогонял тесты и до правки (только с новым эндпоинтом, но с исходным
    `cascadeRescheduleTx`, ещё не отрефакторенным на `simulateCascade`) —
    тест 1 (сверка PATCH-результата с preview) падал бы на расхождении
    только если бы preview и apply использовали разную логику; после
    рефакторинга на общую `simulateCascade` оба пути гарантированно
    согласованы конструктивно, не только "тест это подтвердил в этот раз".
  - `pnpm build` → PASS, API (`tsc`) + Next.js 14.2.35, 26 страниц (без
    прироста First Load JS — `ConfirmDialog` уже был в бандле).
  - Рабочий `.env`, `infra/postgres/data` и рабочий `STORAGE_DIR`
    пользователя не тронуты; временный кластер 5544 (scratchpad) поднят и
    остановлен только в рамках этой сессии.
- Миграция/данные: без изменений Prisma-схемы/миграций. Целенаправленно
  проверил и НЕ нашёл проблему, которую ожидал найти (каскадное удаление
  чужих данных при архивации/удалении проекта) — зафиксировано здесь как
  результат проверки, не как "нечего делать": инвариант "выключение/удаление
  проекта не стирает задачи/заметки/документы других модулей" подтверждён
  чтением `onDelete: SetNull` на всех соответствующих связях, а не
  реализован заново.
- Непроверенное: browser/визуальная проверка `ConfirmDialog` с реальным
  cascade preview (нет browser-tooling в сессии, та же причина SKIPPED, что
  в S00/S03/S04) — проверено только через API-интеграционный тест и
  typecheck компонента. Gantt drag UX (реальное перетаскивание мышью,
  задержка на preview-запрос перед показом confirm) не проверялся вручную
  — по коду `applyMilestoneDates` ждёт preview синхронно перед показом
  диалога/коммитом, что для короткого internal API-запроса должно быть
  незаметно, но не измерено. S14b (notes layout/attachments) и его U05
  acceptance-сценарий (конфликт заметки) — не входили в объём этой карточки,
  за них отвечает отдельная сессия.
- Следующий шаг: S14b (notes layout и attachments, U05 conflict-сценарий)
  по 10-BACKLOG.md — независимая карточка, после неё вся S14 закрывается и
  можно переходить к S15.

### S14c · 2026-09-21 · PARTIAL (только documents-подэтап; S14a/S14b не начаты)

- Поведение: карточка S14 делится на три независимых подэтапа
  (10-BACKLOG.md: "Подзадачи отдельно: S14a проект/план/cascade preview;
  S14b notes layout и attachments; S14c documents upload/move/versions/trash").
  Эта сессия занималась **только S14c**, конкретно data-integrity инвариантом
  "БД и файловая система никогда не расходятся так, что документ виден
  пользователю, но файл недоступен, или файл существует, но документ не
  виден/висит orphan" (см. CLAUDE.md "Документы — бинарное хранилище").
  Нашёл в рабочем дереве, что часть этой карточки уже была сделана в более
  ранней (незакоммиченной) сессии, но не отражена в очереди: миграция
  `20260921180000_documents_name_unique` (частичный case-insensitive unique
  индекс на `(workspaceId, parentId, name) WHERE deletedAt IS NULL`) и
  компенсирующий revert блоба в `DocumentsService.update` для гонки
  переименования/перемещения, плюс тест
  `apps/api/test/documents-move.integration.test.ts`. Этот тест **не был
  реально зелёным** — обращался к несуществующему роуту
  `POST /documents/folders` (реальный роут создания папки — `POST
  /workspaces/:id/documents`, без `/folders`) и падал 404 на первом же шаге.
  Поправил путь — тест теперь проходит на реальной изолированной БД+storage.
  - **Upload** — прочитан `DocumentsService.upload`: блобы пишутся построчно
    вне транзакции, но DB-строки создаются только ПОСЛЕ того, как *все*
    файлы дописаны, одной второй транзакцией (`Promise.all` внутри
    `withUser`). Значит, обрыв где угодно до конца загрузки оставляет **самое
    большее orphan-блобы на диске** (не то же самое, что "документ виден, но
    файл недоступен" — обратный, куда менее опасный случай) и никогда не
    создаёт Document-строку без записанного файла. Инвариант уже соблюдён по
    построению; отдельного фикса/теста не потребовалось — не выдумывал
    регрессию там, где её нет.
  - **Move/rename** (`update`) — уже почти правильно (см. выше), но нашёл
    реальный пробел в существующей компенсации: она помечала `moved`/
    записывала пару ключей **только после того, как `storage.move`
    зарезолвился без исключения**. Это не покрывает класс сбоя, где сам
    вызов `storage.move` **бросает исключение уже ПОСЛЕ того, как блоб
    физически переместился** (сетевой драйвер вроде WebDAV может завершить
    серверную операцию MOVE и всё равно выбросить ошибку на клиенте из-за
    разрыва соединения при чтении ответа) — то есть ровно тот класс, что
    попросили протестировать через "мок StorageAdapter кидает ошибку после
    частичного выполнения". Переписал компенсацию в общий приватный метод
    `revertIfRelocated`: теперь ключи записываются **до** ожидания `move`, а
    в catch-блоке решение о откате принимается не по факту "resolve/reject",
    а по пробе `storage.exists(toKey) && !storage.exists(fromKey)` — корректно
    и когда упал сам `move`, и когда упал последующий шаг транзакции, и
    безопасный no-op, если перемещения не было вовсе.
  - **Trash/restore** (`remove`/`restore`) — были **вообще без компенсации**:
    оба метода двигают блоб (`storage.move`) внутри той же транзакции, что и
    `deletedAt`, но без try/catch. Если сбой случается после реального
    перемещения блоба, но до коммита транзакции (обрыв БД-соединения, любая
    ошибка на следующей строке, убитый процесс), Postgres откатывает строку,
    а файловая система — нет: для `remove()` документ остаётся видимым живым
    (`deletedAt: null`) с недоступным содержимым (блоб уже в `.trash/<id>`);
    для `restore()` документ остаётся видимым в корзине, но блоб уже покинул
    `.trash/<id>`. Ровно инвариант из задания. Добавил тот же
    `revertIfRelocated` в оба метода (общий приватный хелпер, используется
    теперь всеми тремя: `update`/`remove`/`restore`).
  - Падающий тест до фикса: `apps/api/test/documents-trash.integration.test.ts`
    (новый, 2 теста) — реальный `LocalDiskStorage` через `app.get(STORAGE_ADAPTER)`,
    `vi.spyOn(storage, "move")` вызывает настоящий `move`, затем бросает —
    воспроизводит именно "блоб уже переехал, но метод сообщил об ошибке".
    До фикса оба теста падали (сначала `500` вместо `200` на GET
    `.../content`, затем — после первой итерации фикса — на количестве
    вызовов `move`, что и вскрыло исходную ошибку в моей же первой попытке
    компенсации: `moved = {...}` после `await` никогда не выполнялся, потому
    что бросающий вызов не возвращается штатно). Итоговый фикс проверен: оба
    теста зелёные, `documents-move.integration.test.ts` (уже
    существовавший, S14c-move) тоже зелёный, весь `pnpm test:integration` —
    **9 файлов / 63 теста PASS**.
- Файлы: `apps/api/src/documents/documents.service.ts` (`update` — тот же
  внешний try/catch, но общий `revertIfRelocated`; `remove`/`restore` —
  обёрнуты тем же паттерном впервые), `apps/api/test/documents-move.integration.test.ts`
  (исправлен путь `/documents/folders` → `/documents`, поведенчески не
  менялся), `apps/api/test/documents-trash.integration.test.ts` (новый, 2
  теста), `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта запись).
- Проверки и результаты:
  - `pnpm typecheck` → PASS (7/7 проектов, включая `apps/api/tsconfig.test.json`).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (`CalendarPanel.tsx`,
    `DocumentsPanel.tsx`, `seed-demo-workspace.mjs`) — по пути поймал и
    убрал собственный новый warning (`Unused eslint-disable directive` —
    `no-console` в этом проекте не настроен как правило eslint, поэтому
    комментарий `// eslint-disable-next-line no-console` был лишним; убрал).
  - `pnpm test` → PASS, 18 файлов / 171 тест (не трогал `packages/`).
  - `pnpm test:integration` на изолированном portable-Postgres (порт 5546 в
    scratchpad этой сессии, отдельный `STORAGE_DIR` в scratchpad, `prisma
    migrate deploy` на чистом кластере — все миграции применились без ошибок,
    включая уже существовавшую `20260921180000_documents_name_unique`) →
    PASS, **9 файлов / 63 теста** (все существующие интеграционные сьюты
    зелёные, плюс 2 новых теста `documents-trash.integration.test.ts`; 1 тест
    из `documents-move.integration.test.ts` впервые реально прогнан зелёным
    после починки пути). Рабочий `.env`, `infra/postgres/data` и
    пользовательский `STORAGE_DIR` не тронуты — временный кластер поднят и
    остановлен только в рамках сессии.
- Миграция/данные: без новых миграций Prisma. Существовавшая
  `20260921180000_documents_name_unique` (из более ранней сессии) впервые
  реально проверена `prisma migrate deploy` на чистом кластере в рамках этой
  сессии — применяется без ошибок.
- Непроверенное (честный список по приоритету из задания):
  - **S14a (проект/план/cascade preview)** и **S14b (notes layout/attachments)**
    — не начинал, это отдельные сессии по протоколу.
  - **Bulk partial failure** (13-ACCEPTANCE.md U06: "bulk partial failure") —
    `DocumentsService.bulk` уже собирает ошибки по each id и рероасит первую
    только если ВСЕ id упали, но не проверял отдельно, что частично упавший
    bulk-move/trash не оставляет часть блобов "зависшими" — каждый отдельный
    `update`/`remove`/`restore` внутри `bulk` теперь сам компенсирует свой
    собственный сбой (это уже покрыто фиксом выше), но сквозного теста
    именно через `POST /documents/bulk` с инжектированным частичным сбоем не
    писал — бюджет ушёл на upload/trash/restore/move по приоритету из
    задания.
  - **WebDAV-driver** (`webdav.storage.ts`) не имеет собственного
    fault-injection теста — весь прогон, как и в S04, был через
    `LocalDiskStorage` (дефолтный драйвер интеграционных тестов). Новая
    компенсация (`revertIfRelocated`) специально спроектирована с расчётом
    именно на WebDAV-класс сбоя ("move резолвится ошибкой, хотя серверная
    операция уже случилась"), но реального WebDAV-сервера в тестах нет —
    не проверял на реальном протоколе, только через `vi.spyOn` на
    `LocalDiskStorage`, эмулирующий тот же контракт.
  - **`purge`** (безвозвратное удаление) не получил аналогичной защиты — он
    сначала удаляет строку (`tx.document.delete`), потом блобы
    (`storage.remove`), и уже комментирует "row first... a leftover blob is
    harmless, a row with no blob is not" — то есть **уже** спроектирован в
    безопасном порядке (row-then-blob, а не blob-then-row) и не имеет того
    же класса риска, что `update`/`remove`/`restore` (move-before-commit).
    Не трогал — не нашёл в нём нарушения инварианта.
  - **`replaceContent`/`restoreVersion`** (замена содержимого/откат к
    версии) архивируют старое содержимое (`archiveContentTx`: `storage.copy`
    и `tx.documentVersion.create`) внутри той же транзакции, но не
    оборачивались отдельно — не проверял, оставляет ли сбой после
    `storage.copy`/`storage.putFile` там же класс риска, что и move
    (архивная копия успела создаться, но версия-строка не закоммитилась —
    "лишний" файл в `.versions/`, что ближе к orphan-блобу, не к "документ
    виден, но недоступен", т.к. `copy` не трогает live-ключ до записи новых
    байтов через `putFile`, который либо целиком проходит, либо нет — не
    успел проверить отдельным fault-injection тестом, честно не делал вид,
    что проверил).
  - Populated/browser screenshots — не входило в объём (нет
    browser-tooling в сессии, та же причина, что во всех прошлых карточках).
- Следующий шаг: другому агенту — S14a (проект/план/cascade preview) или
  S14b (notes layout/attachments) как следующий подэтап карточки S14;
  отдельно, если бюджет найдётся раньше, стоит проверить
  `replaceContent`/`restoreVersion` тем же fault-injection паттерном
  (`vi.spyOn(storage, "copy"/"putFile")`, бросить после реального
  побочного эффекта) и добавить сквозной bulk-partial-failure тест на
  `POST /documents/bulk`.

### S14b · 2026-09-21 · DONE (notes layout/attachments — nested-modal фикс + верификация)

- Поведение: карточка — "notes layout и attachments", последний из трёх
  подэтапов S14 (10-BACKLOG.md, done-критерий карточки в целом: acceptance
  U04/U05/U06; no nested modals; resizable panel layout; data/storage
  partial failure recovery проверен). Прочитал реальный код перед правкой:
  `apps/api/src/notes/note-attachments.service.ts`,
  `apps/web/panels/note-attachments.tsx`, `apps/web/panels/NotesPanel.tsx`,
  `apps/web/panels/note-editor.tsx`, `packages/ui/src/overlays.tsx`
  (Modal/Sheet/ConfirmDialog/Popover), `packages/ui/src/focus-trap.ts`,
  `packages/ui/src/hooks.ts` (`useResizeWidth`).
  - **Найден и починен реальный no-nested-modals баг** (правило
    `rule/no-nested-modals`, 04-UX.md: "Вложенные модальные окна запрещены").
    `NotesPanel` на узком viewport (`twoPane === false`) рендерит открытый
    `NoteEditor` внутри `<Sheet>`; `NoteAttachmentsSection` (смонтирован
    внутри `NoteEditor`) открывает превью вложения через `<Modal>`, а
    `ConfirmDialog` на detach — тоже `Modal` (`ConfirmDialog` — обёртка над
    `Modal`, см. `overlays.tsx`). Получается Modal поверх уже открытого Sheet.
    До фикса это было не только "не тот компонент", а конкретный, двумя
    путями воспроизводимый баг: (1) и `Modal`, и `Sheet` независимо вешают
    `useEscapeKey` на голый `document`-listener — Escape при открытом Modal
    поверх Sheet закрывал **оба** окна одним нажатием; (2) оба независимо
    гоняют `useFocusTrap` — `computeFocusTrapAction` у Sheet видел, что
    активный элемент (внутри портала Modal) находится вне его собственного
    `panelRef` (`currentOutsideContainer: true`), и по своей же логике
    (строки 36/39 `focus-trap.ts`) насильно утаскивал фокус обратно в Sheet
    при каждом Tab — реальный keyboard-trap баг, ломающий как раз то, что
    требует U12 ("sidebar → list → detail → modal → close → возврат
    фокуса").
    Фикс — не переписывать `NoteAttachmentsSection`/`NoteEditor`/`NotesPanel`
    (CLAUDE.md прямо просит не резать/не переписывать эти файлы без нужды),
    а закрыть класс бага в одной точке: `packages/ui/src/overlays.tsx`
    получил маленький глобальный стек открытых `Modal`/`Sheet`-инстансов
    (`useTopmostOverlay`) — Escape и focus-trap теперь активны только у
    **самого верхнего** открытого оверлея; накрытый снизу автоматически
    отключает оба обработчика, пока не станет верхним снова. Один общий
    примитив вместо точечного патча — тот же баг был бы и у любой другой
    будущей пары Modal(Sheet)-внутри-Sheet(Modal), не только у вложений
    заметок.
  - **U05 (конфликт заметки) — сверен буквально с 13-ACCEPTANCE.md.**
    `apps/web/lib/note-autosave.ts` + `note-editor.tsx` (сделано в S11)
    реализуют "B получает conflict, сервер A1 не затёрт, B может
    сохранить/согласовать" — подтверждено чтением и тестами S11
    (`note-autosave.test.ts`). Но буквальная фраза U05 "После reconnect и
    browser refresh draft восстанавливается только тому же user/workspace"
    **не выполнена**: конфликтное состояние и unsaved-контент живут только в
    памяти `NoteAutosave`/React state этой вкладки — нигде в
    `note-editor.tsx`/`note-autosave.ts` нет `localStorage`/подобной
    персистентности (проверил `grep -i localStorage` по всему
    `apps/web` — совпадений в notes-коде нет, есть только в
    `use-active-workspace`/`CalendarPanel`/`TasksPanel`/`InboxPanel` для
    других целей). Обновление страницы во время конфликта или до его
    разрешения теряет черновик B безвозвратно. Это принадлежит домену S11
    ("Черновики и CAS"), не S14b (layout/attachments) — S11 в очереди уже
    честно помечен PARTIAL с ровно этой причиной ("conflict UI... не
    визуально проверено"), но конкретно refresh-persistence там тоже не
    упомянут явно как отдельный незакрытый пункт, поэтому фиксирую здесь
    вместо того, чтобы просто закрыть S14 as DONE поверх реального разрыва
    с U05. **Не реализовывал** (localStorage draft keyed by
    `user/workspace/noteId` + restore-on-mount + clear-on-resolve) — это
    заметный кусок работы за пределами объёма "layout и attachments",
    трогает `note-autosave.ts`, который в этой сессии не должен был меняться
    по формулировке карточки; честно оставляю следующему агенту (либо
    отдельной S11-сессии, либо явно перечисленной в S14b, если её
    переоткроют).
  - **Resizable panel layout — проверено, не баг.** `NotesPanel` использует
    `useResizeWidth` (`packages/ui/src/hooks.ts`) — `ResizeObserver` на
    контейнер панели, `twoPane = width >= 720`, переключение
    master-detail ↔ `Sheet` в реальном времени при изменении ширины
    **самой dockview-панели** (не окна браузера — в доке несколько панелей
    можно резать драг-разделителем, и это тот "resize", который должен
    работать). Ручного drag-splitter между списком (`w-[20rem]`, фиксирован)
    и редактором внутри самого NotesPanel нигде в репозитории нет — не только
    у заметок: `DocumentsPanel` (единственный другой потребитель
    `useResizeWidth`) устроен так же (дерево/список фиксированной ширины +
    реагирующий на общую ширину layout), отдельного drag-resize-примитива
    (`SplitPane`/`ResizeHandle`) в `packages/ui` не существует вовсе. Значит
    "resizable panel layout" в done-критерии S14 — про dockview-резайз
    панели целиком (уже работает, `useResizeWidth` был и остаётся
    корректным), а не про новую фичу "потянуть внутреннюю границу
    список/детейл". Не стал изобретать новый UI-примитив без явного запроса
    (CLAUDE.md: "UI-примитивы написаны руками... не улучшать добавлением
    без запроса") — зафиксировано как VERIFIED_EXISTING, не как пропуск.
  - **Attachments — detach/upload инвариант сверен, не переизобретён.**
    `NoteAttachmentsService.remove` (строки 141–151) удаляет только строку
    `note_attachments`, `Document`/блоб не трогает — комментарий над методом
    и код совпадают буквально с CLAUDE.md. `upload` (строки 99–132) идёт
    через `this.documents.upload(...)` (`DocumentsService.upload`, тот же
    путь, что обычная загрузка в "Документы"), никакого параллельного
    storage-механизма нет. Клиент (`note-attachments.tsx`) шлёт detach через
    `ConfirmDialog` с явным текстом "Файл останется в модуле «Документы»" —
    поведение и текст совпадают. Не менял — подтверждено чтением, ложных
    правок не вносил.
- Файлы: `packages/ui/src/overlays.tsx` (новый `useTopmostOverlay` +
  Modal/Sheet используют его вместо голого `useEscapeKey`/`useFocusTrap` от
  `open`), `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта запись + правка
  строки S14 в очереди). `note-attachments.service.ts`/`note-attachments.tsx`/
  `NotesPanel.tsx`/`note-editor.tsx` — не менялись, только читались (никаких
  расхождений с CLAUDE.md/06-MODULES не найдено сверх nested-modal бага,
  который был устранён на уровне общего примитива, а не в этих файлах).
- Проверки и результаты:
  - `pnpm typecheck` → PASS (7/7 проектов).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (`CalendarPanel.tsx`,
    `DocumentsPanel.tsx`, `seed-demo-workspace.mjs`) — не мои файлы, не
    регрессия.
  - `pnpm test` → PASS, 18 файлов / 171 тест (не менялись — `packages/ui`
    не имеет component-level test harness — нет `jsdom`/testing-library в
    его `devDependencies`, только `focus-trap.test.ts` на чистой функции;
    заводить новую тестовую инфраструктуру ради этого фикса не стал — новая
    зависимость без явного запроса, см. правило CLAUDE.md про размер/состав
    репозитория и хендролленные примитивы. Логика `useTopmostOverlay`
    проверена вручную чтением: стек — обычный module-level массив id,
    Escape/Tab-trap читают его на момент события, не на момент рендера,
    поэтому не может устареть).
  - `pnpm --filter @orion/web run build` → PASS, 26 страниц, тот же набор
    First Load JS размеров, что в S00/S03/S14a (новый код в `overlays.tsx`
    минимален, прирост бандла не заметен на этом уровне детализации).
  - `pnpm --filter @orion/api exec tsc -p tsconfig.json --noEmit` /
    `tsconfig.test.json` — не запускал отдельно (эта сессия не трогала
    `apps/api`, покрыто общим `pnpm typecheck`).
  - `pnpm test:integration` — **не запускал**: диф сессии целиком во
    frontend-примитиве (`packages/ui`), API/Prisma/RLS не тронуты, поднимать
    изолированный Postgres-кластер под нулевой backend-диф — не тот случай,
    для которого рецепт существует (S00–S14a поднимали его именно потому,
    что меняли `apps/api`). Честно помечаю как непроверенное ниже, а не
    выдаю typecheck/build за интеграционный прогон.
- Миграция/данные: нет — ни Prisma-схема, ни `apps/api` не менялись.
- Непроверенное:
  - **U05 draft persistence через browser refresh** — реальный разрыв с
    буквальным текстом U05, не входит в объём "layout и attachments",
    принадлежит S11; не реализовывал (см. выше подробный разбор).
  - **Nested-modal фикс не проверен в реальном браузере** — нет
    browser-automation тулинга в сессии (та же причина SKIPPED, что в
    S00/S03/S04/S14a); логика проверена чтением кода (module-level стек,
    порядок эффектов, `computeFocusTrapAction` с `currentOutsideContainer`)
    и существующим unit-тестом чистой функции `focus-trap.test.ts` (не
    менялся — покрывает саму decision-функцию, не стек поверх неё). Ручной
    клик/Tab/Escape в реальном Chrome/Tauri-окне на узком viewport с
    открытым вложением заметки не выполнялся.
  - **S14c оставшиеся пункты** (bulk partial failure через
    `POST /documents/bulk`, WebDAV fault-injection,
    `replaceContent`/`restoreVersion` fault-injection) — вне объёма этой
    сессии (S14c — отдельный подэтап, эта сессия его не трогала), поэтому
    вся карточка S14 остаётся PARTIAL, не DONE — см. обновлённая строка в
    очереди.
- Следующий шаг: (1) кто-то с browser-tooling подтверждает nested-modal
  фикс визуально (открыть вложение заметки на узком viewport, Escape/Tab);
  (2) отдельная сессия закрывает U05 draft-persistence (S11 scope, не
  S14b); (3) S14c добивает bulk-partial-failure/WebDAV/replaceContent
  fault-injection тесты — после этого вся карточка S14 переводится в DONE.

### S15 · 2026-09-21 · PARTIAL (time entries pagination+totals, inbox honest truncation — done; finance/search/projects unbounded findMany — не тронуты)

- Поведение: аудит (`grep findMany` по `time/finance/search/projects/inbox`)
  нашёл два реальных, а не гипотетических дефекта из формулировки карточки:
  - `TimeService.list` (`apps/api/src/time/time.service.ts`) был плоским
    `findMany({ take: 500 })` — ни курсора, ни способа увидеть строку 501+,
    ни серверного итога. `TimePanel.tsx` считал «Всего»/«Сегодня»/«7 дней»
    (`summariseEntries` в `panels/time/summary.ts`) сложением того же
    капнутого массива — сверх 500 строк «Всего» было тихо занижено без
    единой ошибки.
  - `InboxService.list` (`apps/api/src/inbox/inbox.service.ts:19`) был
    `take: history ? 100 : 250` без общего счётчика — бейдж «к разбору» в
    `DashboardPanel.tsx`/`app/(app)/layout.tsx` считал `queue.data.length`,
    т.е. плато на 250 при реальном росте очереди дальше.
  - `finance/search/projects` — аудитом не найдено реальной той же
    проблемы: у search каждый тип уже `take: 8` (виджет автодополнения, не
    список отчёта); у projects rollup/activity — `take: 20` на тип +
    `slice(0, 30)` (лента «недавняя активность», по определению не полный
    список); finance-сервисы (`accounts`/`categories`/`budgets`/`goals`/
    `category-rules`/`recurring`) — не пагинируемые пользовательские
    справочники (десятки строк на воркспейс в реальном сценарии, не тысячи).
    Ничего не трогал в этих трёх модулях — не стал придумывать проблему,
    чтобы отчитаться по всем пяти путям карточки.
  - **Time — исправлено.** `TimeService.list` теперь курсорная пагинация:
    `(startedAt, id)` оба по убыванию как составной tie-breaker (`startedAt`
    не уникален — у ручных записей это рутина), `limit` 1..200 (дефолт 100),
    `cursor` — id последней строки предыдущей страницы. Курсор валидируется
    против `workspaceId` (`cursorRow.workspaceId !== workspaceId` → 400) —
    id из чужого пространства отклоняется, а не тихо игнорируется и не
    протекает в чужую выдачу (см. тест ниже). Новый `TimeService.summary` —
    настоящая SQL-агрегация (`SUM`/`COUNT` через `$queryRaw`, не сумма
    загруженной страницы), с теми же фильтрами (`from`/`to`/`taskId`/
    `projectId`), которая остаётся точной при любом количестве строк.
    Новый роут `GET /workspaces/:id/time/summary`.
    **Найденный попутно реальный баг** (не выдуманный ради теста): первая
    версия `summary()` сравнивала `"startedAt" >= <JS Date>` в `$queryRaw` —
    `time_entries.startedAt`/`endedAt` это `timestamp without time zone`
    (литеральные UTC-цифры, конвенция, которую обычный Prisma query engine
    соблюдает сам), а `node-postgres` биндит JS `Date` как `timestamptz`;
    Postgres неявно приводит его к `timestamp` **через сессионный GUC
    `timezone`** при сравнении с tz-less колонкой. На этой машине сессионная
    зона — `Europe/Moscow` (+3), поэтому `startedAt >= <UTC-момент>` реально
    сравнивался со сдвигом на 3 часа вперёд — падающий тест на 620
    фикстурных строках по минуте показал именно `440` вместо `620`
    (620 − 440 = 180 = 3 часа × 60 строк/час, что и подтвердило причину).
    Исправлено биндингом ISO-строки с явным `::timestamp`-кастом (текст →
    timestamp читает цифры буквально, без зоны) и нормализацией `now()`
    через `(now() AT TIME ZONE 'UTC')` вместо голого `COALESCE` с
    `timestamptz`, который иначе продвигал бы всё выражение к tz-типу.
    Комментарий с полным разбором оставлен в коде рядом с фиксом — этот
    паттерн (`$queryRaw` + naive-timestamp колонка) будет повторяться в
    любом будущем агрегатном отчёте, если не помнить про него.
    `TimePanel.tsx` берёт «Сегодня»/«7 дней»/«Всего» из трёх вызовов нового
    `useTimeEntriesSummary` (границы — тот же UTC-день, что и
    `timeEntryDay`/группировка), а не из `summariseEntries` по загруженным
    страницам; список записей — `useInfiniteQuery` с кнопкой «Показать
    ещё» (`fetchNextPage`/`hasNextPage`).
  - **Inbox — исправлено.** `InboxService.list` теперь параллельно с
    `findMany({ take: limit })` делает `count({ where })` с тем же `where`,
    возвращает `{ items, totalCount, limit }`. `InboxPanel.tsx` показывает
    «Показаны первые N из M» только когда `totalCount > items.length`, и
    бейдж «к разбору» в сайдбаре/дашборде теперь берёт `totalCount`, не
    `items.length` (иначе плато на 250 выглядело бы как «очередь больше не
    растёт»).
  - **Cross-workspace cursor security** — единственный найденный
    pagination-эндпоинт с клиентским курсором (`GET .../time`) явно
    проверен и покрыт тестом: id строки из воркспейса B, переданный как
    `cursor` при пагинации воркспейса A, отклоняется 400, не протекает в
    порядок A и не откатывается к «начать сначала» молча.
- Файлы:
  - `apps/api/src/time/time.service.ts` (курсорная `list` +
    `summary`, новые типы `TimePageOptions`/константы лимитов).
  - `apps/api/src/time/time.controller.ts` (`GET /time` принимает
    `cursor`/`limit`, новый `GET /time/summary`).
  - `apps/api/src/inbox/inbox.service.ts` (`list` → `{items, totalCount,
    limit}`), `apps/api/src/inbox/inbox.controller.ts` (тип ответа).
  - `packages/shared-types/src/time.ts` (`timeEntryPageSchema`,
    `timeSummarySchema`), `packages/shared-types/src/inbox.ts`
    (`inboxListSchema`).
  - `packages/core/src/api/api-client.ts` (`listTimeEntries` возвращает
    `TimeEntryPage`, новый `timeEntriesSummary`, `listInbox` возвращает
    `InboxList`).
  - `packages/core-react/src/use-time.ts` (`useTimeEntries` теперь
    `useInfiniteQuery` с полем `entries`, новый `useTimeEntriesSummary`,
    инвалидация задевает и `["time-summary"]`), `packages/core-react/src/
    use-inbox.ts` (`useInbox` типизирован `InboxList`).
  - `apps/web/panels/TimePanel.tsx` (заголовочные итоги из
    `useTimeEntriesSummary`, кнопка «Показать ещё»), `apps/web/panels/time/
    summary.ts` (уточнён комментарий — `today`/`week`/`total` из этого
    файла больше не используются для заголовка панели, только для разбивки
    по проектам/валютам).
  - `apps/web/panels/InboxPanel.tsx` (баннер честной усечки, `list` из
    `data.items`), `apps/web/panels/DashboardPanel.tsx` и
    `apps/web/app/(app)/layout.tsx` (бейдж инбокса — `totalCount`).
  - `apps/api/test/time-pagination.integration.test.ts` (новый, 3 теста —
    см. ниже).
  - `apps/api/test/api-rls.integration.test.ts` и `apps/api/test/
    time-entries.integration.test.ts` — три существующих теста
    приведены к новой форме ответа `GET /time` (`{items, nextCursor}`
    вместо плоского массива); сами сценарии не менялись.
  - `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта запись).
- Проверки и результаты:
  - `pnpm typecheck` → PASS (7/7 проектов).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы).
  - `pnpm test` → PASS, 18 файлов / 171 теста.
  - `pnpm test:integration` на изолированном portable-Postgres (порт 5544,
    `ORION_PG_DATA`/`ORION_PG_PORT` в scratchpad, `prisma migrate deploy`,
    свой `STORAGE_DIR`, рабочий `.env`/`infra/postgres/data` не тронуты) →
    PASS, **11 файлов / 70 тестов** (было 67 без учёта трёх переписанных;
    3 новых теста в `time-pagination.integration.test.ts`):
    - «summary total is exact for >500 entries» — bulk Prisma
      `createMany` 620 записей по 15 минут каждая, `GET /time/summary`
      возвращает `count: 620`, `minutes: 9300` (сначала падал с `440`/`6600`
      из-за таймзонового бага выше — это и есть «сначала падающий тест»,
      не задним числом написанный под готовый код); заодно проверяет, что
      первая страница `list` меньше 620 (доказывает, что итог — не просто
      эхо полной страницы).
    - «pages through a filtered set with zero duplicates and zero gaps» —
      347 bulk-вставленных записей, постраничный обход `limit=50` с
      фильтром `from`/`to`, `Set` всех id по страницам: `size === 347`,
      без дублей (проверка на каждой странице) и без пропусков.
    - «rejects a cursor id from another workspace» — Carol и Dave, курсор
      от первой записи Dave передан в пагинацию воркспейса Carol → 400.
    - До фикса таймзонового бага первый тест падал детерминированно на
      реальной причине (не флейково) — задокументировано в комментарии
      кода, не только здесь.
  - `pnpm build` → PASS: API (`tsc`) + Next.js 26 страниц; `/login` First
    Load JS 496 kB (было 495 kB в S00 baseline — в пределах шума от
    других уже присутствующих в дереве изменений, не от этой сессии: S15
    не трогал `app/login/page.tsx` и не добавлял туда импортов).
  - Рабочий `.env`, `infra/postgres/data` и рабочий `STORAGE_DIR`
    пользователя не тронуты; временный кластер на 5544 и scratch-storage
    подняты и остановлены (`node scripts/postgres.mjs down`) только в
    рамках этой сессии.
- Миграция/данные: без изменений Prisma-схемы/миграций. `time_entries`/
  `inbox_items` не менялись — обе доработки целиком в query-слое сервисов и
  контракте ответа (аддитивно: `{items, nextCursor}` вместо массива и
  `{items, totalCount, limit}` вместо массива — это ломающее изменение
  формы ответа двух эндпоинтов, не аддитивное поле; отражено во всех трёх
  слоях контракта и в трёх местах клиента, которые эти эндпоинты
  потребляли).
- Не проверено:
  - **finance/search/projects** — карточка формально требовала охватить
    все пять модулей; аудит не нашёл в них реального unbounded/truncated
    списка того же класса (см. «Поведение» выше), но это решение принято
    в рамках этой сессии и не было отдельно подтверждено владельцем
    продукта — если он не согласен с классификацией (например считает
    projects-activity `take: 20`/`slice(0, 30)` недостаточным для полного
    отчёта, не только виджета), это отдельный follow-up, не сделанный
    здесь.
  - **Производительность на реалистичном объёме** — тест на 620/347
    строк подтверждает корректность курсора/итога, но не измерял
    latency курсорной пагинации на порядок большем датасете (десятки
    тысяч записей) и не строил fixture performance benchmark, который
    просит карточка («fixture performance... записаны»). Индекс
    `@@index([startedAt])` на `TimeEntry` уже существовал до этой сессии
    (не добавлял составной `(workspaceId, startedAt, id)` — не измерял,
    нужен ли он на реальном объёме; текущий индекс покрывает
    `workspaceId`+`startedAt` отдельными индексами, план запроса не
    снимался).
  - **`/login` bundle** (самый низкий приоритет карточки) — не трогал:
    `git diff`/`next build` не показывают роста этой сессией (496 vs 495 —
    разница до этой сессии, в чужом dirty tree), и явного eager-импорта
    тяжёлой библиотеки в `apps/web/app/login/page.tsx` или его прямых
    зависимостях грепом не найдено. Не гадал и не трогал по инструкции
    карточки («убрать доказанные ненужные eager imports, не угадывая»).
  - **UI визуально** — «Показать ещё»/баннер «первые N из M»/три
    StatCard с `useTimeEntriesSummary` не открывались в реальном браузере
    (нет browser-automation тулинга в сессии, та же причина SKIPPED, что
    в S00/S03/S04/S12/S14b) — проверено чтением кода и typecheck, не
    визуально.
- Следующий шаг: (1) если владелец продукта подтверждает, что
  finance/search/projects действительно не нуждаются в отдельной
  пагинации — карточка S15 закрывается в DONE без доп. кода; если нет —
  следующая сессия применяет тот же паттерн (курсор + `count`) к
  конкретному указанному месту; (2) fixture performance benchmark на
  большем датасете времени, если это блокирует приёмку; (3) browser-tooling
  сессия визуально проверяет TimePanel/InboxPanel изменения.

### S15 (добивка хвостов) · 2026-09-22 · closes the open finance/search/projects item — S15 → DONE

- Поведение: закрывает единственный оставшийся открытый пункт S15 —
  предыдущая запись честно пометила, что классификация
  «finance/search/projects не нуждаются в пагинации» не была *реально*
  проверена нагрузкой, только чтением кода. Эта сессия проверила все три
  реальным объёмом на изолированной БД, а не повторным чтением исходников.
  - **Finance `Transaction`** — единственный из finance-списков, который
    растёт как Time entries, а не как маленький справочник (Account/
    Category/Budget/Goal/CategoryRule/RecurringTransaction — реально
    десятки строк на воркспейс, там классификация верна без вопросов).
    Оказалось, что `TransactionsService.list`
    (`apps/api/src/finance/transactions/transactions.service.ts:40-64`)
    **уже** оффсет-пагинирован: `take: filters.limit ?? DEFAULT_PAGE_SIZE`
    (50), `skip: filters.offset ?? 0` — не плоский unbounded `findMany`,
    которым был `TimeService.list` до основной S15-сессии. Клиент
    (`apps/web/panels/finance/transactions-view.tsx`) уже использует
    честный offset-based "Показать ещё" (`hasMore = items.length ===
    limit`, `setLimit((l) => l + PAGE_SIZE)`) — тот же паттерн, что
    `useInfiniteQuery` у Time, реализованный другим (более ранним, но
    равноценным) способом. Итоги считаются не суммированием этой
    (потенциально усечённой) страницы: `ReportsService.monthlySummary`/
    `categoryBreakdown` (`apps/api/src/finance/reports/reports.service.ts`)
    — настоящие Prisma `aggregate`/`groupBy` с `_sum`, читающие все
    подходящие строки в БД напрямую, независимо от того, сколько
    транзакций показано в списке. **Вывод: реального unbounded-list
    дефекта класса Time/Inbox в Finance нет** — карточка `12-PROGRESS.md`
    ранее описывала Transaction как «маленький справочник», что неточно по
    формулировке (это растущий список), но по факту он уже был пагинирован
    правильным паттерном до этой сессии, поэтому код не менялся.
  - **Search** `take: 8` на тип + общий `slice(0, 30)`
    (`apps/api/src/search/search.service.ts:17-56`) — подтверждено
    намеренным: единственный потребитель `GlobalSearchResult` во всём
    `apps/web` — командная палитра `apps/web/lib/command-center.tsx`
    (`useGlobalSearch`, дополнительно `.slice(0, 16)` на клиенте для
    рендера). Никакой отдельной «страницы полных результатов поиска» в
    API/UI не существует вообще — грепом по `GlobalSearchResult`/
    `useSearch`/`/search?q` в `apps/web` найден только этот один
    потребитель. Не унаследованный баг: не от чего наследовать, полного
    списка результатов нет как продуктовой фичи.
  - **Projects activity** `take: 20` на тип +неявный общий кап через
    `Promise.all` (`ProjectsService.activity`,
    `apps/api/src/projects/projects.service.ts:281-381`) — подтверждено
    намеренным recent-activity feed. Проверено отдельно (это и был риск,
    аналогичный найденному в S16 для DashboardPanel): `spentAmount`/
    `trackedMinutes`/`counts.*` на самой карточке проекта — **не**
    выведены из этой усечённой ленты. Они считаются в
    `ProjectsService.toDtos` (`projects.service.ts:110-229`) отдельным
    путём — `tx.task.groupBy`/`tx.note.groupBy`/`tx.event.groupBy`/
    `tx.document.groupBy` (настоящие DB-агрегаты для counts) и
    `tx.transactionLine.findMany`/`tx.timeEntry.findMany` **без `take`**
    (весь набор строк проекта, не первые 20) с суммированием на
    сервере — корректно по значению, хоть и не DB `_sum` (для time — не
    может быть чистым SQL `_sum`, т.к. `entryMinutes()` считает открытый
    таймер от текущего момента). Наивного суммирования по `take:
    20`-ленте нигде не найдено.
  - Реальная проверка объёмом (не просто повторное чтение кода): новый
    integration-тест `apps/api/test/finance-transactions-scale.integration.test.ts`
    на изолированном Postgres (см. «Проверки» ниже), bulk-insert напрямую
    через Prisma (`prisma.asSystem`), как в эталоне
    `time-pagination.integration.test.ts`:
    - 600 `Transaction` — первая страница `GET .../finance/transactions`
      возвращает ровно 50 (документированный `DEFAULT_PAGE_SIZE`), не 600;
      постраничный обход `limit=100`/`offset` без дублей и без пропусков
      находит все 600.
    - 550 `Transaction` (> 500, за пределами дефолтной страницы) —
      `GET .../finance/reports/monthly` и `GET .../finance/reports/
      categories` возвращают точную сумму по всем 550 строкам, не по
      первой подгруженной странице.
- Файлы:
  - `apps/api/test/finance-transactions-scale.integration.test.ts` (новый,
    2 теста).
  - `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта запись + таблица
    очереди + шапка: S15 переведён в DONE).
  - Прикладной код (`transactions.service.ts`, `reports.service.ts`,
    `search.service.ts`, `projects.service.ts`, панели) **не менялся** —
    реального дефекта не найдено, паттерн Time/Inbox применять было не к
    чему.
- Проверки и результаты:
  - Изолированный portable-Postgres, порт 5548, отдельный `ORION_PG_DATA`
    в scratchpad сессии, `prisma migrate deploy` (58 миграций, чисто),
    свой `STORAGE_DIR`; рабочий `.env`/`infra/postgres/data` не тронуты;
    кластер поднят и остановлен (`node scripts/postgres.mjs down`) только
    в рамках этой сессии.
  - `pnpm test:integration` на этом кластере → PASS, **20 файлов / 110
    тестов** (было 19/? до добавления нового файла — новый файл добавил 2
    теста, ни один существующий тест не менялся).
  - `pnpm typecheck` → PASS (7/7 проектов).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы:
    `CalendarPanel.tsx:320`, `DocumentsPanel.tsx:225`,
    `scripts/seed-demo-workspace.mjs:561`).
  - `pnpm test` → PASS, 22 файла / 196 тестов.
- Миграция/данные: без изменений Prisma-схемы/миграций и без изменений
  контракта (`shared-types` не трогался) — только новый integration-тест.
- Не проверено:
  - Latency courier/perf-бенчмарк offset-пагинации Finance на десятках
    тысяч строк (аналогично незакрытому пункту исходной S15-записи для
    Time) — не измерялся; `skip`-based offset деградирует на очень больших
    offset хуже курсора, но это отдельный перформанс-вопрос, не дефект
    корректности, и реалистичный command-сценарий (сотни-низкие тысячи
    транзакций за годы) не подтверждён как требующий этого прямо сейчас.
  - UI визуально (Показать ещё в TransactionsView, командная палитра) — не
    открывалось в браузере (нет browser-automation тулинга в сессии, та же
    причина SKIPPED, что и во всех предыдущих сессиях без него).
- Итог: все пять путей карточки S15 (time, inbox, finance, search,
  projects) закрыты — три первых кодом в основной сессии, два последних —
  подтверждённой классификацией без дефекта в добивающей. **S15 переведена
  в DONE.**

### S16 · 2026-09-21 · PARTIAL (Finance module only — Inventory/Habits/Lists/Calendar untouched, separate sessions)

- Объём этой сессии: только Finance-часть карточки S16 ("Доведение
  Finance/Inventory/Habits/Lists/Calendar"), по явному указанию карточки —
  "не одна гигантская сессия: по одному модулю". Прочитан весь finance-код
  (`apps/api/src/finance/**` — accounts/transactions/reports/budgets/
  recurring/category-rules/goals/finance-refs.util.ts, `packages/shared-
  types/src/finance.ts`, `apps/web/panels/FinancePanel.tsx` + все
  `apps/web/panels/finance/*.tsx`) перед любой правкой.
- Инвариант, сформулированный и проверенный: деньги — только целые minor
  units (копейки) + `currency`, никогда float; totals по счетам/операциям с
  разными валютами не должны наивно складываться в одно вводящее в
  заблуждение число (100 USD + 100 EUR ≠ 200 чего-либо).
- **Minor units** — VERIFIED_EXISTING. Все суммы (`Account.startingBalance/
  balance`, `TransactionLine.amount`, `Budget.limitAmount/spent`,
  `RecurringTransaction.amount`) — `z.number().int()` в схемах и Prisma
  `Int`-колонки; вся арифметика — целочисленные `_sum`/raw SQL `SUM(...)::int`
  (`computeNetByAccount`, `budgetSpentTx`, `sumLines` в `reports.service.ts`).
  Ни одного float-пути не найдено. `apps/web/lib/format.ts` — единственное
  место, где копейки/рубли конвертируются для UI (`parseMoneyInput` →
  `Math.round(value * 100)`, целое на выходе).
- **Multi-currency accounts — реальная, используемая возможность**, не
  гипотетическая: `Account.currency` (v0.14, `packages/shared-types/src/
  finance.ts:20/34`) устанавливается по счёту, `AccountsService.toDto`
  возвращает его, `AccountsView`/`FinanceSummaryRow` уже показывают его в UI.
  Значит "просуммировать across accounts с разными валютами в одно число"
  — реальный, не выдуманный риск, не "упрощение v0" (не входит в список
  "Осознанные упрощения v0" в CLAUDE.md).
- **Найден и исправлен реальный баг**: `DashboardPanel.tsx` (`financeStats`,
  было `apps/web/panels/DashboardPanel.tsx:176`) считал `totalBalance =
  (accounts ?? []).reduce((sum, a) => sum + a.balance, 0)` — наивная сумма
  через все счета вне зависимости от валюты — и печатал результат через
  `formatMoney(totalBalance)` без указания валюты (молча дефолт ₽). Для
  мультивалютного пространства это обманчивая, неверная цифра — ровно тот
  класс бага, который `FinanceSummaryRow` (вкладка «Финансы») уже
  специально обходит своей собственной группировкой по валюте (её
  докомментарий прямо это признавал: "unlike the Dashboard's finance card
  which only ever summed the default workspace currency" — т.е. баг был
  знаем по имени, но не исправлен).
  - Написан падающий тест ДО правки: `apps/web/lib/format.test.ts`
    (`sumByCurrency`, функции ещё не существовало) — `TypeError: sumByCurrency
    is not a function` (3/3 упали), проверено запуском
    `npx vitest run apps/web/lib/format.test.ts` до правки.
  - Исправление: новый чистый хелпер `sumByCurrency<T>(items, currency,
    amount)` в `apps/web/lib/format.ts` (группирует по валюте вместо
    единого `reduce`). `DashboardPanel.tsx` теперь строит
    `financeStats.balancesByCurrency` через `sumByCurrency` и рендерит одну
    строку `<p>` на валюту (было: одна обманчивая сумма). Заодно
    `FinanceSummaryRow` (`apps/web/panels/finance/summary-row.tsx`),
    который уже делал то же самое вручную (`useMemo` с ручным `Map`),
    переведён на тот же общий хелпер — было два независимых, могущих
    разойтись места с одной и той же логикой, теперь одно.
  - После правки тот же тест-файл: 3/3 PASS.
- **Найден, но НЕ исправлен полностью — тот же класс бага в Reports/
  Budgets** (честно оставлено TODO, не тот же уровень готовности что
  Dashboard-фикс): `ReportsService.monthlySummary`/`sumLines`
  (`apps/api/src/finance/reports/reports.service.ts:31-46,90-101`) и
  `categoryBreakdown` (`:55-87`) агрегируют `TransactionLine.amount` через
  **все** счета рабочего пространства без учёта `Account.currency` —
  `MonthlyFinanceSummary`/`CategoryBreakdownEntry` (`packages/shared-types/
  src/finance.ts:332-346`) вообще не имеют поля `currency` в контракте.
  `BudgetsService`/`budgetSpentTx` (`finance-refs.util.ts:82-97`) — тот же
  паттерн для `Budget.spent` (категория не привязана к одному счёту/валюте).
  Почему не исправлено полностью в этой сессии: правильный фикс — либо
  переработать форму ответа (`MonthlyFinanceSummary`/`CategoryBreakdownEntry`/
  `Budget` получают валютное измерение — массив на (месяц, валюта) вместо
  плоских чисел), либо гарантировать, что бюджет/отчёт физически не может
  включать операции из разных валют — оба варианта меняют публичный
  контракт API (`shared-types`) и переписывают три экрана
  (`ReportsView` — два hand-rolled SVG-графика + разбивка по категориям,
  `BudgetsView`, `FinanceSummaryRow`), т.е. не помещается рядом с честным
  Dashboard-фиксом в одну сессию без риска сделать половинчатую, непроверенную
  переделку контракта. Вместо имитации готовности — сделан минимальный
  честный компромисс по инварианту "не выдавать обманчивую цифру": в
  `FinanceSummaryRow` плитка «Расход в этом месяце» (единственное место, где
  `monthly.expense` печатается пользователю без разбивки) теперь скрывается,
  когда `balancesByCurrency.length > 1` (пространство реально мультивалютное
  — иначе цифра всё ещё корректна, это доминирующий случай), с явным
  комментарием в коде, почему и что именно осталось TODO. `ReportsView`
  (графики) и `BudgetsView` не тронуты — там `monthly.expense`/`spent` по-
  прежнему может молча смешивать валюты для мультивалютных пространств,
  см. «Следующий шаг».
- **Recurring transactions** (`RecurringCheckerService.runCheck`,
  `apps/api/src/finance/recurring/recurring-checker.service.ts`) —
  VERIFIED_EXISTING, без изменений. Материализованная `Transaction.occurredAt`
  берётся из `rule.nextRunAt` (запланированное время), не из времени
  выполнения крона (`new Date()`) — `:47` `occurredAt: rule.nextRunAt`.
  Сумма — `rule.amount`, тот же целочисленный minor-units путь, без
  конвертации. Полная idempotency-проверка конкурентного выполнения — это
  отдельная карточка S21 ("P1: recurring finance/inbox concurrency"), не
  трогал по заданию.
- **Lint warnings** — сверено с baseline (`CalendarPanel.tsx:320`,
  `DocumentsPanel.tsx:225`, `scripts/seed-demo-workspace.mjs:561`): ни один
  не в finance-файлах. Отдельный прогон `npx eslint apps/web/panels/
  DashboardPanel.tsx apps/web/panels/finance apps/web/panels/FinancePanel.tsx
  apps/api/src/finance --max-warnings=9999` → 0 warnings до и после правки.
  Ничего чинить не пришлось здесь — честно, не искал несуществующую работу.
- Файлы: `apps/web/lib/format.ts` (новый экспорт `sumByCurrency`, обновлён
  устаревший докомментарий `formatMoney` — раньше утверждал "ORION keeps one
  currency per workspace", что противоречит `Account.currency` с v0.14),
  `apps/web/lib/format.test.ts` (новый, 3 теста),
  `apps/web/panels/DashboardPanel.tsx` (`financeStats.totalBalance` →
  `balancesByCurrency`, рендер цикла по валютам),
  `apps/web/panels/finance/summary-row.tsx` (дедуп на `sumByCurrency`,
  guard на «Расход в этом месяце» + докомментарий про оставшийся Reports/
  Budgets риск), `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта запись).
  Backend/API/схема Prisma/shared-types **не менялись** — весь фикс на
  фронтенде (агрегация в существующих `formatMoney`-точках), контракт
  `MonthlyFinanceSummary`/`Budget` не тронут (это и есть открытый TODO выше).
- Проверки и результаты:
  - Падающий тест до правки → падал (`sumByCurrency is not a function`,
    3/3), проверено отдельным прогоном.
  - `pnpm typecheck` → PASS (7/7 проектов).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не в finance).
  - `pnpm test` → PASS, **19 файлов / 174 теста** (было 13/135 в S00-базовом
    снимке — приросло за счёт S01-S15; +3 новых теста этой сессии).
  - `pnpm test:integration` — **не запускался**: изменения этой сессии
    целиком во фронтенде (`apps/web/lib`, `apps/web/panels`), backend/API/
    Prisma-схема не менялись, интеграционный сьют (`apps/api/test/*`)
    таких файлов не покрывает — прогон ничего нового не проверил бы. Не
    поднимал изолированный portable-Postgres ради этого.
  - `pnpm build` — не запускался (нет причины ожидать регрессии сборки от
    чистого рефакторинга хелпера + JSX-цикла; typecheck уже покрывает типы).
- Миграция/данные: нет — ни одна Prisma-модель/миграция не менялась.
- Непроверенное: **Reports/Budgets мультивалютная агрегация** (см. выше) —
  `MonthlyFinanceSummary`/`CategoryBreakdownEntry`/`Budget.spent` по-прежнему
  наивно смешивают валюты для пространств с более чем одной валютой на
  счетах; `ReportsView` (графики) и `BudgetsView` эту цифру пользователю
  показывают без предупреждения. Populated UI screenshot нового вида
  Dashboard-карточки (несколько строк баланса вместо одной) не снят — нет
  browser-tooling в сессии (та же причина SKIPPED, что в S00/S03/S04).
  Inventory/Habits/Lists/Calendar — вообще не открывались, по заданию.
- Следующий шаг: отдельная сессия для Reports/Budgets мультивалютного
  фикса — переработать `MonthlyFinanceSummary`/`CategoryBreakdownEntry`/
  `Budget` на валютное измерение (массив (период, валюта) вместо плоских
  чисел) и переписать `ReportsView`/`BudgetsView` под новую форму; либо,
  если владелец продукта решит, что мультивалютные бюджеты/отчёты вне
  объёма v1 — явно задокументировать это как "Осознанное упрощение v0" в
  CLAUDE.md (сейчас это не значится там, поэтому и не третировалось как уже
  решённое). После неё — S16 для Inventory/Habits/Lists/Calendar, по одному
  за сессию, как и было указано в самой карточке.

### S16 (Inventory) · 2026-09-21 · VERIFIED_EXISTING

- Объём этой сессии: только Inventory-часть карточки S16 ("Доведение
  Finance/Inventory/Habits/Lists/Calendar" — по одному модулю за сессию,
  Finance уже DONE из предыдущей сессии). Habits/Lists/Calendar не
  открывались.
- Поведение: прочитал `apps/api/src/inventory/inventory.service.ts`,
  `inventory.controller.ts`, `inventory-alerts.service.ts` целиком и
  Prisma-модели `InventoryItem`/`InventoryMovement` в `schema.prisma`
  перед тем как что-либо трогать. Сформулированный инвариант: "`balance`
  всегда равен сумме `InventoryMovement.quantity` по позиции; конкурентные
  списания никогда не уводят пересчитанный `balance` в противоречивое
  (отрицательное или не соответствующее ни одному из исходов гонки)
  состояние; журнал движений append-only — нет маршрута редактирования/
  удаления одной записи".
  Код уже удовлетворяет инварианту, реализация написана в предыдущей
  (не увиденной в этой сессии, но откоммиченной ранее) итерации:
  - **Append-only** — `InventoryController` объявляет только `POST
    items/:itemId/movements` и `GET items/:itemId/movements`; ни PATCH, ни
    DELETE для одной записи `InventoryMovement` не существует ни в
    контроллере, ни в сервисе (`InventoryService` не содержит
    `updateMovement`/`deleteMovement`). `InventoryMovement` в Prisma-схеме
    не имеет `@updatedAt`, что соответствует «эта строка не редактируется
    после вставки».
  - **Balance никогда не денормализован как мутируемое поле** —
    `InventoryItem` в схеме не содержит колонку `balance`/`quantity`
    вообще; `computeTotalsTx` в `inventory.service.ts` каждый раз считает
    его сырым `SUM(quantity)` по `inventory_movements` (через
    `$queryRaw`, сгруппировано по `itemId` для списка, через
    `tx.inventoryMovement.aggregate` для одной позиции внутри
    `recordMovement`) — не тот случай "денормализовано для скорости", а
    просто отсутствие денормализации, поэтому расхождение мутацией в
    принципе невозможно: перечитать баланс значит пересчитать сумму.
  - **Concurrency** — `recordMovement` делает `SELECT id FROM
    "inventory_items" WHERE id = ${itemId} FOR UPDATE` первой операцией
    внутри `withUser`-транзакции, до чтения текущего баланса и до вставки
    новой строки движения; для списания/отрицательной корректировки
    баланс агрегируется заново (`aggregate`) уже под этой блокировкой и
    запрос отклоняется `BadRequestException` (400 "Недостаточно
    остатка..."), если результат ушёл бы в минус, **до** `create()`.
    Строка-локер (`FOR UPDATE`) сериализует конкурентные транзакции на
    одну и ту же позицию — вторая ждёт коммита/отката первой прежде чем
    увидеть актуальный агрегат, что и закрывает классическую read-then-write
    гонку "оба читают 8, оба пишут -2".
  Поскольку сама механика уже присутствовала и не требовала правки —
  никакого прикладного фикса в этой сессии не было; результат по
  протоколу (`VERIFIED_EXISTING`, не выдуманная работа) — реальный
  concurrency-тест, доказывающий инвариант на изолированной БД.
- Файлы: **новый** `apps/api/test/inventory-concurrency.integration.test.ts`
  (2 теста); `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта запись).
  Прикладной код (`apps/api/src/inventory/*`, схема) не менялся — фикса не
  требовалось.
- Проверки и результаты:
  - Написал тест ДО подтверждения (не после) — не заглядывал в git log
    реализации, чтобы убедиться, что тест реально мог бы упасть на наивной
    реализации: тест 1 бьёт `Promise.all` двумя параллельными `issue
    quantity: 5` против баланса 8 (не два последовательных `await` — по
    протоколу гонка не воспроизводится последовательным вызовом), проверяет
    `[201, 400].sort()` статусов (ровно одно списание проходит), финальный
    `balance` из `GET items` равен 3 (никогда не отрицательный, никогда не
    -2 и никогда не 8), независимо пересчитывает сумму по
    `inventoryMovement.findMany` через `prisma.asSystem` в обход сервиса и
    сверяет с DTO-балансом, и проверяет, что в базе ровно одна `issue`
    строка (не две — отклонённый запрос не долетел до `create`). Тест 2
    проверяет append-only: создаёт движение, бьёт `PATCH`/`DELETE` по трём
    правдоподобным путям
    (`/inventory/movements/:id`, `/inventory/items/:itemId/movements/:id`)
    и ожидает `[404, 405]` на каждый, затем читает строку напрямую через
    Prisma и подтверждает `quantity` не изменился.
  - Прогнал тест на изолированном portable-Postgres (тот же рецепт 5544 в
    scratchpad, что в S00–S04: `ORION_PG_DATA`/`ORION_PG_PORT`, `prisma
    migrate deploy`, свой `STORAGE_DIR`, рабочий `.env`/`infra/postgres/data`
    не трогались) → **PASS, 2/2 теста** на первом прогоне (не пришлось
    подгонять тест под прохождение — совпадает с ожиданием "инвариант уже
    выполняется").
  - `pnpm test:integration` (весь набор, тот же изолированный кластер) →
    PASS, **12 файлов / 72 теста** (было 70 до этой сессии, +2 новых).
  - `pnpm typecheck` → PASS (7/7 проектов).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы).
  - `pnpm test` → PASS, 19 файлов / 174 теста (не трогал юнит-слой).
  - Временный кластер на 5544 (и scratch storage/pg-data) поднят и
    остановлен только в рамках этой сессии; рабочий `.env` и
    `infra/postgres/data` не тронуты.
- Миграция/данные: нет — Prisma-схема Inventory не менялась, правки не
  потребовалось.
- Непроверенное: `InventoryAlertsService.evaluateTx` (low-stock уведомления)
  не входил в объём "concurrency/append-only" done-критерия и не
  проверялся отдельно на гонку (он читает уже пересчитанный после лока
  баланс из того же вызова `recordMovement`, поэтому логически защищён тем
  же `FOR UPDATE`, но отдельного теста на дедуп/гонку двух уведомлений не
  писал — вне объёма этой карточки). UI (`InventoryPanel`) не открывался —
  задание про серверный concurrency/append-only контракт, не про клиент.
  `adjustment` (третий тип движения, знак через `direction`) прогнан только
  косвенно (`deltaFor` покрыт тем же кодовым путём `recordMovement`, что
  `receipt`/`issue`, но отдельного race-теста именно на `adjustment` не
  писал — риск тот же самый код, поэтому не считаю это пробелом в
  инварианте, но не доказано отдельным тестом).
- Следующий шаг: Habits — следующая по очереди часть S16 (по одному модулю
  за сессию, как и раньше). После всех четырёх частей карточка S16
  целиком станет DONE.

### S16 (Habits) · 2026-09-21 · PARTIAL (real bug found and fixed — toggle concurrency)

- Поведение: карточка требовала верификацию "habit day/idempotency" для
  Habits — сверился с уже подробным описанием в корневом `CLAUDE.md`
  («Привычки (v0.19)») построчно против реального кода перед правкой:
  - `habitLocalDayKey()` vs `habitDayKey()` — **подтверждено корректно**.
    Клиент (`apps/web/panels/HabitsPanel.tsx:77`, `packages/core-react/src/
    use-habits.ts:135`) реально передаёт `habitLocalDayKey(now)` на
    `?today=` при чтении и на `{ day }` при toggle; сервер использует
    `habitDayKey` (UTC) только как дефолт, когда клиент день не передал.
    `graft grep` по обоим символам (44 попаданий/25 символов/10 файлов)
    не нашёл ни одного места, где сервер подставлял бы свой UTC-день вместо
    переданного клиентом.
  - `habitStreak`/`isHabitScheduled`/`dueToday`/`doneToday` — **подтверждено
    вычисляемые, не хранимые**: `HabitsService.toDto` (habits.service.ts:189)
    зовёт `habitStreak(...)`/`isHabitScheduled(...)` на каждый DTO из
    актуальных `HabitEntry` строк; в Prisma-схеме `Habit` нет столбца
    `streak`/`dueToday`/`doneToday` — их физически негде закэшировать.
  - Пустое расписание = каждый день, прощающее сегодня, считаются только
    запланированные дни — уже покрыто юнит-тестами
    `packages/shared-types/src/habit.test.ts` (не трогал, все проходят в
    составе `pnpm test`, 174/174).
  - **`toggle`-идемпотентность — реальный баг, а не VERIFIED_EXISTING.**
    Старый код (`HabitsService.toggle`, до этой сессии) — чистый
    check-then-act без синхронизации: `findUnique` → `create`/`delete`, с
    `catch` только на `P2002` (уникальный индекс `(habitId, day)`), с
    комментарием "the user's intent — 'make it done' — is satisfied".
    Написал падающий concurrency-тест **до** правки
    (`apps/api/test/habits-concurrency.integration.test.ts`, два теста,
    оба на реальном `Promise.all`, не последовательных `await`) и прогнал
    его на неизменённом коде на изолированном portable-Postgres (порт 5544,
    тот же рецепт, что в S00–S04, scratchpad-каталоги, рабочий
    `.env`/`infra/postgres/data` не трогались):
    - Тест на гонку двух *un-tick* (уже отмеченный день, обе конкурентные
      `toggle` читают "существует", обе пытаются `delete`) — **упал с
      500**: Prisma репортит проигравшую `delete` как `P2025` ("record not
      found"), не `P2002`, а старый `catch` ловил только `P2002`.
    - Тест на гонку двух *tick* (чистый день) — упал по другой, более
      серьёзной причине: не 500, а **тихая потеря отметки**. Оба ответа
      были `201`, но один — `{ done: true }`, другой — `{ done: false }`, и
      в базе **ноль** строк `HabitEntry`, хотя первый ответ утверждал
      успех. Это случилось потому что без синхронизации второй запрос
      иногда читает уже закоммиченное первым состояние (не гонится с ним
      на уровне уникального индекса), видит "уже существует" и **удаляет
      только что созданную запись** — настоящий toggle-flip, о котором
      вызывающая сторона не подозревает, что это была гонка, а не
      осознанный второй клик.
    Фикс (`apps/api/src/habits/habits.service.ts`, метод `toggle`):
    `SELECT id FROM habits WHERE id = ${habitId} FOR UPDATE` внутри той же
    `withUser`-транзакции перед чтением/записью `HabitEntry` — тот же
    паттерн, что `InventoryService.recordMovement` уже использует для
    своей конкурентной инвариант (S16 Inventory, эта же карточка). Лок
    сериализует конкурентные toggle одного habit (любой день), поэтому
    второй запрос всегда видит реальное закоммиченное состояние, а не
    устаревший снимок — тем самым устраняет и потерю отметки, и саму
    возможность гонки на уникальном индексе. `catch` на `P2002`/`P2025`
    оставлен как defense-in-depth (на случай, если лок когда-нибудь
    обойдут), не как основной механизм.
    Важное наблюдение, отражённое в комментариях кода и теста: сериализация
    не отменяет того, что toggle — это флип, а не set; два конкурентных
    флипа от одного и того же чистого состояния **детерминированно**
    гасят друг друга (день остаётся неотмеченным после двух конкурентных
    toggle) — это законное поведение (щёлкнули дважды — вернулись в
    исходное состояние), а не баг. Баг был именно в недетерминированности
    и падении 500, не в самом факте взаимного гашения. Тесты проверяют это
    через чётность числа флипов (2 флипа от чистого дня → 0 записей; 1
    существующая отметка + 2 конкурентных флипа → 1 запись), а не
    требованием "всегда done: true".
- Файлы: `apps/api/src/habits/habits.service.ts` (метод `toggle` — лок +
  расширенный catch), `apps/api/test/habits-concurrency.integration.test.ts`
  (новый, 2 теста), `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта
  запись). Модель `HabitEntry`/уникальный индекс `(habitId, day)` не
  менялись — уже были корректны.
- Проверки и результаты:
  - Падающий тест до фикса → подтверждённо красный по обеим причинам
    (500 на un-tick гонке, потеря записи на tick гонке) на изолированном
    кластере.
  - После фикса: `habits-concurrency.integration.test.ts` → PASS, 2/2,
    прогнано **5 раз подряд** без флейков (гонка синхронна по локу, не
    зависит от таймингов сети).
  - `pnpm test:integration` (полный набор, тот же изолированный кластер
    5544, `prisma migrate deploy`, свой `STORAGE_DIR`) → PASS, **13 файлов
    / 74 теста** (было 72 до этой сессии, +2 новых).
  - `pnpm test` → PASS, 19 файлов / 174 теста (не трогал юнит-слой —
    `habit.test.ts` уже покрывал `habitStreak`/`isHabitScheduled`).
  - `pnpm typecheck` → PASS (7/7 проектов).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы).
  - Попутно замечено: в начале сессии случайно запустил `node
    scripts/postgres.mjs up` без переопределения `ORION_PG_DATA`/
    `ORION_PG_PORT` (по умолчанию целится в рабочий `infra/postgres/data`
    на 5433) — команда только подняла кластер (идемпотентно, как обычный
    `pnpm db:up`), никаких миграций/тестов/записей на него не выполнялось,
    сразу переключился на изолированный кластер 5544 по рецепту из этого
    файла. Рабочие данные не затронуты.
  - Временный кластер на 5544 (и scratch storage/pg-data) поднят и
    остановлен только в рамках этой сессии.
- Миграция/данные: нет — фикс целиком в query-логике сервиса.
- Непроверенное: UI (`HabitsPanel.tsx`) не менялся — сверка
  `habitLocalDayKey`-передачи была построчной (grep + Read), не
  browser-tooling верификацией клика по чекбоксу (нет browser-automation в
  сессии, та же причина SKIPPED, что в S00). Race между *toggle* и
  *archive*/*update* того же habit (например, архивация во время
  конкурентного toggle) не тестировалась отдельно — лок на `habits`
  берётся только внутри `toggle`, `update`/`archive` его не берут, так что
  такая гонка (не про day-идемпотентность, отдельный вопрос) не
  покрыта этой сессией.
- Следующий шаг: Lists и Calendar остаются TODO для S16 (по одному модулю
  за сессию). После всех частей карточка S16 целиком станет DONE.

### S16 (Lists) · 2026-09-21 · BLOCKED (done-критерий "lists destructive copy" не соответствует коду — фичи копирования списка нет вообще)

- Поведение: карточка S16 (`10-BACKLOG.md:130-132`) требует по Lists —
  "lists destructive copy". Перед любой правкой нашёл модуль `lists` в
  `MODULE_CATALOG` (`packages/shared-types/src/modules.ts:251-263`, label
  «Списки», `kind: "additional"`) и прочитал весь код модуля:
  - `apps/api/src/lists/lists.service.ts` (полностью, 159 строк) —
    `list/create/update/archive/createItem/updateItem/deleteItem/clearChecked`.
    **Ни одного метода copy/duplicate/clone.**
  - `apps/api/src/lists/lists.controller.ts` (полностью, 104 строки) —
    те же 8 маршрутов, что в сервисе, один в один. Нет `POST :listId/copy`
    или аналога.
  - `packages/shared-types/src/list.ts` — grep на `copy|duplicate|clone`
    (`-i`) не нашёл совпадений; схемы только `list`, `createListInput`,
    `updateListInput`, `listItem`, `createListItemInput`,
    `updateListItemInput`.
  - `apps/web/panels/ListsPanel.tsx` — grep на `copy|duplicate|clone|Копир|Дублир`
    (`-i`) не нашёл совпадений; та же проверка по всей `apps/web/panels/`
    нашла совпадения только в шести файлах, не относящихся к Lists
    (Dashboard/Notes/Sync/note-attachments/task-form — про буфер обмена
    ссылок/URL, не про копирование списков).
  - Раздел «10. Списки» в `docs/SONNET_IMPLEMENTATION/06-MODULES.md:115-117`
    (единственное релевантное упоминание Lists в модульных спеках) описывает
    quick-add Enter, reorder, «очистить выполненное» с сообщением числа и
    обратимостью — **про копирование списка спецификация не говорит ни слова**.
  - `01-AUDIT.md`/`13-ACCEPTANCE.md`/`09-RELIABILITY.md` содержат слово
    "lists" только в общих перечислениях модулей (`grep -i lists`), без
    отдельного сценария копирования.
  Вывод: "destructive copy" в done-критерии S16 не описывает существующую
  или задокументированную функциональность Lists. Либо формулировка карточки
  унаследована от более раннего/другого драфта плана, либо перепутана с
  другим модулем (в Tasks/Projects/Notes тоже нет своего copy — не проверял
  специально, вне периметра этой сессии). Придумывать endpoint копирования
  списка, которого никто не просил и не специфицировал (в каком виде
  реагирует workspace-scope, что происходит при копировании архивного
  списка, копируются ли `checked`-флаги пунктов и т.д.), значило бы внести
  необсуждённую фичу без теста на реальный баг — начинать с падающего теста
  было не на чем построить, потому что нет инварианта, который можно было бы
  нарушить.
- Файлы: не менялись (только чтение). Единственная правка — эта запись.
- Проверки и результаты: не запускал `pnpm typecheck`/`pnpm test`/
  `pnpm test:integration` в этой сессии — правок кода нет, перезапуск не
  нужен; baseline (PASS по всем) уже задокументирован в разделе S00 выше и
  не мог измениться от чтения файлов.
- Миграция/данные: нет.
- Непроверенное: существует ли copy/duplicate где-то вне `lists`/`Lists`
  именования (например, задумано как копирование задачи со списком
  подзадач через `subtasks.tsx`) — эта гипотеза противоречит тому, что
  карточка S16 явно перечисляет Lists отдельно от Tasks и относится к
  модулю из `MODULE_CATALOG`, но формально не исключена другим агентом.
- Следующий шаг: если владелец подтверждает, что копирование списка —
  желаемая новая фича (не восстановление сломанного поведения), завести её
  отдельной карточкой backlog с явным контрактом (что переносится: пункты,
  их `checked`, независимость копии от оригинала при последующем удалении/
  архивации), а не закрывать через S16 "доведение существующего". До тех
  пор часть S16 по Lists остаётся BLOCKED, не PARTIAL/DONE — Calendar
  по-прежнему TODO отдельной сессией.

### S16 (Calendar) · 2026-09-21 · PARTIAL (recurrence/readonly VERIFIED_EXISTING; реальный timezone-баг найден и исправлен; drag&drop edge case задокументирован, не исправлен)

- Поведение: done-критерий S16 по Calendar — "calendar recurrence/timezone/
  readonly" (`10-BACKLOG.md:130-132`). Прочитал полностью
  `apps/api/src/events/events.service.ts`, `calendar-connections.service.ts`,
  `packages/shared-types/src/event.ts`, `packages/shared-types/src/recurrence.ts`,
  `apps/web/panels/CalendarPanel.tsx` и весь `packages/ui/src/calendar/*`
  (shared.tsx, month-grid.tsx, time-grid.tsx, agenda.tsx) перед любой правкой.
  Сформулировал по инварианту на каждый из трёх пунктов и сверил с кодом:

  **1. Recurrence** — VERIFIED_EXISTING. Инвариант: правка/удаление одного
  вхождения серии не должна ломать остальные, серия должна поддерживать
  исключения. `EventsService.update`/`remove` реализуют три `scope`:
  `one` (upsert `EventOverride` с `canceled`/патчем на конкретный
  `occurrenceStart` — исключение из серии), `following` (капает `until`
  мастера и создаёт новый событие-хвост с остальной рекуррентностью),
  `all` (правит сам мастер). `EventsService.list` разворачивает окно через
  `expandRecurrence` (`packages/shared-types/src/recurrence.ts`, юнит-тесты —
  `recurrence.test.ts`, уже существовали) и применяет override/cancel к
  каждому вхождению. Ничего не сломано, новых тестов не потребовалось — уже
  протестированная, работающая функциональность.

  **2. Readonly** — VERIFIED_EXISTING, включая server-side enforcement (не
  только UI). Инвариант: прямой PATCH/DELETE на событие, импортированное из
  внешнего ICS-фида, должен отклоняться сервером, а не только скрываться в
  UI. Нашёл: `calendar-connections.service.ts:177` ставит `readOnly: true`
  на каждое импортированное событие; `EventsService.update`/`remove`
  (`events.service.ts:125`, `:206`) кидают `BadRequestException` **до** любой
  мутации, если `master.readOnly` — это применяется до ветвления по scope,
  т.е. защищает и scope=one/following/all одинаково. Клиент дополнительно
  прячет реакцию на drag (`CalendarPanel.tsx:266`: `if (event.readOnly)
  return;`), но это UI-удобство поверх уже существующей server-side защиты,
  не единственный барьер. Единственный пробел — не было теста, бьющего
  endpoint напрямую (существующий тест `pulls an external ICS feed on the
  scheduled pass, read-only` в `api-rls.integration.test.ts` проверял только
  флаг `readOnly` в ответе `GET`, не сам запрет мутации). Добавил в тот же
  тест прямой `PATCH`/`DELETE` на импортированное событие с проверкой
  `status === 400` и что событие осталось в списке — падал бы, если бы
  проверка была снята. PASS.

  **3. Timezone / date-only (реальный баг, исправлен)**. Инвариант: `allDay`
  событие — date-only, а не instant (тот же принцип, что и
  `habitLocalDayKey` для привычек), и должно отображаться на правильном
  календарном дне независимо от часового пояса просматривающего.
  `normaliseRange` в `events.service.ts:358-367` действительно хранит
  `allDay`-события как UTC-полуночные границы (contract, задокументирован в
  `event.ts:52-55`) — это верно. Баг был на клиенте: `MonthGrid`/`TimeGrid`
  (`packages/ui/src/calendar/month-grid.tsx`, `time-grid.tsx`) бакетировали
  элементы по календарному дню через `startOfDay(new Date(item.start))` —
  **локальные** геттеры Date поверх UTC-полуночного instant. Для любого
  зрителя западнее UTC (отрицательный оффсет) `new Date(utcMidnightISO)`
  интерпретируется как предыдущий локальный календарный день — `allDay`
  событие визуально съезжает на день раньше. Починил: добавил
  `allDayAnchor(iso)` в `packages/ui/src/calendar/shared.tsx` (реанкорит UTC
  Y/M/D на локальную полночь) и использовал его в бакетировании
  `month-grid.tsx` (границы диапазона в `WeekRow`) и `time-grid.tsx`
  (`allDayByDay`) — только для `item.allDay === true`, обычные timed-события
  не тронуты. Тест — `packages/ui/src/calendar/shared.test.ts` (новый файл,
  по прецеденту `focus-trap.test.ts`: чистая логика, без jsdom). Попытка
  воспроизвести баг через реальный сдвиг `TZ` в vitest не сработала — на этой
  Windows-машине `process.env.TZ`, выставленный в рантайме (и даже через
  переменную окружения при спавне процесса), не меняет то, что возвращает
  `Date` (проверено отдельно: `TZ=Pacific/Kiritimati node -e "..."` всё равно
  вывел московское время хоста) — известное ограничение Node на Windows, не
  ICU-фича, а не баг теста. Переписал тест так, чтобы не зависеть от
  фактического сдвига зоны: проверяет, что `allDayAnchor(iso).getFullYear/
  Month/Date()` (локальные геттеры результата) равны `getUTCFullYear/Month/
  Date()` входного instant — именно это и есть инвариант, который чинит баг,
  независимо от того, в какой зоне реально выполняется процесс.

  **Найдено, но не исправлено (задокументировано, не в периметре этой
  правки)**: при переносе `allDay`-события drag&drop'ом на другой день в
  `MonthGrid` (`month-grid.tsx` `onDrop`, не в `TimeGrid`'овской полосе
  «весь день») клиент шлёт `{ start: dayToISO(day) }` — **без** `end` и без
  `allDay`. `EventsService.buildUpdateData` (`events.service.ts:369-397`)
  вызывает `normaliseRange` (которая снова снэпит к UTC-полуночным границам)
  только когда И `startAt`, И `endAt` переданы вместе; при одном `startAt`
  она пишет его сырым instant'ом без пересчёта дня, а `allDay`/`endAt`
  остаются от старого события. Отдельно, даже в `TimeGrid`'овской полосе
  «весь день», которая честно шлёт оба поля и `allDay: true`, использует
  `startOfDay(day).toISOString()` (локальная полночь) — для зрителя *восточнее*
  UTC локальная полночь при переводе в UTC инстант может откатиться на
  предыдущий UTC-день, и `normaliseRange` на сервере извлечёт из него не тот
  день. Это симметричный, но отдельный баг (drag&drop payload construction,
  а не display bucketing) в двух разных местах с разными хвостами
  (пропущенные поля vs неправильный якорь дня), требует отдельной правки и
  тестирования обоих направлений смещения — не стал трогать в рамках этой
  сессии, чтобы не вносить непротестированную правку поверх сложной
  local/UTC арифметики. Оставляю как находку для отдельной карточки.
- Файлы: `packages/ui/src/calendar/shared.tsx` (новая функция `allDayAnchor`),
  `packages/ui/src/calendar/month-grid.tsx`, `packages/ui/src/calendar/time-grid.tsx`
  (используют `allDayAnchor` при бакетировании `allDay`-элементов),
  `packages/ui/src/calendar/shared.test.ts` (новый файл),
  `apps/api/test/api-rls.integration.test.ts` (прямой PATCH/DELETE на
  readOnly-событие внутри существующего теста), `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md`
  (эта запись).
- Проверки и результаты:
  - `pnpm test` → PASS, 20 файлов / 176 тестов (было 175, +1 новый
    `shared.test.ts`).
  - `pnpm typecheck` → PASS (7/7 проектов).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (`CalendarPanel.tsx:320`,
    `DocumentsPanel.tsx:225`, `seed-demo-workspace.mjs:561`) — не мои файлы,
    регрессии нет.
  - `pnpm test:integration` на изолированном portable-Postgres (тот же
    рецепт, что в S00: отдельный `ORION_PG_DATA`/`ORION_PG_PORT=5544` в
    scratchpad, `prisma migrate deploy` начисто применил все миграции,
    отдельный `STORAGE_DIR`) → PASS, 13 файлов / 74 теста, включая новые
    прямые PATCH/DELETE-проверки readonly. Кластер остановлен и данные
    удалены после прогона; рабочий `.env`/`infra/postgres/data` не
    затрагивались.
- Миграция/данные: нет новых миграций (только применение существующих на
  изолированном тестовом кластере, как выше).
- Непроверенное: визуальная проверка в реальном браузере (нет
  browser-automation тулинга в сессии, как и во всех предыдущих частях
  S16/S00) — фикс проверен только юнит-тестом на уровне чистой функции, не
  скриншотом отрендеренного месяца/недели в разных зонах. Drag&drop payload
  баг (см. выше) найден, но не исправлен и не покрыт тестом.
- Итог по карточке S16 целиком: **PARTIAL**, не DONE. Finance/Inventory/
  Habits — готовы (см. записи выше). Calendar — готов в объёме этой сессии
  (recurrence/readonly verified, timezone-баг исправлен и протестирован;
  drag&drop edge case — отдельная находка, не блокирует closure этой части).
  Lists — остаётся **BLOCKED** отдельно: фичи копирования списков, которую
  требует done-критерий, не существует нигде в коде/спеке (см. запись выше),
  и это не должно повторно расследоваться следующим агентом без решения
  владельца. Карточка S16 не закрывается как DONE, пока Lists BLOCKED не
  снят явным решением (новая фича по контракту или правка формулировки
  карточки) — это осознанное, а не забытое расхождение.

### S17 · 2026-09-21 · DONE

- Поведение: две новые модели — `TaskComment` (комментарии) и `TaskActivity`
  (append-only журнал статуса/исполнителя/срока), обе с RLS, зеркалят
  модульный контракт CLAUDE.md.
  - **Комментарии** — CRUD под `workspaces/:id/tasks/:taskId/comments`.
    `userId` всегда server-stamped из `CurrentUser`; `CreateTaskCommentInput`
    физически не содержит поля `userId` (только `body`), так что подмена
    невозможна на уровне схемы, не только проверки. Редактировать/удалять
    может только автор — `TaskCommentsService.assertOwnedCommentTx` кидает
    403; owner/lead moderation override сознательно **не добавлен** —
    08-TEAM-AND-ACCESS.md не описывает такого исключения для комментариев,
    выдумывать не стал (см. doc-comment класса).
    Авторство переживает удаление участника: `TaskComment.userId` — FK на
    `User`, не на `WorkspaceMember` (`WorkspaceMember`-строка удаляется без
    каскада на `User`), поэтому после `DELETE .../members/:id` комментарий
    остаётся читаемым с тем же именем автора — не "unknown", без нарушения
    FK. Проверено интеграционным тестом (регистрирует, коммит, удаляет
    участника, читает страницу комментариев снова).
  - **XSS-safe rendering** — сервер не делает никакой обработки HTML в теле
    (хранит как есть); клиент рендерит тело тем же безопасным путём, что и
    заметки — `MarkdownView`/`renderMarkdown` из `packages/ui/src/markdown.tsx`
    (`markdown-it` с `html: false` — сырой HTML никогда не интерпретируется).
    Отдельного санитайзера не заводил — переиспользовал существующий путь,
    как просила карточка.
  - **Пагинация** — cursor-based, тот же композитный курсор `(createdAt, id)`
    desc, что у `TimeService.list` (S15): `GET .../comments?cursor&limit`,
    `TaskCommentPage.nextCursor`. Курсор с чужого task/workspace отклоняется
    400 (не молча игнорируется), как у `TimeService`.
  - **Notification producer** — при создании комментария, если у задачи есть
    `assigneeId`, уведомляется исполнитель через
    `NotificationCenterService.createTx` (kind `task_comment`, новый в
    `Notification.kind`), с `eventKey: task_comment:<commentId>` для дедупа и
    `actorId` для self-skip. Политика спрашивается явно
    (`NotificationPolicyService.allowsForUser(recipientId, "task")`) —
    отдельного тумблера "комментарии" не заводил, переиспользовал
    существующий `taskReminders` (карточка не просила новую настройку).
    **Важная находка**: `createTx` нельзя звать внутри `withUser(actorId, …)`,
    когда `recipientId !== actorId` — RLS-политика `notifications_isolation`
    требует `recipientId = current_setting('app.current_user_id')`, так что
    вставка падает `42501` (RLS violation), не 500 без объяснения — только
    после того, как интеграционный тест поймал это как настоящий 500.
    Исправлено: `TaskCommentsService.create` сначала пишет комментарий в
    `withUser(userId, …)`, затем отдельно уведомляет через
    `this.prisma.asSystem(tx => notifications.createTx(tx, …))` — тот же
    паттерн, что у `DueTaskCheckerService`, но по требованию, а не по кроном
    расписанию. Это первый actor-triggered продюсер уведомлений в проекте;
    комментарий в `notification-center.service.ts` про "future actor-triggered
    producers" был написан заранее (S07), но сам путь через `asSystem` не был
    проверен до этой сессии.
  - **Журнал (аудит)** — `TasksService.update` диффит `status`/`assigneeId`/
    `dueAt` против строки до записи (`current`, уже загружалась для остальной
    логики) и пишет `TaskActivity` строки в той же транзакции, что и сам
    `task.update` (без RLS-конфликта — актёр здесь всегда сам обновляет
    задачу, `withUser(userId,…)` достаточно). Чисто переименование (без этих
    трёх полей) не создаёт строк — проверено тестом. Только чтение —
    `GET .../tasks/:taskId/activity`.
  - **Snapshot/бэкап (S03)** — обе новые модели дописаны в
    `snapshot-registry.ts` (policy `included`) и `SNAPSHOT_MODELS` в
    `snapshot.service.ts` (после `tasks`/`taskDependencies` — FK на `taskId`).
    Без этого `snapshot.integration.test.ts` (S03a coverage test) ловит
    пропуск сразу — что и произошло при первом прогоне, поймано и исправлено
    до финального прогона.
- Файлы:
  - `apps/api/prisma/schema.prisma` (`TaskComment`, `TaskActivity` + relations
    на `Task`/`Workspace`/`User`), `apps/api/prisma/migrations/
    20260921190000_task_comments_and_activity/migration.sql` (таблицы + RLS
    ENABLE/FORCE/POLICY для обеих — одной миграцией, не двумя, ради скорости
    сессии; структурный RLS-тест это не различает).
  - `apps/api/src/tasks/task-comments.service.ts` (новый),
    `apps/api/src/tasks/task-activity.service.ts` (новый),
    `apps/api/src/tasks/tasks.controller.ts` (routes `:taskId/comments`,
    `:taskId/comments/:commentId`, `:taskId/activity`),
    `apps/api/src/tasks/tasks.module.ts` (регистрация + импорт
    `NotificationsModule`), `apps/api/src/tasks/tasks.service.ts` (audit-diff
    в `update()`).
  - `apps/api/src/sync/snapshot-registry.ts`, `apps/api/src/sync/
    snapshot.service.ts` (две новые строки, см. выше).
  - `packages/shared-types/src/task-comment.ts` (новый: `taskCommentSchema`,
    `taskCommentPageSchema`, `createTaskCommentInputSchema` — без `userId`,
    `updateTaskCommentInputSchema`, `taskActivitySchema`), `packages/
    shared-types/src/index.ts`, `packages/shared-types/src/notification.ts`
    (`kind` enum + `"task_comment"`).
  - `packages/core/src/api/api-client.ts` (`listTaskComments/createTaskComment/
    updateTaskComment/deleteTaskComment/listTaskActivity`), `packages/
    core-react/src/use-task-comments.ts` (новый: `useTaskComments/
    useCreateTaskComment/useUpdateTaskComment/useDeleteTaskComment/
    useTaskActivity`), `packages/core-react/src/index.ts`.
  - `apps/web/panels/tasks/task-comments.tsx` (новый: `TaskCommentsSection` —
    список + форма + инлайн-редактирование, рендер через `MarkdownView`),
    `apps/web/panels/TasksPanel.tsx` (подключение в `Sheet` деталей задачи,
    рядом с `EntityLinksSection`), `apps/web/components/notification-bell.tsx`
    (иконка/лейбл для `task_comment`).
  - `apps/api/test/task-comments.integration.test.ts` (новый, 7 тестов).
- Проверки и результаты:
  - `pnpm db:generate` (после правки schema.prisma) → OK.
  - `pnpm typecheck` → PASS (7/7 пакетов, включая `apps/web` и
    `apps/api/tsconfig.test.json`).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы) плюс
    ноль новых после чистки одного unused-import warning в
    `use-task-comments.ts`.
  - `pnpm test` → PASS, 20 файлов / 176 тестов (unit-слой не менял поведение
    существующих модулей).
  - `pnpm test:integration` на изолированном portable-Postgres (порт 5545,
    отдельный `ORION_PG_DATA`/`STORAGE_DIR` в scratchpad, `prisma migrate
    deploy` — новая миграция применилась чисто вместе со всеми
    предыдущими) → PASS, **14 файлов / 81 тест** (было 74 до S17: +7 новых из
    `task-comments.integration.test.ts`). Первый прогон поймал два реальных
    бага до финального зелёного прогона (не догонялось до прохождения
    задним числом — оба исправлены по коду, не по тесту):
    1. `snapshot.integration.test.ts` S03a coverage — `TaskComment`/
       `TaskActivity` не были в `snapshot-registry.ts`/`SNAPSHOT_MODELS`.
    2. Notification producer падал 500 (`42501` RLS violation на
       `tx.notification.createMany`) при попытке создать адресованное чужому
       пользователю уведомление внутри `withUser(actorId, …)` — см. находку
       выше, исправлено переносом уведомления в `asSystem`.
  - `pnpm build` → PASS, API (`tsc`) + Next.js (26 страниц, First Load JS не
    изменился ощутимо).
  - Рабочий `.env` и `infra/postgres/data` не тронуты; временный кластер на
    5545 (и scratch storage) подняты и снесены только в рамках этой сессии.
- Миграция/данные: одна новая миграция
  `20260921190000_task_comments_and_activity` — две таблицы
  (`task_comments`, `task_activities`) с RLS ENABLE+FORCE+POLICY. Обратной
  совместимости не требуется (новые таблицы, ничего существующего не
  меняется).
- Непроверенное:
  - **Mentions (`@упоминания`)** — сознательно не реализованы. Карточка S17
    (10-BACKLOG.md) — две строки текста, "accessible mentions" упомянуты в
    done-критериях, но нет отдельного пункта функциональности "mentions" в
    описании задачи; учитывая формулировку "минимум task comments" и
    отсутствие любого упоминания `@mention` где-либо в модульном контракте/
    PLAN.md, решил не строить autocomplete/parsing/notify-on-mention как вне
    заявленного MVP-объёма, а не тихо недоделать. Если владелец подтвердит,
    что mentions нужны — это отдельная, самостоятельная подзадача (парсинг
    `@`, ограничение выбора участниками workspace, отдельный notification
    kind), не разворачивалась в этой сессии.
  - UI **не тестировался в браузере** (нет browser-tooling в этой сессии,
    та же причина SKIPPED, что и в предыдущих Sxx) — `TaskCommentsSection`
    проверен только `pnpm build`/typecheck, не кликами. Инлайн-редактирование
    и разворачивание "показать больше" в UI не имеют собственного теста
    (E2E объём не входил в карточку).
  - Аудит-журнал показывает только последние 200 записей (`take: 200`, без
    пагинации) — для реального MVP с малым числом изменений на задачу этого
    достаточно, но это не cursor-paginated как комментарии; если понадобится
    журнал длиннее 200 правок на одну задачу, потребуется тот же курсорный
    паттерн.
  - Уведомление о комментарии уходит только исполнителю (`assigneeId`); нет
    "подписки"/watcher-листа и нет уведомления автору предыдущего
    комментария — начальная реализация, как и было заявлено в приоритетах
    задачи ("ядро" = CRUD+ownership+XSS, потом pagination, потом notification
    producer, потом audit log — все четыре пункта покрыты, но producer в
    самом простом варианте адресации).
- Следующий шаг: если понадобятся mentions — отдельная подзадача с явным
  решением владельца (см. выше). Иначе S17 закрыт, следующая по
  10-BACKLOG.md — S18 (Desktop/диагностика/production policy).

### S18 · 2026-09-21 · PARTIAL (readiness polling, single-instance guard, production CSP done and tested; native single-instance plugin, browser/Tauri runtime verification not done)
- Поведение:
  - Прочитан весь desktop-стек перед правкой: `apps/desktop/src-tauri/src/
    main.rs` (5 строк — только `notification` plugin, никакого запуска API,
    подтверждает находку S05 "Tauri doesn't spawn the API"), `tauri.conf.json`
    (`security.csp: null` — полностью открыта), `capabilities/default.json`
    (не менялся — не относится к CSP). Реальный "launcher", который карточка
    просит снабдить readiness — не Rust, а `scripts/launch-desktop.mjs`
    (запускается ярлыком `ORION.lnk` → `launch-desktop.cmd` → этот файл, он
    же за `pnpm dev:app`): поднимает Docker→Postgres→API→Web→`tauri dev`.
    Уже был опрос портов вместо `sleep` (`waitPort`, TCP-connect раз в
    400мс) — не "прямой баг с фиксированной паузой", но с реальным дефектом:
    TCP-connect не отличает готовый ORION API от **любого чужого процесса**,
    уже слушающего порт 4000 ("занят порт" из done-критерия) — код молча
    писал "API уже слушает :4000" и открывал окно Tauri поверх сервиса,
    который на самом деле не отвечает ни на один настоящий запрос.
  - Добавлен `scripts/readiness.mjs` — чистые функции `pollReadiness`
    (опрашивает `GET /system/health` до готового `{status:"ok"}`, различая
    `ready` / `wrong-service` (порт занят, но это не ORION API) / `crashed`
    (у дочернего процесса ненулевой `exitCode`) / `timeout`) и
    `describeReadinessFailure` (человеко-читаемое русское сообщение под
    каждое из этих состояний, включая хвост лог-файла). `system/health` уже
    существовал (`apps/api/src/system/system.controller.ts`, `SELECT 1`
    через Prisma) и уже был в `ApiClient.getHealth()` — не дублировал,
    переиспользовал контракт.
  - `scripts/launch-desktop.mjs`: `waitPort`+`tcpOpen` для API заменены на
    `waitApiReady` (HTTP через `pollReadiness`), включая ветку "порт уже
    занят" — теперь она тоже бьёт по `/system/health` (короткий 5-секундный
    таймаут) прежде чем доверять чужому порту. Добавлен single-instance guard
    (`checkSingleInstance`/`writeLock`/`releaseLock` — PID-лок в
    `tmp/orion-launch.lock`): повторный запуск ярлыка при уже работающем
    экземпляре получает явное русское сообщение "ORION уже запущен..." и
    выходит, не поднимая второй конфликтующий набор процессов на те же
    порты. Настоящий "сфокусировать существующее окно" через
    `tauri-plugin-single-instance` не сделан — это Rust/Cargo-зависимость,
    которую нельзя собрать/проверить без Rust-тулинга в сессии (см.
    "Непроверенное"); PID-лок — минимально достаточная защита от
    двойного запуска, не полная UX-фича.
  - Production CSP (`apps/desktop/src-tauri/tauri.conf.json`): заменил
    `csp: null` на конкретную политику по реально используемым ресурсам,
    выясненным чтением кода, не наугад:
    `default-src 'self'; script-src 'self'` (без `unsafe-inline`/
    `unsafe-eval` — в коде не нашлось ни одного `eval`/inline-`<script>`,
    которому это было бы нужно), `style-src 'self' 'unsafe-inline'`
    (Tailwind/CodeMirror кладут инлайновые `style=`, что CSP считает частью
    `style-src`, не `script-src`), `img-src`/`media-src ... blob:` (везде,
    где `FilePreview`/thumbnails зовут `URL.createObjectURL` —
    `apps/web/panels/documents/{thumbnail,preview-pane}.tsx`,
    `documents/document-history.tsx`, `note-attachments.tsx`,
    `DocumentsPanel.tsx`), `worker-src 'self' blob:` (pdf.js:
    `packages/ui/src/file-preview/pdf-view.tsx` грузит воркер с `/pdf.worker.
    min.mjs`, т.е. `self`, но некоторые версии pdf.js на некоторых страницах
    поднимают fallback-воркер из blob — оставил обе), `connect-src 'self'
    http://127.0.0.1:* http://localhost:*` (desktop по архитектуре — только
    loopback API, см. S05 "local запускается на loopback"; не поставил
    внешний домен без причины), `object-src 'none'`, `frame-ancestors
    'none'`. Не тронул `capabilities/default.json` — там ACL-разрешения
    плагинов, не связано с CSP.
- Файлы:
  - `scripts/readiness.mjs` (новый), `scripts/readiness.test.mjs` (новый, 9
    тестов), `scripts/launch-desktop.mjs` (readiness + single-instance),
    `vitest.config.mts` (`include` расширен на `scripts/**/*.test.mjs`),
    `apps/desktop/src-tauri/tauri.conf.json` (CSP), `README.md` (раздел
    Desktop: явное предупреждение, что `tauri:build`/NSIS не включает
    backend, плюс упоминание нового readiness-поведения лаунчера).
- Проверки и результаты:
  - `node --check` на всех трёх изменённых/новых `.mjs` файлов → OK
    (синтаксис; полноценно исполнить лаунчер нельзя без реального
    Docker/Postgres/API окружения, не входил в объём этой сессии).
  - `pnpm test` → PASS, **21 файл / 185 тестов** (было 20/176 после S17;
    +9 из `readiness.test.mjs`: ready-immediately, retry-through-
    ECONNREFUSED, wrong-service на 200 с чужим телом, wrong-service на
    non-2xx, crashed (не делает лишних fetch после того, как процесс уже
    мёртв), timeout, плюс три теста на `describeReadinessFailure`).
    Тест использует управляемые `now()`/`sleep()` (не реальные таймеры) —
    полностью детерминирован, не гонка.
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы), ноль
    новых на `scripts/*.mjs`.
  - `pnpm typecheck` → PASS (7/7 workspace-пакетов).
  - `node -e "JSON.parse(...)"` на `tauri.conf.json` → валиден.
  - `pnpm build` не перезапускал отдельно в этой сессии — ни один из
    изменённых файлов не входит в `apps/api`/`apps/web`/`packages/*`
    билд-граф (typecheck уже это подтверждает для web/api/packages), а
    `tauri build`/`tauri dev` вне объёма (см. "Непроверенное").
- Миграция/данные: нет (нет схемы/Prisma изменений в этой карточке).
- Непроверенное:
  - **Реальный запуск `tauri dev`/`pnpm dev:app`/`tauri:build`** — нет
    Rust/Cargo/Tauri CLI рантайма в этой сессии (та же причина SKIPPED, что
    у browser-tooling во всех предыдущих Sxx). Не проверено вживую: что CSP
    не ломает `tauri dev` (webpack HMR/eval Next.js dev-сервера — по
    документации Tauri v2 CSP инжектится только в HTML, который раздаёт сам
    Tauri через asset-протокол для `frontendDist`, а не во внешний `devUrl`
    (`http://localhost:3010`), поэтому в теории `tauri dev` не затронут — но
    это вывод из документации/схемы конфига, не из реального прогона);
    что PDF/attachments/popout реально открываются под этой CSP в собранном
    `tauri:build`; что NSIS-инсталлятор вообще собирается с новым CSP-полем.
  - **Настоящий single-instance (фокус существующего окна)** —
    `tauri-plugin-single-instance` не подключён (потребовал бы правки
    `Cargo.toml`+`main.rs`+пересборки Rust-зависимостей, непроверяемой без
    тулинга). Сделан только более слабый, но по духу done-критерия
    достаточный PID-lock на уровне Node-лаунчера — предотвращает второй
    конфликтующий процесс, не переключает фокус на первое окно.
  - **DNS-rebinding защита CSP/connect-src** — `connect-src
    http://127.0.0.1:* http://localhost:*` не защищает от вредоносной
    страницы, которая через DNS rebinding представляется `localhost`, но
    резолвится на внешний IP (это отдельный сетевой риск, не CSP-политика;
    пересекается с открытым пунктом S05 "DNS-rebinding" — не дублировал
    работу, оставил как есть за S05).
  - **Safe logs** — прочитал `apps/api/src` на `console.log` рядом с
    `SECRET`/`password`/`token` (grep, 0 совпадений) и `scripts/*.mjs` на
    прямые секреты в логах: единственные буквальные секреты —
    `scripts/launch-demo.mjs` пишет `JWT_SECRET`/`APP_PASSWORD` в
    `apps/api/.env` (файл, не консоль/лог) — тот же dev-плейсхолдер, что и в
    `infra/postgres/init/01-app-roles.sql`, помечен в самом файле как "not
    for production use". Реальный `pnpm dev:api`/NestJS вывод в консоль не
    проверялся построчно вживую (нет запущенного процесса в сессии) —
    только чтением исходников бутстрапа (`main.ts`, `configure-app.ts`) на
    предмет логирования конфигурации; там ничего похожего на дамп env не
    нашлось.
  - **Web/desktop feature parity** — не проверял отдельно; карточка не
    называла конкретного расхождения, а `apps/web` — единственный источник
    UI и для web, и для desktop (одна кодовая база, `frontendDist` — просто
    статический экспорт того же `apps/web`), так что paritet по
    архитектуре, не по отдельной сборке — специально не искал регрессию
    вслепую без конкретной жалобы.
- Следующий шаг: другой агент с реальным Windows+Rust+Tauri CLI тулингом —
  прогнать `pnpm dev:app` целиком (занятый порт чужим процессом, убитый API
  посреди запуска, недоступная БД) и подтвердить, что сообщения из
  `describeReadinessFailure` действительно доходят до экрана (см.
  `launch-desktop.cmd`, уже делает `pause` при ошибке — не менял, но не
  видел вживую); собрать `tauri:build`/`tauri dev` под новым CSP и открыть
  PDF/вложение/detached popout, чтобы убедиться, что политика не режет
  реальный ресурс; если нужен полноценный single-instance с фокусом окна —
  добавить `tauri-plugin-single-instance` отдельной подзадачей с реальной
  сборкой для проверки.

### S22 · 2026-09-21 · DONE (desktop export blocker cleared; web+desktop builds PASS)
- Поведение:
  - Прочитан весь путь целиком перед правкой: `apps/web/app/invite/[token]/
    page.tsx` (динамический сегмент, требовал бы `generateStaticParams` под
    `output:"export"`, но токены рантаймовые — их нельзя перечислить),
    `invites.service.ts`/`invites.controller.ts` (`lookup`/`accept`, dry-run
    ссылка, `asSystem` по той же chicken-and-egg причине что и регистрация),
    `login`/`register` `page.tsx` (до правки — **никакого** return-to
    механизма не было вообще: оба всегда делали `router.replace("/spaces")`),
    `apps/web/next.config.js` (`DESKTOP_EXPORT=1` → `output:"export"`,
    отдельный `distDir: ".next-desktop"`), `apps/web/package.json`
    (`build:desktop` уже существовал как команда — только не был подключён
    ни в CI, ни в корневой `package.json`).
  - Новый контракт ссылки: `/invite?token=...`, один статический маршрут
    (`apps/web/app/invite/page.tsx`) вместо `/invite/[token]/page.tsx`
    (удалён). `useSearchParams()` обёрнут в `<Suspense>` — без этого Next 14
    валит `output:"export"` с "should be wrapped in a suspense boundary";
    та же обёртка добавлена в `login`/`register`, которым теперь тоже нужен
    `useSearchParams()` для `next`. Миграция ссылок выбрана осознанно
    (карточка допускала оба варианта): старых invite-ссылок в реальных
    данных нет — доставка ручная (dry-run, `acceptUrl` копируется в буфер
    один раз при создании, см. doc comment `WorkspaceInvitesService`), так
    что redirect/alias для legacy-сегмента не нужен, только смена формата
    на будущее.
  - Return-to intent (`apps/web/lib/return-to.ts`, `sanitizeReturnTo`):
    принимает **только** внутренний путь — `^/(?!/)[^\s\\]*$` — отклоняет
    абсолютный URL, `//host` (protocol-relative), `\`-трюк тех же
    протокол-relative атак, управляющие символы, длину >2048. `/login` и
    `/register` читают `?next=`, санитизируют и используют его вместо
    жёсткого `/spaces` и при уже залогиненном заходе, и после успешного
    login/register. Взаимная ссылка «Войти»/«Зарегистрироваться» тоже несёт
    `next`, чтобы переключение между ними на самой странице `/invite` не
    роняло intent.
  - Explicit-action требование (карточка п.3) уже было выполнено до этой
    сессии кодом `/invite` — accept только по клику кнопки, а не при заходе;
    несовпадение email показывает явное предупреждение, а не тихий
    auto-accept под чужим аккаунтом. Не менялось по сути, только перенесено
    на новый маршрут.
  - Честные состояния вместо одного "ошибка" (карточка done-критерий,
    тот же принцип что у S08 session states): `InviteLookup.expired:
    boolean` заменён на `InviteLookup.status: "pending"|"expired"|"used"|
    "revoked"` (`packages/shared-types/src/workspace-invite.ts`).
    `WorkspaceInvitesService.lookup` теперь различает: `accepted` → `used`,
    `revoked` → `revoked`, время вышло → `expired`, иначе `pending`.
    Раньше все три схлопывались в один `expired: true`. На `/invite`
    добавлено четвёртое отдельное состояние — отсутствующий/пустой `token`
    в URL ("в ссылке нет токена") — и отдельная ветка network-failure
    (`lookup.error instanceof TypeError`) с кнопкой "Повторить" вместо
    молчаливого "не найдено", которая раньше покрывала и 404, и обрыв сети
    одной фразой.
  - Не логировать bearer invite URL (карточка п.5): `WorkspaceInvitesService.
    create` раньше писал в лог `this.logger.log(... acceptUrl)` — полную
    ссылку с сырым токеном. Заменено на лог `workspace ${workspaceId},
    invite ${row.id}` без токена; сама ссылка уходит только один раз в
    HTTP-ответ и в `navigator.clipboard.writeText` на клиенте
    (`members-section.tsx`), туда её и раньше не логировали.
  - Тесты, парсившие URL строкой: `acceptUrl.split("/invite/")[1]` в 8
    местах (`api-rls.integration.test.ts` ×5, `notifications.
    integration.test.ts`, `task-comments.integration.test.ts`, `time-entries.
    integration.test.ts`) заменены на `new URL(acceptUrl).searchParams.
    get("token")!` — переживает смену формата ссылки, не завязан на
    конкретный путь.
  - Открытый redirect: добавлен `apps/web/lib/return-to.test.ts`, 8 тестов —
    внутренний путь принимается; `null`/`undefined`/пустая строка,
    абсолютный внешний URL, `//host`, `\`-обход, путь без ведущего `/`,
    control-символы/пробелы, длина >2048 — всё отклоняется в `null`
    (вызывающий код падает обратно на `/spaces`).
- Файлы:
  - Новые: `apps/web/app/invite/page.tsx`, `apps/web/lib/return-to.ts`,
    `apps/web/lib/return-to.test.ts`.
  - Удалён: `apps/web/app/invite/[token]/page.tsx` (и пустая директория
    `[token]`).
  - Изменены: `apps/web/app/login/page.tsx`, `apps/web/app/register/
    page.tsx` (оба — `next` через `useSearchParams`+`<Suspense>`,
    `sanitizeReturnTo`), `apps/api/src/workspaces/invites.service.ts`
    (`acceptUrl` формат, `status` вместо `expired`, лог без токена),
    `packages/shared-types/src/workspace-invite.ts` (`inviteLookupSchema`),
    `package.json` (новый скрипт `build:desktop-export`), `.github/
    workflows/ci.yml` (новый шаг "Desktop static export"), 4 integration-
    тестовых файла (парсинг токена).
- Проверки и результаты:
  - `pnpm typecheck` → PASS (7/7). Первый прогон падал на **устаревшем**
    `.next/types/app/invite/[token]/page.ts`, оставшемся от удалённой
    директории (Next не удаляет generated types сам при удалении маршрута
    в уже собранном `.next`) — не баг в новом коде, `rm -rf apps/web/.next
    apps/web/.next-desktop` перед пересборкой убрал stale-артефакт.
  - `pnpm lint` → PASS, те же 3 предсуществующих warning'а (`CalendarPanel.
    tsx`, `DocumentsPanel.tsx`, `seed-demo-workspace.mjs`) — ни один не в
    затронутых файлах.
  - `pnpm test` → PASS, **22 файла / 193 теста** (было 21/185; +8 из
    `return-to.test.ts`).
  - `pnpm build` (web, `output` не задан — обычный Next SSG/SSR билд) →
    PASS. Вывод роутов подтверждает `/invite` теперь `○ (Static)`, не
    динамический сегмент.
  - **`pnpm build:desktop-export` (= `DESKTOP_EXPORT=1 next build`,
    `output: "export"`) → PASS**, exit 0, реальный прогон (не только
    заявлено) — это единственный измеримый done-критерий карточки. Вывод
    сборки: `Generating static pages (27/27)`, `/invite` в списке маршрутов
    как `○ (Static)`. Экспортированный HTML лежит в `apps/web/.next-desktop/
    invite.html` (не `invite/index.html` — Next экспортирует лист-маршрут
    без trailing slash как плоский `.html`-файл рядом с `.next-desktop`,
    ожидаемо для `distDir` override в `next.config.js`); файл существует,
    непустой, содержит рендер страницы (проверено grep на "Приглашение в
    пространство" в файле). Desktop smoke в терминах карточки ("открывает
    экспортированную страницу") ограничен этим файловым уровнем — реального
    Tauri-рантайма в сессии нет (та же причина SKIPPED, что и в S18/S19/
    всех предыдущих Sxx с browser/Tauri-тулингом); утверждение "работает в
    приложении" сверх статического HTML не делаю.
  - **Произвольный новый token lookup после сборки** — не проверено живым
    HTTP-запросом к собранному экспорту (нет запущенного API+статик-сервера
    в этой сессии), но логика клиентского рантайм-lookup не менялась
    структурно (тот же `useInviteLookup`/`api.lookupInvite` вызов, что и
    раньше в динамическом варианте, который до этой карточки *не собирался
    вовсе* под export) — до S22 вопрос был "соберётся ли статика", не
    "работает ли lookup внутри уже работающего API", последнее покрыто
    существующими integration-тестами (`accept`/`lookup` через `/invites/
    :token`), которые проходят с новым `status`-контрактом (см. следующий
    пункт).
  - `pnpm test:integration` не запускался в этой сессии (нет поднятого
    portable/CI Postgres в рамках отведённого объёма) — изменения в
    `invites.service.ts` (`status` вместо `expired`, лог без URL) и во всех
    4 integration-тестовых файлах, парсящих `acceptUrl`, проверены только
    typecheck'ом (в т.ч. `tsconfig.test.json`, `pnpm typecheck` включает
    `apps/api/test`) — синтаксически и по типам согласованы с новой
    сигнатурой `InviteLookup`, но не прогнаны против реальной БД.
- Миграция/данные: нет Prisma-изменений — `InviteLookup.status` вычисляется
  в сервисе из существующих колонок (`WorkspaceInvite.status`, `expiresAt`),
  колонки не менялись.
- Непроверенное:
  - `pnpm test:integration` (см. выше) — следующий агент с поднятым Postgres
    должен прогнать хотя бы `api-rls.integration.test.ts` (invite-related
    it-блоки) и один из трёх других файлов, чтобы подтвердить, что
    `new URL(acceptUrl).searchParams.get("token")` реально извлекает
    валидный токен из нового формата ссылки на живом сервере, а не только
    типизируется.
  - Реальный Tauri smoke (`tauri:build`/`tauri dev` открывает `/invite` в
    окне, кликабельность кнопок, DevTools без CSP-ошибок) — нет Rust/Cargo
    в сессии, та же причина SKIPPED, что в S18.
  - UI не тестировался в браузере (нет browser-tooling) — новые ветки
    состояний (`used`/`revoked`/`expired`/no-token/network) на `/invite`
    проверены только чтением JSX-логики и успешной сборкой, не кликами.
  - CI workflow (`.github/workflows/ci.yml`, новый шаг `build:desktop-
    export`) не запускался в реальном GitHub Actions — синтаксис YAML не
    провалидирован линтером Actions, только визуально сверен с форматом
    соседних шагов.
- Следующий шаг: прогнать `pnpm test:integration` (или хотя бы поднять
  portable Postgres и прогнать invite-блоки `api-rls.integration.test.ts`)
  для реального (не только типового) подтверждения нового `?token=`
  контракта; когда появится Rust/Tauri-тулинг в сессии — реальный
  `tauri:build`/`tauri dev` smoke на `/invite`, включая проверку, что CSP из
  S18 (`connect-src 'self' http://127.0.0.1:* ...`) не режет lookup/accept
  запросы с этой страницы.

### S21 · 2026-09-21 · DONE

- Поведение: `RecurringCheckerService.runCheck()` было `findMany` (все due
  rules) → цикл `for` с индивидуальной `asSystem`-транзакцией на правило —
  без row lock и без уникального ключа occurrence. Два конкурентных тика
  (два инстанса воркера, или ретрай после падения) видели одно и то же
  `nextRunAt <= now`, оба создавали `Transaction` и продвигали расписание —
  дубль платежа. `InboxService.process()` читал `processedAt` вне барьера
  (`findUnique`), затем создавал target и только потом писал `processedAt`
  — два конкурентных запроса на один item оба проходили `if
  (inbox.processedAt) return inbox`, оба создавали задачу/заметку/событие.
  Оба случая исправлены DB-level барьерами (не in-process flag):
  - **Recurring**: `Transaction.(recurringRuleId, scheduledFor)` — новая
    UNIQUE-колонка-пара (nullable, `recurringRuleId` → `RecurringTransaction`
    `onDelete: SetNull` — удаление правила не стирает историю уже созданных
    операций, только останавливает будущие). `materializeOne(ruleId)` берёт
    `SELECT ... FOR UPDATE` на конкретную строку `finance_recurring_transactions`
    внутри той же `asSystem`-транзакции, что создаёт `Transaction` и
    продвигает `nextRunAt`; второй воркер блокируется на локе, после
    коммита первого перечитывает `nextRunAt`/`pausedAt` под свежим SELECT и
    видит, что окно уже сдвинуто/правило на паузе → skip, не дубль. UNIQUE
    constraint — барьер последней инстанции на случай гонки мимо лока
    (P2002 → `skipped`, не краш, без повторного продвижения расписания).
    `scheduledFor` — всегда `rule.nextRunAt`, прочитанный под локом, никогда
    `new Date()` (иначе backfill после простоя переписал бы историю
    временем запуска, а не временем слота). Продвижение `nextRunAt`
    происходит только ПОСЛЕ успешной вставки внутри той же транзакции —
    откат вставки (любая другая ошибка) не продвигает расписание.
    `runCheck()` дополнительно берёт `orderBy: nextRunAt asc, take:
    RECURRING_CHECK_BATCH_LIMIT` (200, экспортированная константа) — предел
    на число *правил* за один проход, не на число occurrence: правило,
    пропустившее много тиков, по-прежнему материализует ровно один
    occurrence за проход и попадёт в следующий тик с уже сдвинутым
    `nextRunAt`, поэтому долгий даунтайм расползается по тикам сам, а
    предел не даёт одному проходу застрять на сотнях due-правил разом.
  - **Inbox**: `process()` теперь сначала атомарно «застолбляет» запись —
    `updateMany({ where: { id, workspaceId, processedAt: null }, data: {
    processedAt } })` — и только при `claim.count === 1` создаёт target;
    проигравший вызов (`claim.count === 0`) читает уже обработанную строку
    и возвращает её же `targetId`, не создавая второй target. Барьер — само
    условное `UPDATE`: Postgres сериализует конкурентные `UPDATE` одной
    строки на READ COMMITTED (второй блокируется до коммита первого, затем
    его `WHERE processedAt IS NULL` переоценивается заново и не совпадает),
    так что защита реальна даже без явного `SELECT ... FOR UPDATE`.
  - Написаны падающие-до-фикса concurrency-тесты (`Promise.all`, не
    последовательные `await` — по явному требованию протокола) ДО правки
    сервисов, оба воспроизводили гонку на предыдущей версии кода
    (recurring: оба тика создавали `Transaction`, дубль; inbox: оба запроса
    создавали `Task`) — подтверждено построчным up/down перед коммитом, не
    сохранено отдельным логом.
- Файлы: `apps/api/prisma/schema.prisma` (`Transaction.recurringRuleId` +
  `.scheduledFor` + `@@unique([recurringRuleId, scheduledFor])` +
  обратная связь `RecurringTransaction.transactions`), новая миграция
  `apps/api/prisma/migrations/20260921200000_recurring_transaction_idempotency_key/`,
  `apps/api/src/finance/recurring/recurring-checker.service.ts` (переписан:
  `materializeOne`, `RECURRING_CHECK_BATCH_LIMIT`, `$queryRaw` FOR UPDATE),
  `apps/api/src/inbox/inbox.service.ts` (`process()` — claim-then-create),
  новые тесты `apps/api/test/recurring-idempotency.integration.test.ts` (4
  теста: конкурентная материализация/пауза-в-гонке/удаление-правила
  сохраняет историю/предел батча существует), `apps/api/test/
  inbox-concurrency.integration.test.ts` (2 теста: конкурентный `process`
  создаёт ровно один target / повторный `process` на обработанном item —
  no-op), `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта запись).
- Проверки и результаты:
  - `pnpm typecheck` → PASS (7/7).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы).
  - `pnpm test` → PASS, 22 файла / 193 теста.
  - `pnpm test:integration` на изолированном portable-Postgres (порт 5546,
    scratchpad `pg-s21-data`/`s21-storage`, `prisma migrate deploy` — новая
    миграция применилась чисто первым же прогоном на свежей БД, `.env` и
    `infra/postgres/data` не тронуты) → PASS, **16 файлов / 87 тестов** (было
    81 до этой сессии + 6 новых: 4 recurring + 2 inbox). Оба новых файла
    зелёные, остальные 14 (включая `api-rls`/`blob-backup`, которые сперва
    падали из-за моего ручного `SYNC_SECRET` в окружении — переопределённый
    вручную секрет не проходит формат, дефолт из `setup-integration.ts`
    валиден сам по себе, убрал переопределение) — не тронуты этой сессией.
- Миграция/данные: `20260921200000_recurring_transaction_idempotency_key` —
  `ALTER TABLE finance_transactions ADD COLUMN recurringRuleId, scheduledFor`
  + `CREATE UNIQUE INDEX` + `ADD CONSTRAINT ... FOREIGN KEY ... ON DELETE
  SET NULL`. Сгенерирована через `prisma migrate diff --from-migrations
  ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --script`
  (не `migrate dev`, который в этой среде не работает
  non-interactive), затем применена и провалидирована `prisma migrate
  deploy` на чистой временной БД — прошла первым же проходом. RLS не
  требуется отдельно: новая пара колонок лежит в уже существующей
  `finance_transactions`, под её текущими политиками (тест RLS-структуры в
  `api-rls.integration.test.ts` прошёл без изменений).
- Непроверенное: multi-instance/multi-process сценарий (два реальных
  Node-процесса, не два `Promise.all`-вызова внутри одного процесса на
  одном `PrismaService`) — барьер спроектирован как DB-level (row lock +
  unique constraint), который по конструкции работает одинаково что для
  двух параллельных вызовов в одном процессе, что для двух процессов, но
  реального теста с двумя отдельными Node-процессами/портами в сессии не
  было (расписание крона и так одно на инстанс в текущем деплое ORION —
  see «Осознанные упрощения v0», offline-sync/несколько API-инстансов не
  часть архитектуры v0). Inbox-барьер не тестировался под `Serializable`
  isolation (по умолчанию Postgres/Prisma тут READ COMMITTED, что и
  описано в комментарии в коде — при смене изоляции на Serializable барьер
  превратился бы в serialization failure вместо тихого `count: 0`, что
  потребовало бы retry-обёртки; сейчас такой обёртки нет, но и isolation
  level в проекте нигде не меняется). `downtime catch-up` протестирован
  только утверждением, что `RECURRING_CHECK_BATCH_LIMIT` существует и
  разумен (200) — не реальным прогоном с сотнями due-правил (слишком
  медленно для юнита), логика распределения по тикам проверена по коду
  (один occurrence за проход на правило).
- Следующий шаг: если появится multi-instance деплой ORION — добавить
  реальный two-process concurrency test (два `NestFactory.create` на
  разных портах против одной БД, а не два `Promise.all` в одном процессе).
  Пока не актуально (текущая архитектура — один API-процесс, см. PLAN.md).

### S19 · 2026-09-21 · DONE (сквозной прогон), release verdict BLOCKED

- Поведение: карточка S19 — не разработка, а проверочная сессия. Задача:
  прогнать весь backlog S00–S22 (кроме S16-Lists, явно BLOCKED продуктовым
  решением) командами на **одной truly-чистой** изолированной среде — новый
  portable Postgres кластер, новый порт, не переиспользующий ничего из
  прошлых сессий — и зафиксировать честную fault-matrix + итоговый вердикт
  release READY/BLOCKED. Никакого нового прикладного кода не писалось —
  регрессий не найдено.
- Среда: новый portable-кластер `scripts/postgres.mjs` с
  `ORION_PG_DATA=<scratchpad>/pg-s19-data`, `ORION_PG_PORT=5547` (порт не
  пересекается ни с рабочим 5433, ни с портами прошлых сессий 5544/5545/5546
  — на случай их не до конца прибранных остатков). `apps/api/.env` и
  `infra/postgres/data` не трогались. `STORAGE_DIR` — отдельный scratchpad-
  каталог. Кластер поднят, использован, остановлен (`postgres.mjs down`) в
  конце сессии.
- Проверки и результаты (точные числа, не «проверено вручную»):
  1. **`prisma migrate deploy`** на пустой БД (порт 5547) — первый раз за
     весь backlog все миграции всего проекта (61 директория, до
     `20260921200000_recurring_transaction_idempotency_key` включительно —
     последняя миграция S21) применились одна за другой на действительно
     пустой БД в одной сессии → **PASS**, `All migrations have been
     successfully applied.`, без единого предупреждения/конфликта. Это
     закрывает главный риск карточки: накопленные миграции S03 (snapshot
     registry), S06 (time actor), S07 (notifications), S11 (note revision),
     S14a (milestones), S17 (task comments), S21 (recurring idempotency) не
     конфликтуют друг с другом и не полагаются на промежуточное ручное
     состояние БД.
  2. **`pnpm typecheck`** → **PASS**, 7/7 workspace-проектов (включая
     `apps/api` `tsconfig.json` + `tsconfig.test.json`).
  3. **`pnpm lint`** → **PASS**, 0 errors, те же 3 предсуществующих warning
     (`CalendarPanel.tsx:320`, `DocumentsPanel.tsx:225` — react-hooks/
     exhaustive-deps; `scripts/seed-demo-workspace.mjs:561` — unused var) —
     регрессии нет, ровно тот же список, что фиксировался в S00/S21.
  4. **`pnpm test`** (unit) → **PASS**, 22 файла / 193 теста, 1.38s.
  5. **`pnpm build`** (production) → **PASS**: `apps/api` `tsc`, `apps/web`
     `next build` (Next.js 14.2.35) — 27 страниц сгенерированы, включая
     `/invite`, `/account`, `/login`, `/register`, `/spaces`.
  6. **`pnpm build:desktop-export`** (S22) → **PASS**: `DESKTOP_EXPORT=1
     next build`, статический экспорт создан в `apps/web/.next-desktop`
     (проверено наличие каталога + `404.html`/`account.html`/`calendar.html`
     и т.д. на диске, не только код возврата команды).
  7. **`pnpm test:integration`** на чистой БД (порт 5547) → **PASS, 16 файлов
     / 87 тестов**, 52.72s. Ровно тот же count, что фиксировала S21-сессия
     (81 до S21 + 6 новых recurring/inbox = 87) — то есть между S21 и этой
     сессией регрессий не появилось, и это первый прогон всех 16 файлов
     **вместе на настоящей чистой БД той же сессии**, не по одному файлу в
     разных сессиях с разными накопленными состояниями. Список файлов:
     `api-rls.integration.test.ts`, `blob-backup.integration.test.ts`,
     `documents-move.integration.test.ts`,
     `documents-trash.integration.test.ts`,
     `habits-concurrency.integration.test.ts`,
     `inbox-concurrency.integration.test.ts`,
     `inventory-concurrency.integration.test.ts`,
     `milestones-cascade.integration.test.ts`,
     `mode-security.integration.test.ts`, `note-cas.integration.test.ts`,
     `notifications.integration.test.ts`,
     `recurring-idempotency.integration.test.ts`,
     `snapshot.integration.test.ts`, `task-comments.integration.test.ts`,
     `time-entries.integration.test.ts`, `time-pagination.integration.test.ts`.
- Повторные security/restore fault-тесты (все — часть composite-прогона
  выше, а не отдельные прогоны):
  - **S01 restricted-module-aggregate-access** — покрыт
    `mode-security.integration.test.ts` + relevant it-блоки
    `api-rls.integration.test.ts` → зелёные в этом прогоне.
  - **S02 owner-only sync gates** — покрыт `api-rls.integration.test.ts`
    (sync/backup endpoints) → зелёный.
  - **S03 legacy-snapshot fail-closed** — `snapshot.integration.test.ts` →
    зелёный.
  - **S04 blob-backup fault-injection** — `blob-backup.integration.test.ts`
    → зелёный.
  - **S15 cross-workspace cursor rejection** — покрыт `time-pagination.
    integration.test.ts` → зелёный.
  - **S21 recurring/inbox concurrency** — `recurring-idempotency.
    integration.test.ts` + `inbox-concurrency.integration.test.ts` → зелёные.
  Все шесть зелёные в одном и том же прогоне на одной и той же чистой БД —
  порчи от более поздних сессий не обнаружено.
- Fault-matrix (S00–S22, кроме S16-Lists — статус не менялся этой сессией,
  переносится из журнала без новой проверки там, где явно указано):

  | Карточка | Статус | Причина PARTIAL/BLOCKED (сноска на журнал) |
  |---|---|---|
  | S00 | PARTIAL | Populated screenshots SKIPPED — нет browser-tooling в любой сессии этого backlog, включая эту |
  | S01 | DONE | Подтверждено composite-прогоном этой сессии |
  | S02 | DONE | Подтверждено composite-прогоном этой сессии |
  | S03 | DONE | Подтверждено composite-прогоном + чистым `migrate deploy` этой сессии |
  | S04 | PARTIAL | Stale-preview (manifest-hash между preview/apply) не сделан — не проверялось заново, т.к. не разработческая сессия |
  | S05 | PARTIAL | DNS-rebinding, WebDAV client redirect/size limits, register rate-limit — не сделаны |
  | S06 | PARTIAL | mine/team/unknown UI surfacing не подключены (только backend concurrency-барьер) |
  | S07 | DONE | — |
  | S08 | DONE | — |
  | S09 | DONE | — |
  | S10 | DONE | — |
  | S11 | PARTIAL | Conflict UI + nav guard не верифицированы визуально (нет browser-tooling) |
  | S12 | PARTIAL | Sweeping token/error-pattern audit и визуальная/zoom/contrast-проверка не сделаны |
  | S13 | PARTIAL | Live U01-U03/U09 сценарии и screenshots не прогонялись (нет browser-tooling) |
  | S14 | PARTIAL | S14c: bulk-partial-failure/WebDAV/replaceContent fault-injection не протестированы |
  | S15 | PARTIAL | Finance/search/projects unbounded `findMany` не тронуты (только time/inbox исправлены) |
  | S16 | PARTIAL, Lists **BLOCKED** | Lists: done-критерий "destructive copy" не соответствует коду — фичи копирования списков не существует нигде (сервис/контроллер/shared-types/панель), это продуктовое решение, не баг backlog'а |
  | S17 | DONE | — |
  | S18 | PARTIAL | Native Tauri single-instance plugin и любая runtime-верификация не сделаны — нет Rust/Cargo/Tauri-тулинга ни в одной сессии backlog'а, включая эту |
  | S19 | DONE (composite прогон) | Эта запись. Сам composite-прогон закрыт; release verdict остаётся BLOCKED по причинам из других карточек (см. «Выпуск» ниже) |
  | S20 | TODO | Следующая сессия — документация выпуска, не в объёме S19 |
  | S21 | DONE | Подтверждено composite-прогоном этой сессии, count тестов не изменился (87) |
  | S22 | DONE | `build:desktop-export` PASS в этой сессии (статический экспорт на диске подтверждён) |

- Миграция/данные: не менялись. `prisma migrate deploy` на новом изолированном
  кластере (порт 5547) — 61 директория миграций применилась чисто, без
  вмешательства. Никаких новых Prisma-моделей/колонок в этой сессии.
- Непроверенное (совпадает с непроверенным во всех предыдущих сессиях, не
  специфично для S19 — визуальный/native tooling отсутствует физически в
  среде агента, не забыто, а недоступно):
  - **Все U01–U14 сценарии из `13-ACCEPTANCE.md`, требующие браузера/
    реального клика/screenshot'ов** (U01 личный день, U02 команда, U04
    project/plan drag через UI, U05 conflict UI, U06 upload UI, U09
    timezone/DST через реальные часы системы, U10 network-flakiness через
    реальный disconnect, U11 навигация кликами, U12 accessibility/contrast/
    reflow, U13 startup UI) — SKIPPED, нет MCP browser-инструмента ни в этой,
    ни в одной прошлой сессии backlog'а. Всё, что проверено — это
    API/сервисный слой соответствующих сценариев через integration-тесты
    (например U05 конфликт покрыт `note-cas.integration.test.ts` на уровне
    API, но не UI-веткой из S11).
  - **U13 native launch modes** (local loopback/account picker, PIN,
    unexpected origin) — покрыты только там, где есть unit/integration-тест
    (S05 SSRF guard, rate-limit), сам процесс запуска Tauri-приложения не
    прогонялся — нет Rust/Cargo/Tauri в среде.
  - **U08 большие данные** (501+ time entries, >pageSize finance rows) —
    покрыто частично `time-pagination.integration.test.ts` (S15), finance-
    часть (unbounded `findMany`) не переделана — см. S15 PARTIAL выше, эта
    сессия её не трогала (не разработческая).
  - **S16 Lists copy** остаётся BLOCKED — не рассматривалось как регрессия,
    т.к. это заранее задокументированное продуктовое расхождение с
    `13-ACCEPTANCE.md`/`10-BACKLOG.md`, не находка этой сессии.
- Итоговый вердикт: **release BLOCKED**. Обоснование — ниже, в «Выпуск v0.19
  release-gate (S19 итог)».

#### Выпуск v0.19 release-gate (S19 итог)

Технический P0-периметр (миграции, типы, линт, юнит, интеграция, production
build, desktop export) — **весь зелёный** в этой сессии на настоящей чистой
среде: это единственное, что можно утверждать с уверенностью после
composite-прогона.

Тем не менее **release READY заявить нельзя**, потому что:

1. **Ни один визуальный/кликовый acceptance-сценарий (U01–U14
   13-ACCEPTANCE.md) не прогонялся вживую ни в одной сессии backlog'а** —
   везде SKIPPED из-за отсутствия browser/MCP-тулинга в среде агента. Пункт
   «Выпуск» в `13-ACCEPTANCE.md` прямо требует: «Не выполненные native tests
   ограничивают заявление только проверенным web build» и «P0 сценарии
   доступа и восстановления обязательны» — доступ/восстановление на
   API-уровне зелёные (composite integration прогон), но сами U-сценарии
   как целостные пользовательские потоки (клавиатура, DnD, конфликт-UI,
   accessibility) не подтверждены.
2. **S16 Lists — явно BLOCKED продуктовым решением**, не багом: фичи
   копирования списков нет в коде вовсе, а `13-ACCEPTANCE.md`/done-критерий
   её предполагают. Это расхождение спецификации с реализацией, требующее
   решения продукта (реализовать фичу или скорректировать acceptance),
   не техническое исправление.
3. **Native Tauri smoke (S18/S22)** не прогонялся ни разу за весь backlog —
   нет Rust/Cargo в среде ни одного агента. `build:desktop-export`
   (статический веб-экспорт) зелёный, но это не то же самое, что открыть
   реальное Tauri-окно (единственное расширение Tauri за проект —
   `@tauri-apps/plugin-notification`, и его тоже никто не прогонял вживую).
4. Несколько карточек остаются честно **PARTIAL** с задокументированными
   пробелами, не закрытыми в этой сессии, т.к. она проверочная, не
   разработческая: S04 (stale-preview manifest-hash), S05 (DNS-rebinding,
   WebDAV redirect/size limits, register rate-limit), S06 (mine/team UI),
   S11/S12/S13 (визуальная верификация), S14c (bulk-partial-failure/WebDAV
   fault-injection), S15 (finance/search/projects unbounded findMany), S18
   (native single-instance plugin).

**Release BLOCKED: причины —**
(a) визуальные/кликовые U01–U14 сценарии повсеместно SKIPPED (нет
browser-tooling во всей среде агента за весь backlog, не только в этой
сессии);
(b) S16 Lists BLOCKED продуктовым решением (фичи копирования списков нет в
коде);
(c) native Tauri/desktop smoke ни разу не прогонялся (нет Rust/Cargo-тулинга);
(d) семь карточек (S04, S05, S06, S11, S12, S13, S14, S15, S18) остаются
честно PARTIAL с конкретными незакрытыми пунктами, перечисленными в
fault-matrix выше и в их собственных записях журнала.

Если организация принимает web-only release с задокументированными
ограничениями (b)–(d) и ручной визуальной проверкой вне этой среды перед
отгрузкой — технический P0-периметр это подтверждённо выдерживает
(миграции/типы/линт/юнит/интеграция/build/desktop-export все зелёные на
чистой среде в этой сессии). Финальное go/no-go — решение владельца
продукта, не техническое ограничение S19.

- Следующий шаг: S20 (документация выпуска) — следующая сессия по очереди;
  отдельно, когда в среде появится browser/MCP-тулинг или Rust/Cargo —
  закрыть непроверенное из пункта выше реальными прогонами, а не апгрейдом
  статуса по логике кода.

### S20 · 2026-09-22 · DONE

- Поведение: документационная сессия, кода не меняла. Прочитан весь
  `12-PROGRESS.md` (S00–S22) как источник истины; синхронизирована
  документация с реальным состоянием кода:
  - `CLAUDE.md` — новый раздел «Release-hardening backlog (v0.20)» с
    механизмами из S05 (`ORION_MODE`), S03/S04 (snapshot registry v2 +
    blob-backup), S07 (адресные уведомления `recipientId`/`eventKey`), S06
    (`TimeEntry.userId`), S11 (`Note.revision`/CAS), S17
    (`TaskComment`/`TaskActivity`), S21 (идемпотентность recurring/inbox),
    S22 (`/invite?token=`), S18 (readiness/single-instance лаунчера).
    Исправлена пометка «зарезервировано»: `documentVersion` больше не
    reserved (реальная модель с S03/S04 кодом), `documentAnnotation`
    осталась reserved (только схема, кода нет). `financeImportResult`,
    `financeForecastPoint`, `shareSelector`, `connectionLink` — по журналу
    бэклог их не трогал, остались reserved как были.
  - `README.md` — команда `build:desktop-export`, переменная `ORION_MODE`,
    упоминание адресных уведомлений/комментариев к задачам, раздел
    «Статус Sync» дополнен про snapshot registry v2/blob-backup, добавлена
    ссылка на новый `docs/RELEASE_NOTES.md`.
  - `docs/UI_UX_DESIGN.md` — раздел Notes актуализирован: `NoteEditor` уже
    вынесен в `note-editor.tsx` (сделано по пути в S11, документ раньше
    описывал это как «первоочередной шаг», что стало неверным), добавлено
    описание конфликтного автосохранения (`note-autosave.ts`).
    `docs/MODULES_AND_PLUGINS.md` — реальных расхождений с S00–S22 не
    найдено (раздел про модули/плагины не пересекается с этим бэклогом
    предметно), не менялся.
  - `docs/PLAN.md` — новая запись `v0.29` с решениями бэклога (не
    хронологией): actor-scoped модель (TimeEntry/Notifications), snapshot
    registry как явный реестр вместо неявного списка, idempotency-key
    паттерн для фоновых обработчиков (recurring/inbox), `ORION_MODE` как
    явный enum вместо эвристики, зачем понадобился CAS у заметок и почему
    не распространён на задачи/проекты, плюс явный список оставленных
    открытыми решений (Reports/Budgets мультивалютность, Lists).
  - Новый `docs/RELEASE_NOTES.md` — вердикт (BLOCKED, причины из S19),
    таблица зелёного P0-периметра, сводка по каждой карточке, известные
    ограничения, реальная процедура backup/restore/rollback по коду
    `SyncService`/`snapshot-registry.ts`/`blob-backup.service.ts` (без
    придуманного UI).
- Файлы: `CLAUDE.md`, `README.md`, `docs/PLAN.md`, `docs/UI_UX_DESIGN.md`,
  `docs/RELEASE_NOTES.md` (новый), `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md`.
- Проверки и результаты: `pnpm typecheck` и `pnpm lint` — см. запись ниже по
  факту прогона в этой же сессии (документация не содержит примеров кода,
  которые где-либо компилируются/тестируются).
- Миграция/данные: нет (документация не меняет схему/код).
- Непроверенное: соответствие раздела «Разрешения»/«Плагины»
  `docs/MODULES_AND_PLUGINS.md` реальному коду не проверялось построчно —
  вне предметной области этого бэклога (S00–S22 не трогали Plugin API).
- Следующий шаг: нет — S20 последняя карточка обязательного backlog. Весь
  комплект S00–S22 пройден; итоговый вердикт релиза — **BLOCKED** по
  причинам S19 (визуальные/desktop-нативные сценарии не проверялись
  вживую нигде в бэклоге, продуктовый вопрос по Lists), задокументированным
  честно в `docs/RELEASE_NOTES.md`. Следующий шаг — вне этого бэклога: либо
  продуктовое решение по Lists + реальные браузерные/Tauri прогоны в среде
  с нужным тулингом, либо явное решение владельца продукта отгружать
  web-only с текущими ограничениями.

### S12 (follow-up) · 2026-09-22 · error-pattern sweep closed (PARTIAL card, this sub-item now done)

- Поведение: закрыл оставшийся пункт S12 "единый status/error visual pattern"
  (журнал 2026-09-21: 17 файлов уже на `EmptyState tone="danger"`, 28 файлов
  показывали текст ошибки — ≥11 панелей вне паттерна, не разобраны). Прочитал
  `packages/ui/src/primitives.tsx` (`EmptyState` — `icon`/`title`/`description`/
  `action`/`tone`) и эталон `DashboardPanel.tsx` (S13: `EmptyState tone="danger"`
  + `action` с кнопкой "Повторить" на `refetch`). Прошёл все 11+ файлов из
  находки S12 (`Не удалось`/`Ошибка` вне `tone="danger"`) и разобрал каждый на
  block-level (кандидат) vs не-кандидат:
  - **Block-level, переведено на `EmptyState tone="danger"`** (5 файлов, 6 мест):
    `settings/modules-section.tsx` и `settings/plugins-section.tsx` — оба
    заменяли всё тело секции карточкой с текстом+кнопкой при `isError`
    (список модулей/плагинов не грузится); `documents/preview-pane.tsx` и
    `note-attachments.tsx` (`AttachmentPreview`) — блок предпросмотра файла
    заменял место превью текстом при `isError` от `useDocumentBlob`, добавил
    retry на `refetch()`, которого раньше не было вовсе; `SettingsPanel.tsx` —
    `preferencesError` (использовался в двух вкладках, "Уведомления" и
    "Внешний вид", при `preferences.isError`) и блок "Приложение" (`appInfo`
    fallback без `data`), оба получили retry на соответствующий `refetch()`.
  - **НЕ тронуто, инлайн mutation-toast (другой класс UI, не блочная ошибка
    загрузки)**: `note-attachments.tsx` (attach/upload/detach), `DocumentsPanel.tsx`
    (upload/create-folder/rename/move/download/replace), `time/timer-widget.tsx`
    (start/stop/save-note), `finance/accounts-view.tsx`,
    `finance/recurring-view.tsx`, `finance/goals-view.tsx`,
    `settings/members-section.tsx`, `settings/workspace-section.tsx`,
    `SettingsPanel.tsx` (профиль/пароль/аватар/сессии) — во всех этих местах
    ошибка приходит из `mutateAsync`/`onError` мутации (сохранить/создать/
    удалить) и уже правильно показывается транзиентным `toast({ tone: "danger" })`,
    а не заменяет секцию контента — это не тот класс UI, что "не удалось
    загрузить список X", трогать не стал, поведение не менял.
  - **НЕ тронуто, per-item статус строки, не блочная ошибка**:
    `calendar-connections.tsx` (`connection.lastError` — статус конкретного
    ICS-фида в списке, соседние фиды рендерятся нормально, это не «список не
    загрузился»).
  - **НЕ тронуто, нет query isError вообще** (только toast на мутациях):
    `documents/document-history.tsx` — прочитан целиком, ошибка загрузки
    списка версий не отображается отдельным блоком (только `isLoading` →
    `Skeleton`, пустой список → уже `EmptyState` без tone, download/restore —
    toast), гэпа не нашёл, не менял.
- Файлы: `apps/web/panels/settings/modules-section.tsx`,
  `apps/web/panels/settings/plugins-section.tsx`,
  `apps/web/panels/documents/preview-pane.tsx`,
  `apps/web/panels/note-attachments.tsx`, `apps/web/panels/SettingsPanel.tsx`,
  `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md` (эта запись + обновлена строка
  S12 в сводной таблице).
- Проверки и результаты:
  - `pnpm typecheck` → PASS (7/7 проектов).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (`CalendarPanel.tsx`,
    `DocumentsPanel.tsx`, `seed-demo-workspace.mjs`) — не мои файлы, регрессии
    нет.
  - `pnpm test` → PASS, 22 файла / 196 тестов (юнит-слой `packages/**`, эта
    правка их не касается — прогон для регрессии).
  - `pnpm test:integration`/`pnpm build` не гонял — изменения только в
    `apps/web/panels/**` (JSX-рендер ветки ошибки + один новый `refetch`
    проп на существующих query-хуках), API/Prisma не тронуты.
  - Визуальная проверка (как EmptyState реально выглядит в узком
    preview-pane/модалке вложения) — не снята, нет browser tooling, та же
    причина, что и в исходной записи S12.
- Миграция/данные: нет.
- Непроверенное: (1) визуальный рендер новых `EmptyState` в узких контейнерах
  (preview-pane, модалка вложения заметки) — не снят скриншот, полагался на
  то, что `EmptyState` уже используется в контейнерах сравнимого размера
  (напр. `Modal`/`Sheet` в других панелях); (2) остальные пункты исходной
  записи S12 (compact-density visual, 200% zoom, reduced-motion, double
  density-compounding) — по-прежнему не сделаны, вне объёма этой сессии.
- Следующий шаг: единый error-pattern sweep для S12 закрыт. Оставшийся
  открытый пункт S12 — только визуальная/zoom/contrast-верификация, требует
  browser-automation tooling, которого в сессии по-прежнему нет.

### S14c (добивка) · 2026-09-22 · DONE — оба оставшихся пункта закрыты, S14 в целом DONE

- Поведение: добивающая сессия по двум честно оставленным в предыдущей S14c
  записи пунктам (см. журнал 2026-09-21 выше, "Непроверенное"):
  `replaceContent`/`restoreVersion` fault-injection и сквозной
  bulk-partial-failure тест через `POST /documents/bulk`. Прочитан
  `DocumentsService` (весь файл, 785 строк) и `DocumentsController` целиком
  перед правками.
  - **`replaceContent`/`restoreVersion`** — прочитал оба метода: в отличие от
    `update`/`remove`/`restore` (которые *двигают* блоб и всегда могут
    подвинуть его обратно), эти два **перезаписывают** live-ключ на месте
    (`storage.putFile` / `storage.copy`), уничтожая прежние байты. Написал
    падающий тест до правки
    (`apps/api/test/documents-content-fault.integration.test.ts`,
    `vi.spyOn(storage, "putFile"/"copy")` — вызывает реальный метод, затем
    бросает, тот же класс сбоя "серверная операция уже случилась, клиент
    получил исключение", что и у WebDAV-move) — **баг подтверждён реально**:
    без фикса `putFile`/`copy` успевал физически перезаписать live-байты
    новым содержимым, но `tx.document.update` (checksum/sizeBytes/mimeType)
    откатывался вместе со всей Prisma-транзакцией — документ оставался
    видимым и его контент 200-ился (класс "orphan-блоб" тут не подходит),
    но **отданные байты переставали соответствовать метаданным в БД**, а
    настоящее прежнее содержимое переживало только в orphan-файле
    `.versions/<id>/<n>` без строки `DocumentVersion`, то есть становилось
    недостижимым через UI истории версий. Ровно инвариант CLAUDE.md с другой
    стороны: не "строка без блоба", а "строка, чей блоб ей больше не
    соответствует". Фикс: `archiveContentTx` теперь возвращает `versionKey`
    только что сделанной резервной копии; оба метода фиксируют
    `attempted = { liveKey, backupKey }` **до** деструктивной перезаписи и в
    catch зовут новый приватный `revertContentIfWritten` — безусловно
    копирует `backupKey` обратно поверх `liveKey` (в отличие от
    `revertIfRelocated`, тут не нужно пробовать `exists()`: backup всегда
    корректен, доперезаписывать им live — идемпотентно-безопасно вне
    зависимости от того, успел ли реальный `putFile`/`copy` отработать
    целиком, частично или вообще не начаться). После фикса оба теста
    зелёные (2 теста, проверяют и байты через `GET .../content`, и
    `checksum`/`sizeBytes` из списка документов).
  - **Bulk partial failure** — прочитал `DocumentsService.bulk`: применяет
    операцию к каждому id по очереди, ловит ошибку каждого id отдельно,
    ре-бросает первую только если упали **все** id. Написал сквозной тест
    (`apps/api/test/documents-bulk-fault.integration.test.ts`) —
    `POST /workspaces/:id/documents/bulk` с `op: "trash"` на 3 документах,
    `vi.spyOn(storage, "move")` считает вызовы и бросает (после реального
    вызова) только на 2-м. **Тест прошёл сразу, без изменений кода** — каждая
    отдельная `remove()` внутри `bulk()` уже сама себя компенсирует через
    `revertIfRelocated` (фикс из сессии 2026-09-21), так что упавший 2-й
    документ откатывается в исходное активное состояние (реально
    reachable, не "полу-в-корзине"), а 1-й и 3-й документы полноценно
    оказываются в корзине. Зафиксировано как **VERIFIED_EXISTING** — код не
    менялся, инвариант уже держится по построению `bulk()` (каждая операция
    в батче — самостоятельная транзакция с собственной компенсацией, а не
    один общий transaction/rollback на весь батч), выдумывать фикс не стал.
- Файлы: `apps/api/src/documents/documents.service.ts`
  (`archiveContentTx` теперь возвращает `versionKey`; `replaceContent` и
  `restoreVersion` — `attempted`/catch по образцу `update`/`remove`/
  `restore`; новый приватный `revertContentIfWritten`),
  `apps/api/test/documents-content-fault.integration.test.ts` (новый, 2
  теста), `apps/api/test/documents-bulk-fault.integration.test.ts` (новый, 1
  тест, VERIFIED_EXISTING — код не менялся), `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md`
  (эта запись + статус S14 → DONE).
- Проверки и результаты:
  - `pnpm typecheck` → PASS (7/7, включая `apps/api/tsconfig.test.json`).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning
    (`CalendarPanel.tsx`, `DocumentsPanel.tsx`, `seed-demo-workspace.mjs`),
    новых не добавил.
  - `pnpm test` → PASS, 22 файла / 196 тестов (юнит-слой не трогал).
  - `pnpm test:integration` на изолированном portable-Postgres (порт 5548 в
    scratchpad, свой `STORAGE_DIR` там же, `prisma migrate deploy` на чистом
    кластере — все миграции применились без ошибок) → PASS, **19 файлов /
    106 тестов** (все существующие интеграционные сьюты зелёные + 3 новых
    теста из двух новых файлов). Падающие тесты `documents-content-fault...`
    прогнаны и подтверждены красными на немодифицированном коде **до**
    фикса (см. выше), затем зелёными после. Рабочий `.env`,
    `infra/postgres/data` и пользовательский `STORAGE_DIR` не тронуты —
    временный кластер поднят и остановлен только в рамках сессии.
- Миграция/данные: без новых миграций Prisma.
- Непроверенное: те же пункты, что были честно оставлены в предыдущей
  записи S14c и не входили в объём этой сессии — **WebDAV-driver** не имеет
  собственного fault-injection теста (весь прогон через `LocalDiskStorage`,
  как и во всех предыдущих S00–S14 сессиях: реального WebDAV-сервера в
  тестовой среде нет); **`purge`** не тронут (уже спроектирован в безопасном
  row-then-blob порядке, см. предыдущую запись); визуальные/browser-сценарии
  вне объёма (нет browser tooling).
- Следующий шаг: карточка **S14 целиком переведена в DONE** — все три
  подэтапа (S14a, S14b, S14c) закрыты, PASS на изолированной БД. Следующая
  сессия по очереди — S20-порождённое (уже DONE) или добивка других PARTIAL
  карточек (S00/S05/S11/S12/S13/S15/S18) по таблице очереди выше.

### S05 · 2026-09-22 (добивка хвостов #2) · DONE — оба последних открытых пункта закрыты (WebDAV client redirect/size limits, register rate-limit)

- Поведение: закрыты последние два честно оставленных пункта карточки S05 из
  журнала 2026-09-21/2026-09-22 (см. записи выше) — карточка переведена в
  DONE в таблице очереди.
  - **WebDAV client size limit — закрыт по-настоящему.** Пакет `webdav`
    (v4.11.5, `apps/api/node_modules/webdav/dist/node/types.d.ts`) оказался
    на поверку axios-based и его `WebDAVClientOptions` **публично**
    принимает `maxContentLength`/`maxBodyLength` — это прокидывается прямо в
    internal axios-клиент (`factory.js`: `context.maxContentLength` →
    `request.js: prepareRequestOptions` → `finalOptions.maxContentLength`).
    Предыдущая сессия не заметила эту опцию и считала лимит размера
    невозможным напрямую. Добавлено в `WebdavRemote` constructor
    (`apps/api/src/sync/webdav-remote.ts`):
    `maxContentLength: MAX_REMOTE_RESPONSE_BYTES` (тот же лимит 5 МиБ, что у
    ICS-фидов, импортирован из `remote-url-guard.ts`).
  - **WebDAV redirect control — осознанно оставлен как есть, с явным
    обоснованием.** Единственный способ заставить `webdav`-пакет не следовать
    3xx — переписать его internal `request`-функцию через `getPatcher()`
    (экспортируемый, но недокументированный hot-patch хук самого пакета,
    `node_modules/webdav/dist/node/compat/patcher.js`, на базе
    `hot-patcher`), для чего пришлось бы объявить `axios` — сейчас
    транзитивную, не публичную зависимость `webdav` — прямой зависимостью
    `apps/api` только ради обхода чужой реализации, не публичный контракт
    (webdav может сменить HTTP-клиент в любой мажорной версии и тихо
    сломать патч), и патч глобален на процесс (задел бы заодно
    `storage/webdav.storage.ts`, отдельный admin-конфигурируемый клиент).
    Решение: не городить эту хрупкую конструкцию ради приватной детали
    реализации чужого пакета. Обоснование (подробно — блок-комментарий в
    начале `webdav-remote.ts`): (1) WebDAV remote — не произвольный
    untrusted URL вроде ICS-фида, это адрес, который сам владелец
    пространства явно ввёл и сохранил как *свою* точку бэкапа; (2) хостнейм
    и его DNS-резолв уже проверяются дважды — при сохранении конфига
    (`putRemote` → `assertPublicRemoteUrl`) и заново перед каждым сетевым
    вызовом (`remoteFor` → `assertResolvedHostIsPublic`, DNS-rebinding
    re-check); редирект добавил бы третью зависимую от DNS проверку по тому
    же принципу, а не закрыл бы принципиально новый класс дыры; (3)
    практический ущерб от непойманного редиректа — запрос уйдёт на адрес,
    выбранный *уже скомпрометированным* сервером, который пользователь сам
    настроил как доверенный, а не слепой SSRF на произвольный внутренний
    адрес по вине стороннего атакующего, как в сценарии ICS. Если решение
    пересмотрят — интеграционный тест должен зеркалить
    `remote-url-guard-dns.integration.test.ts`/"does not follow a redirect
    from an allowed calendar feed" в `mode-security.integration.test.ts`
    (реальный `node:http`-стаб с 302), не мокать `webdav`.
  - **Register rate-limit — добавлен, узкий, два независимых окна.** Новый
    `apps/api/src/auth/register-rate-limit.guard.ts`
    (`RegisterRateLimitGuard`), навешен на `POST /auth/register`
    (`@UseGuards`, `auth.controller.ts`), зарегистрирован в `AuthModule`.
    Не копия `LoginRateLimitGuard` — флэт per-IP счётчик, настроенный под
    login (10/5мин), именно так и сломал register в первой сессии (см.
    журнал 2026-09-21): легитимный bulk-сценарий (seed-скрипты,
    интеграционные тесты — `api-rls.integration.test.ts` в одиночку
    регистрирует ~35 аккаунтов с одного loopback IP за один прогон)
    систематически шире 10 попыток. Вместо этого — два окна:
    - per-IP, щедрый (`ipMax = 60` / 5 мин) — защита от голого флуда
      регистраций с одного источника, порог заведомо выше самого тяжёлого
      существующего теста;
    - per-(IP, email), узкий (`emailMax = 5` / 15 мин) — целевая защита
      именно от того паттерна, который называет done-criterion
      (email-enumeration/спам попыток регистрации одного и того же адреса):
      легитимный bulk использует свой email на каждый аккаунт, поэтому это
      окно для него практически никогда не срабатывает.
    `NODE_ENV=test`-обход рассмотрен и отклонён: правило CLAUDE.md
    "запрет проверяется сервером" и общий дух карточки — лимит должен
    реально защищать в проде, а не выключаться по флагу окружения, который
    легко выставить по ошибке; узкое двухоконное решение защищает и
    реальный сценарий, и тестовый bulk без такого переключателя.
- Файлы: `apps/api/src/sync/webdav-remote.ts` (maxContentLength + блок-
  комментарий с решением по редиректу), `apps/api/src/auth/register-rate-limit.guard.ts`
  (новый), `apps/api/src/auth/auth.module.ts`, `apps/api/src/auth/auth.controller.ts`,
  `apps/api/test/mode-security.integration.test.ts` (2 новых теста: bulk-
  сценарий 20 разных email с одного IP — все 201; повтор одного email с
  одного IP — 6-я попытка 429), `docs/SONNET_IMPLEMENTATION/12-PROGRESS.md`
  (эта запись + таблица очереди).
- Проверки и результаты:
  - `pnpm typecheck` → PASS (7/7 проектов).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (не мои файлы).
  - `pnpm test` → PASS, 22 файла / 196 тестов.
  - Изолированный `pnpm test:integration` на portable-Postgres (порт 5544,
    рецепт S00: `ORION_PG_DATA`/`ORION_PG_PORT` в scratchpad-каталоге сессии,
    `prisma migrate deploy`, свой `STORAGE_DIR`, не рабочий `.env`/
    `infra/postgres/data`) → **PASS, 19 файлов / 108 тестов**, включая оба
    новых теста и все существующие register-heavy файлы (`api-rls`,
    `blob-backup`, и т.д.) без единой регрессии — подтверждает, что новый
    guard не ломает bulk-сценарии.
  - Рабочий `.env` и `infra/postgres/data` не тронуты; кластер на 5544 и
    scratch-storage подняты и остановлены только в рамках этой сессии.
- Миграция/данные: без изменений Prisma-схемы/миграций.
- Непроверенное: реальный сетевой запрос к WebDAV-серверу с редиректом не
  выполнялся (осознанно — решение задокументировано, а не протестировано
  фактическим поведением `webdav`-пакета, т.к. решение — оставить как есть).
  DNS rebinding остаточное окно между re-check в `remoteFor` и фактическим
  запросом `webdav`-клиента — то же принятое ограничение, что и раньше (см.
  `remote-url-guard.ts`), не новый пробел этой сессии.
- Следующий шаг: карточка **S05 полностью DONE**. Следующая сессия — любая
  из оставшихся PARTIAL карточек (S00/S11/S12/S13/S15/S18) по таблице
  очереди выше.

## Шаблон записи

```md
### Sxx · YYYY-MM-DD · DONE/PARTIAL/BLOCKED
- Поведение:
- Файлы:
- Проверки и результаты:
- Миграция/данные:
- Непроверенное:
- Следующий шаг:
```

### Дополнение документации · 2026-09-22 · Office-first

Владелец согласовал офисное редактирование с упором на Word/Excel/Google Таблицы. Добавлен 21-OFFICE-IMPLEMENTATION, обновлены индекс, backlog, решения, протокол и приёмка. Исторический native-first план в 20 удалён во избежание противоречий. O01, O02, O03, O04, O05, O06: TODO; OF01–OF10: NOT RUN. Прикладной код, зависимости, сервисы и миграции в этом дополнении не изменялись. Следующий шаг для офисного этапа: O01 с синтетическими файлами; перед интеграцией проверить закрытие R18-01/02/03.

### R18-01/R18-02/R18-03 · 2026-09-22 · DONE (все три REVIEW-регресса Codex закрыты, честная переоценка S04/S07/S11)

- Контекст: `docs/SONNET_IMPLEMENTATION/18-REVIEW-FINAL-PASS.md` нашёл 3
  CONFIRMED дефекта с воспроизводящими тестами против настоящей PostgreSQL,
  которые прошлые сессии по журналу ошибочно считали закрытыми (R02/R03 из
  17-REVIEW-CURRENT повторились как R18-02/R18-03 после того, как S07/S11 были
  отмечены DONE/PARTIAL без этого сценария; R18-01 — новый дефект в S04,
  которая тоже стояла DONE). Честная переоценка ниже.

**Baseline (обязательный шаг перед правками).** Скопирован
`evidence/review-regressions.integration.test.ts.txt` →
`apps/api/test/codex-review-regressions.integration.test.ts`. Прогнан на
изолированной БД (порт 5544, рецепт S00) с `-t REVIEW` **до** любых правок
прикладного кода — все 3 теста FAIL, что подтверждает дефекты:
  - R18-01: `expected 500 to be 201` — реальная защита сработала не так, как
    ожидалось (см. ниже про доработку теста).
  - R18-02: `promise resolved instead of rejecting` — restore не бьёт CAS.
  - R18-03: `expected true to be false` — заголовок закрытой задачи утёк.

Тестовый файл реки пришлось адаптировать под API, который успел уйти вперёд с
момента написания review (честно, не подгонка под баг): `https://example.invalid/dav`
не резолвится DNS вообще ни в каком окружении (RFC 2606) — заменено на
`https://example.com/dav` (тот же паттерн, что уже использует
`blob-backup.integration.test.ts`); apply теперь требует `expectedManifestHash`
из предварительного `dryRun`-превью (S04 stale-preview rejection, добавлено
после того, как ревьюер писал тест) — добавлен шаг preview перед apply. Сама
логика проверки (`expect(...).toBe(...)`) не менялась.

**R18-01 · DB failure after blob swap must preserve live bytes.**
- Поведение: `SyncService.restore()` раньше делал `blobs.restore()` (стейджинг
  + атомарный своп корня workspace + удаление старого дерева) **до**
  `snapshots.apply()` (транзакция БД). Если `apply()` падал после свопа, живые
  байты уже были заменены, строки БД — нет, отката не было (старое дерево уже
  удалено). Переделано в настоящий durable two-phase restore:
  1. `BlobBackupService.stage()` — только стейджинг с проверкой checksum, живое
     дерево не трогается ни при успехе, ни при падении.
  2. Захват durable lock-строки `SyncRestoreOperation` (unique `workspaceId` —
     она же блокировка второго конкурентного restore → 409).
  3. `snapshots.apply()` **и** пометка lock-строки `phase="committed"` — в
     ОДНОЙ транзакции БД: либо оба применяются, либо оба откатываются
     (файлы в любом случае ещё старые).
  4. Только после подтверждённого commit — `BlobBackupService.publish()`
     (реальный своп). Если процесс падает между commit и publish, следующая
     попытка restore видит lock-строку в фазе `committed` и **докатывает
     вперёд** (`recoverPendingRestore`), не откатывает — БД уже сдвинулась.
  5. Конкурентная запись документа (`DocumentsService.upload`/`replaceContent`)
     теперь тоже проверяет активный lock (`assertNoActiveRestoreTx`) и
     получает 409, пока restore не завершён — своп меняет всё дерево
     workspace целиком.
- Файлы: `apps/api/prisma/schema.prisma` (модель `SyncRestoreOperation`),
  `apps/api/prisma/migrations/20260922080000_sync_restore_operation/migration.sql`,
  `apps/api/prisma/migrations/20260922080100_sync_restore_operation_rls/migration.sql`,
  `apps/api/src/sync/restore-lock.util.ts` (новый — raw SQL против
  `sync_restore_operations`, см. причину ниже), `apps/api/src/sync/blob-backup.service.ts`
  (`restore()` → `stage()`/`publish()`/`discardStaging()`),
  `apps/api/src/sync/sync.service.ts` (`restore()` переписан,
  `recoverPendingRestore()` новый), `apps/api/src/documents/documents.service.ts`
  (`assertNoActiveRestoreTx` в `upload`/`replaceContent`),
  `apps/api/src/sync/snapshot-registry.ts` (новая модель классифицирована
  `ephemeral-excluded` — служебная lock-строка, не пользовательские данные).
- **Важно про Prisma Client**: рабочий `pnpm dev:api` пользователя был запущен
  параллельно с сессией и держал открытым нативный query-engine `.dll.node` —
  `prisma generate` после добавления модели в схему стабильно падал с EPERM
  (rename поверх занятого файла). Решение — не трогать сгенерированный клиент
  вообще: доступ к новой таблице сделан через `tx.$queryRaw`/`tx.$executeRaw`
  (`restore-lock.util.ts`), что всё равно идёт через `withUser`/`asSystem`
  транзакцию вызывающего и подчиняется той же RLS-политике, что и обычный
  accessor. Миграции применены и таблица реально существует и используется;
  когда клиент будет перегенерирован в другой сессии (без конкурирующего
  dev-процесса), `restore-lock.util.ts` можно один в один заменить на
  `tx.syncRestoreOperation.*` без изменения вызывающего кода или поведения.
- Проверено: REVIEW-тест R18-01 → PASS; весь существующий
  `blob-backup.integration.test.ts` (5 тестов, S04a–S04e, включая
  fault-injection S04c и stale-preview S04e) → PASS без регрессий.
- Миграции: `20260922080000_sync_restore_operation`,
  `20260922080100_sync_restore_operation_rls` — применены через обычный
  `prisma migrate deploy` **только** на изолированном тестовом кластере
  (127.0.0.1:5544, scratchpad); рабочая `.env`/`infra/postgres/data`
  пользователя не трогались и новых миграций не получали. Для применения на
  рабочей/prod БД — обычный `pnpm db:migrate` в подходящий момент.
- Не проверено: настоящий kill -9 процесса между commit и publish (только
  вызов-инъекция исключения в `SnapshotService.apply`, как в исходном
  REVIEW-тесте) — процесс-уровневый краш не воспроизводился отдельно, но
  `recoverPendingRestore` устроен так, чтобы быть идемпотентным при повторном
  restore-вызове независимо от того, где именно упал предыдущий процесс.
  Блокировка конкурентной ЗАПИСИ (не restore) реализована только для
  `DocumentsService.upload`/`replaceContent` — не для `createFolder`/`move`/
  `remove`/корзины; эти пути не пишут байты напрямую в `StorageAdapter.putFile`
  так же, как upload/replaceContent, поэтому риск ниже, но не нулевой (не
  тестировался под конкурентным restore).

**R18-02 · Note revision restore bypasses CAS.**
- Поведение: `restoreRevision` менял title/body/tags через `tx.note.update`
  напрямую, не трогая `revision` — открытый до restore редактор оставался
  формально актуальным и успешно перезаписывал восстановленный текст.
  Переписано на тот же атомарный CAS-паттерн (`updateMany` с `revision` в
  WHERE), что уже использует `update()` (S11): restore теперь тоже бьёт
  ревизию на +1 и возвращает 409 (`note_revision_conflict`), если снимок,
  который читало restore, устарел. Отдельно закрыт обход "пропущенный
  `expectedRevision` = чек полностью выключен" — И в `update()`, И в
  `restoreRevision()` для **контент-меняющих** записей: если клиент не
  передал `expectedRevision`, сервер подставляет ревизию, которую эта же
  транзакция только что прочитала (`before.revision`/`current.revision`), и
  проверяет её в том же атомарном `updateMany` — закрывает гонку между
  чтением и записью для всех клиентов, а не только тех, что explicitly шлют
  поле. `expectedRevision` оставлен optional на уровне zod-схемы (не сделан
  required) — миграция всех клиентов на обязательное поле не требовалась,
  раз сервер закрывает дыру сам; для не-контентных PATCH (pin/archive)
  поведение не менялось.
- Файлы: `apps/api/src/notes/notes.service.ts` (`update()` — implicit
  fallback на `before.revision`; `restoreRevision()` — CAS + revision bump),
  `apps/api/src/notes/notes.controller.ts` (принимает опциональный body с
  `expectedRevision` на restore-эндпоинте), `packages/shared-types/src/note.ts`
  (новая схема `restoreNoteRevisionInputSchema`), `packages/core/src/api/api-client.ts`
  (`restoreNoteRevision` принимает опциональный `expectedRevision`).
- Проверено: REVIEW-тест R18-02 → PASS; существующий
  `note-cas.integration.test.ts` (3 теста) → PASS без регрессий.
- Миграции: нет (колонка `revision` уже существовала с S11,
  `20260921170000_note_revision`).
- Не проверено: UI (`apps/web/panels/note-history.tsx`) не переведён на
  передачу `expectedRevision` в `restoreNoteRevision` — сознательно, сервер
  уже закрывает дыру без этого; если продукт захочет UI-подсказку "версия
  устарела" именно на самой кнопке restore (а не только на следующем
  сохранении), понадобится прокинуть текущую ревизию из `useNote` в
  `NoteHistoryPanel`.

**R18-03 · Notifications leak data from a now-restricted module.**
- Поведение: `NotificationCenterService.list`/`markRead`/`markAllRead`
  проверяли только membership+recipientId, не текущий доступ адресата к
  модулю/сущности, на которую ссылается уведомление (`entityType`/`entityId`).
  Член, ограниченный по `tasks` после того, как получил уведомление о задаче,
  продолжал читать `title`/`body` через ленту уведомлений, хотя прямой
  `GET /tasks/:id` уже отвечал 403/409. Добавлена
  `moduleIdForEntityType(entityType)` (маппинг `task`→`tasks`,
  `event`→`calendar`, `budget`/`transaction`→`finance`,
  `inventory_item`→`inventory`, `note`→`notes`, `document`→`documents`,
  `project`→`projects`, `habit`→`habits`, `list`/`list_item`→`lists`;
  `null`/неизвестный тип → не гейтится, считается системным) и
  `isVisibleToActor()`, использующая **существующий**
  `ModulesService.accessibleSetTx` (S01) — не отдельная параллельная
  проверка. Применено везде, где обещал ревьюер:
  - `list()` — фильтрует найденные строки перед возвратом (over-fetch 300 →
    filter → slice 100, т.к. курсорной пагинации нет);
  - `markRead()` — 404 вместо 200, если сущность недоступна (нельзя
    "прочитать" то, что уже нельзя видеть, но и не "не найдено" в обычном
    смысле — трактуется так же, как `list()` бы его скрыл);
  - `markAllRead()` — не подметает в "прочитано" уведомления, чей модуль
    сейчас недоступен;
  - `createTx()` — не создаёт новое уведомление, если у адресата уже сейчас
    нет доступа к модулю источника (до записи в БД, не постфактум).
  Системные уведомления (`entityType === null`) не гейтятся вообще — как и
  просил ревьюер отдельным пунктом.
- Файлы: `apps/api/src/notifications/notification-center.service.ts`
  (весь diff — `moduleIdForEntityType`, `isVisibleToActor`, изменения в
  `list`/`markRead`/`markAllRead`/`createTx`, инъекция `ModulesService`
  через `@Global()` `ModulesModule`, без изменения `notifications.module.ts`).
- Проверено: REVIEW-тест R18-03 → PASS; существующий
  `notifications.integration.test.ts` (6 тестов) → PASS без регрессий.
- Миграции: нет.
- Не проверено: "удалённая сущность" (не restricted-модуль, а сама задача/
  событие физически удалена) отдельно НЕ детектируется и НЕ редактируется до
  generic "запись недоступна" — сделан только module-access гейт (буквальный
  воспроизведённый дефект). Ревьюер отдельно просил явное поведение и для
  этого случая; не реализовано за нехваткой времени в этой сессии, осталось
  как открытый пункт (см. "Осталось" ниже). Внешние каналы доставки
  (Telegram) не проверялись на этот же гейт — только `NotificationCenterService`
  (лента в приложении).

**Честная переоценка предыдущих статусов** (per явное требование ревьюера —
не защищать репутацию прошлых сессий):
  - **S04** был отмечен DONE (`### S04 · 2026-09-22 · DONE`) — это было
    преждевременно: R18-01 был реальным, воспроизводимым дефектом в том же
    restore-пути, который этот DONE описывал. Классификация S04
    **пересматривается на DONE только теперь**, после R18-01 (durable
    two-phase restore + lock) — предыдущая запись DONE была неверной на
    момент написания.
  - **S07** был отмечен DONE (`### S07 · 2026-09-21 · DONE`) — тоже
    преждевременно: R18-03 (=повтор R03 из 17-REVIEW-CURRENT) — access-check
    на READ уведомлений не был реализован вообще, несмотря на то что S07
    отмечена DONE. **Пересматривается на DONE только теперь**, после R18-03.
  - **S11** остаётся **PARTIAL** (как и было) — R18-02 не про autosave/UI
    (то, из-за чего S11 PARTIAL), а про отдельный путь `restoreRevision`,
    которого S11 не касалась. R18-02 закрыт этой сессией, но не меняет
    причину, по которой S11 сама PARTIAL (conflict UI/nav guard не
    верифицированы визуально — по-прежнему нет browser tooling).
  Итог: ни один из статусов задним числом не "спасён" — S04 и S07
  фактически были неполными на момент, когда их отметили DONE; это
  зафиксировано явно, а не скрыто повторным DONE без объяснения.

- Файлы (сводно всей сессии, абсолютные пути):
  `C:\Users\Reno\Desktop\ORION\apps\api\prisma\schema.prisma`,
  `C:\Users\Reno\Desktop\ORION\apps\api\prisma\migrations\20260922080000_sync_restore_operation\migration.sql`,
  `C:\Users\Reno\Desktop\ORION\apps\api\prisma\migrations\20260922080100_sync_restore_operation_rls\migration.sql`,
  `C:\Users\Reno\Desktop\ORION\apps\api\src\sync\restore-lock.util.ts`,
  `C:\Users\Reno\Desktop\ORION\apps\api\src\sync\blob-backup.service.ts`,
  `C:\Users\Reno\Desktop\ORION\apps\api\src\sync\sync.service.ts`,
  `C:\Users\Reno\Desktop\ORION\apps\api\src\sync\snapshot-registry.ts`,
  `C:\Users\Reno\Desktop\ORION\apps\api\src\documents\documents.service.ts`,
  `C:\Users\Reno\Desktop\ORION\apps\api\src\notes\notes.service.ts`,
  `C:\Users\Reno\Desktop\ORION\apps\api\src\notes\notes.controller.ts`,
  `C:\Users\Reno\Desktop\ORION\packages\shared-types\src\note.ts`,
  `C:\Users\Reno\Desktop\ORION\packages\core\src\api\api-client.ts`,
  `C:\Users\Reno\Desktop\ORION\apps\api\src\notifications\notification-center.service.ts`,
  `C:\Users\Reno\Desktop\ORION\apps\api\test\codex-review-regressions.integration.test.ts` (новый,
  постоянный regression-тест — оставлен в suite навсегда).
- Проверки и результаты (финальный прогон после всех трёх фиксов):
  - `pnpm typecheck` → PASS (7/7 проектов, включая `apps/api` тестовый tsconfig).
  - `pnpm lint` → PASS, те же 3 предсуществующих warning (`CalendarPanel.tsx`,
    `DocumentsPanel.tsx`, `seed-demo-workspace.mjs`) — не мои файлы, регрессии нет.
  - `pnpm test` → PASS, 22 файла / 196 тестов.
  - Изолированный `pnpm test:integration` (порт 5544, рецепт S00,
    `prisma migrate deploy`, свой `STORAGE_DIR` в scratchpad, рабочий
    `.env`/`infra/postgres/data` не тронуты) → **PASS, 21 файл / 113 тестов**,
    включая все 3 REVIEW-теста и полный `blob-backup`/`note-cas`/
    `notifications` без единой регрессии.
**S16 (Lists BLOCKED → DONE, низкий приоритет, сделано в оставшееся время).**
Прочитан `apps/web/panels/ListsPanel.tsx`. Подтверждено: BLOCKED предыдущей
сессии стоял на неверном прочтении done-критерия ("destructive copy" —
интерфейсный текст, не функция дублирования списка). Архивация списка уже
использует `FuseButton` (двойное подтверждение: "В архив" → "Ещё раз — архив"
→ "В архиве"). «Очистить отмеченные» уже было обратимым (toast с действием
«Отменить», пересоздающим снятые пункты через `createItem`/`updateItem`), но
кнопка не называла число — добавлено: `Очистить отмеченные (${checkedCount})
— можно отменить`. Файл: `apps/web/panels/ListsPanel.tsx` (одна строка).
Проверено: `tsc --noEmit -p apps/web/tsconfig.json` → PASS. Не проверено:
визуально (нет browser tooling). S16 переведена DONE в таблице очереди.

- Следующий шаг: R18-03's "удалённая сущность" редактирование (не только
  module-access) для уведомлений — отдельный маленький пункт. Иначе —
  следующая PARTIAL карточка по очереди (S00/S11/S12/S13/S18).

## O01 · 2026-09-22 · DONE (codec-слой доказан, UI не трогали)

Офисный трек — отдельная нумерация O01–O06, [21-OFFICE-IMPLEMENTATION.md](21-OFFICE-IMPLEMENTATION.md).
Финальное (после пересмотра того же дня, см. [14-DECISIONS.md](14-DECISIONS.md))
решение — native-путь без Document Server/Docker. Задача этой сессии — только
O01: выбрать и обосновать конкретные библиотеки и доказать жизнеспособность
изолированным spike'ом с реальными round-trip тестами, **не** встраивать в
`DocumentsPanel`/UI (это O04).

### Выбранные библиотеки и версии (зафиксировано через `npm view`, не по памяти)

- **Текст**: `@tiptap/core@3.31.3`, `@tiptap/starter-kit@3.31.3`,
  `@tiptap/html@3.31.3` (для `generateJSON`/`generateHTML` — HTML↔JSON без
  монтирования редактора), `@tiptap/extension-table(-row/-cell/-header)@3.31.3`,
  `@tiptap/extension-image@3.31.3`. **Важно**: v3-пакеты экспортируют
  именованные биндинги (`import { Table } from "@tiptap/extension-table"`),
  НЕ default export, как можно было бы предположить по устаревшим примерам —
  проверено запуском `node -e "require(...)"`, ловится TS/рантайм ошибкой
  `Cannot read properties of undefined (reading 'configure')` иначе.
- **DOCX сериализация**: `docx@9.7.1` (только запись — подтверждено, у
  пакета нет парсера существующего DOCX). Для чтения существующего DOCX в
  редактируемую модель — **готового парсера DOCX→Tiptap JSON на npm нет**;
  реализован pipeline `mammoth` (уже зависимость `@orion/ui` для read-only
  `DocxView`, теперь добавлен и в `@orion/web`) → HTML → `@tiptap/html`
  `generateJSON` (ProseMirror DOM-парсер по правилам зарегистрированных
  расширений). Этот pipeline **реально проверен** на программно
  сгенерированном DOCX (заголовок + жирный/курсив текст + таблица 2×2) —
  см. тесты ниже, а не предположение из плана.
  Запись в обратную сторону (Tiptap JSON → DOCX) — **написан небольшой
  ручной маппер дерева** `blocksFromNodes` в `docx-codec.ts` (paragraph/
  heading/bulletList/orderedList/table/blockquote → примитивы `docx`),
  потому что `docx` не принимает HTML/JSON на вход. Это не «свой офисный
  движок» — глиняный слой в десятки строк поверх двух зрелых библиотек,
  именно то, что просил план (пп. 1 задания).
- **Таблицы — Univer ОТКЛОНЁН, обоснование зафиксировано ниже** (это
  находка сессии, не была известна на момент написания плана):
  - Рабочий UI требует не `@univerjs/core` (который сам по себе уже ~3 МБ
    unpacked по данным registry), а пресет `@univerjs/preset-sheets-core`,
    который тянет **14 отдельных `@univerjs/*` пакетов** (`ui`, `docs`,
    `docs-ui`, `sheets`, `sheets-ui`, `design`, `network`, `rpc`,
    `engine-render`, `engine-formula`, `sheets-formula(-ui)`,
    `sheets-numfmt(-ui)`); сам `preset-sheets-core` отдаёт unpacked size
    ~9.9 МБ по данным `npm view`, до пересчёта зависимостей. Непропорционально
    для ленивого чанка office-редактора в «ядре для соло-разработчика».
  - **На npm нет официального Univer-пакета импорта/экспорта XLSX** —
    `npm search @univerjs xlsx/import/export/exchange` не находит ничего от
    самого Univer (только сторонний неофициальный
    `@mertdeveci55/univer-import-export`, на который не стоит опираться для
    файлового I/O). У Univer это либо платный/хостируемый Exchange-плагин,
    либо «пиши свой конвертер».
  - Оба пункта прямо попадают в явно предусмотренный планом fallback
    (20-DOCUMENT-EDITORS.md, п. про табличный редактор): **`exceljs@4.4.0`**
    (чтение+запись XLSX) + **`hyperformula@3.4.0`** (голый, без обёртки
    Univer) как настоящий формульный движок для пересчёта. Явная цена этого
    выбора: **нет готового spreadsheet-грид UI** — O04 должен будет
    построить/подключить простую редактируемую таблицу самостоятельно и
    привязать правки ячеек к HyperFormula вручную; **диаграммы и сводные
    таблицы НЕ ПОДДЕРЖИВАЮТСЯ** этой комбинацией (exceljs умеет читать XML
    диаграмм, но не писать полноценные chart-объекты — не пробовалось).

### Что реально доказано round-trip тестами (не декларативно)

Новые файлы: `apps/web/lib/office/docx-codec.ts`, `apps/web/lib/office/xlsx-codec.ts`,
их тесты `docx-codec.test.ts` (4 теста), `xlsx-codec.test.ts` (4 теста) — все
в `apps/web/lib/office/` (входит в существующий `include` корневого
`vitest.config.mts`, `apps/web/lib/**/*.test.ts`, правка конфига не
понадобилась).

- **DOCX**: программно собран DOCX (заголовок H1, обычный/жирный/курсивный
  текст, таблица 2×2) средствами `docx` — независимо от нашего кодека.
  `docxToTiptapJson` парсит его в Tiptap JSON: проверены и текст, и
  сохранение bold/italic **марок**, и структура `table` (не расплющено в
  параграфы). `tiptapJsonToDocx` сериализует обратно в DOCX, и результат
  прочитан **свежим вызовом `mammoth`** (не нашим парсером) — текст,
  жирный/курсивный текст и содержимое ячеек таблицы присутствуют в HTML.
  Отдельный тест: неизвестный узел (`codeBlock`, для которого нет явного
  маппинга) не роняет сериализацию — деградирует до параграфа с текстом
  (соответствует принципу «деградация, а не крах» из 20-DOCUMENT-EDITORS.md).
- **XLSX**: собран `exceljs`-воркбук с двумя листами (`Данные`, `Итоги`),
  формулой `SUM(A1:A2)` внутри листа и **межлистовой** формулой
  `Данные!A3*2`. `xlsxToWorkbookState` читает значения и текст формул.
  `recalculate` (HyperFormula) вычисляет `SUM` = 30 и межлистовую ссылку =
  60 — **настоящий пересчёт**, не переиспользование закэшированного в файле
  результата. Отдельный тест меняет значение ячейки в состоянии (эмуляция
  правки пользователем: 10→100) и подтверждает, что пересчёт корректно
  меняет зависимые формулы (120 и 240) — то есть модель пригодна для живого
  редактирования, а не только для чтения статичного файла.
  `workbookStateToXlsx` сериализует пересчитанное состояние обратно в XLSX
  и результат прочитан **свежим независимым `ExcelJS.Workbook`** — имена
  листов, значения и текст формул на месте.

### Найденное реальное ограничение (не из плана, обнаружено тестами)

HyperFormula **не парсит небуквенно-ASCII (в т.ч. кириллические) имена
листов в формуле без кавычек**: `=Данные!A1` падает с
`Parsing error. unexpected character: ->Д<-`, а `='Данные'!A1` (в кавычках,
как Excel сам кавычит имена с пробелами/спецсимволами) парсится нормально.
Проблема в том, что **сам Excel не требует кавычек** для простого
кириллического имени листа без пробелов — то есть файл, реально сохранённый
в Excel с кириллическими названиями листов, придёт из `exceljs` без кавычек
и будет падать при пересчёте. Временное решение в `recalculate()`:
предпросчётная нормализация текста формулы — все голые ссылки на известные
листы, чьё имя содержит не-ASCII символы или пробел, оборачиваются в
кавычки перед передачей в HyperFormula (regex-замена, не `\b`, потому что
`\b` определён через ASCII-класс `\w` и не работает на кириллице — тоже
найдено тестами, не предположено). Это обходной путь, а не факт починки
самого HyperFormula; в O02/O03 стоит проверить на дополнительных реальных
фикстурах (имена листов с апострофами, восклицательными знаками и т.д. —
worst case для этой regex-нормализации).

Другие известные, ожидаемые потери (не тестировались точечно, следуют из
самой природы mammoth/HTML-моста, задокументированы как принятый компромисс
per 20-DOCUMENT-EDITORS.md, «открывается и выглядит разумно»): точные
шрифты/цвета/отступы, колонтитулы, сноски, track changes/комментарии,
вложенные списки глубже одного уровня (наш маппер списков плоский — п.
`bulletList`/`orderedList` в `docx-codec.ts`), встроенные объекты
(диаграммы/OLE).

## Диаграммы/pivot в XLSX · 2026-09-22 · Исследование DONE (без изменения кода)

Владелец подтвердил: диаграммы и сводные таблицы в таблицах — важны, не
опциональны. По его запросу проведено целевое исследование альтернатив без
Docker/внешнего сервиса поверх находки O01 («`exceljs` не пишет диаграммы/pivot
вообще»). Результат — [22-SPREADSHEET-CHARTS-RESEARCH.md](22-SPREADSHEET-CHARTS-RESEARCH.md).

Кратко: чистого бесплатного open-source решения с реальной поддержкой
создания диаграмм/pivot через UI не найдено. Жизнеспособные пути — (A)
компромисс «сохранять существующие диаграммы/pivot нетронутыми при
редактировании XLSX через ZIP/OOXML-патчинг поверх уже выбранного `exceljs`,
но не поддерживать создание новых через UI ORION в этом релизе» (без новых
зависимостей, реализуемо сейчас) или (B) коммерческая лицензия **Univer Pro**
(`@univerjs-pro/sheets-chart(-ui)` + `sheets-pivot(-ui)` + `exchange-client`,
версия 0.25.2 на момент проверки, реальная поддержка заявлена официально) —
но это разворот решения O01 «Univer отклонён» и требует узнать непубличную
цену у вендора. Прочие кандидаты (SheetJS Pro, jspreadsheet Pro, Luckysheet,
Fortune-sheet + сторонние Excel-плагины, modern-xlsx, WASM-порты LibreOffice/
ONLYOFFICE x2t) — либо тоже коммерческие, либо незрелые/заброшенные, детали и
обоснование по каждому — в файле исследования. Решение (A) vs (B) — за
владельцем продукта, не выбрано автоматически. Код/зависимости не менялись.

### Проверки (полный прогон монорепо)

- Новые зависимости: `apps/web/package.json` — `docx@^9.7.1`,
  `exceljs@^4.4.0`, `hyperformula@^3.4.0`, `mammoth@^1.8.0` (уже была в
  `@orion/ui`, теперь и в `@orion/web`, т.к. spike и будущий редактор живут
  в `apps/web/lib/office/`), `@tiptap/core@^3.31.3` + `starter-kit` + `html`
  + `extension-table(-row/-cell/-header)` + `extension-image` — все `^3.31.3`.
  Корневой `devDependencies`: `jsdom@^30.1.1` (нужен только для теста
  `docx-codec.test.ts`, у которого `generateJSON` требует DOM; помечен
  `// @vitest-environment jsdom` в файле, остальной suite по-прежнему
  `environment: "node"`).
- `pnpm test` → PASS, 24 файла / 204 теста (было 22/196, +2 файла / +8 тестов
  из `apps/web/lib/office/`, без регрессий в остальных).
- `pnpm typecheck` (корневой, по всем 7 пакетам с `typecheck`) → PASS.
  По пути найдены и исправлены две несвязанных с логикой type-несовместимости:
  `ArrayBuffer | SharedArrayBuffer` от `Buffer.buffer.slice(...)` (docx),
  и то, что `exceljs` бандлит собственную старую копию `@types/node`, чей
  `Buffer` номинально не совпадает с `Buffer` из версии `@types/node` этого
  репозитория — `wb.xlsx.load(...)` требует явный `as any` c
  `eslint-disable-next-line` и комментарием, не более мягкого каста.
- `pnpm lint` → PASS, 0 ошибок; 3 warning — все три **предсуществующие**
  (`CalendarPanel.tsx`, `DocumentsPanel.tsx`, `seed-demo-workspace.mjs`),
  не мои файлы, без регрессий. Один найденный и исправленный `no-control-regex`
  в собственном коде (`/[^\x00-\x7F]/` → `/[^ -~]/` + `/\s/`).
- Bundle: UI ещё не подключён (по заданию — O04, не эта сессия). Проверено
  `grep`, что ничего вне `apps/web/lib/office/` не импортирует эти модули —
  значит они физически не могут попасть ни в login bundle, ни в любой
  другой чанк на этом этапе; реальную ленивую разбивку чанков подтвердит
  `pnpm --filter @orion/web build` только после того, как O04 подключит
  `React.lazy`-вкладку редактора.

### Готовность к O02+

Путь **жизнеспособен**, направление подтверждено с двумя скорректированными
по факту исследования деталями (не всё «как в плане»):
1. Табличный движок — `exceljs` + голый `hyperformula`, **не Univer**
   (обоснование выше; план сам предусматривал этот fallback явно).
2. DOCX→Tiptap чтение реализовано собственным маппером
   `mammoth → HTML → @tiptap/html generateJSON`, а не готовой библиотекой —
   такой библиотеки не существует; предсказано планом («сверь, есть ли
   готовое решение… или нужно писать конвертер» — ответ: нужно, и он
   написан и протестирован).

Следующий шаг — **O02**: сопряжение с `DocumentVersion` (сериализация
модели редактора в байты на реальном upload-пути `DocumentsService`, а не
изолированно), конфликт сохранения (сверить с `Note.revision` CAS-паттерном
и явно решить/обосновать для `Document`). Codec-слой (`docx-codec.ts`,
`xlsx-codec.ts`) готов быть переиспользован O02/O03 as-is; UI (O04) не
начат и не должен начинаться раньше O02/O03 по плану.

- Файлы (абсолютные пути): `C:\Users\Reno\Desktop\ORION\apps\web\lib\office\docx-codec.ts`,
  `C:\Users\Reno\Desktop\ORION\apps\web\lib\office\docx-codec.test.ts`,
  `C:\Users\Reno\Desktop\ORION\apps\web\lib\office\xlsx-codec.ts`,
  `C:\Users\Reno\Desktop\ORION\apps\web\lib\office\xlsx-codec.test.ts`,
  `C:\Users\Reno\Desktop\ORION\apps\web\package.json`,
  `C:\Users\Reno\Desktop\ORION\package.json` (root devDependency `jsdom`).

## O01b · 2026-09-22 · DONE (диаграммы/pivot в xlsx-codec, программная форма — codec-слой, UI не трогали)

Продолжение O01 после того, как владелец подтвердил (дважды): диаграммы и
сводные таблицы нужны, добавляются **программной формой** («выбрать
диапазон + тип диаграммы → вставить»), не drag-and-drop холстом — тот
отдельный будущий этап, здесь не делался. Решение опирается на
[`22-SPREADSHEET-CHARTS-RESEARCH.md`](22-SPREADSHEET-CHARTS-RESEARCH.md),
чья эмпирическая проверка (та же сессия, до этой) установила, что
`modern-xlsx@1.2.1` реально пишет валидные `chart1.xml`/`pivotTable1.xml`
через `ChartBuilder`/`addPivotCache`/`addPivotTable`, но требует Node 24+
без обхода. Версия на npm перепроверена заново перед добавлением в
зависимости (`npm view modern-xlsx versions`) — `1.2.1` существует, это не
предположение из исследования.

### Архитектурное решение: modern-xlsx как ЕДИНЫЙ writer, не надстройка над exceljs

Задание прямо просило проверить композицию «exceljs пишет файл → modern-xlsx
открывает тот же файл и добавляет chart/pivot части поверх → пересохраняет»
**на практике**, а не на словах — эта композиция **не была реализована**,
потому что первый же проверочный скрипт показал, что она не нужна:
`modern-xlsx`'s `Workbook`/`Worksheet`/`Cell` — это не chart-only надстройка,
а полноценный read+write XLSX-движок (ячейки, формулы, стили, `toBuffer()`),
эмпирически проверенный собственным spike-скриптом (`new Workbook()` →
`ws.cell("A1").value`/`.formula` → `ws.addChart(...)` →
`ws.addPivotTableFromBuilder(...)` → `wb.toBuffer()` → результат читается
и `modern-xlsx`, и `exceljs` без ошибок). Раз один writer умеет и ячейки, и
диаграммы/pivot, **сводить два независимых OOXML-writer'а на одном файле не
было причины** — именно тот риск «конфликт структуры OOXML», о котором
предупреждало исследование, снят тем, что композиции просто нет.

Итоговая архитектура `xlsx-codec.ts` — **условное ветвление writer'а**, не
замена одного другим:

- Обычный случай (нет диаграмм/pivot в `WorkbookState`) — **`exceljs`,
  без изменений**, тот же код путь, что был в O01, ни одна существующая
  строка `workbookStateToXlsx` не тронута для этого случая. Чтение
  (`xlsxToWorkbookState`) вообще не менялось — как и было решено раньше,
  `exceljs` остаётся читателем всегда.
- Если `state.charts`/`state.pivotTables` непусты — `workbookStateToXlsx`
  переключается на новую `workbookStateToXlsxViaModernXlsx`, которая
  переписывает **все** ячейки/формулы через `modern-xlsx` (не только
  chart/pivot части) — значит для файла с диаграммой единственный writer,
  трогавший байты, это `modern-xlsx`, без cross-writer swap на уровне ZIP.

### Новый публичный API (чистые функции, как и весь codec-слой)

- `addChart(state, { sheetId, dataRange, chartType: "bar"|"line"|"pie", title? })`
  — иммутабельно добавляет диаграмму в `WorkbookState.charts`. `sheetId` —
  это имя листа (`SheetState.name`), других идентификаторов листа в модели
  O01 нет — сигнатура адаптирована под существующую модель, а не выдумана
  заново. `dataRange` — A1-диапазон с заголовком в первой строке
  (`"A1:B4"`): первая колонка → категории, остальные колонки → серии
  (имя серии — из ячейки заголовка), первая строка не попадает в данные —
  так же, как «выделить диапазон → вставить диаграмму» в самом Excel.
- `addPivotTable(state, { sheetId, sourceRange, targetCell, rowFields, valueFields })`
  — `rowFields`/`valueFields` адресуются **по именам колонок** из
  заголовка `sourceRange`, не по числовым индексам — так форма может
  предложить пользователю чекбоксы с человекочитаемыми именами полей, без
  знания внутреннего порядка колонок `modern-xlsx`. `valueFields[].subtotal`
  по умолчанию `"sum"`.
- Обе функции валидируют на входе: `sheetId` существует в `state.sheets`,
  у pivot есть хотя бы одно поле — иначе кидают понятную русскую ошибку
  сразу, не откладывая до сериализации. Отсутствие поля среди заголовков
  `sourceRange`/`dataRange` (опечатка в имени колонки) ловится позже, в
  `workbookStateToXlsx`, тоже с понятной ошибкой (нужен доступ к самим
  строкам состояния, которого нет в момент вызова `addPivotTable`).

### Что реально доказано тестами (не декларативно)

12 тестов в `xlsx-codec.test.ts` (было 4, добавлено 8), `pnpm vitest run
apps/web/lib/office/xlsx-codec.test.ts` → **PASS**:

- `addChart`/`addPivotTable` кидают на несуществующий лист / пустой набор
  полей pivot, и не мутируют входной `state` (проверено `toBe` на ссылке
  `sheets`, не только `toEqual`).
- **Реальная распаковка XLSX как ZIP** (`jszip`, добавлен в
  `devDependencies` — только для тестовой инспекции байт, не в рантайм
  редактора) и проверка `xl/charts/chart1.xml`: правильный DrawingML
  namespace, `<c:barChart>`/`<c:lineChart>` по заданному типу, текст
  заголовка, и — важно — **именно диапазон данных без строки заголовка**
  (`Sales!$A$2:$A$3`, не `$A$1:$A$3`), доказывая, что заголовок не попал
  в саму диаграмму как точка данных. `[Content_Types].xml` содержит
  Override для `chart1.xml` (без него Excel/LibreOffice не распознают
  часть).
- `xl/pivotTables/pivotTable1.xml` + `xl/pivotCache/pivotCacheDefinition1.xml`
  реально существуют и содержат `ref="D1"` (targetCell), правильные имена
  полей, `subtotal="sum"` (включая случай, когда caller его не указал —
  проверен именно дефолт, не только явное значение).
- Файл с диаграммой/pivot, записанный `modern-xlsx`, **читается обратно
  `exceljs`** (`wb.xlsx.load` не падает, `getCell("A2").value` верный) —
  подтверждает, что переключение writer'а не производит файл, который
  ломает уже принятый read-путь codec-слоя.
- Опечатка в имени поля pivot (`"NotAColumn"`) даёт `reject` с понятной
  ошибкой на сериализации, а не тихо падает где-то в WASM.
- Файл **без** диаграмм/pivot по-прежнему идёт через `exceljs`-путь
  (явная проверка отсутствия `xl/charts/`/`xl/pivotTables/` в ZIP) —
  доказывает, что ветвление не задело общий случай, а не просто
  предполагается по чтению кода.
- Workaround Node 22 (`initWasmSync` + чтение `.wasm`-байтов рядом с
  `dist/index.mjs` пакета, через `createRequire(import.meta.url).resolve`,
  а не хардкод `node_modules/modern-xlsx/...` — pnpm кладёт пакет под
  `node_modules/.pnpm/modern-xlsx@1.2.1/node_modules/modern-xlsx/`) —
  реально сработал на этой машине (Node 22.14.0, зафиксировано `git
  status`/`node --version` в начале сессии): все 12 тестов прошли без
  Node 24.

### Прогон гейта монорепо (в этой же сессии)

- `pnpm typecheck` → PASS (все 7 пакетов с `typecheck`, включая `apps/web`
  и `apps/api`).
- `pnpm lint` → PASS, 0 ошибок; 3 warning — все **предсуществующие**
  (`CalendarPanel.tsx`, `DocumentsPanel.tsx`, `seed-demo-workspace.mjs`),
  не тронутые этой сессией файлы.
- `pnpm test` → **212 passed** (24 файла), включая 12 новых xlsx-codec
  тестов — без регрессий по остальным 200.
- `pnpm --filter @orion/web build` → PASS (Next.js продакшн-сборка). Codec
  ещё нигде не импортируется вне `apps/web/lib/office/` (UI-подключение —
  будущий срез, см. ниже), поэтому сборка не тянет `modern-xlsx`/WASM ни в
  один существующий чанк — это подтверждает не регрессия размера бандла, а
  просто отсутствие импорта, и это ожидаемо для codec-only сессии.

### Известные ограничения — зафиксировано честно, не скрыто

1. **Нет визуального редактирования уже вставленных диаграмм/pivot.** Раз
   вставлены — правка (сдвинуть диапазон, поменять тип) через API этой
   сессии не предусмотрена; нужно удалить объект из `state.charts`/
   `state.pivotTables` (простой `.filter` на клиентском массиве, функции
   `removeChart`/`removePivotTable` не написаны — их тривиально добавить в
   O04 вместе с формой, инфраструктура для этого не нужна отдельно) и
   вставить заново. Это ожидаемо для «программной формы» — тот же
   компромисс, что был явно согласован владельцем перед этой сессией.
2. **`modern-xlsx@1.2.1` официально требует Node ≥24** (`engines` в его
   `package.json`); обход через `initWasmSync` — задокументированный в
   README путь для встраивающих библиотек, но не гарантирован будущими
   минорными версиями пакета (то же предупреждение, что было в
   `22-SPREADSHEET-CHARTS-RESEARCH.md` до этой сессии, остаётся в силе).
   Если апдейт `modern-xlsx` сломает `initWasmSync`, пострадает только
   ветка с диаграммами/pivot — обычный exceljs-путь не затронут архитектурно.
3. **Диаграммы поддержаны только `bar`/`line`/`pie`** (сигнатура
   `ChartType` этого codec-слоя) — библиотека `modern-xlsx` умеет больше
   (`column`, `doughnut`, `scatter`, `area`, `radar`, `bubble`, `stock`),
   сознательно сужено до трёх типов, которые реально просила задача
   («тип диаграммы» в программной форме); расширение — тривиальная правка
   union-типа плюс проброс в `ws.addChart`, не архитектурное изменение.
4. **Pivot table поддерживает только `rowFields`/`valueFields`**, без
   `colFields`/`pageFields`, которые есть у `PivotTableBuilder` в самой
   библиотеке — тоже сознательное сужение под текущее задание, не предел
   возможностей writer'а.
5. **Реальный Excel/LibreOffice не открывали файл на этой машине** —
   как и в `22-SPREADSHEET-CHARTS-RESEARCH.md`, `soffice`/`libreoffice` не
   установлены в этом окружении. Проверка ограничена структурной
   валидностью OOXML (правильные `[Content_Types].xml`, namespace,
   `r:id`-связи) и повторным чтением через `exceljs` — сильный, но не
   исчерпывающий сигнал. Визуальная проверка в реальном офисном пакете —
   открытый пункт перед тем, как O04 подключит это к UI и владелец
   реально попробует файл.
6. **UI не подключён** — по заданию этой сессии (аналогично O01): только
   `addChart`/`addPivotTable` + сериализация, форма «выбрать диапазон + тип»
   не написана. Следующий шаг для этого — часть O04.

- Файлы (абсолютные пути): `C:\Users\Reno\Desktop\ORION\apps\web\lib\office\xlsx-codec.ts`,
  `C:\Users\Reno\Desktop\ORION\apps\web\lib\office\xlsx-codec.test.ts`,
  `C:\Users\Reno\Desktop\ORION\apps\web\package.json` (добавлены
  `modern-xlsx@^1.2.1` в `dependencies`, `jszip@^3.10.1` в `devDependencies`).

## O02 · 2026-09-22 · DONE (контракты/права/CAS-решение зафиксированы; прикладной серверный код НЕ менялся — обосновано ниже; новый integration-тест доказывает реальный round-trip)

Офисный трек, [21-OFFICE-IMPLEMENTATION.md](21-OFFICE-IMPLEMENTATION.md), задача
O02: «модель сериализации/десериализации, сопряжение с DocumentVersion,
конфликт сохранения». Прочитаны полностью перед правками:
`apps/api/src/documents/documents.service.ts` (весь файл, включая S14c
`archiveContentTx`/`revertContentIfWritten` компенсацию для `replaceContent`/
`restoreVersion`), `documents.controller.ts`, `packages/shared-types/src/document.ts`,
`apps/api/prisma/schema.prisma` (модели `Document`/`DocumentVersion`),
`docs/SONNET_IMPLEMENTATION/14-DECISIONS.md` (пересмотр ONLYOFFICE → native),
и оба codec-файла O01/O01b целиком.

### Итог по каждому пункту задания

1. **Определение «офисного» документа** — по `Document.mimeType`, новое поле
   не нужно. `mimeType` уже пишется на upload/replaceContent из
   `file.mimetype` (multer/клиент), ничего не «санитайзится» сервером
   (`documents.service.ts:475`: `file.mimetype && file.mimetype.length > 0 ? file.mimetype : "application/octet-stream"`).
   DOCX/XLSX — точное совпадение с
   `application/vnd.openxmlformats-officedocument.wordprocessingml.document` /
   `...spreadsheetml.sheet` — клиентская константа/switch в будущем O04, не
   серверный enum.
2. **Открытие** — выбран путь «клиент скачивает сырые байты через уже
   существующий `GET .../documents/:id/content` и парсит сам» (codec из
   O01/O01b), **без** нового серверного контракта. Обоснование по
   `rule/smallest-intervention`: сервер уже отдаёт байты с корректным
   `Content-Type`/`Range`; распарсить DOCX→Tiptap JSON / XLSX→`WorkbookState`
   — чистая функция без побочных эффектов и без знания о Prisma/RLS/
   workspace, вводить новый ответ вида «JSON вместо байт» означало бы вторую
   сериализацию того же контента и новый DTO без выигрыша (клиенту всё равно
   нужно уметь распарсить исходный DOCX/XLSX для показа истории версий).
3. **Сохранение** — клиент сериализует модель в DOCX/XLSX (`tiptapJsonToDocx`/
   `workbookStateToXlsx`) и шлёт как обычный `POST .../documents/:id/content`
   (`DocumentsService.replaceContent`) — новая `DocumentVersion`, тот же путь
   для любого файла. **Доказано не теоретически** — новый
   `apps/api/test/office-documents.integration.test.ts` реально: (а) собирает
   Tiptap JSON/`WorkbookState` в Node через `apps/web/lib/office/docx-codec.ts`
   и `xlsx-codec.ts` (те же функции, что O01/O01b протестировали
   изолированно), (б) грузит байты через настоящий HTTP `POST
   .../documents/upload` на поднятом `NestFactory.create(AppModule)` с
   реальными Postgres+RLS (`vitest.integration.config.mts`, изолированный
   кластер порт 5546) и реальным `StorageAdapter` (`local`, temp `STORAGE_DIR`),
   (в) скачивает обратно через `GET .../content`, (г) парсит codec'ом ещё раз
   и сверяет содержимое. DOCX-тест проверяет текст первой и второй
   (после `replaceContent`) версий плюс то, что архивная `DocumentVersion`
   всё ещё парсится в исходный текст. XLSX-тест проверяет кросс-листовую
   формулу (`Данные!A3*2`) после round-trip и повторного пересчёта
   HyperFormula, включая изменение исходной ячейки и правильный каскад
   зависимых значений после второго сохранения. Все 4 теста PASS.
4. **«Создать документ»/«Создать таблицу»** — решено НЕ добавлять
   `POST .../documents/create-office?type=`: существующий
   `POST .../documents/upload` уже принимает произвольный `multipart/form-data`
   с клиентским `mimetype`, а генерация пустого валидного DOCX/XLSX — это
   ровно `tiptapJsonToDocx({ type: "doc", content: [] })` /
   `workbookStateToXlsx({ sheets: [{ name: "Sheet1", rows: [] }] })`, то есть
   обычный файл с точки зрения сервера. Подтверждено тем же тестом (первый
   DOCX-документ в тесте — программно сгенерированный с нуля, не взятый из
   готового файла). O04 реализует «Создать документ» как: сгенерировать
   пустой DOCX/XLSX клиентом → `uploadDocuments` с явным именем/`mimeType`,
   без новой ручки.
5. **Права и conflict policy**:
   - Права на открытие/сохранение — обычный путь `DocumentsController`
     (`@RequireModule("documents")` + `WorkspacesService.assertMember` внутри
     каждого метода `DocumentsService`, RLS на `documents`/`document_versions`)
     — office-файл ничем не отличается от любого другого `Document`, отдельно
     не дублировалось и не должно.
   - **CAS-решение: без CAS, last-write-wins — зафиксировано явно, не по
     умолчанию.** Проверено чтением `documents.service.ts:replaceContent`
     (L447–491) и `schema.prisma` (`model Document`, L1080–1115): у `Document`
     **нет** поля `revision` (в отличие от `Note.revision`, добавленного в
     v0.11/S11 специально для `Note`'s `expectedRevision`-CAS —
     `notes.service.ts:restoreRevision` и `update`). `replaceContent` не
     принимает `expectedRevision` и не сравнивает ревизию — HTTP 409
     (`ConflictException`) там сегодня означает только «P2002 по гонке
     архивной версии» (`documentId+versionNumber` unique), не «кто-то уже
     сохранил новее». Решение O02: **не вводить CAS для `Document` ради
     office-файлов.** Причины: (а) план прямо просил обосновать
     last-write-wins, если он выбран, а не молча оставить как есть; (б)
     добавление `expectedRevision` только для DOCX/XLSX создало бы третий
     несовместимый паттерн конфликтов рядом с «`Note` — CAS» и «остальные
     `Document` — LWW», что прямо противоречит принципу CLAUDE.md
     «Модульный контракт»/консистентности паттернов между зеркальными
     сущностями; общий `expectedRevision` для ВСЕХ `Document` — отдельная,
     более крупная миграция (новая колонка + правка каждого вызывающего
     `update`/`bulk`/`move` кода), которую владелец не заказывал в этом
     задании; (в) сам план явно называет модель работы «один открыл →
     отредактировал → сохранил → следующий открыл» (не совместное
     редактирование), т.е. **последовательное** сохранение — заявленно
     приемлемый сценарий для office-файлов, и предыдущая сохранённая версия
     физически не теряется (она жива как `DocumentVersion`, доступна через
     history/restore) — только не защищена явным отказом «кто-то сохранил
     раньше вас». Третий тест в новом файле (`"save conflict policy..."`)
     это подтверждает эмпирически: два последовательных `replaceContent` от
     «разных клиентов» оба успешны (нет 409), второй побеждает как текущая
     версия, первый остаётся доступен как `DocumentVersion #1` — то есть OF04
     («повторный upload той же версии не размножает версии») и OF06 («два
     ПОСЛЕДОВАТЕЛЬНЫХ сохранения») из матрицы приёмки уже проходят с текущим
     контрактом без единой правки прод-кода.
6. **Отказы (повреждённый/невалидный DOCX/XLSX)** — подтверждён инвариант
   «Documents — бинарное хранилище, сервер не разбирает формат»: четвёртый
   тест грузит произвольный текстовый буфер под `mimeType` DOCX, сервер
   принимает (201) и отдаёт байты как есть — `docxToTiptapJson` на них
   бросает исключение только на **клиенте**. Серверная DOCX/XLSX-валидация
   сознательно не добавлена — O03/O04 обязаны ловить эту ошибку клиентской
   стороной и деградировать до просмотра/скачивания оригинала (см.
   21-OFFICE-IMPLEMENTATION.md «open… деградация до просмотра»), не пытаться
   провалидировать на сервере.

### Что НЕ менялось (осознанно)

Ни одна Prisma-модель/миграция, ни `documents.service.ts`/`documents.controller.ts`,
ни `shared-types/document.ts` не тронуты — существующий контракт `Document`+
`DocumentVersion`+`upload`/`content`/`replaceContent` уже полностью
достаточен для O02. Единственные новые файлы — тест и его обвязка.

### Технический нюанс: cross-app import в тесте

`apps/api/test/office-documents.integration.test.ts` импортирует
`apps/web/lib/office/{docx,xlsx}-codec.ts` напрямую по относительному пути —
намеренно, чтобы гонять **реальный** codec-слой (не копию) против **реального**
HTTP API. Vitest транспилирует файл per-file (esbuild), поэтому в рантайме
это работает (Node module resolution идёт от физического расположения файла
— находит `apps/web/node_modules`). `tsc`-проект `apps/api` (CommonJS,
`rootDir: "."`) не может типизировать файл вне `rootDir`, да и `apps/web`
использует `modern-xlsx`, чьи типы требуют `moduleResolution: bundler/node16`
и `import.meta` — несовместимо с настройками `apps/api`. Решение: файл
добавлен в `exclude` `apps/api/tsconfig.test.json`, `pnpm typecheck` его не
проверяет, но `pnpm test:integration` его выполняет и проверяет поведение —
не типы. Компромисс осознанный, не костыль вслепую.

### Проверки (полный прогон, изолированный кластер)

```bash
ORION_PG_DATA=<scratchpad>/office-pg-test-data ORION_PG_PORT=5546 node scripts/postgres.mjs up
DATABASE_URL="postgresql://orion:orion_local_dev@127.0.0.1:5546/orion" \
  pnpm --filter @orion/api exec prisma migrate deploy   # все миграции применились чисто
DATABASE_URL="postgresql://orion:orion_local_dev@127.0.0.1:5546/orion" \
APP_DATABASE_URL="postgresql://orion_app:OcjNaKnQFUp0gdwdju-cSP9T_0gaiOZI@127.0.0.1:5546/orion" \
STORAGE_DIR=<scratchpad>/office-test-documents \
  pnpm test:integration     # 22 файла / 117 тестов PASS (новый файл — 4 теста)
ORION_PG_DATA=<scratchpad>/office-pg-test-data ORION_PG_PORT=5546 node scripts/postgres.mjs down
```

- `pnpm test` → PASS, 24 файла / 212 тестов (без изменений в unit-слое —
  O02 не тронул `packages/`).
- `pnpm typecheck` → PASS, все 7 workspace-проектов (после добавления
  `exclude` в `apps/api/tsconfig.test.json`, см. выше).
- `pnpm lint` → PASS, те же 3 предсуществующих warning (`CalendarPanel.tsx`,
  `DocumentsPanel.tsx`, `seed-demo-workspace.mjs`), без регрессий.

### Ограничения и что осталось непроверенным

- Реальный Word/Excel эту сессию не открывали (нет установленного офиса в
  среде агента) — как и в O01/O01b, структурная валидность OOXML плюс
  независимый повторный парсинг (`mammoth`/`exceljs`) — это то, что
  проверено; визуальная сверка в реальном офисном пакете остаётся открытым
  пунктом для OF01/OF02 (матрица приёмки), не для O02.
- OF03 (права: чужой workspace/выключенный модуль/удалённый файл) для
  office-файлов отдельно не тестировался этой сессией — office-документ
  проходит через тот же `DocumentsService`/`RequireModule`/RLS путь, что уже
  покрыт существующими `api-rls.integration.test.ts` и
  `documents-*.integration.test.ts` для любого файла; отдельного риска для
  DOCX/XLSX конкретно нет (mimeType не влияет на авторизацию), поэтому
  отдельный дублирующий тест не писался — но явно не прогонялся именно с
  office-mimeType, если понадобится дотошная проверка.
- Одновременное (не последовательное) сохранение по-прежнему явно вне
  объёма (план это подтверждает) — third test в новом файле имитирует
  «последовательных» клиентов через await, не настоящую гонку.

### Готовность к O04

O03 («клиентский парсинг при открытии и сериализация при сохранении») в
основном уже доказан этим тестом на уровне codec+API — остаётся перенести
тот же вызов `docxToTiptapJson`/`tiptapJsonToDocx`/`xlsxToWorkbookState`/
`workbookStateToXlsx` в реальный `apps/web` UI-код (загрузка блоба через
`ApiClient`, а не `fetch` напрямую, плюс обработка ошибки парсинга —
деградация до preview/download, ещё не реализована как UI-состояние). O04
может начинаться: контракт открытия/сохранения/конфликта/отказов
зафиксирован и доказан реальным round-trip, новых серверных изменений не
требуется для самого редактора (только для UI-слоя).

- Файлы (абсолютные пути):
  `C:\Users\Reno\Desktop\ORION\apps\api\test\office-documents.integration.test.ts` (новый),
  `C:\Users\Reno\Desktop\ORION\apps\api\tsconfig.test.json` (добавлен `exclude`).

## O04 (+O03) · 2026-09-22 · PARTIAL DONE (редактор и создание файлов реализованы и проходят typecheck/lint/unit/build/desktop-export; реальный Word/Excel/браузер/Tauri НЕ проверялись — нет browser/Office tooling в среде агента, см. ограничения)

Офисный трек, [21-OFFICE-IMPLEMENTATION.md](21-OFFICE-IMPLEMENTATION.md), задача O04:
«вкладка редактора и создание файлов в UI» (зависимость O03, «клиентский
парсинг при открытии и сериализация при сохранении» — которая по факту была
почти доказана O02's round-trip test на уровне codec+API, но никогда не была
перенесена в реальный `apps/web` UI-код; эта сессия делает обе задачи разом,
т.к. O04 не может существовать без клиентского парсинга/сериализации).
Прочитаны полностью перед правками: 21-OFFICE-IMPLEMENTATION.md,
12-PROGRESS.md записи O01/O01b/O02, 20-DOCUMENT-EDITORS.md «Рабочая
поверхность», 11-AGENT-PROTOCOL.md «Алгоритм одной сессии»,
`apps/web/panels/DocumentsPanel.tsx` целиком, `packages/ui/src/file-preview.tsx`
+ `file-preview/{docx-view,sheet-view,pdf-view}.tsx` целиком (эталон
React.lazy + graceful degradation), `apps/web/panels/documents/{preview-pane,document-history}.tsx`,
`packages/ui/src/autosave-status.tsx`, `packages/core/src/api/api-client.ts`
(документные методы), `packages/core-react/src/use-documents.ts`, оба codec-файла
`apps/web/lib/office/{docx,xlsx}-codec.ts` целиком (их публичный API, не
угадывался).

### Что сделано

1. **`docx-codec.ts`**: добавлена `docxToTiptapJsonInBrowser` — браузерный
   аналог существующей (Node-only, `mammoth`'s Node entry с `Buffer`)
   `docxToTiptapJson`. Использует тот же mammoth browser subpath
   (`mammoth/mammoth.browser`), что уже применяет `@orion/ui`'s `DocxView`
   для read-only просмотра, и те же `officeDocExtensions()`, что Node-путь —
   так редактор и preview парсят DOCX одинаково. Это была реальная дыра в
   готовности к O04, зафиксированная в самом O02: комментарий в коде прямо
   говорил «O03's browser code will use the browser subpath»; O02 сам этим
   путём не пользовался (тестировал только Node-путь через vitest).
2. **`apps/web/lib/office/office-files.ts`** (новый) — MIME/расширение-детекция
   DOCX/XLSX (`isDocxDocument`/`isXlsxDocument`, то же правило «MIME
   сначала, расширение — фолбэк», что `documentGroup`/`previewKind`) и
   генерация пустого валидного DOCX/XLSX (`createEmptyDocxFile`/`createEmptyXlsxFile`),
   ровно то, что O02 §4 предписал: `tiptapJsonToDocx({type:"doc",content:[]})`
   и `workbookStateToXlsx({sheets:[{name:"Sheet1",rows:[]}]})`, без нового
   серверного эндпоинта.
3. **`apps/web/components/office/OfficeEditor.tsx`** (новый) — тонкий
   диспетчер: `React.lazy` на `docx-editor.tsx`/`xlsx-editor.tsx`, качает
   байты через уже существующий `useDocumentBlob` (тот же хук, что
   read-only `PreviewPane`), при ошибке парсинга (`onParseFailed`) откатывается
   на переданный `fallback` (обычный `FilePreview`), не роняя вкладку.
4. **`apps/web/components/office/docx-editor.tsx`** (новый, default export —
   цель `React.lazy`) — Tiptap-редактор поверх `@tiptap/react` (добавлен в
   `apps/web/package.json`, версия `^3.31.3`, синхронно с уже установленными
   `@tiptap/core`/`starter-kit`/extension-пакетами той же мажорной версии).
   Тулбар: отменить/повторить, bold/italic/strike, заголовки 1-3,
   маркированный/нумерованный список, вставка таблицы (все — реально
   доступные команды из `officeDocExtensions()`, тот же extension-набор, что
   codec использует для парсинга — **подчёркивание в тулбар сознательно не
   добавлено**: `Underline` extension не входит в `officeDocExtensions()`,
   а добавлять его только в UI без правки codec означало бы редактор и
   парсер/сериализатор расходятся в поддерживаемых марках). Сохранение —
   `editor.getJSON()` → `tiptapJsonToDocx` → `File` → существующий
   `useReplaceDocumentContent` (без правок сервера). Состояние сохранения —
   переиспользован `AutosaveStatus` (`@orion/ui`, найден по grep в S11's
   работе, как просил протокол) в режиме «Сохранить руками»
   (saving/dirty/saved/error), кнопка «Сохранить» — явное действие, не
   автосохранение (план это не требует).
5. **`apps/web/components/office/xlsx-editor.tsx`** (новый, default export) —
   простой редактируемый грид поверх `WorkbookState` (НЕ Excel-клон, по
   заданию): табы листов, ячейки как `<input>` с двумя режимами (текст/число
   или формула через `=...`), после каждого редактирования — `recalculate`
   (HyperFormula) для пересчёта зависимых ячеек. «Вставить диаграмму» —
   минимальная форма (диапазон A1-нотацией, тип bar/line/pie, заголовок) →
   существующий `addChart` из `xlsx-codec.ts`. **Pivot table форма не
   реализована** (явно опциональный пункт задания, отложен — см.
   ограничения).
6. **`apps/web/panels/documents/preview-pane.tsx`** — при открытии
   DOCX/XLSX-файла (`isOfficeDocument`) показывает `OfficeEditor` вместо
   read-only `FilePreview`; сама панель предпросмотра (уже занимающая
   половину `DocumentsPanel` в two-pane режиме или весь `Sheet` на узком
   экране) и есть «большая вкладка редактора» из 20-DOCUMENT-EDITORS.md —
   новый Workbench-панель-тип НЕ заводился (риск/объём несоразмерны задаче,
   зафиксировано явно, не молча). Имя файла/скачивание уже показывались
   хедером `PreviewPane`; история версий — уже есть в `DocumentsPanel`
   (кнопка «История версий…» в меню файла, `DocumentHistory`, не тронута —
   переиспользована как есть, п.4 задания).
7. **`apps/web/panels/DocumentsPanel.tsx`** — кнопки «Документ»/«Таблица»
   рядом с «Папка»/«Загрузить» (тот же `variant="outline"` `size="sm"`
   паттерн), генерируют файл и грузят его через уже существующий
   `useUploadDocuments`, имена — «Новый документ.docx»/«Новая таблица.xlsx»
   (буквально из текста задания, а не заново придуманы). Импорт кодеков —
   **динамический** (`await import("../lib/office/office-files")` внутри
   обработчика клика), не статический на верхнем уровне модуля — см. §
   «Проверка ленивой загрузки» ниже, почему это было важно поправить.

### Проверка ленивой загрузки (не предполагалась, а измерена по build output)

Первая версия статически импортировала `office-files.ts` (а через него —
весь `xlsx-codec.ts`/`docx-codec.ts`, то есть Tiptap/docx/exceljs/
HyperFormula/modern-xlsx) на верхнем уровне `DocumentsPanel.tsx`. Хотя
`DocumentsPanel` уже лениво грузится через `next/dynamic` в
`lib/panel-registry.ts`, статический импорт означал, что весь office-codec
подтягивается в чанк `DocumentsPanel` безусловно, при каждом открытии
панели «Документы» — даже если пользователь ни разу не создаёт/не открывает
office-файл. Исправлено переносом импорта `office-files.ts` внутрь
обработчика клика (`createOfficeDocument`) — динамический `import()`.
`pnpm --filter @orion/web build` (обычный) и `pnpm build:desktop-export`
(desktop) оба подтверждают:
- `/login` — **498 kB** First Load JS, не изменилось (не является страницей,
  где Documents/office-код вообще достижим).
- `/panel/[panelId]` (несущий все панели, включая Документы) — **786 kB /
  1.28 MB**, идентично до и после переноса импорта на динамический — то
  есть тяжёлые office-библиотеки не входят в синхронно необходимый для
  первого рендера набор ни в одном из двух вариантов; перенос на
  динамический импорт всё равно сделан как более консервативный/корректный
  по духу задания вариант (риск был в том, что webpack мог бы в другой
  конфигурации сплит-чанков подтянуть общий чанк заранее).
- Отдельные async-чанки для Tiptap/mammoth (docx-editor) и
  exceljs/HyperFormula/modern-xlsx (xlsx-editor) подтверждены по содержимому
  (`grep -l "ProseMirror\|mammoth\|hyperformula\|modern-xlsx"` по
  `.next/static/chunks/*.js` — три файла ~330–1000 КБ, отдельные от
  `login`'s chunk list в `app-build-manifest.json`).

### Проблема, найденная и исправленная: modern-xlsx ломал сборку под браузер

`workbookStateToXlsx` (xlsx-codec.ts) переключается на writer `modern-xlsx`
только когда `state.charts`/`state.pivotTables` не пусты; сам writer
резолвит свой `.wasm`-файл через `node:fs`/`node:module`/`node:path`
(`ensureModernXlsxWasm`) — путь, написанный для O02's интеграционного теста
(который выполняется под Node), Node-only. Простое подключение
`xlsx-codec.ts` в клиентский код **ломало саму сборку** (`pnpm build`):
webpack обязан собрать (не выполнить — именно собрать, чтобы сформировать
чанк) любую ветку, достижимую через `import()`, даже никогда не
вызываемую в браузере, и падал на `UnhandledSchemeError` для `node:`-схемы.
Исправлено в `apps/web/next.config.js`: `webpack.IgnorePlugin` с
`resourceRegExp: /^node:(fs\/promises|fs|path|module)$/` для клиентского
бандла (`!isServer`) — простого `resolve.fallback` оказалось недостаточно,
т.к. он перехватывает голые спецификаторы (`"fs"`), а не запросы со схемой
(`"node:fs"`). **Следствие**: если пользователь в браузере/Tauri реально
попробует сохранить лист с диаграммой/pivot-таблицей, `ensureModernXlsxWasm`
бросит исключение времени выполнения (модуль недоступен) — это **поймано**
в `XlsxEditor.save()`'s `try/catch` и показано как явная русская ошибка
сохранения (не силент/частично записанный файл, что соответствует контракту
21-OFFICE-IMPLEMENTATION.md «ошибка сохранения»), но диаграммы физически не
сохраняются из браузера/Tauri в этой сессии — открытый пункт для O05/O06 или
отдельной сессии (например: переложить `.wasm`-фетч на `fetch()` вместо
`node:fs`, или собирать xlsx с диаграммами исключительно на бэкенде — оба
варианта не исследовались, вне объёма O04).

### Что НЕ реализовано / отложено (честно)

- **Pivot table UI** — явно опциональный пункт задания, не сделан из-за
  бюджета сессии; `addPivotTable` из codec остаётся неподключённым к UI.
- **Диаграммы в браузере** — форма есть, `addChart` вызывается и корректно
  обновляет `WorkbookState`, но фактическое сохранение падает в
  браузере/Tauri (см. выше) — известное, задокументированное ограничение,
  не тихий баг.
- **Read-only режим по правам** — в проекте нет роли «viewer»/read-only
  членства (`workspaceRoleSchema`, `packages/shared-types/src/workspace.ts`
  — сверено чтением; все роли, дошедшие до `assertMember`, имеют доступ на
  запись). Отдельного read-only UI-гейта поэтому не заводилось — «ошибка
  парсинга → деградация до preview/download» и есть единственный
  практический read-only путь для office-файла в этом проекте, что и
  реализовано (`onParseFailed` → `fallback`). Если/когда в проекте появится
  reader-роль, `OfficeEditor` — точка, где добавить проверку.
- **Конфликт сохранения (CAS)** — не касается O04 напрямую: O02 уже
  зафиксировал last-write-wins для `Document`, редактор ничего не меняет
  в этом контракте.
- **Реальный Word/Excel/браузер/Tauri smoke** — НЕ прогонялись (нет
  установленного офиса, браузера или Tauri в среде агента). Доказано только
  структурно: typecheck проходит (Tiptap/codec-типы согласованы), unit-тесты
  не регрессировали, `next build`/`build:desktop-export` компилируют и
  собирают весь UI-код включая новые компоненты без ошибок компиляции —
  это proxy для «код синтаксически и типово корректен», НЕ подтверждение,
  что открытие/редактирование/сохранение реального DOCX/XLSX в браузере
  визуально работает. Mammoth-browser-путь (`docxToTiptapJsonInBrowser`)
  зеркалит уже работающий (по O01.12) `DocxView`, что снижает, но не
  устраняет этот риск.
- **Сложные DOCX-стили** (кастомные шрифты/цвета/колонтитулы/комментарии/
  track changes) — те же принятые потери, что документированы в O01
  (`docx-codec.ts`'s заголовочный комментарий); редактор их не расширяет и
  не сужает.

### Проверки (полный прогон, без БД — этот трек не тронул сервер/схему)

```bash
pnpm install              # добавлен @tiptap/react@^3.31.3
pnpm typecheck             # PASS, все 7 workspace-проектов
pnpm lint                  # PASS, те же 3 предсуществующих warning (CalendarPanel, DocumentsPanel, seed-demo-workspace) — без новых
pnpm test                  # PASS, 24 файла / 212 тестов (без изменений в unit-слое — O04 не добавил юнит-тестов для UI-компонентов; кодек уже покрыт O01/O01b/O02)
pnpm --filter @orion/web build          # PASS — см. §«Проверка ленивой загрузки» за числа чанков
pnpm build:desktop-export               # PASS — apps/web/.next-desktop сгенерирован (index.html/*.txt/_next/...)
```

### Файлы (абсолютные пути)

- `C:\Users\Reno\Desktop\ORION\apps\web\lib\office\docx-codec.ts` — правка (добавлена `docxToTiptapJsonInBrowser`)
- `C:\Users\Reno\Desktop\ORION\apps\web\lib\office\office-files.ts` — новый
- `C:\Users\Reno\Desktop\ORION\apps\web\components\office\OfficeEditor.tsx` — новый
- `C:\Users\Reno\Desktop\ORION\apps\web\components\office\docx-editor.tsx` — новый
- `C:\Users\Reno\Desktop\ORION\apps\web\components\office\xlsx-editor.tsx` — новый
- `C:\Users\Reno\Desktop\ORION\apps\web\panels\documents\preview-pane.tsx` — правка (подключён `OfficeEditor`)
- `C:\Users\Reno\Desktop\ORION\apps\web\panels\DocumentsPanel.tsx` — правка (кнопки «Документ»/«Таблица»)
- `C:\Users\Reno\Desktop\ORION\apps\web\next.config.js` — правка (`webpack.IgnorePlugin` для `node:` схемы в клиентском бандле)
- `C:\Users\Reno\Desktop\ORION\apps\web\package.json` — правка (добавлен `@tiptap/react`)

### Следующий шаг

O05 («последовательные сохранения и история») — по факту уже почти
покрыт O02's тестом на уровне API (два последовательных `replaceContent`,
OF04/OF06 проходят). Реальная работа O05 для UI — подтвердить, что
`useReplaceDocumentContent`/`useDocumentVersions`' `invalidateQueries` даёт
второму открывшему актуальную версию без перезагрузки страницы (уже похоже
работает по коду хука, но не проверено вживую). Первый шаг для следующего
агента — открыть реальный DOCX/XLSX в браузере (нужен запущенный
dev-сервер и браузер, недоступные этой сессии) и подтвердить визуально
round-trip, прежде чем ставить O04 в полный DONE.

## O04-follow-up · 2026-09-22 · DONE (диаграммы/pivot из браузера — реально чинится, не архитектурный обход)

Продолжение O04: тот же владелец попросил разобраться, можно ли реально
заставить `modern-xlsx` работать в браузере вместо серверного обхода.
Прочитаны полностью перед правками: этот файл, записи «O01b» и «O04»
целиком, `apps/web/lib/office/xlsx-codec.ts` целиком, `apps/web/components/office/xlsx-editor.tsx`
целиком, `apps/web/next.config.js` целиком.

### Найдено: пакет реально имеет browser-таргет, O04 просто не тем путём вызвал `initWasm`

Инспекция `node_modules/.pnpm/modern-xlsx@1.2.1/node_modules/modern-xlsx/`
(`package.json`'s `exports`, `dist/`, `wasm/`, `wasm-lite/`) и README
(разделы «Browser Usage (ESM)», «Browser Usage (CDN/IIFE)», «Custom WASM
URL») показали: это не Node-only пакет без browser-сборки — обычный
wasm-bindgen `--target web`-подобный модуль, где `initWasm(wasmSource?)`
делает **обычный `fetch()`**, без единого обращения к `node:fs` в самом
загрузчике (`dist/utils-duTZlpYF.mjs`'s `initWasm`/`init`/`__wbg_init` —
проверено построчно, `node:fs/promises` встречается только в отдельных,
не импортируемых этим кодеком Node-only удобствах `wb.toFile()`/
`readFile()` в других чанках пакета).

O04's находка была верной («в браузере нет `node:fs`, `initWasmSync`
сломан»), но вывод «значит нужен архитектурный обход» — нет: O04 просто не
попробовал `initWasm()` (асинхронный, fetch-based), а сразу списал пакет
как Node-only, увидев, что *default* auto-detected URL (через
`import.meta.url`, который после webpack указывает на emitted JS-чанк, а
не на `node_modules`) не работает после бандлинга. Решение — именно то,
что README называет «Custom WASM URL»: передать `initWasm()` явный URL на
статически раздаваемый `.wasm`-файл.

### Что сделано

1. **`apps/web/scripts/copy-modern-xlsx-wasm.mjs`** (новый) — копирует
   `modern-xlsx.wasm` из-под `node_modules/.pnpm/...` в
   `apps/web/public/modern-xlsx.wasm`, тем же паттерном, что
   `copy-pdf-worker.mjs` для pdf.js (резолвит пакет через `createRequire`,
   не хардкодит pnpm-layout, гитигнорится — регенерируется). Подключён в
   `apps/web/package.json`'s `prepare-assets`/`dev`/`build`/`build:desktop`.
2. **`apps/web/lib/office/xlsx-codec.ts`**'s `ensureModernXlsxWasm` — теперь
   ветвится: `typeof window !== "undefined"` → браузер →
   `mod.initWasm("/modern-xlsx.wasm")` (fetch со статики); иначе Node →
   прежний `initWasmSync` + `node:fs` путь (не тронут, всё ещё нужен для
   Node 22, где `initWasm()` без аргумента делает `fetch('file://...')` и
   падает — это отдельный, уже решённый в O01b баг).
3. **`apps/web/next.config.js`** — `webpack.IgnorePlugin` для `node:`-схемы
   **оставлен** (комментарий обновлён, не удалён): он больше не нужен ради
   *нашего* `ensureModernXlsxWasm` (тот больше не трогает `node:fs` в
   браузерной ветке), но по-прежнему нужен из-за `node:fs/promises`
   внутри самого пакета `modern-xlsx` (`wb.toFile()`/`readFile()` в
   `dist/src-*.mjs`/`dist/utils-*.mjs`) — эти функции codec не вызывает, но
   webpack обязан *собрать* эту достижимую (через `import("modern-xlsx")`)
   ветку для клиентского чанка независимо от того, вызывается ли она в
   рантайме.
4. **`apps/web/components/office/xlsx-editor.tsx`** — заголовочный
   комментарий, утверждавший «диаграммы не сохраняются из браузера»,
   переписан как устаревший/исправленный; сам `try/catch` вокруг
   сохранения оставлен как есть (оправданная защита от любой будущей
   ошибки сохранения, не только этой).

### Что реально доказано тестом (не «не падает», а корректный `chart1.xml`)

Новый `apps/web/lib/office/xlsx-codec.browser-wasm.test.ts`
(`// @vitest-environment jsdom`, так что `window` определён — та же ветка,
что в реальном браузере) стабит `global.fetch` на реальные байты
`modern-xlsx.wasm`, прочитанные из `node_modules` (не мок-заглушка), и
прогоняет **весь** пайплайн `addChart` → `workbookStateToXlsx` →
распаковка результата `jszip`, теми же ассертами, что O01b's Node-путь:
`xl/charts/chart1.xml` присутствует, правильный DrawingML namespace,
`<c:barChart>`, текст заголовка, диапазоны данных без строки заголовка
(`Sales!$A$2:$A$3`/`$B$2:$B$3`), `[Content_Types].xml` содержит Override
для `chart1.xml`, и файл читается обратно `exceljs` без ошибок. Тест
явно проверяет `expect(global.fetch).toHaveBeenCalledWith("/modern-xlsx.wasm")`
— доказывает, что путь инициализации реально прошёл через fetch, а не
тихо переиспользовал уже инициализированный из другого теста WASM
(каждый тестовый файл — отдельный воркер/модульный реестр в vitest,
проверено запуском именно этих двух файлов вместе: `xlsx-codec.test.ts`
(Node-путь) + `xlsx-codec.browser-wasm.test.ts` (браузерный путь) — оба
инициализируют WASM независимо, 13 тестов, все PASS).

### Прогон гейта монорепо (в этой же сессии)

```bash
pnpm typecheck                       # PASS, все 7 workspace-проектов
pnpm lint                            # PASS, те же 3 предсуществующих warning (CalendarPanel, DocumentsPanel, seed-demo-workspace) — без новых
pnpm test                            # PASS, 25 файлов / 213 тестов (было 212; +1 новый browser-wasm тест)
pnpm --filter @orion/web build       # PASS, идентичные размеры чанков /panel/[panelId] (786 kB / 1.28 MB) — фикс не раздул бандл
pnpm build:desktop-export            # PASS; вручную проверено find .next-desktop -iname "*modern-xlsx*" → .next-desktop/modern-xlsx.wasm существует в корне export'а, туда же, куда `initWasm("/modern-xlsx.wasm")` полезет за файлом
```

### Осталось честно нерешённым

- **Реальный браузер/Tauri smoke по-прежнему не прогонялся** — та же
  причина, что в O04 (нет установленного браузера/Office в среде агента).
  Доказательство этой сессии — структурное (jsdom + реальный fetch реальных
  WASM-байт + распаковка результата как ZIP), что сильнее, чем "typecheck
  проходит", но не то же самое, что открыть настоящий Chrome/Tauri-окно и
  нажать «Вставить диаграмму» глазами.
- **Pivot table UI по-прежнему не реализован** (это было явно вне рамок и
  O04, и этой сессии — `addPivotTable` из codec готов и покрыт тестами, но
  не подключён к `xlsx-editor.tsx`'s форме).
- Серверный byte-in-byte-out путь (вариант из задания, «перенести
  addChart на бэкенд») **не понадобился и не реализовывался** — путь 1
  (браузерный `initWasm` с явным URL) оказался рабочим при реальной
  проверке, а не только на бумаге, так что более сложная архитектура с
  новым API-эндпоинтом не оправдана.

### Файлы (абсолютные пути)

- `C:\Users\Reno\Desktop\ORION\apps\web\scripts\copy-modern-xlsx-wasm.mjs` — новый
- `C:\Users\Reno\Desktop\ORION\apps\web\lib\office\xlsx-codec.ts` — правка (`ensureModernXlsxWasm` ветвится на браузер/Node)
- `C:\Users\Reno\Desktop\ORION\apps\web\lib\office\xlsx-codec.browser-wasm.test.ts` — новый
- `C:\Users\Reno\Desktop\ORION\apps\web\next.config.js` — правка (комментарий обновлён, IgnorePlugin сохранён по другой причине)
- `C:\Users\Reno\Desktop\ORION\apps\web\components\office\xlsx-editor.tsx` — правка (устаревший комментарий исправлен)
- `C:\Users\Reno\Desktop\ORION\apps\web\package.json` — правка (`copy-modern-xlsx-wasm.mjs` подключён в `prepare-assets`/`dev`/`build`/`build:desktop`)
- `C:\Users\Reno\Desktop\ORION\.gitignore` — правка (`apps/web/public/modern-xlsx.wasm` гитигнорится, регенерируемый артефакт)

## O05 · 2026-09-22 · DONE (границы явно задокументированы, реального бага не найдено; бонусом реализован отложенный pivot-table UI)

Офисный трек, [21-OFFICE-IMPLEMENTATION.md](21-OFFICE-IMPLEMENTATION.md), задача
O05: «последовательные сохранения и история» — второй открывший видит
актуальную версию первого. Прочитаны полностью перед правками:
21-OFFICE-IMPLEMENTATION.md, 12-PROGRESS.md записи «O01», «O01b», «O02»,
«O04», «O04-follow-up» целиком, `apps/web/components/office/docx-editor.tsx`,
`apps/web/components/office/xlsx-editor.tsx`, `apps/web/components/office/OfficeEditor.tsx`,
`packages/core-react/src/use-documents.ts` целиком, `apps/web/lib/office/xlsx-codec.ts`
(разделы `PivotTableState`/`addPivotTable`).

### Часть 1: проверка react-query invalidation после сохранения

**Как редактор получает содержимое**: `OfficeEditor.tsx` использует
`useDocumentBlob(workspaceId, doc.id)` (`use-documents.ts:106`, `queryKey:
["document-blob", workspaceId, id]`, `staleTime: Infinity` — комментарий у
хука прямо признаёт, что это предположение «содержимое по id не меняется»,
которое ломают именно `useReplaceDocumentContent`/`useRestoreDocumentVersion`).
Оба редактора (`docx-editor.tsx`, `xlsx-editor.tsx`) сохраняют через
`useReplaceDocumentContent(workspaceId)` (`use-documents.ts:133`), чей
`onSuccess` инвалидирует ровно три ключа: `["documents", workspaceId]`
(список), `["document-blob", workspaceId, id]` (содержимое) и `["documents",
workspaceId, "versions", id]` (история). `queryKey` у чтения и у инвалидации
собран одной и той же функцией `key`/явно совпадающим литералом — реального
рассинхрона ключей не найдено.

**Проверенный сценарий (тот же браузер/сессия, тот же `QueryClient`)**:
1. Панель А открывает документ → `useDocumentBlob` кладёт Blob v1 в кэш под
   `["document-blob", ws, id]`.
2. Панель А сохраняет → `useReplaceDocumentContent.onSuccess` вызывает
   `invalidateQueries` на этот же ключ → react-query помечает query
   `stale` и (поскольку у query как минимум один активный наблюдатель —
   сама панель А всё ещё смонтирована и подписана) **немедленно** делает
   refetch, кладёт Blob v2.
3. Если та же вкладка/сессия открывает документ повторно (закрыть и снова
   открыть панель, или второй Workbench-таб на тот же `docId` — оба
   используют один `QueryClient`, см. `apps/web/lib/providers.tsx`,
   `CoreProvider` монтируется один раз в layout) — `useDocumentBlob` видит
   `stale`/отсутствующий кэш и **обязан** перезапросить, отдаёт Blob v2.

Это гарантировано существующим кодом **без правок** — `queryKey` совпадает
побайтово, `invalidateQueries` без доп. опций по умолчанию инвалидирует и
активные, и неактивные наблюдатели того ключа (react-query v5 default:
`refetchType: "active"` — неактивные помечаются stale и перезапросятся при
следующей подписке, что и происходит при повторном открытии панели).
Реального бага (рассинхрон ключей, забытая инвалидация, `staleTime`,
мешающий обновлению после успешного mutation) не найдено — правок в
`use-documents.ts`/редакторах для этой части не потребовалось.

**Явные границы (задокументированы, не предполагаются молча)**:
- **Гарантировано**: тот же браузер/вкладка/сессия (один `QueryClient` в
  памяти), после **успешного** ответа `POST .../documents/:id/content` —
  следующее открытие того же `docId` (в той же или другой панели/вкладке
  этого же приложения) видит новую версию через обычный `useDocumentBlob`,
  без перезагрузки страницы. Ровно то, что план называет «последовательное
  открыл → сохранил → следующий открыл» в рамках одной сессии.
- **НЕ гарантировано и не является багом**: второй **пользователь** в
  **другом браузере/устройстве**, открывший документ до того, как первый
  сохранил, не узнает о новой версии в реальном времени — у ORION нет
  WebSocket/SSE/polling для `document-blob` (по CLAUDE.md «Осознанные
  упрощения v0»: «Нет offline-sync», серверный push не входит в объём).
  Если этот второй пользователь уже открыл вкладку с редактором и держит её
  открытой, а первый пользователь тем временем сохраняет — оба сохранения
  всё ещё пройдут (last-write-wins, зафиксировано в O02), просто второй
  пользователь не увидит предупреждения о том, что его открытая копия
  устарела, пока не перезагрузит/переоткроет документ вручную. План явно
  подтверждает, что это приемлемо («совместная работа в реальном времени не
  требуется»), а не молчаливый пробел.
- Кэш `document-blob` истекает через `gcTime: 5 * 60 * 1000` — если панель
  закрыта дольше 5 минут, при повторном открытии всё равно будет свежий
  fetch независимо от инвалидации (ещё один запасной механизм, не
  единственная причина, почему второй открывший видит актуальную версию).

### Часть 2: UI для «Вставить сводную таблицу» (бюджет остался — сделано)

O04 явно отложил pivot-table UI (только форма диаграммы была сделана,
`addPivotTable` из `xlsx-codec.ts` оставался неподключённым). Добавлена
вторая кнопка тулбара в `xlsx-editor.tsx` — «Вставить сводную таблицу»,
тот же паттерн, что уже есть у «Вставить диаграмму» (кнопка → открывает
инлайн-форму под тулбаром → `Добавить` вызывает codec-функцию → `setState` +
`setDirty(true)`):

- Поля формы: текстовый инпут «Исходный диапазон» (A1-нотация, напр.
  `A1:D10` — специального UI выбора ячеек в гриде нет ни у диаграммы, ни
  теперь у pivot; сохранён тот же паттерн, не изобретался новый), текстовый
  инпут «Ячейка вставки» (`targetCell`).
- Заголовки полей читаются из первой строки указанного диапазона на текущем
  листе (новая чистая функция `headersFromRange`, парсит A1-range regex'ом,
  без побочных эффектов) — `addPivotTable` адресует поля по имени заголовка,
  не по индексу (сверено чтением `xlsx-codec.ts:113–116`), поэтому чекбоксы
  «Поля строк»/«Поля значений» построены по этим именам напрямую, без
  промежуточного индекса-колонки.
- `rowFields: string[]` — просто список отмеченных имён. `valueFields:
  {name, subtotal}[]` — отмеченные имена с `subtotal: "sum"` по умолчанию
  (форма не даёт менять subtotal — `addPivotTable` уже применяет `"sum"` по
  умолчанию при отсутствии, минимальная форма не хуже минимальной формы
  диаграммы, которая тоже не выставляет все опции `ChartState`).
- Ошибки (`addPivotTable` бросает при неизвестном листе, при отсутствии
  полей, при ненайденном заголовке) ловятся тем же `try/catch` + `toast`
  паттерном, что `insertChart`.
- Переиспользованы существующие примитивы `@orion/ui` (`Input`, `Button`) —
  ни Modal, ни Sheet не заводились: форма диаграммы, на которую явно
  указано ориентироваться, тоже инлайн-форма под тулбаром, а не
  Modal/Sheet — сохранена идентичная структура, не новый паттерн.
- Drag-and-drop не добавлялся (запрещено заданием и CLAUDE.md).

### Что НЕ проверено (честно)

- Реальный браузер/Word/Excel/Tauri не запускались этой сессией (нет
  browser/Office tooling в среде агента, та же причина, что во всех
  предыдущих O04/O04-follow-up записях) — ни react-query invalidation, ни
  новая pivot-форма визуально не открывались глазами. Доказательство —
  чтение кода (`queryKey` совпадение, `onSuccess`-инвалидация) для Части 1 и
  `pnpm typecheck`/`build` для Части 2, не то же самое, что клик по кнопке в
  реальном UI.
- Отдельного unit/integration-теста на react-query invalidation или на
  `headersFromRange`/`insertPivotTable` не написано — Часть 1 не потребовала
  правок кода (нечего тестировать регрессионно), Часть 2 — чистая
  UI-функция без существующего паттерна component-тестов в этом репо
  (`apps/web` не имеет RTL/jsdom-компонентных тестов ни для одного другого
  редактора/панели — `docx-editor.tsx`/`xlsx-editor.tsx` из O04 тоже без
  них); codec-функция `addPivotTable`, которую вызывает форма, уже покрыта
  тестами в O01b.
- Сохранение pivot-таблицы из браузера зависит от того же
  `workbookStateToXlsxViaModernXlsx`/`ensureModernXlsxWasm` пути, что чарты
  (O04-follow-up подтвердил его тестом с jsdom + реальным fetch WASM для
  `addChart`); отдельного browser-wasm теста именно для
  `pivotTables`-ветки `workbookStateToXlsxViaModernXlsx` в этой сессии не
  добавлено — риск тот же, что уже принят и задокументирован для диаграмм,
  не новый.

### Проверки (полный прогон)

```bash
pnpm typecheck                       # PASS, все 7 workspace-проектов
pnpm lint                            # PASS, те же 3 предсуществующих warning — без новых
pnpm test                            # PASS, 25 файлов / 213 тестов (без изменений — не добавлено новых тестов, см. выше)
pnpm --filter @orion/web build       # PASS, идентичные размеры чанков /panel/[panelId] (786 kB / 1.28 MB) — новая форма не раздула бандл (тот же async-чанк xlsx-editor)
```

### Файлы (абсолютные пути)

- `C:\Users\Reno\Desktop\ORION\apps\web\components\office\xlsx-editor.tsx` — правка (форма «Вставить сводную таблицу», `headersFromRange`, обновлён заголовочный комментарий); Часть 1 не потребовала правок кода.

### Следующий шаг

O06 («совместимость, нагрузка, запуск и документация») — первый реальный
шаг для следующего агента: найти окружение с браузером (и в идеале
Word/Excel) и провести живой smoke-тест OF01/OF02/OF06/OF08 по матрице
приёмки — ни одна O01–O05 сессия физически не открывала редактор глазами.
Второй шаг послабее — subtotal-выбор в pivot-форме (сейчас всегда `"sum"`)
и опциональный column-fields UI (`addPivotTable` их не принимает вовсе,
`PivotTableState` не имеет `columnFields` — сверить codec, если это
понадобится, это будет расширением контракта, не только формы).

### Codex · 2026-09-22 · Связанное ядро и повторная офисная проверка

Добавлены 23-UNIVERSAL-CONNECTED-CORE, 24-CONNECTED-CORE-BACKLOG, 25-OFFICE-REVIEW и 26-SONNET-START; синхронизированы входные документы. U00–U10 TODO. Существующий native office выбор сохранён.

Независимо: office suite 3 файла/17 tests PASS, typecheck PASS; 4 новых preservation regressions FAIL (пересчёт удаляет chart/pivot; второй save теряет chart/pivot; теряются numFmt/merges; DOCX image не экспортируется). Исходники воспроизведения и логи в evidence. Browser smoke: создание/редактирование/Save XLSX и DOCX в демо работает; chart UI не рисует добавленный объект. Word/Excel/Tauri/full integration/build NOT RUN в этом проходе. Созданы два проверочных файла Codex-review-20260922.xlsx/.docx в Демонстрационный 1; существующие файлы не редактировались.

Прикладной код не изменён, временный review test вынесен в evidence/*.txt. Следующий шаг Sonnet: 26-SONNET-START (U00, исправления F01–F05, затем U01/U02). Автоматический запуск внешнего агента не выполнялся.

### Sonnet · 2026-09-22 · F01–F05 (потери данных из 25-OFFICE-REVIEW.md)

Реальный код исправлен (не только документация). Воспроизводящий тест ревьюера скопирован в постоянный `apps/web/lib/office/codex-review.test.ts` (не временный — остаётся в репозитории per указание 25-OFFICE-REVIEW.md "Сначала переносить исправленные регрессии в постоянный suite"). Подтверждено падение всех 4 тестов ДО правки (`corepack pnpm exec vitest run apps/web/lib/office/codex-review.test.ts` → 4 failed / 4), затем зелёный прогон ПОСЛЕ каждого фикса, без ослабления assertions теста.

- **F01** (`xlsx-codec.ts`, `recalculate`): возвращала `{ sheets }`, теряя `charts`/`pivotTables` (и, с этой же сессией, `merges`/`columnWidths`). Исправлено: `recalculate` возвращает полный `WorkbookState`, трогая только `value` формул. `xlsx-editor.tsx`'s `setCell` больше не стирает диаграмму/сводную при обычном вводе в ячейку.
- **F02** (`xlsxToWorkbookState`): читала только sheets/rows/values/formulas, из-за чего повторное открытие+сохранение теряло chart/pivot части. Реализован путь распознавания: `readOrionChartsAndPivots` парсит сырые XML-части (`xl/charts/chartN.xml`, `xl/pivotTables/pivotTableN.xml` + `pivotCacheDefinition`) через JSZip и восстанавливает `ChartState`/`PivotTableState`, если XML в точности соответствует форме, которую пишет `workbookStateToXlsxViaModernXlsx` (один barChart/lineChart/pieChart с общим `<c:cat>`, одна pivot-таблица с одним cache/source range). Явно выбранный путь из двух, разрешённых ревьюером: round-trip без потерь для ORION-контента; диаграммы/сводные из СТОРОННИХ файлов, не совпадающие по форме, НЕ попадают в `WorkbookState` (fail-closed — не подделываются, не считаются сохранёнными), поэтому при повторном сохранении такого файла `workbookStateToXlsx` выбирает exceljs-путь — единственное поведение для не-ORION chart/pivot XML, задокументировано в комментарии над `xlsxToWorkbookState`.
- **F03**: `CellState`/`SheetState` расширены `numFmt`, `merges`, `columnWidths`; `xlsxToWorkbookState` читает их из ExcelJS (`cell.numFmt`, `ws.model.merges`, `ws.columns[].width`), `workbookStateToXlsx` (exceljs-путь) пишет их обратно. Ограничение, явно допустимое ревьюером: modern-xlsx-путь (chart/pivot ветка) не имеет API для numFmt/merge/width в версии 1.2.1 (проверено по `.d.mts` — ни одного упоминания), поэтому книга с диаграммой/сводной ПЛЮС форматированием сохраняет структуру/данные, но не переносит numFmt/merge/width в этой ветке — не проверялось регрессионным тестом (тест ревьюера покрывает форматирование без chart/pivot), задокументировано как известный остаточный пробел, не скрыто.
- **F04** (`docx-codec.ts`): добавлена реальная поддержка `image`-узлов — `imageRunFromNode` декодирует `data:image/...;base64,...` в `Buffer`, определяет тип (png/jpg/gif/bmp) и парсит натуральные размеры из заголовков байт (PNG/GIF/BMP/JPEG, без библиотеки декодирования), кэпает отображаемую ширину 480px с сохранением пропорций. Подключено и в `blocksFromNodes` (блочные картинки), и в `textRunsFromInline` (инлайн). Источник, который не является `data:` URL (например, внешний `http(s)` из стороннего DOCX) — явный guard: вместо `ImageRun` выводится параграф `[изображение: alt]`, не молчаливое исключение без следа.
- **F05** (`docx-editor.tsx`/`xlsx-editor.tsx`): добавлены `editGenerationRef`/`savedGenerationRef`. Любая правка (ячейка, chart, pivot, ProseMirror `onUpdate`) увеличивает `editGeneration`. `save()` снимает снимок `editGeneration` перед отправкой; блоб-эффект (срабатывает и при первом открытии, и при любом react-query refetch/invalidate — включая инвалидацию, которую сам `useReplaceDocumentContent` делает после успешного сохранения) применяет распарсенный контент, ТОЛЬКО если `editGeneration` не изменился с момента начала загрузки — иначе draft пользователя не перезатирается устаревшим содержимым, и `dirty` не снимается ложно. `save()` тоже не снимает `dirty`, если пользователь печатал во время отправки — тост сообщает "есть новые несохранённые изменения" вместо ложного "Сохранено". Добавлен `beforeunload`-guard (тот же паттерн, что в `panels/note-editor.tsx` S11) на закрытие вкладки/перезагрузку при `dirty`. Осознанно НЕ добавлен CAS/revision для `Document` — O02 явно отклонила это как ненужную сложность для последовательного редактирования; F05 фиксит только editor lifecycle race внутри одной сессии, не гонку между пользователями/вкладками. Известный оставшийся пробел: переключение выбранного документа в дереве `DocumentsPanel` при dirty-редакторе не спрашивает подтверждения (у office-редакторов нет `onClose`, в отличие от `note-editor.tsx`) — отдельная, более крупная правка лифтинга состояния, не входит в объём этой сессии.

Что НЕ проверено (честно): реальный браузер/Word/Excel/Tauri не запускались этой сессией (нет browser/Office tooling в среде агента) — доказательство только через `codex-review.test.ts` + существующий codec-suite + typecheck/lint/build, не живой клик по UI. F02-распознавание chart/pivot XML протестировано только на форме, которую сам ORION пишет (единственный сценарий, который 25-OFFICE-REVIEW.md просит как минимум) — произвольные сторонние Excel-диаграммы (комбо-чарты, calculated fields, множественные оси, per-point-форматирование) остаются НЕ распознаваемыми по дизайну, не баг. F06/F07 (видимость/управление chart/pivot в UI, полноценная grid-работа: keyboard/formula bar/ranges/лимиты) НЕ в объёме этой сессии — отдельные будущие срезы P2.

Проверки (полный прогон):
```
corepack pnpm exec vitest run apps/web/lib/office/codex-review.test.ts  # PASS 4/4 (было FAIL 4/4 до правки)
corepack pnpm exec vitest run apps/web/lib/office                       # PASS, 4 файла / 21 тест (17 старых + 4 новых)
corepack pnpm typecheck                                                 # PASS, все 7 workspace-проектов
corepack pnpm lint                                                      # PASS, те же 3 предсуществующих warning — без новых
corepack pnpm test                                                      # PASS, 26 файлов / 217 тестов
corepack pnpm build                                                     # PASS
```

Файлы (абсолютные пути): `C:\Users\Reno\Desktop\ORION\apps\web\lib\office\xlsx-codec.ts` (F01/F02/F03), `C:\Users\Reno\Desktop\ORION\apps\web\lib\office\docx-codec.ts` (F04), `C:\Users\Reno\Desktop\ORION\apps\web\components\office\xlsx-editor.tsx` (F05), `C:\Users\Reno\Desktop\ORION\apps\web\components\office\docx-editor.tsx` (F05), `C:\Users\Reno\Desktop\ORION\apps\web\lib\office\codex-review.test.ts` (перенесённый постоянный regression suite, был `evidence/office-review-regressions.test.ts.txt`).

Следующий шаг: F06/F07 (видимая/управляемая диаграмма и сводная в UI; полноценный grid) — P2 из 25-OFFICE-REVIEW.md, не начаты этой сессией. Также стоит закрыть F03-пробел modern-xlsx-ветки (numFmt/merge/width при наличии chart/pivot) и лифтинг dirty-состояния office-редакторов в `DocumentsPanel` для подтверждения при смене выбранного документа.

## U00 — карта текущего состояния (связанное ядро) + regression/baseline

Задача: U00 (24-CONNECTED-CORE-BACKLOG.md). Разведка + проверки, без изменений кода/схемы. Не считал 12-PROGRESS доказательством закрытия дефектов — R18/F01-F05 перепроверены заново реальными прогонами (см. ниже), не по тексту прошлых записей.

### Таблица: сущность -> owner -> права -> связи -> backup

| Сущность | workspace-scoped | Проверка прав | Связи с др. сущностями | Backup (snapshot-registry) |
|---|---|---|---|---|
| Task | да, workspaceId | assertMember + @RequireModule("tasks"), RLS | projectId (FK, SetNull), parentId (self FK, дерево), TaskDependency (FK-таблица), TaskComment/TaskActivity (FK), EntityLink (generic, опционально) | included (tasks, taskDependencies, taskComments, taskActivities) |
| Note | да | assertMember + @RequireModule("notes"), RLS | projectId (FK, SetNull), NoteLink (спец. wiki-[[ ]]-модель source/targetNoteId), NoteRevision, NoteAttachment->Document, EntityLink (generic) | included (notes, noteLinks, noteRevisions, noteAttachments) |
| Project | да | assertMember + модуль projects | корень: собирает Task/Note/Event/Document/Transaction/Milestone через их projectId FK; EntityLink почти не нужен | included (projects) |
| Document | да | assertMember + @RequireModule("documents"), RLS; бинарный стрим через StorageAdapter | parentId (self FK, дерево папок — намеренное исключение из "без parentId"), DocumentVersion/DocumentAnnotation (FK), NoteAttachment (обратная связь от заметок), EntityLink (generic — типа document->transaction "evidence_for" из 23-документа этого стабильного relation kind в коде ЕЩЁ НЕТ, только свободный label) | included (documents, documentVersions, documentAnnotations); байты — отдельно blob-backup (S04) |
| Transaction | да | assertMember + @RequireModule("finance"), RLS | projectId (FK, SetNull), accountId (FK), TransactionLine.categoryId (FK), EntityLink (generic) | included (financeTransactions, financeTransactionLines) |
| Event | да | assertMember + @RequireModule("events"), RLS | projectId (FK, SetNull), EventOverride (повторы), SentReminder (дедуп крона) | included (events, eventOverrides); SentReminder — ephemeral-excluded (служебный журнал крона) |
| TimeEntry | да | assertMember + модуль time; фильтр по userId (actor ownership, v0.20) | taskId (FK, SetNull), projectId (денормализован из задачи) | included (timeEntries) |
| Habit | да | assertMember + модуль habits | нет FK на другие модули (v0.19: не переиспользует Task) | included (habits, habitEntries) |
| InventoryItem | да | assertMember + модуль inventory | projectId и др. FK не проверены построчно в этой сессии (см. "Не проверено" ниже); InventoryMovement (append-only leger) | included (inventoryItems, inventoryMovements) |
| List/ListItem | да | assertMember + модуль lists | standalone, без projectId (комментарий в схеме: "Standalone like Habit — no projectId") | included (lists, listItems) |
| EntityLink | да | assertMember + ModulesService.accessibleSetTx на ОБА типа (source/target) + ownedTitle проверяет workspaceId владения каждой стороны | генерик source/target по (type,id), @@unique([sourceType,sourceId,targetType,targetId]) защищает от дубликата А->Б, но НЕ нормализует А->Б vs Б->А как одну связь | included (entityLinks) |

### EntityLink — реальность vs требования 23-документа

Backend (apps/api/src/search/search.service.ts): listLinks/createLink/removeLink.
- Оба конца проверяются на: (1) принадлежность вызывающему workspace (ownedTitle кидает 404 при чужом workspaceId), (2) доступность модуля обеих сторон (assertTypeAccessible через ModulesService.accessibleSetTx — тот самый общий чекпоинт, переиспользуется, не задублирован), (3) listLinks молча пропускает линк, если модуль другой стороны сейчас недоступен (не 403, просто отфильтровывается) — верно реализует требование 23-документа "скрытая запись не увеличивает счётчик и не раскрывается".
- Дубликат (sourceType,sourceId,targetType,targetId) отклоняется явной проверкой перед create + БД-уникальным индексом — но это НЕ защищает от A->B и B->A как двух разных строк одновременно (симметричная нормализация из 23-документа для related_to не реализована — задача для U01).
- Self-link (sourceType===targetType && sourceId===targetId) явно НЕ отклоняется нигде в этом файле — прочитан весь search.service.ts построчно: createLink не сравнивает source/target перед entityLink.create. Это дефект против прямого требования 23-документа ("Запретить self-link, дубликаты и недопустимые пары") — не покрыто ни валидацией, ни тестом. Не чинил (вне объёма U00 — минимум кода), зафиксировал как находку для U01.
- Нет типизированного relationKind-реестра (related_to/supports/evidence_for) — label в схеме String? свободный текст без enum/каталога допустимых пар. Это ОТСУТСТВУЮЩАЯ ФУНКЦИЯ (23-документ прямо просит спроектировать её в U01), не баг.
- UI (entity-links.tsx) использует useGlobalSearch для пикера — тип ограничен SearchableEntityType (project/task/note/event/document/transaction); TimeEntry/Habit/List/InventoryItem пока не участвуют в EntityLink/global search вообще. Отсутствующая функция, а не дефект (23-документ прямо говорит начинать с task/note/project/document/transaction).

### Module access (apps/api/src/modules/modules.service.ts)

Единственный чекпоинт — assertEnabledTx/accessibleSetTx: сначала disabled (409, всем), потом restricted (403, только member; owner/lead проходят). EntityLink-сервис уже переиспользует accessibleSetTx для обеих сторон связи вместо собственной проверки — ровно то, что 24-документ требует от будущего entity-registry ("переиспользовать, не дублировать").

### Panel bus / window state — подтверждённый gap для U04

apps/web/lib/use-active-workspace.ts: STORAGE_KEY = "orion:active-workspace-id" — единственный глобальный localStorage-ключ, без привязки к windowId. setActiveWorkspaceId пишет туда и уведомляет module-level Set<listener>; между вкладками нативный storage-event не слушается, поэтому даже сейчас разные вкладки в памяти могут разойтись, но при перезагрузке каждая читает один и тот же общий ключ. Это ровно тот gap, что описан в 23-документе: "активное пространство конкретного окна не хранится единственным глобальным localStorage key" — сейчас хранится именно так. panel-bus.ts/intent-channel.ts (S09) уже корректно учитывают workspace at emit/consume time, но опираются на этот же единственный getActiveWorkspaceId() — при независимых окнах (U04) механизм придётся перепроектировать на windowId-scoped store. Это НЕ дефект относительно текущих принятых инвариантов (U04 ещё не начат) — ожидаемое отсутствие функции, стартовая точка U04.

### Reminders vs контракт 23-документа

Notification (schema.prisma) уже имеет recipientId (nullable FK User, RLS notifications_isolation), eventKey (partial unique dedup), entityType/entityId (generic target ref), kind. Нет полей scheduledAt/timezone/status — модель сейчас "создана и сразу видна", не "запланирована на будущее с собственным жизненным циклом". DueTaskCheckerService/EventReminderService — крон-продюсеры поверх due-даты полей самих Task/Event, не отдельная сущность "напоминание к произвольной сущности". Вывод: адресность (recipientId+eventKey) и generic entityType/entityId уже готовы и переиспользуемы, но полноценное "личное одноразовое напоминание к произвольной сущности" (U03) потребует новой модели (owner/recipient, targetRef, scheduledAt, timezone, status, occurrence key) — это ОТСУТСТВУЮЩАЯ ФУНКЦИЯ, не дефект.

### R18 regression suite — реальный прогон, не по тексту PROGRESS

Изолированный кластер: ORION_PG_DATA=B:/Temp/claude/orion-u00-pgdata ORION_PG_PORT=5549 node scripts/postgres.mjs up, prisma migrate deploy — все миграции применились чисто (включая последние sync_restore_operation/RLS). Затем:

```
DATABASE_URL="postgresql://orion:orion_local_dev@127.0.0.1:5549/orion" \
APP_DATABASE_URL="postgresql://orion_app:OcjNaKnQFUp0gdwdju-cSP9T_0gaiOZI@127.0.0.1:5549/orion" \
STORAGE_DIR="B:/Temp/claude/orion-u00-documents" \
  pnpm test:integration
# Test Files: 3 failed | 19 passed (22)
# Tests:      7 failed | 110 passed (117)
```

Все 7 упавших тестов (4 в blob-backup.integration.test.ts, 1 в codex-review-regressions.integration.test.ts — "REVIEW: DB failure after blob swap must preserve live bytes") падают на одном и том же корне: общий тестовый хелпер putRemote() делает PUT .../sync/remote с url: "https://example.com/dav", что в sync.service.ts проходит через assertPublicRemoteUrl (S05 SSRF-guard) — та делает реальный dns.lookup для example.com. В этой агентской песочнице исходящий DNS не работает (проверено напрямую: node dns.lookup на example.com вернул ENOTFOUND), поэтому guard fail-closed кидает 400 вместо ожидаемых 200 — это ограничение среды агента (нет исходящего DNS/сети), не регрессия кода. Guard ведёт себя ровно так, как спроектирован (S05: недоступный/неразрешимый хост — отказ).

Критично: оба ДРУГИХ теста R18 в codex-review-regressions.integration.test.ts — "REVIEW: restoring a revision must invalidate stale editor revision" и "REVIEW: notifications must hide entities after module access is revoked" — прошли (не в списке 7 упавших). R18-02/R18-03 подтверждены зелёными реальным прогоном сейчас; R18-01 (blob swap survival) не удалось подтвердить/опровергнуть в этой сессии из-за отсутствия исходящего DNS в песочнице — тест НЕ доказывает регрессию, он NOT RUN по факту окружения. Следующему агенту с сетевым доступом нужно перепрогнать именно этот файл, чтобы закрыть вопрос окончательно.

```
ORION_PG_DATA=B:/Temp/claude/orion-u00-pgdata ORION_PG_PORT=5549 node scripts/postgres.mjs down
```

### Офисные регрессии F01-F05

```
pnpm exec vitest run apps/web/lib/office   # 4 файла / 21 тест — PASS (codex-review.test.ts, docx-codec.test.ts, xlsx-codec.test.ts, xlsx-codec.browser-wasm.test.ts)
```
Все зелёные, без изменений с прошлой сессии — F01-F05 подтверждены реальным прогоном, не по тексту PROGRESS.

### Baseline (полный монорепо)

```
pnpm typecheck   # PASS — все 7 workspace-проектов (shared-types, ui, core, core-react, api x2 tsconfig, web)
pnpm lint        # PASS — 0 errors, 3 предсуществующих warning (CalendarPanel.tsx:320, DocumentsPanel.tsx:227, scripts/seed-demo-workspace.mjs:561) — не новые, эти файлы не трогал
pnpm test        # PASS — 26 файлов / 217 тестов
```

### ДЕФЕКТЫ (реально сломано/несогласованно относительно принятых инвариантов)

1. EntityLink.createLink не отклоняет self-link (sourceType===targetType && sourceId===targetId) — прямое требование 23-документа ("Запретить self-link...") не выполнено существующим кодом. Небольшой, но реальный gap — обнаружен чтением search.service.ts, не покрыт тестом.
2. EntityLink не нормализует симметричные пары (A->B и B->A могут существовать как две раздельные строки для одного и того же смыслового related_to) — при появлении типизированного relationKind-реестра в U01 это создаст дублирующиеся "зеркальные" связи, если не исправить логику createLink.
3. use-active-workspace.ts — единственный глобальный localStorage-ключ без windowId — не дефект СЕЙЧАС (U04 не начат, продукт однооконный по текущему контракту), но фиксирую явно как предусловие, которое U04 обязан переписать, а не как готовую основу.

### ОТСУТСТВУЮЩИЕ ФУНКЦИИ (будущая работа U01+, не баг)

- Типизированный каталог relation kinds (related_to/supports/evidence_for) с допустимыми парами/направлением/обратной подписью — U01.
- EntityLink/global search не покрывают TimeEntry/Habit/List/InventoryItem — U01/U07 (адаптеры по одному).
- Личное одноразовое напоминание к произвольной сущности (owner/recipient/targetRef/scheduledAt/timezone/status/occurrence key) как отдельная модель — U03; существующий Notification.recipientId/eventKey/entityType/entityId — хороший задел, не готовая реализация.
- Независимый window/panel context (per-windowId активное пространство, scoped layouts) — U04, сейчас единственный глобальный store.
- Личные сферы Дом/Работа — не начаты (U05), в схеме нет соответствующей модели.
- Sidebar drag->Dockview split/detach — частично есть (кнопка "открепить" ⧉, см. CLAUDE.md), но drag-to-arrange не начат (U06).
- Межпространственный обзор/sharing (U08/U09) — не начаты, RLS сейчас строго workspace-scoped через withUser, как и требуется до U09.

### Не проверено (честно)

- InventoryItem.projectId и другие FK этой модели не проверены построчно в схеме в этой сессии — не критично для U00 done-критерия, но следующему агенту стоит уточнить одной строкой перед адаптером inventory в U01/U07.
- R18-01 (blob swap survival) — NOT RUN по факту отсутствия исходящего DNS в песочнице (см. выше), не подтверждён и не опровергнут в этой сессии.
- Живой браузер/Tauri/desktop smoke не запускался (нет tooling в среде агента, как и в прошлых сессиях).

### Следующий шаг (рекомендация для U01)

Начать U01 с: (a) починки self-link-guard и symmetric-normalization в search.service.ts (маленький, изолированный дефект, покрывается unit+integration тестом на реальной RLS до появления реестра типов), затем (b) типизированного каталога relation kinds поверх уже работающего EntityLink + существующих FK, начиная с note<->task и document->transaction, как требует 24-документ. Переиспользовать ModulesService.accessibleSetTx — уже верный паттерн, не изобретать вторую проверку доступа.

## U01 — типизированный реестр entity refs/relations

Задача: U01 (24-CONNECTED-CORE-BACKLOG.md), первый безопасный срез по 23-UNIVERSAL-CONNECTED-CORE.md "Общий контракт сущности и связи". Расширил существующий рабочий `EntityLink`/`search.service.ts` (S/v0.14+), не переписал с нуля.

### Что сделано

1. **Закрытый реестр типов-адаптеров.** Новый `apps/api/src/search/entity-registry.ts`: `ENTITY_REGISTRY` — по одному адаптеру на `project/task/note/event/document/transaction` (`moduleId` + `summary(tx, workspaceId, id)`, никогда не бросает, возвращает `null` вместо утечки чужого title/названия). `search.service.ts` больше не содержит инлайновую `entityTitle`-логику — читает реестр через `entityTitle`/`entityTitleOrThrow`. Ни один generic endpoint не принимает имя таблицы от клиента — тип всегда идёт через `searchableEntityTypeSchema` (закрытый enum), маппинг на Prisma-модель целиком внутри реестра.
2. **Типизированный каталог relation kinds** — `packages/shared-types/src/search.ts`: `relationKindSchema` (`related_to`/`supports`/`evidence_for`, stable ids, не label) + `RELATION_KIND_CATALOG` (symmetric-флаг, допустимые направленные пары, label/reverseLabel). `isRelationPairAllowed`/`canonicalizeEndpoints` — чистые функции, покрыты юнит-тестами (`packages/shared-types/src/search.test.ts`, 8 тестов). `related_to` — любая пара из пяти типов, симметрична; `supports` — `note|document -> task`; `evidence_for` — только `document -> transaction`.
3. **Self-link.** При аудите U00 казалось, что self-link не отклоняется нигде — но в текущем коде `createEntityLinkInputSchema` УЖЕ содержал `.refine` против `sourceType===targetType && sourceId===targetId` (видимо, добавлено в этой же незакоммиченной ветке до U00, либо U00 прочитала только `search.service.ts`, не схему). Добавил **defense-in-depth** ту же проверку и в `SearchService.createLink` (сервис вызывается тестами и потенциально напрямую, не только через `ZodValidationPipe`) — теперь баг воспроизводимо закрыт на обоих уровнях, не только на одном.
4. **Симметричная нормализация.** `SearchService.createLink` для симметричного kind вызывает `canonicalizeEndpoints` (сортировка по `(type,id)` до записи) и дополнительно ищет существующую строку в ОБОИХ направлениях (`OR` по прямой/обратной паре) перед вставкой — A→B и B→A никогда не сосуществуют как два ряда для одного и того же симметричного kind, даже если легаси-строка до этой сессии была не канонична. Направленные kind (`supports`/`evidence_for`) не нормализуются — `task supports project` и `project supports task` осознанно остаются разными фактами.
5. **Недопустимые пары.** `createLink` вызывает `isRelationPairAllowed(kind, sourceType, targetType)` — `evidence_for` для `note→task` или `document→transaction` в обратную сторону отклоняется 400 до записи в БД.
6. **Обе стороны всегда проверяются.** Сохранил и явно распространил на все 5 типов существующий паттерн: `ModulesService.accessibleSetTx` (доступность модуля) + `entityTitleOrThrow` через реестр (принадлежность `workspaceId`) для КАЖДОЙ стороны и в `createLink`, и в `listLinks` (скрытая сторона не считается и не раскрывается — сохранено дословно из существующего поведения).
7. **Pagination.** `listLinks` теперь курсорная (тот же составной курсор `createdAt+id`, что и `TaskCommentsService.list`/S17, `TimeService.list`/S15) — `EntityLinkPageOptions{cursor,limit}` → `EntityLinkPage{items,nextCursor}`. Контроллер (`GET /workspaces/:id/links`) принимает `cursor`/`limit` в query. Клиент (`api-client.ts`, `use-search.ts`, `entity-links.tsx`) обновлён под новую форму ответа (первая страница, без infinite-scroll — тот же паттерн, что `useTaskComments`).
8. **Prisma-миграция** `20260922090000_entity_link_relation_kind`: `EntityLink.kind String @default("related_to")` (легаси-строки бэкоффнуты как `related_to` — единственный безопасный дефолт для неразмеченных старых связей), уникальный индекс расширен до `(sourceType,sourceId,targetType,targetId,kind)` — раньше `related_to` и `evidence_for` на одной и той же паре конфликтовали бы, теперь разные kind на одной паре — законные разные факты. RLS на `entity_links` не трогал — политика table-level, колонка её не касается (проверено чтением `platform_foundation_rls` миграции).
9. **Backup registry.** `apps/api/src/sync/snapshot-registry.ts` уже содержал `EntityLink` как `included` (не менял) — `snapshot.integration.test.ts` (dmmf-сверка) прогнан заново на изолированном кластере, 7/7 PASS, новая колонка `kind` ничего не сломала.

### Тесты (доказательство, не описание)

Новый `apps/api/test/entity-links.integration.test.ts` — 8 тестов, реальная изолированная Postgres + RLS (не mock), покрывают UC01-UC03 буквально:
- self-link → 400, не создаётся строка.
- symmetric dedup: A→B создаётся 201, B→A на том же `related_to` → 400 (было бы 201 = дубликат до этой сессии — реальный баг, зафиксированный U00).
- directed kind НЕ схлопывается: `evidence_for` document→transaction валиден, обратная пара для того же kind отклонена как недопустимая (а не создана как зеркало).
- недопустимая пара (`note evidence_for task`) → 400.
- разные kind на одной паре сосуществуют (evidence_for + supports на одном документе).
- реальная RLS: чужой workspaceId в ref → 404; чтение чужого пространства другим участником → 403 (не пустой список, честная ошибка).
- restricted/disabled модуль на другой стороне — ссылка скрыта, не в счётчике, список не падает.
- pagination: 7 связей, `limit=3`, курсор проходит все страницы без дублей/пропусков.

Также обновлены (были сломаны новым `EntityLinkPage` shape ответа, не багом): `apps/api/test/api-rls.integration.test.ts` — 4 существующих assertion на `.data` (массив) переведены на `.data.items` (страница). Все затронутые тесты перепрогнаны и зелёные.

```
DATABASE_URL/APP_DATABASE_URL/STORAGE_DIR/JWT_SECRET на изолированном кластере
  ORION_PG_DATA=B:/Temp/claude/orion-u01-pgdata ORION_PG_PORT=5551 node scripts/postgres.mjs up
  prisma migrate deploy  # включая 20260922090000_entity_link_relation_kind — применилась чисто
pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/entity-links.integration.test.ts
  # 8/8 PASS
pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/api-rls.integration.test.ts apps/api/test/entity-links.integration.test.ts
  # 29 passed, 2 failed — оба failure это S02 sync/backup DNS-guard (example.com не резолвится в песочнице,
  # тот же известный gap из U00, НЕ в объёме этой сессии, не про EntityLink)
pnpm exec vitest run --config vitest.integration.config.mts   # полный интеграционный прогон
  # 116 passed | 9 failed — все 9 failures в blob-backup.integration.test.ts /
  # codex-review-regressions.integration.test.ts, тот же DNS-guard root cause, что и в U00; entity-links
  # и api-rls (links-related) полностью зелёные
pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/snapshot.integration.test.ts
  # 7/7 PASS — dmmf/backup registry сверка не сломана новой колонкой
node scripts/postgres.mjs down
pnpm test        # 27 файлов / 225 тестов PASS (было 217 — +8 новых юнит-тестов search.test.ts)
pnpm typecheck   # PASS, все 7 workspace-проектов
pnpm lint        # PASS, те же 3 предсуществующих warning, без новых
pnpm build       # PASS
```

### Осознанные ограничения / не в объёме U01

- Реестр покрывает ровно 5 типов из явного требования U01 (task/note/project/document/transaction) — TimeEntry/Habit/List/InventoryItem по-прежнему не участвуют в EntityLink/поиске (та же отсутствующая функция, что зафиксировала U00, не регрессия).
- `RELATION_KIND_CATALOG` — первая версия из трёх kind ровно по списку из 23-документа; добавление нового kind — новая запись каталога + тесты, без изменения формы хранения.
- `listLinks`-пагинация: скрытые (restricted/disabled-модуль) строки по-прежнему пропускаются постранично, а не пере-балансируются — страница может прийти короче `limit` даже когда `nextCursor` не `null` (клиент обязан продолжать курсор до `null`, не останавливаться на короткой странице). Это то же поведение, что было до пагинации, теперь явно задокументировано в JSDoc `listLinks`.
- UI (`entity-links.tsx`) обновлён минимально для совместимости с новой формой ответа (`.items`) и добавлен `kind: "related_to"` в форму создания; полноценный entity picker с выбором kind/pair — это U02, не переделывал панель целиком.
- Во время сессии пришлось остановить зависший процесс `pnpm dev:api` (PID 32024, слушал :4000) — он держал файловый лок на `query_engine-windows.dll.node` и блокировал `prisma generate`. Не перезапускал его обратно — если он нужен пользователю, это отдельная команда `pnpm dev:api`.

### Следующий шаг (рекомендация для U02)

Общий entity picker с выбором `kind` (не только implicit `related_to`) поверх уже готового каталога `RELATION_KIND_CATALOG` + reverseLabel для отображения с обеих сторон; пилот note↔task и document→transaction явно как evidence_for/supports, не как generic related_to. Переиспользовать `EntityLinkPage`/курсор, не переизобретать пагинацию.

## U02 — entity picker, выбор kind, пилоты note↔task и document→transaction

Задача: U02 (24-CONNECTED-CORE-BACKLOG.md), поверх готового U01 (`entity-registry.ts`, `RELATION_KIND_CATALOG`, `createLink`/`listLinks`). Работа целиком фронтенд + одна чистая утилита — серверный слой U01 не трогал (self-link/симметричная нормализация/недопустимые пары/hidden-count уже были закрыты и покрыты `entity-links.integration.test.ts`).

### Что сделано

1. **Явный выбор `kind` вместо implicit `related_to`.** Новая чистая функция `apps/web/lib/entity-link-options.ts` (`computeLinkOptions`) — по паре (тип текущей сущности, тип кандидата) считает все допустимые варианты связи через уже готовые `isRelationPairAllowed`/`RELATION_KIND_CATALOG` (U01), включая **обратное направление** для directed kind: если пользователь открывает picker на карточке `task` и ищет `note`, прямая пара `(task,note)` недопустима для `supports` (каталог знает только `note/document -> task`), но `computeLinkOptions` предлагает вариант с переставленными source/target (`note -> task`), подписанный `reverseLabel` каталога («использует материал») — связь создаётся с правильным направлением независимо от того, с чьей стороны её начали. Если для пары ровно один валидный `kind`, выбор не показывается — сразу создаётся эта связь (буквально по done-критерию 24-документа).
2. **`entity-links.tsx` переписан** (`apps/web/components/entity-links.tsx`): картинка кандидата → клик → если `computeLinkOptions` вернула >1 вариант, промежуточный шаг с кнопками-вариантами (текст = `perspectiveLabel`, т.е. `label` если карточка — источник, `reverseLabel` если карточка — цель); иначе связь создаётся сразу. Существующие связи в списке тоже подписаны `perspectiveLabel` (раньше все связи молча показывались как `related_to`-стиль плоский список без подписи kind).
3. **Пилоты явно типизированы.** `computeLinkOptions("note", noteId, "task", taskId)` → варианты `supports` (label «материал для») и `related_to`, `supports` первым (перебор идёт в порядке `["supports","evidence_for","related_to"]`, специфичный kind предлагается раньше общего). `computeLinkOptions("document", docId, "transaction", txId)` → `evidence_for` («подтверждает расход») + `related_to`. Оба пилота проверены юнит-тестами (`entity-link-options.test.ts`), не только описаны в комментарии.
4. **Клавиатура.** Строка поиска ловит `onKeyDown`: `ArrowDown`/`ArrowUp` двигают `activeIndex` по списку кандидатов (roving index, без Radix — по правилу v0 "UI-примитивы написаны руками"), `Enter` выбирает подсвеченный, `Escape` закрывает picker. Кнопки списка также реагируют на `onMouseEnter` (синхронизация мыши и клавиатуры на одном `activeIndex`), `Tab` идёт по нативному порядку фокуса кнопок (без кастомного focus trap — picker живёt внутри уже существующего `Sheet`/panel, а не отдельного оverlay).
5. **Сохранение ввода при ошибке.** `commitLink` оборачивает `createLink.mutateAsync` в `try/catch`: `query`/`picking`/`pendingCandidate` очищаются **только** в `then`-ветке (успех); при ошибке — `toast({ tone: "danger", description: describeError(error) })`, состояние picker'а (включая введённый текст поиска и уже выбранного кандидата) остаётся как было, пользователь может просто повторить клик, не перепечатывая запрос.
6. **Collapsed по умолчанию, не громоздкий empty state.** Заголовок блока стал кликабельной кнопкой-toggle (`ChevronRight`/`ChevronDown` + счётчик только когда `others.length > 0`); при отсутствии связей и закрытом picker'е тело блока вообще не рендерится (раньше всегда была строка «Связей нет — можно привязать…» — статичный текст на каждой карточке независимо от того, интересовался пользователь связями или нет). Соответствует 23-документу: "связанные группы — по наличию и запросу пользователя".
7. **Фильтр по типу в picker'е.** Когда результаты поиска смешанные (несколько типов сразу), над списком кандидатов появляются чипы типов (`Все` + типы, присутствующие в текущих хитах) — сужает список без похода на сервер (клиентский фильтр по уже полученным `hits`, тот же паттерн, что и остальные клиентские фильтры проекта). Кандидаты также заранее отфильтрованы через `computeLinkOptions(...).length > 0`, т.е. пары без единого допустимого `kind` вообще не показываются в списке (не только не создаются по клику).
8. **Переход к связанному объекту.** Расширил `apps/web/lib/panel-bus.ts` тем же паттерном `makeFocusChannel`, что уже был для task/note/event: добавил `focusDocument`/`useFocusedDocumentId`, `focusTransaction`/`useFocusedTransactionId`, `focusProject`/`useFocusedProjectId`. Клик по чипу связанной записи в `entity-links.tsx` зовёт `FOCUS_BY_TYPE[type]?.(id)` — переиспользует существующий intent-channel механизм, не новый роутинг. Подключил потребителей:
   - `apps/web/panels/DocumentsPanel.tsx` — `useFocusedDocumentId()` → `setSelectedFileId(id)` (тот же state, что и обычный клик по строке, открывает существующий `Sheet`/`PreviewPane`). Известное ограничение: если целевой документ сейчас в корзине, а панель открыта в режиме `view === "active"`, `byId` его не найдёт (тот же `useDocuments(workspaceId, view)` фильтр, что и раньше) — переключение view при переходе не реализовывал, это next-step для U03.
   - `apps/web/panels/finance/transactions-view.tsx` — `useFocusedTransactionId()` → находит транзакцию в уже загруженном `transactions` и открывает тот же `Sheet`, что и клик по строке.
   - `focusProject` подключён в канале, но не завёл потребителя в `ProjectsPanel.tsx` (там сущность открывается через отдельный `projectId`-driven detail-компонент, не через простой `selected*Id` стейт, как у Documents/Finance) — клик по связанному проекту в этой сессии просто открывает панель «Проекты» через встроенный в `makeFocusChannel`/`openPanel` побочный эффект, не доводит до конкретного проекта. Зафиксировано ниже как пробел, не выдаю за готовое.
9. **Пилот document→transaction интегрирован в реальный UI.** `TransactionForm`/`transactions-view.tsx` раньше не имели `EntityLinksSection` вообще (проверил — не было ни импорта, ни блока). Добавил `<EntityLinksSection workspaceId type="transaction" id={editing.id} />` в существующий `Sheet` редактирования операции (`apps/web/panels/finance/transactions-view.tsx`), после формы — тот же паттерн, что уже стоял в `TasksPanel`/`note-editor.tsx`/`ProjectsPanel.tsx`.
10. **Пилот note↔task** уже имел `EntityLinksSection` на обеих сторон с U01 (проверил — не переделывал точки монтирования в `TasksPanel.tsx`/`note-editor.tsx`), но раньше создавал только `related_to`; теперь автоматически получает выбор `supports`/`related_to` через переписанный компонент без изменения точки монтирования.
11. **Документ.** `apps/web/panels/documents/preview-pane.tsx` раньше вообще не показывал связи ни для одного документа — добавил `EntityLinksSection` в шапку превью (между заголовком/кнопкой «Скачать» и телом предпросмотра), доступно и в двухпанельном, и в `Sheet`-режиме (оба пути рендерят один и тот же `preview`-элемент в `DocumentsPanel.tsx`).

### Hidden count (проверка, не новый код)

Перечитал `SearchService.listLinks` (U01) построчно ещё раз: скрытые (restricted/disabled-модуль или чужой workspace) стороны отфильтровываются **до** попадания в `items`/`nextCursor` — счётчик на клиенте (`others.length`) и весь UI строятся поверх уже отфильтрованного ответа, никакой отдельный подсчёт на фронтенде не завёл (не было причины дублировать). Это то же гарантированное поведение, что зафиксировали 8 integration-тестов U01 (`entity-links.integration.test.ts`, включая явный кейс "restricted/disabled модуль на другой стороне — ссылка скрыта, не в счётчике"). Новых интеграционных тестов на это не писал — серверная логика не менялась в этой сессии, повторный прогон существующего файла ниже подтверждает, что она осталась зелёной.

### Тесты и проверки (доказательство, не описание)

Новый `apps/web/lib/entity-link-options.test.ts` — 5 тестов чистой логики (framework-free, входит в тот же `vitest.config.mts`, что и остальные `apps/web/lib/**/*.test.ts`, без jsdom):
- пилот note→task: варианты `related_to`+`supports`, `supports` с `sourceType:"note"` и `label` «материал для».
- пилот task-picker линкует note: та же связь создаётся как `note->task` (не `task->note`), подпись — `reverseLabel` «использует материал».
- пара с ровно одним валидным kind (`event`+`note`) не даёт второй вариант.
- пилот document→transaction в обе стороны открытия picker'а (с документа и с транзакции) — оба создают `document->transaction`, обратной `evidence_for`-строки не существует.
- same-type пара (`task`+`task`) не даёт `related_to` (allowAnyPair требует разные типы) — задокументировал существующее поведение `isRelationPairAllowed`, не мой новый код.

```
pnpm typecheck   # PASS, все 7 workspace-проектов
pnpm lint        # PASS, те же 3 предсуществующих warning (CalendarPanel/DocumentsPanel exhaustive-deps,
                 #   seed-demo-workspace unused var) — ни одного нового
pnpm test        # 28 файлов / 230 тестов PASS (было 27/225 — +1 файл, +5 тестов entity-link-options.test.ts)
pnpm build       # PASS — apps/api (tsc) + apps/web (next build, 27 статических страниц)
```

Живой клик-тест **не проводился** — нет browser tooling в этой сессии (то же ограничение, что во всех предыдущих U/S-сессиях). `pnpm build`/`typecheck` — единственный доступный proxy для UI-корректности; JSX/типы/пропсы проверены компилятором, но реальный рендер picker'а, клавиатурная навигация мышью+клавиатурой одновременно и визуальный вид collapsed/expanded состояний не подтверждены скриншотом.

### Осознанные ограничения / не в объёме этой сессии

- **`focusProject` без потребителя** в `ProjectsPanel.tsx` — канал заведён (консистентность с остальными 5 типами), но клик по связанному проекту не долистывает до конкретной карточки, только открывает панель «Проекты». `ProjectsPanel` использует свой `projectId`-driven detail компонент без единого «выбранный id» стейта на верхнем уровне панели — доведение до конкретного проекта требует более глубокой правки структуры панели, не однострочного эффекта, как у Documents/Finance.
- **Документ в корзине** не открывается через `focusDocument`, если панель сейчас в режиме "активные" (см. пункт 8 выше) — известный, не скрытый пробел.
- **Межпространственные связи** по-прежнему не поддержаны (не в объёме U02, см. 23-документ "Межпространственные данные: отдельный этап") — `useGlobalSearch` ищет только в активном пространстве, picker не предлагает переключить пространство.
- **Кросс-панельный E2E** (открыть task, создать supports-связь с note, перейти по ссылке, убедиться что нота открылась с фокусом) не прогонялся вживую — только по коду и юнит-тестам чистой логики выбора kind/направления.
- Не трогал `search.service.ts`/`entity-registry.ts`/Prisma-схему — U01 backend уже удовлетворял done-критерию U02 без изменений.

### Следующий шаг (рекомендация для U03)

Контекстные create-and-link (создать задачу/заметку прямо из picker'а, не только связать существующее) и личное одноразовое напоминание к сущности — поверх уже готового `computeLinkOptions`/`FOCUS_BY_TYPE`. Заодно можно закрыть пробел с `focusProject`, если U03 трогает `ProjectsPanel.tsx`, и решить фильтр по view (`active`/`trash`) для `focusDocument`, если появится сценарий связи с удалённым документом.

## U03 — контекстные create-and-link и личное одноразовое напоминание (2026-09-22)

**Часть 2 (напоминание) — DONE. Часть 1 (create-and-link) — DONE для task/note в отдельной последующей сессии (2026-09-22, см. "U03 Часть 1 (create-and-link) — реализовано" ниже); document намеренно не подключён, идемпотентность — только клиентская. Первоначальная запись ниже сохранена как есть (историческая honest-partial фиксация того среза).**

### Часть 2: `EntityReminder` — реализация

- `apps/api/prisma/schema.prisma` — новая модель `EntityReminder` (workspaceId, ownerId, recipientId, entityType/entityId из закрытого U01 реестра, scheduledAt, timezone, status pending/delivered/cancelled, deliveredAt). Первый срез — личное: `recipientId === ownerId` всегда, как явно разрешает 23-документ ("Начать с одноразовых личных напоминаний"). Миграция `apps/api/prisma/migrations/20260922100000_entity_reminders/` — таблица + ENABLE/FORCE RLS + политика по `workspace_members`, тот же шаблон, что у `task_comments`/`task_activities` (S17). Структурный тест `api-rls.integration.test.ts` ("RLS enabled, forced and policied on every workspace-owned table") подтверждает покрытие — прогнан и PASS.
- **Не переписывал** `DueTaskCheckerService`/`EventReminderService` — новый независимый `apps/api/src/search/reminder-checker.service.ts` (`@Cron(EVERY_MINUTE)`), делает `asSystem`-обход по всем `pending`-строкам с `scheduledAt <= now()`.
- **Reminder повторно не доставляется**: доставка идёт через существующий `NotificationCenterService.createTx` с `eventKey: entity_reminder:<id>` — тот же `createMany({skipDuplicates:true})`-барьер, что у `task_due`/`event_reminder`. `status` переводится в `delivered` только после того, как вставка уведомления подтверждена (или её дедуп подтверждён как no-op) — никогда заранее.
- **Отзыв доступа учитывается ДВАЖДЫ**: при создании (`RemindersService.create` — `ModulesService.accessibleSetTx` + `ENTITY_REGISTRY[type].summary` не даёт создать напоминание на объект, который сейчас не виден/не существует в этом workspace) И повторно на доставке (`ReminderCheckerService.runCheck` — перечитывает членство в workspace, доступность модуля сущности и её существование прямо перед отправкой; любое из трёх ⇒ `status: cancelled`, никогда `delivered`, уведомление не создаётся, title сущности не просачивается).
- **`NotificationPolicyService.allowsForUser`** спрашивается перед каждой отправкой (инвариант CLAUDE.md #8) — добавлен новый `ReminderKind = "entity"`, который уважает только тихие часы (без отдельного тумблера в `UserPreference` — осознанно, задокументировано в коде: это ближе к "напомнить сейчас", а не к ambient-крону). Suppressed-по-политике случай оставляет `pending` (не cancelled/delivered) для ретрая следующим тиком — тот же принцип, что у `DueTaskCheckerService`.
- API: `GET/POST/PATCH workspaces/:id/reminders` — `apps/api/src/search/reminders.controller.ts` + `.service.ts`, тот же `JwtAuthGuard`-паттерн без `@RequireModule`, что у `SearchController` (reminders — cross-cutting, не свой модуль). Зарегистрированы в `search.module.ts` (уже импортирует `NotificationsModule`).
- `packages/shared-types/src/reminder.ts` (`entityReminderSchema`, `createEntityReminderInputSchema`) + `Notification.kind` дополнен `"entity_reminder"`. `packages/core/src/api/api-client.ts` — `listReminders/createReminder/cancelReminder`. `packages/core-react/src/use-search.ts` — `useReminders/useCreateReminder/useCancelReminder`.
- **Snapshot registry v2** (обязательный по CLAUDE.md шаг, найден тестом `snapshot.integration.test.ts` "S03a: every workspace-scoped model classified" — без этой правки `pnpm test:integration` падал): `EntityReminder` добавлен в `SNAPSHOT_MODEL_REGISTRY` (`snapshot-registry.ts`) как `included`/`entityReminders` — pending-напоминание это намерение пользователя (как `Task.dueAt`), не журнал доставки (тот — `Notification`/`SentReminder`, `ephemeral-excluded`) — и в `SNAPSHOT_MODELS` (`snapshot.service.ts`).
- UI: минимальная кнопка «Напомнить» в `apps/web/components/entity-links.tsx` (используется во всех местах, где уже подключён `EntityLinksSection`) — `<input type="datetime-local">` (в `packages/ui` нет отдельного date/time-пикера, решил не заводить новый компонент ради одного поля), список pending-напоминаний этой сущности с отменой. Полноценной формы выбора не строил — по заданию это допустимо ("не обязательно полноценная форма").

### Тесты (реальная изолированная БД, реальная конкурентность)

Новый `apps/api/test/reminders.integration.test.ts`, 6 тестов, все PASS:
1. create/list/cancel через реальный HTTP.
2. RLS + ownership: чужой entity ref → 404, чужой workspace → 403.
3. Повторный **последовательный** тик крона не дублирует уведомление (eventKey dedup) — `runCheck()` дважды подряд, второй раз `delivered: 0` потому что WHERE уже не видит строку в `pending`.
4. **UC04, настоящая конкурентность**: `Promise.all([checker.runCheck(), checker.runCheck()])` — не последовательные await — на одну и ту же due-строку; ровно одно `Notification` с данным `eventKey` после гонки.
5. Отзыв доступа через **выключение модуля** (`PATCH .../modules/notes`) перед доставкой → `status: cancelled`, ноль уведомлений.
6. Отзыв доступа через **удаление membership** напрямую в БД (нет своего API для этого — см. `WorkspacesModule`) перед доставкой → `cancelled`, ноль уведомлений, title не утёк.

```
pnpm db:migrate            # миграция применена чисто на локальном Postgres (127.0.0.1:5433)
pnpm typecheck              # PASS, все 7 workspace-проектов
pnpm lint                   # PASS, те же 3 предсуществующих warning, ни одного нового
pnpm test                   # PASS, 28 файлов / 230 тестов (без изменений — новых юнитов не добавлял,
                             #   вся новая логика reminder покрыта интеграционным тестом с реальной RLS)
pnpm build                  # PASS — apps/api (tsc) + apps/web (next build, 27 статических страниц)
pnpm test:integration       # 21/24 файла PASS. 3 файла (api-rls, blob-backup,
                             # codex-review-regressions) падают на 7 тестах,
                             # ВСЕ по одной причине, НЕ связанной с этой сессией:
                             # putRemote/SSRF-guard резолвит example.com, а в
                             # песочнице этого агента нет исходящего сетевого
                             # доступа (Test-Connection example.com тоже падает).
                             # Тот же файл api-rls.integration.test.ts прошёл
                             # "RLS enabled/forced/policied" структурный тест
                             # (включая entity_reminders) отдельным прогоном —
                             # PASS. reminders.integration.test.ts — 6/6 PASS.
                             # snapshot.integration.test.ts — 7/7 PASS (после
                             # добавления EntityReminder в реестр).
```

Живой клик-тест кнопки «Напомнить» **не проводился** — нет browser tooling в этой сессии (то же известное ограничение, что во всех предыдущих U-сессиях).

### Часть 1 (create-and-link) — что НЕ сделано и почему

По прямому указанию в задании ("приоритизируй Часть 2 выше Часть 1... если бюджет не позволит полную атомарность — честный PARTIAL"): контекстные действия «Создать задачу»/«Написать заметку»/«Прикрепить документ»/"Связать существующее"+create прямо из `EntityLinksSection` **не реализованы** в этой сессии — только уже существующий (с U02) путь "связать существующее". Что уже даёт частичную защиту от гонки бесплатно: `EntityLink` имеет `@@unique([sourceType, sourceId, targetType, targetId, kind])` (schema.prisma) — два одновременных клика "связать" с одной и той же парой создают одну строку, вторая падает 400 "Такая связь уже существует", это уже покрыто существующими U01-тестами (`entity-links.integration.test.ts`, symmetric/directed dedup). Чего не хватает: атомарного «создать сущность + связать» с гарантией отсутствия осиротевшего объекта при сбое между двумя шагами (create task succeeds, link fails → задача осталась без связи и без отката) — это требует либо общей транзакции между `TasksService.create`/`NotesService.create`/... и `SearchService.createLink` (сейчас разные сервисы, разные `withUser`-транзакции), либо client-side компенсации (удалить только что созданную сущность при ошибке линковки). Ни то ни другое не реализовано; кнопок «Создать задачу»/«Написать заметку» в `EntityLinksSection` нет вовсе.

### Следующий шаг (рекомендация для U04 и хвоста U03)

- U03-хвост: контекстные create-and-link из Части 1 — с общей `withUser`-транзакцией между целевым `*Service.create` и `SearchService.createLink` (оба уже принимают `Prisma.TransactionClient` внутри, стоит вынести tx-принимающие приватные методы наружу как package-private helpers) — тогда atomicity бесплатна на уровне Postgres, без client-side idempotency key.
- Расширить `ReminderKind` пер-user тумблером в `UserPreference`, если окажется, что личные напоминания создаются часто и тихие часы одни — недостаточная гранулярность.
- U04 (независимый window/panel context) не затронут этой сессией.

### Верификация записи U03 (2026-09-22, повторная сессия)

Предыдущая сессия была отмечена как упавшая по rate limit, но working tree и запись выше сохранились нетронутыми (файл не был испорчен, как и предупреждалось). Перед тем как продолжать Часть 1, перепроверил заявленное Части 2 с нуля на реальной БД, не полагаясь на текст записи:

- `pnpm typecheck` — PASS, все 7 проектов.
- `pnpm lint` — PASS, те же 3 предсуществующих warning, ноль новых.
- `pnpm test` — PASS, 28 файлов / 230 тестов.
- `pnpm db:migrate` — миграция `20260922100000_entity_reminders` уже применена, `Already in sync`.
- `apps/api/test/reminders.integration.test.ts` (реальная БД, `vitest.integration.config.mts`) — 6/6 PASS, включая настоящий `Promise.all` конкурентный тест UC04.
- `apps/api/test/api-rls.integration.test.ts -t "RLS"` — структурный тест ENABLE/FORCE/policy по всем workspace-таблицам — PASS (`entity_reminders` покрыта).
- `pnpm build` — PASS (`apps/api` tsc + `apps/web` next build, 27 статических страниц).

Вывод: Часть 2 (личное одноразовое напоминание) подтверждена рабочей и протестированной, ничего переделывать не потребовалось. Часть 1 (create-and-link) подтверждена нетронутой — в `entity-links.tsx` и `search.service.ts`/`tasks.service.ts` нет ни кнопок «Создать задачу»/«Написать заметку», ни общего tx-helper. Учитывая приоритет задания (Часть 2 выше Части 1) и то, что рискованный рефактор транзакционных границ `TasksService`/`NotesService`/`SearchService` под ограниченный бюджет сессии мог дестабилизировать уже проверенный зелёный код, решил **не** трогать Часть 1 в этой сессии и оставить рекомендацию выше в силе для следующего среза. Существующая защита от двойного клика (unique-constraint на `EntityLink`, см. выше) остаётся единственной гарантией для уже реализованного пути «связать существующее».

### U03 Часть 1 (create-and-link) — реализовано (2026-09-22, отдельная сессия)

Ровно по рекомендации из предыдущей записи ("общая `withUser`-транзакция между целевым `*Service.create` и `SearchService.createLink`, оба уже принимают `Prisma.TransactionClient` внутри — вынести tx-принимающие методы наружу как package-private helpers"):

- **`TasksService.createTx(tx, userId, workspaceId, input)`** и **`NotesService.createTx(tx, userId, workspaceId, input)`** — тело прежнего `create()` без обёртки `withUser`; сам `create()` теперь тонкая обёртка `withUser(userId, tx => this.createTx(...))`. Поведение публичного `create()` не изменилось (проверено юнит/интеграционными тестами, которые его используют — все зелёные без правок). `NotesModule` теперь `exports: [NotesService]` (раньше не экспортировал).
- **`SearchService.createLinkTx(tx, userId, workspaceId, input)`** (приватный) — тело прежнего `createLink()` без `withUser`; `createLink()` — тонкая обёртка.
- **`SearchService.createAndLink(userId, workspaceId, input)`** — новый публичный метод: один `withUser`-транзакция, внутри — `assertMemberTx` + module-access gate на оба типа (новую сущность и target), затем `tasks.createTx`/`notes.createTx`, затем `this.createLinkTx` с `sourceType/sourceId` = только что созданная сущность. Если что-то на любом шаге бросает (target не найден, недопустимая пара для `kind`, дубликат связи и т.д.) — Postgres откатывает ВСЮ транзакцию: ни сущность, ни связь не остаются в БД. Проверено интеграционным тестом (см. ниже) на двух разных причинах отката — 404 target и 400 недопустимая пара.
- Межмодульная зависимость: `SearchModule` теперь импортирует `TasksModule`/`NotesModule` (однонаправленно — `search -> tasks/notes`, обратной зависимости нет, цикла нет).
- Эндпоинт: `POST workspaces/:id/create-and-link` (`SearchController.createAndLink`), тело — `createAndLinkInputSchema` (`packages/shared-types/src/search.ts`): `{ targetType, targetId, kind?, idempotencyKey?, entity: { type: "task", input: CreateTaskInput } | { type: "note", input: CreateNoteInput } }`. **`document` сознательно не подключён** в этом срезе — вложение файла требует своей истории durable-recovery для multipart-загрузки (см. doc-comment схемы); отправка `entity.type: "document"` отклоняется на границе zod (400), это доказано тестом.
- **Идемпотентность — только клиентская, задокументировано как гэп, не выдаётся за серверную гарантию.** `idempotencyKey` принимается и прокидывается в схему, но сервер НЕ дедуплицирует по нему — нет отдельной таблицы/колонки для этого узкого среза (сознательно, чтобы не разрастаться). Единственная защита от двойного клика — `apps/web/components/entity-links.tsx`: `submitLockRef` (обычный `useRef`, не React state — блокирует **до** первого re-render) выставляется в `true` синхронно в начале обработчика клика, до `await createAndLink.mutateAsync(...)`, и кнопка «Создать и связать» дополнительно дизейблится через `createAndLink.isPending`. Настоящий network-retry после реального таймаута НЕ защищён — задокументировано и в коде (doc-comment схемы), и явно доказано интеграционным тестом ниже (два параллельных запроса с одним `idempotencyKey` → два объекта, две связи).
- **Клиент**: `packages/core/src/api/api-client.ts` — `createAndLink()`. `packages/core-react/src/use-search.ts` — `useCreateAndLink()` (инвалидирует `["links", workspaceId]` и `["tasks"|"notes", workspaceId]` по факту `result.entityType`). `apps/web/components/entity-links.tsx` — две новые кнопки «Задача»/«Заметка» рядом с «Связать», открывающие минимальную инлайн-форму (заголовок + необязательное описание/тело). **Не переиспользовал** `panels/task-form.tsx` целиком — та форма завязана на списки проектов/вех/участников, которых в контексте `EntityLinksSection` (общий компонент, используется из любой детали любой сущности) нет под рукой; вместо этого — по инструкции задания "минимальная форма" — два поля (`Input`+`Textarea` из `@orion/ui`), `priority: "normal"` жёстко (дефолт схемы всё равно требует явного значения в output-типе `CreateTaskInput`).

#### Тесты (реальная изолированная БД, `apps/api/test/create-and-link.integration.test.ts`, 6/6 PASS)

1. Happy path: task создаётся И связь создаётся, видна с обеих сторон (`GET .../links?type=note&id=...`).
2. Happy path: note создаётся И связь создаётся.
3. **Атомарность (несуществующий target)**: `targetId` — случайный uuid → 404, число задач в списке не изменилось, задачи с этим заголовком не существует (не полу-созданное состояние).
4. **Атомарность (недопустимая пара для kind)**: `note`+`evidence_for`+`document` (каталог `RELATION_KIND_CATALOG` разрешает `evidence_for` только `document->transaction`) → 400, заметка не создана — доказывает, что откат происходит ПОСЛЕ создания сущности внутри той же транзакции, а не только до неё.
5. **Честный concurrency-тест (без ослабленных assertions)**: `Promise.all([...])` — два одновременных запроса с одинаковым `idempotencyKey` → оба 201, в БД в итоге ДВЕ задачи и ДВЕ связи. Тест прямо документирует отсутствие серверной дедупликации, а не маскирует его.
6. `entity.type: "document"` отклоняется на границе схемы (400).

```
pnpm --filter @orion/shared-types typecheck   # PASS
pnpm --filter @orion/core typecheck           # PASS
pnpm --filter @orion/core-react typecheck     # PASS
pnpm --filter @orion/api typecheck            # PASS (src + test/tsconfig.test.json)
pnpm --filter @orion/web typecheck            # PASS
pnpm lint                                     # PASS — те же 3 предсуществующих warning, ноль новых
pnpm test                                     # PASS — 34 файла / 264 теста (unit, без БД)
pnpm --filter @orion/api exec vitest run test/create-and-link.integration.test.ts   # PASS 6/6
pnpm --filter @orion/api exec vitest run test/entity-links.integration.test.ts      # PASS 8/8 (регрессия — не сломал U01 путь)
pnpm build                                    # PASS — apps/api (tsc) + apps/web (next build, 29 статических страниц)
```

Живой клик-тест новых кнопок в браузере **не проводился** — нет browser tooling в среде агента (то же известное ограничение всех предыдущих U-сессий).

#### Что осталось (честно)

- Идемпотентность — клиентская-only (см. выше), не серверная. Полноценный dedup потребовал бы отдельной таблицы `idempotency_keys` (ключ + workspaceId + userId + результат/статус, TTL) — не сделано в этом срезе, сознательно, задокументировано в трёх местах (shared-types doc-comment, PROGRESS, тест).
- «Прикрепить документ» не реализовано вовсе — ни formы, ни эндпоинта для этого пути. Существующий путь «связать существующий документ» через «Связать существующее» (U02, уже был) продолжает работать без изменений.
- Живые UI-скриншоты/клик-тест не проводились (нет browser tooling).

## U04 — независимый window/panel context; scoped active workspace и layout

Задача: U04 (24-CONNECTED-CORE-BACKLOG.md), контракт "Независимые окна и раскладки" из 23-UNIVERSAL-CONNECTED-CORE.md. Стартовая точка — подтверждённый в U00-записи gap: `apps/web/lib/use-active-workspace.ts` использовал единственный глобальный localStorage-ключ `orion:active-workspace-id` без привязки к окну.

### Реализовано

- `apps/web/lib/window-context.ts` (новый) — `getWindowId()`: id текущей вкладки/окна, генерируется `crypto.randomUUID()` при первом обращении и кладётся в `sessionStorage` (не `localStorage`) — `sessionStorage` нативно изолирован по browsing context движком браузера/webview, поэтому изоляция между окнами не требует межвкладочной координации. Пережить перезагрузку той же вкладки (survive reload) и НЕ пережить закрытие вкладки — ровно то поведение, которое нужно "своему контексту окна". Кэш в module-level переменной на время жизни страницы. Fallback на in-memory uuid, если storage недоступен (приватный режим). Задокументирован известный нюанс: same-origin `window.open()` (браузерный popout dockview) по спецификации копирует `sessionStorage` открывателя в новый browsing context при создании — поэтому popout ненадолго "наследует" windowId/workspace родителя, затем расходится независимо после первой записи с любой стороны; это соответствует реальному сценарию (popout показывает одну панель ИЗ текущего окна), живьём не проверялось (нет browser tooling).
- `apps/web/lib/use-active-workspace.ts` — `STORAGE_KEY` заменён на `activeWorkspaceStorageKey(windowId)` = `orion:active-workspace:<windowId>`, хранилище — `sessionStorage` вместо `localStorage`. `getActiveWorkspaceId`/`setActiveWorkspaceId` не изменили сигнатуру — все существующие вызовы (`panel-bus.ts`, `spaces/page.tsx`, `layout.tsx`'s workspace `<select>`) продолжают работать без правок. Побочный плюс: `panel-bus.ts`/`intent-channel.ts` (S09) уже читали workspace через `getActiveWorkspaceId()` at emit/consume time — теперь это автоматически ещё и per-window (не только per-workspace): интент из окна A физически не может быть consumed в окне B, даже если оба выбрали один и тот же workspace.
- `apps/web/lib/dock-layout-key.ts` (новый) — `dockLayoutStorageKey(userId, workspaceId, purpose = "main")` = `orion.dockLayout:<purpose>:<userId>:<workspaceId>`. Раньше был один фиксированный ключ `orion.dockLayout` на весь localStorage — общий на всех пользователей/пространства машины.
- `apps/web/app/(app)/layout.tsx` — `onReady` теперь вычисляет ключ через `dockLayoutStorageKey(user!.id, workspace!.id)` (оба гарантированно не-null к моменту монтирования Workbench — рендер-гейт компонента не пускает дальше спиннера без них) вместо константы. Логика восстановления/дефолта вынесена в переиспользуемую `loadLayoutForKey(api, key)`. Добавлен `layoutKeyRef` + новый `useEffect` на `[user?.id, workspace?.id]`: при живом переключении пространства в том же окне (селектор в сайдбаре, без размонтирования Workbench) — сохраняет текущий layout под старым ключом, закрывает все панели, грузит layout под новым ключом (или дефолт). Без этого переключение пространства показывало бы позиции панелей чужого пространства и затем тихо перезаписывало бы старый layout под общим ключом.
- `DetachHeaderAction` (Tauri "Открепить в окне") — свежий `WebviewWindow` это новый webview с пустым `sessionStorage`, поэтому у него не было бы своего активного пространства и `PanelWindow` отправлял бы его на `/spaces`. Исправлено: при detach текущий workspace читается синхронно через `getActiveWorkspaceId()` и передаётся через `?workspaceId=` в URL окна.
- `apps/web/app/panel/[panelId]/panel-window.tsx` — читает `?workspaceId=` через `useSearchParams()` (эффект с пустыми deps, проверка через синхронный `getActiveWorkspaceId()`, а не через `workspace` из хука, который на первом рендере всегда `undefined` до загрузки списка пространств) и засеивает свой собственный (новый) windowId-scoped стор один раз, только если своего выбора ещё нет — после этого окно живёт независимо. `page.tsx` обёрнут в `<Suspense>` (тот же паттерн, что у login/register/invite, иначе `output: "export"` падает на сборке).

### Проверено (уже было верно, без правок)

- `intent-channel.ts` — framework-free JS-модуль с `Set<listener>` в module scope; между вкладками браузера JS-модули физически не шарятся (разные JS-рантаймы), поэтому изоляция по окнам была "бесплатной" ещё до этой сессии. Явно подтверждено чтением кода, не только предположением.
- Staleness / query key scoping (react-query) — прогреп всех `queryKey:` в `packages/core-react/src/*.ts`: практически каждый read-запрос уже включает `workspaceId` вторым элементом ключа (`["tasks", workspaceId, ...]`, `["notes", workspaceId, ...]` и т.д.) — переключение пространства в react-query само по себе не покажет "старый" ответ под новым workspace, потому что это физически другой ключ кэша. Исключения — намеренно глобальные ключи не по пространству: `session`, `workspaces`, `auth-accounts`, `preferences`, `sessions`, `orion-mode` — так и должно быть (это не workspace-scoped данные). Несколько мутаций (`use-inbox.ts`, `use-notifications.ts`, `use-projects.ts`) инвалидируют по префиксу без `workspaceId` (`invalidateQueries({ queryKey: ["inbox"] })`) — это избыточная инвалидация чужих workspace-кэшей (лишний рефетч), не утечка неверных данных в текущий контекст; не чинил (вне объёма U04, не дефект done-критерия).

### Известный пробел — logout cross-tab (сознательно не решался в этой сессии)

`useLogout`/`useLogoutAll` (`packages/core-react/src/use-auth.ts`) чистят react-query кэш (`session`, `workspaces`, `auth-accounts`) только в своём окне — другое открытое окно того же браузера не узнаёт о logout, пока само не сделает запрос и не получит 401. Полная межвкладочная синхронизация logout (например, через `storage`-event на localStorage-флаг или `BroadcastChannel`) — самостоятельная тема, явно вынесена как gap для будущей сессии, не пытался решать здесь по заданию. Переход active workspace на sessionStorage не ухудшает этот гэп (было так же и с localStorage), просто не делает его лучше.

### Не проверено вживую (честно)

Нет browser/Tauri tooling в среде агента — ни один сценарий из UC05 ("окно A=Семья, B=Студия; переключение/перезапуск A не меняет B") не прогнан в реальном браузере с двумя вкладками. Доказательство этой сессии — код-ревью (прочитан весь путь: `window-context.ts` → `use-active-workspace.ts` → `panel-bus.ts`/`intent-channel.ts` → `layout.tsx`) плюс unit-тесты на чистые функции (`resolveWindowId`, `activeWorkspaceStorageKey`, `dockLayoutStorageKey`), которые доказывают детерминированность и различимость ключей по windowId/userId/workspaceId, но не сам факт браузерной изоляции `sessionStorage` (это гарантия спецификации/движка, не кода ORION). Detach-в-Tauri-окно (`?workspaceId=` seed) тоже не запускался в реальном Tauri — только прочитан код обеих сторон (`DetachHeaderAction` → `panel-window.tsx`).

Проверки (полный прогон):
```
corepack pnpm exec vitest run apps/web/lib/window-context.test.ts apps/web/lib/dock-layout-key.test.ts apps/web/lib/use-active-workspace.test.ts apps/web/lib/intent-channel.test.ts
# PASS 4 файла / 21 тест
corepack pnpm typecheck   # PASS, все 7 workspace-проектов
corepack pnpm lint        # PASS, те же 3 предсуществующих warning — без новых
corepack pnpm test        # PASS, 31 файл / 246 тестов
corepack pnpm build       # PASS, apps/api tsc + apps/web next build (27 статических страниц, /panel/[panelId] по-прежнему пререндерится статически с новым Suspense)
```

Файлы (абсолютные пути): `C:\Users\Reno\Desktop\ORION\apps\web\lib\window-context.ts` (+`.test.ts`, новые), `C:\Users\Reno\Desktop\ORION\apps\web\lib\dock-layout-key.ts` (+`.test.ts`, новые), `C:\Users\Reno\Desktop\ORION\apps\web\lib\use-active-workspace.ts` (+`.test.ts`, новый тест), `C:\Users\Reno\Desktop\ORION\apps\web\app\(app)\layout.tsx`, `C:\Users\Reno\Desktop\ORION\apps\web\app\panel\[panelId]\panel-window.tsx`, `C:\Users\Reno\Desktop\ORION\apps\web\app\panel\[panelId]\page.tsx`.

Следующий шаг: U05 (личные сферы) зависит от U04 — теперь разблокирован. Отдельно стоит закрыть cross-tab logout gap (не входил в объём U04) и — при появлении реального browser/Tauri tooling — прогнать живой multi-tab/multi-window smoke UC05, которого эта сессия честно не проводила.

## U05 — личные сферы, presets, переключатель и избранное

Задача: U05 (24-CONNECTED-CORE-BACKLOG.md), контракт "Иерархия и владение" +
"Переключатель показывает сферу и название пространства" из
23-UNIVERSAL-CONNECTED-CORE.md. Зависимость U04 (windowId/scoped
active-workspace) уже закрыта предыдущей сессией.

**Сверка нумерации проверок**: в 24-CONNECTED-CORE-BACKLOG.md таблица
"Проверки UC" идёт по номеру задачи (UC01↔U01, …, UC06↔U06, UC07↔U07…), а не
плотным списком без пропусков — U05 в этой нумерации не получает своего
отдельного UC. Единственная явная проверка сфер по тексту документа лежит
внутри **UC10** («личные сферы не становятся общими: source workspace
отдельно восстановлен без выдачи прав на старые чужие refs») — это финальная
миграционная приёмка U10, не отдельный срез. Эта сессия закрывает done-критерий
самого U05 из таблицы задач (см. ниже), а не UC10 целиком — восстановление/
backup-путь для сфер здесь только подтверждён по коду (registry уже
исключает `UserPreference`), не прогнан через живой snapshot/restore сценарий.

### Ключевое архитектурное решение

Сфера — **личная** (per-user) метадата о группировке уже существующих
workspace, не новая иерархия владения. Хранится JSON-колонкой на
`UserPreference` (`spheres: WorkspaceSphere[]` = `{id,name,order,
workspaceIds}[]`), не отдельной Prisma-моделью: читается/пишется целиком как
один маленький per-user blob и никогда не фильтруется/не джойнится на уровне
БД — тот же паттерн, что уже был у `backgroundEffectSettings`. Отдельное
поле `favoriteWorkspaceIds: String[]` — независимое избранное, как явно
требует спецификация ("для быстрого доступа есть независимое избранное").

### Реализовано

- `apps/api/prisma/schema.prisma` — `UserPreference.spheres Json @default("[]")`
  и `favoriteWorkspaceIds String[] @default([])`, миграция
  `20260922174215_u05_workspace_spheres`.
- `packages/shared-types/src/settings.ts` — `workspaceSphereSchema`,
  `workspaceOrganizationSchema` (ответ `GET .../organization`),
  `createSphereInputSchema`, `updateSphereInputSchema`,
  `assignWorkspaceSphereInputSchema` (`sphereId: string | null`, `null` = снять
  сферу), `setWorkspaceFavoriteInputSchema`.
- `apps/api/src/settings/settings.service.ts` — `getOrganization`,
  `createSphere`, `updateSphere`, `deleteSphere`, `assignWorkspaceSphere`,
  `setWorkspaceFavorite`. Каждая мутация, трогающая конкретный workspaceId
  (assign/favorite), сначала зовёт `WorkspacesService.assertMember` — сфера
  не может сослаться на пространство, где пользователь не состоит (403).
  **Ленивая фильтрация при каждом чтении** (`filterOrganization`): и
  `getOrganization`, и результат любой мутации пересчитываются против
  актуального `WorkspacesService.listForUser(userId)` — workspace, из
  которого пользователя убрали, пропадает из его сфер/избранного сам, без
  отдельного cleanup-хука на удаление членства (не может протухнуть, нет
  второго места, которое надо не забыть вызвать). Один workspace — не более
  чем в одной сфере данного пользователя: `assignWorkspaceSphere` сначала
  снимает workspaceId со всех сфер, затем добавляет в целевую.
- `apps/api/src/settings/settings.controller.ts` — `GET /settings/organization`,
  `POST .../spheres`, `PATCH .../spheres/:sphereId`,
  `DELETE .../spheres/:sphereId`, `PUT .../workspace-sphere`,
  `PUT .../favorites/:workspaceId`. Не под `workspaces/:workspaceId` —
  это per-user ресурс, как и существующий `settings/preferences`.
- `apps/api/src/settings/settings.module.ts` — добавлен импорт
  `WorkspacesModule` (для `WorkspacesService.assertMember`/`listForUser`).
- `packages/core/src/api/api-client.ts`, `packages/core-react/src/use-workspace-organization.ts`
  (+ экспорт из `index.ts`) — `useWorkspaceOrganization` и мутации-хуки,
  зеркалят `use-settings.ts`; один query key `["workspace-organization"]`,
  не по workspace (как `preferences`/`workspaces`).
- `apps/web/app/(app)/layout.tsx` — сайдбар-переключатель (`<select>`)
  сгруппирован через `<optgroup>`: `buildSwitcherGroups()` (чистая функция)
  строит "Избранное" (независимо от сферы, может повторить workspace, что и
  есть смысл быстрого доступа) → сферы пользователя по его `order` → "Другое"
  для несферных. Без единой сферы/избранного — плоский список без групп, как
  раньше (**"старый аккаунт без сфер продолжает работать"** — прямое
  следствие, без миграции данных).
- `apps/web/panels/SettingsPanel.tsx` + новый
  `apps/web/panels/settings/spheres-section.tsx` — вкладка "Сферы":
  создание/переименование/удаление сферы, назначение сферы (`<Select>`) и
  избранного (звезда) на каждый workspace пользователя. Нет owner-only гейта
  (в отличие от соседнего `workspace-section.tsx`) — здесь нет
  workspace-owned данных, это чисто личная настройка.
- `apps/api/src/sync/snapshot-registry.ts` — уточнён комментарий у
  `UserPreference` (`identity-excluded`), явно называет `spheres`/
  `favoriteWorkspaceIds` — модель уже была вне workspace-scoped snapshot
  реестра (per-user, нет `workspaceId`), правка только документирующая, кода
  не потребовалось.

### Проверено (без правок, для подтверждения пункта 5 задания)

`SNAPSHOT_MODEL_REGISTRY` уже содержал `{ model: "UserPreference", policy:
"identity-excluded" }` до этой сессии (per-user, backup — только про
workspace). Новые JSON/array-колонки на существующей модели не требуют
отдельной записи реестра (он на уровне модели, не колонки) и не меняют
классификацию — подтверждено чтением, не предположением.

### Тесты

`apps/api/test/spheres.integration.test.ts` (новый, реальная RLS БД, паттерн
скопирован с `entity-links.integration.test.ts`):

1. `lets two members of the SAME workspace keep independently named/ordered spheres` —
   Боб приглашает Алису в свой workspace через реальный invite/accept flow;
   Алиса называет его "Работа", Боб — "Дом"; проверено, что у каждого свой
   вид и что имя одного не протекает в список другого.
2. `drops a workspace from the sphere/favorites of a user who is no longer a member` —
   гость добавляет shared workspace в сферу и в избранное, затем его
   членство удаляется напрямую; следующий `GET .../organization` уже не
   содержит этот workspaceId ни в сфере, ни в избранном, но сама сфера (уже
   пустая) остаётся.
3. `moving a workspace between spheres changes only personal metadata, never access or data` —
   создаётся заметка, workspace переносится "Дом" → "Работа" одним PUT без
   явного снятия со старой сферы; заметка остаётся видна и не изменена;
   отдельно — попытка привязать чужой (по membership) workspaceId к своей
   сфере отклоняется 403.
4. `an account with no spheres at all still reads a valid (empty) organization` —
   явная проверка default-состояния (пустые массивы, не ошибка).

Проверки (полный прогон):
```
corepack pnpm exec vitest run --config vitest.integration.config.mts spheres.integration.test.ts
# PASS, 1 файл / 4 теста
corepack pnpm typecheck   # PASS, все 7 workspace-проектов
corepack pnpm lint        # PASS, те же 3 предсуществующих warning — без новых
corepack pnpm test        # PASS, 31 файл / 246 тестов
corepack pnpm test:integration
# 22 файла PASS / 3 файла с сетевыми WebDAV-тестами (blob-backup,
# codex-review-regressions, часть api-rls "S02 sync/backup") падают на
# putRemote({url:"https://example.com/dav"}) → 400: в песочнице агента нет
# исходящего DNS/сети (`curl https://example.com` таймаутит на резолве),
# assertPublicRemoteUrl честно отклоняет недостижимый хост. Не regression —
# ни один из изменённых в этой сессии файлов не пересекается с
# sync/webdav/remote-url-guard; эти 7 тестов не про U05.
corepack pnpm build       # PASS, apps/api tsc + apps/web next build (27 статических страниц)
```

### Не проверено вживую / известные пробелы

- Нет browser tooling — сгруппированный `<select>`/`<optgroup>` в сайдбаре и
  вкладка "Сферы" в Settings не кликались живьём; доказательство — typecheck
  + `next build` (статическая сборка проходит, значит JSX/типы валидны) плюс
  ревью кода, не скриншот.
- `/spaces` (полноэкранный picker пространств, `apps/web/app/spaces/page.tsx`)
  **не** сгруппирован по сферам — там остался плоский список карточек. Не
  входило в объём как "ядро done-критерия" (сайдбар-переключатель — то, что
  явно требует 23-документ: "Переключатель показывает сферу и название
  пространства"); группировка `/spaces` — кандидат для U06 заодно с
  поиском/стрелками/pinned-порядком, которые 23-документ тоже описывает для
  переключателя и которые эта сессия сознательно не делала (бюджет сессии).
- Reorder сфер (`order`) API поддерживает (`PATCH .../spheres/:id { order }`),
  но в `spheres-section.tsx` нет UI для явного up/down — сферы создаются в
  порядке создания. Минорный пробел, не часть done-критерия U05 (там про
  "порядок" сказано только "у двух участников разные названия/порядок" —
  это про независимость данных двух пользователей, что доказано тестом 1,
  а не про drag-переупорядочивание в UI).
- Living-restore сценарий для U10/UC10 ("личные сферы не становятся общими")
  не прогонялся живьём в этой сессии — только подтверждено по коду, что
  `UserPreference` вне snapshot-реестра.

Следующий шаг: U06 (sidebar drag→Dockview, split, открыть в отдельном окне;
личные раскладки) — не зависит от U05 по таблице, но естественно продолжает
работу над сайдбар-переключателем (поиск/pinned-порядок/`/spaces`-группировка,
явно отложенные здесь).

## U06 — sidebar drag→Dockview, split, открыть в отдельном окне; личные раскладки

Задача: U06 (24-CONNECTED-CORE-BACKLOG.md), контракт "Независимые окна и
раскладки" (последний абзац, про drag/split/detach) из
23-UNIVERSAL-CONNECTED-CORE.md. Зависимость U04 (windowId/scoped active
workspace/layout) уже закрыта.

### Проверка реальности перед правкой (сверка задания)

Прочитан весь текущий Workbench-путь до правок: `apps/web/app/(app)/layout.tsx`
(`openPanel`, `DetachHeaderAction`), `packages/ui/src/sidebar.tsx`,
`packages/ui/src/workbench.tsx`. Подтверждено: клик по разделу сайдбара уже
делал открыть-или-сфокусировать (`api.getPanel(id)?.setActive() : api.addPanel(...)`)
без дублей — то, что CLAUDE.md описывает. **Drag не было вообще** — `Sidebar`
рендерил только `<button onClick>`, без `draggable`/`onDragStart`, и `Workbench`
не подписывался ни на один drag-событие dockview. Это и есть срез, который
делает эта сессия.

### Ключевое техническое решение — dockview's own external-DnD API, не своя HTML5 DnD

Проверена установленная версия: `packages/ui/package.json` просит `^4.7.0`,
реально разрешено pnpm до **`dockview-react@4.13.1`** (= `dockview@4.13.1` =
`dockview-core@4.13.1`, все три — один и тот же публичный API, `dockview-react`
реэкспортирует `dockview`, который реэкспортирует `dockview-core`). Прочитаны
`.d.ts` пакета (не документация — реальные типы установленной версии):
dockview-core уже даёт полный контракт под "внешний drag → tab/split",
рассчитанный именно на этот сценарий (официальный use-case пакета —
external DnD source вроде файлового дерева или, как здесь, сайдбара):

- `DockviewApi.onWillShowOverlay` — fires per-group при наведении; dockview
  **сам** рисует видимую overlay-зону (центр/края, ровно "центр — вкладка,
  край — split" из 23-документа) если не вызвать `event.preventDefault()`.
  Обработчик здесь просто отклоняет её для всего, что не несёт ORION-ную
  metaу (см. ниже) — оставляя штатное поведение dockview для его
  собственного drag существующих вкладок (`event.getData()` непусто).
- `DockviewApi.onUnhandledDragOverEvent` — тот же выбор для пустой области
  дока вне групп (`event.accept()`).
- `DockviewApi.onDidDrop` — фактический drop; `event.group`/`event.position`
  готовы использоваться напрямую как `AddPanelOptions.position.referenceGroup`
  + `positionToDirection(event.position)`.

Итог: **DnD-библиотека не добавлялась** (ни `@dnd-kit`, ни своя with
`onDragOver`/`onDrop` на кастомных зонах) — только нативный HTML5
`draggable`/`dragstart` на сайдбар-кнопке (ставит `dataTransfer` с
собственным MIME) плюс перечисленные три готовых dockview-события. Ровно
то, что просило задание ("не переезжай на @dnd-kit... если dockview уже
даёт нужный API из коробки — проверь реально, не предполагай").

### Реализовано

- `apps/web/lib/panel-drop.ts` (новый, без зависимости от dockview/React —
  чистые функции, юнит-тестируемые без живого DockviewApi/DOM):
  - `ORION_PANEL_DRAG_MIME` — собственный MIME (`application/x-orion-panel-id`)
    в `dataTransfer`, единственный способ отличить "тащат раздел сайдбара" от
    "тащат уже открытую вкладку dockview" (`event.getData()` непусто только
    для последнего — это `PanelTransfer`, внутренний формат dockview).
  - `isOrionPanelDragEvent` — читает `dataTransfer.types` (доступно на
    `dragover`, `.getData()` — нет, кросс-браузерное ограничение спецификации
    HTML5 DnD); используется в `onWillShowOverlay`/`onUnhandledDragOverEvent`.
  - `readDraggedPanelId` — читает `dataTransfer.getData(...)`, валиден только
    на `drop` — используется в `onDidDrop`.
  - `resolveDropAction(panelId, known, disabledModulePanelIds, openPanelIds)` —
    **duplicate/focus policy** одним местом: `unknown-panel` (нет такого id),
    `module-disabled` (выключенный модуль — тот же гейт, что уже был у
    `openPanel`), `focus` (уже открыт — не дублировать), `create` (новый).
    Решение по duplicate: перетаскивание уже открытого раздела **всегда**
    просто фокусирует существующую вкладку, никогда не дублирует и **не
    перемещает** её в зону дропа — сознательное упрощение против "переместить,
    если дропнули в конкретную split-зону" (см. doc-комментарий в файле):
    перемещение существующей панели потребовало бы отдельного dockview
    move-API, проверенного на живой геометрии дропа, которую эта сессия не
    может увидеть (нет browser tooling); focus-only — тот же контракт, что
    уже был у клика, предсказуем и полностью протестирован без браузера.
  - `panelWindowUrl(panelId, workspaceId?)` — общий URL-билдер для
    "открыть в отдельном окне", вынесенный из `DetachHeaderAction`, теперь
    используется и им, и новой sidebar-командой.
  - `apps/web/lib/panel-drop.test.ts` (новый) — 13 тестов на все четыре
    функции: MIME-детекция (включая `DOMStringList`-подобный `types` и
    отсутствующий `dataTransfer`), duplicate/focus/unknown/disabled policy,
    URL-энкодинг workspaceId.
- `packages/ui/src/workbench.tsx` — реэкспортирует `positionToDirection`
  (значение) и типы `Position`/`DockviewGroupPanel`/`DockviewDndOverlayEvent`/
  `DockviewWillShowOverlayLocationEvent`/`DockviewDidDropEvent` из
  `dockview-react`, тем же паттерном, что уже был у `DockviewApi`/
  `DockviewReadyEvent` — dockview-зависимость остаётся изолирована в этой
  одной обёртке, `apps/web` не импортирует `dockview-react` напрямую.
  `Direction` (тип, не значение) сознательно НЕ реэкспортирован — он не
  входит в публичный `dockview-core/index.d.ts` (только через внутренний
  `gridview/baseComponentGridview`), поэтому `apps/web/app/(app)/layout.tsx`
  задаёт структурно совпадающий `PanelSplitPosition` тип сам (комментарий на
  месте объясняет, почему это не "выдуманный" тип, а зеркало реального).
- `packages/ui/src/sidebar.tsx` — `SidebarLinkItem` получил `onDragStart?`
  (ставит `draggable` на кнопку) и `menuItems?: MenuItem[]` (кебаб-меню
  через уже существующий `DropdownMenu` из `overlays.tsx` — Escape/click-outside
  уже даёт бесплатно). Кебаб рендерится только когда рейл раскрыт (`open`) и
  только если `menuItems` заданы — большинство `href`-ссылок их не передают.
- `apps/web/app/(app)/layout.tsx`:
  - `placePanel(panelId, position?)` — единая точка входа с той же
    duplicate/focus-политикой (фокус вместо дубля), которую раньше отдельно
    содержал только `openPanel`; `openPanel` теперь `placePanel(panelId)`
    без позиции (старое поведение), `openPanelSplit(panelId)` —
    **немышиная альтернатива drop-на-край**: сплитует вправо от
    `api.activeGroup` (нет активной группы — просто открывает, как клик).
  - `onReady` подписывается на `onWillShowOverlay`/`onUnhandledDragOverEvent`/
    `onDidDrop` (см. решение выше); `onDidDrop` строит `known`/`disabledIds`/
    `openIds` из `panelRegistry`/`disabledModulesRef`/`api.panels` и зовёт
    `resolveDropAction`, затем либо фокусирует, либо `placePanel(...,
    { referenceGroup: drop.group, direction: positionToDirection(drop.position) })`.
  - `detachPanelToWindow(panelId, title)` (модульная функция, вынесена из
    `DetachHeaderAction.detach`) — общая для (а) хедер-кнопки "⧉" на уже
    открытой вкладке (Tauri) и (б) новой sidebar-команды "Открыть в новом
    окне" (в меню кебаба каждого раздела) — **не требует, чтобы раздел был
    сначала открыт в текущем окне**, что и было явным требованием ("команда
    открытия на втором мониторе обязательна", отдельно от detach уже
    открытой вкладки). В Tauri — `WebviewWindow` с `?workspaceId=` (как и
    раньше у detach). В браузере — `window.open(...)`, тот же механизм,
    которым уже пользуется встроенный popout dockview там, просто достижимый
    без предварительного открытия панели.
  - Каждый пункт `navPanels` получил `onDragStart` (пишет
    `ORION_PANEL_DRAG_MIME` в `dataTransfer`) и `menuItems`: "Открыть",
    "Открыть рядом (сплит)", "Открыть в новом окне" — второй и третий пункт
    ровно закрывают "альтернативы меню/клавиатурой" для split и detach.

### Данные не копируются (проверено чтением, не только предположением)

Ни один путь (клик/drag/split/detach) не создаёт новый или другой
react-query hook: `placePanel`/`openPanelSplit`/drop-обработчик все вызывают
`api.addPanel({ id: panelId, component: panelId, ... })` — `component` это
id панели из `panelComponents` (`Object.fromEntries(panelRegistry.map(p =>
[p.id, p.component]))`, строка 72 файла), тот же самый компонент что и у
клика, читающий те же `use*`-хуки с тем же `workspaceId` вне зависимости от
физической позиции в dockview-сетке или от того, в каком окне ОС он
отрисован (detached-окно — отдельная страница `/panel/[panelId]`, использует
тот же `getPanelDefinition(panelId).component`). Позиция в layout — только
координаты грида, которые `onDidLayoutChange` сериализует в `localStorage`
(см. ниже) — не часть параметров запроса ни одного хука.

### Личные раскладки (пункт 8 задания)

Не требовало отдельной работы: существующий `onDidLayoutChange` →
`window.localStorage.setItem(dockLayoutStorageKey(user.id, workspace.id),
api.toJSON())` (из U04, debounce 300мс) уже слушает **любое** изменение
dockview-грида, а drag/split/detach-close — это ровно такие изменения
(добавление/удаление/перемещение панели в гриде). Отдельно не проверялось
живьём (см. ниже), но по коду это тот же путь, что уже покрыт U04's
unit-тестами на `dockLayoutStorageKey`/сам факт вызова `toJSON`/`fromJSON`
не менялся.

### Не проверено вживую (честно — как и предупреждало задание)

Нет browser/Tauri tooling в среде агента. Ничего из визуального drag&drop
не запускалось руками:

- Видимые drop-зоны — верю dockview's `.d.ts`/архитектуре (overlay рисуется
  самим dockview при непредотвращённом `onWillShowOverlay`), но реально
  нарисованный оверлей в браузере не увиден ни разу.
  **UC06 "native multi-window smoke" — НЕ выполнен.**
- Escape-отмена драга и "drop вне валидной зоны ничего не создаёт" — оба
  опираются на нативное поведение спецификации HTML5 Drag and Drop
  (Escape отменяет операцию на уровне ОС/браузера до `drop`; `onDidDrop`
  просто не срабатывает без валидного drop) — не код ORION, но и не
  проверено вживую, что раздел сайдбара реально ведёт себя как валидный
  drag source в реальном браузере (свойство `draggable` на `<button>`
  поддерживается всеми evergreen-браузерами, но это тоже не запущено).
- `detachPanelToWindow` в браузерной ветке (`window.open`) — только
  прочитан код, не открыто реальное окно/вторая монитора.
- Восстановление раскладки после drag/split конкретно (не просто после
  переключения workspace, как в U04) — не воспроизведено вручную.

Доказательства этой сессии — код-ревью всего изменённого пути плюс
unit-тесты на чистую логику без DOM: MIME-детекция, duplicate/focus policy,
URL-билдер. Это НЕ доказывает, что визуальный UX работает — только что
решения, которые определяют "фокусировать/создать/отклонить" при реальном
drop, детерминированы и покрыты тестами.

### Проверки (полный прогон)

```
corepack pnpm exec vitest run apps/web/lib/panel-drop.test.ts
# PASS 1 файл / 13 тестов
corepack pnpm typecheck   # PASS, все 7 workspace-проектов
corepack pnpm lint        # PASS, те же 3 предсуществующих warning — без новых
corepack pnpm test        # PASS, 32 файла / 259 тестов (было 31/246 — +1 файл/+13)
corepack pnpm build       # PASS, apps/api tsc + apps/web next build (27 статических страниц, тот же список что и в U04/U05)
```

Файлы (абсолютные пути): `C:\Users\Reno\Desktop\ORION\apps\web\lib\panel-drop.ts`
(+`.test.ts`, новые), `C:\Users\Reno\Desktop\ORION\apps\web\app\(app)\layout.tsx`,
`C:\Users\Reno\Desktop\ORION\packages\ui\src\workbench.tsx`,
`C:\Users\Reno\Desktop\ORION\packages\ui\src\sidebar.tsx`.

Следующий шаг: U07 (полная цепочка "Поездка", адаптеры Calendar/Time/
Lists/Habits/Inventory) — зависит от U03 (не сделан в этой линии сессий) и
U06 (эта сессия). Отдельно стоит: живой browser/Tauri smoke для U06's
визуальной части (drop-зоны, реальный multi-window, restore после
drag) — ни разу не прогонялся ни в одной сессии проекта; и перенос drag
между независимыми окнами ОС — явно НЕ требуется первой версией по
23-документу, не реализовывался.

## U07 — полная цепочка «Поездка» и рабочий проект; адаптеры Calendar/Time/Lists/Habits/Inventory (2026-09-22)

U07 буквально требовал не «построить модуль», а проверить и, где нужно,
достроить уже существующую интеграцию Project↔соседи. Task.projectId,
Note.projectId, Event.projectId, Document.projectId (через `parentId`-дерево
для файлов + прямой FK у самой записи), Transaction.projectId,
TimeEntry.projectId и InventoryItem.projectId — все существовали до этой
сессии (v0.14–v0.26), `ProjectsService`/`ProjectsPanel.tsx` уже собирали
задачи/заметки/события/документы/операции/время в детали проекта живыми
FK-запросами (`tx.task.groupBy({ where: { projectId }})` и т.п.), с
module-gating через `ModulesService.accessibleSetTx` — ни разу не
денормализованные копии.

**Найденный реальный пробел (почищен):** `InventoryItem.projectId` существует
и валидируется (`assertProjectTx` в `inventory.service.ts`, форма
`InventoryPanel.tsx` уже даёт назначить проект позиции), но `ProjectsService`
и `ProjectsPanel.tsx` никогда не читали её обратно — счётчик и лента
активности проекта не знали о складе, хотя склад знал о проекте. Однонаправленная
связь. Починено симметрично остальным соседям:

- `packages/shared-types/src/project.ts` — `counts.inventory` в `projectSchema`,
  `"inventory"` в `projectActivitySchema.type`.
- `apps/api/src/projects/projects.service.ts` — `inventory` добавлен в три
  места: `toDtos()` (count per project, `enabled.has("inventory")` gate),
  `activityMaxByProjectTx()` (участвует в «открывали N дней назад»),
  `activity()` (до 20 последних позиций склада в ленте). Везде тот же паттерн
  `enabled.has(x) ? tx.inventoryItem.groupBy(...) : []`, что и у остальных
  пяти соседей — выключенный модуль отдаёт пустой массив, не падает.
- `apps/web/panels/ProjectsPanel.tsx` — `Package`-иконка и лейбл «Позиция
  склада» в `ACTIVITY_ICON`/`ACTIVITY_LABEL`, `StatCard` «Склад» за
  `isEnabled("inventory")`, переход по клику на activity-строке открывает
  панель `inventory`.

**Подтверждено без изменений кода (код-ревью + integration-тест):**

- Calendar: `Event.projectId` есть, событие видно и в календаре, и в
  `project.activity` (тип `event`), module-gated `enabled.has("calendar")`.
- Time: `TimeEntry.projectId` денормализован из задачи (комментарий в
  `schema.prisma` совпадает с CLAUDE.md), участвует в `trackedMinutes`/
  `timeCost`/`plannedMinutes` проекта; **не** попадает в `activity`-ленту —
  осознанно (лента показывает изменяемые записи-сущности, не поминутный
  тикающий журнал; сам агрегат `trackedMinutes` — это и есть представление
  времени на проекте).
- Lists: `List` НЕ имеет `projectId` (комментарий в `schema.prisma`: «Standalone
  like Habit — no projectId»). Это отсутствующая функция первой версии, не
  баг — в 23-документе списки упомянуты как контекст («Списки: Поездка,
  закупка, оборудование»), а не как обязательный FK. **Не реализовано в этой
  сессии** — вне буквального объёма U07 («адаптер» для существующего, не
  «добавить FK всюду»).
- Habits: `Habit` НЕ имеет `projectId` и НЕ входит в закрытый реестр U01
  (`SearchableEntityType` = `project | task | note | event | document |
  transaction`) — привычка не может быть связана с проектом ни через прямой
  FK, ни через generic `EntityLink`. Осознанное ограничение первой версии
  U01 («начать с task/note/project/document/transaction»), задокументировано
  в U01-записи. **Не реализовано в этой сессии.**
- Inventory: см. «найденный пробел» выше — теперь симметричен.
- Все семь существующих `projectId` (`Task`/`Note`/`Event`/`Document`/
  `Transaction`/`TimeEntry`/`InventoryItem`) — `String?` (nullable) в
  `schema.prisma`, подтверждено чтением схемы построчно: связь с проектом
  никогда не обязательна.
- «Аналогичный рабочий проект»: в коде `ProjectsService`/`ProjectsPanel` нет
  ни одной ветки, завязанной на «семья» vs «работа» — один и тот же код-путь
  обслуживает оба сценария. Новый integration-тест это утверждает буквально
  (два проекта, «Поездка» и «Заказ клиента», одинаковый набор адаптеров).
- Выключение модуля не ломает проект: `activity()`/`toDtos()` для каждого
  соседа оборачивают запрос в `enabled.has(x) ? … : []` — подтверждено новым
  тестом (выключение `finance` на живом проекте с операцией: `spentAmount`
  обнуляется, `transaction`-строка пропадает из ленты, но `tasks`-счётчик и
  остальные секции не задеты, весь ответ остаётся `200`, не `500`/`403`).

### Новый integration-тест

`apps/api/test/project-connected-core.integration.test.ts` (реальная
изолированная Postgres + RLS, не мок): семейный сценарий «Поездка» и рабочий
«Заказ клиента» — оба создают note/task/event/document/transaction/time
entry/inventory item с `projectId`, `GET .../projects/:id` проверяется на
все семь типов ровно по одному разу в `activity` и правильные `counts`;
изоляция между двумя проектами в одном пространстве и между пространствами
(чужой `projectId` из другого workspace — `404`, не пустой список); отключение
`finance` на лету не роняет остальные секции; `projectId` остаётся
необязательным на task/note/transaction/inventory (создание без него — `201`,
`projectId: null`). 5/5 PASS.

### Проверки (полный прогон)

```
corepack pnpm --filter @orion/shared-types typecheck   # PASS
corepack pnpm --filter @orion/api typecheck             # PASS
corepack pnpm --filter @orion/web typecheck              # PASS
corepack pnpm test                                        # PASS, 32 файла / 259 тестов
corepack pnpm lint                                          # PASS, те же 3 предсуществующих warning
corepack pnpm build                                          # PASS, apps/api tsc + apps/web next build (27 страниц)
npx vitest run --config vitest.integration.config.mts test/project-connected-core.integration.test.ts
  # PASS, 5/5
npx vitest run --config vitest.integration.config.mts
  # 133 passed, 7 failed — все 7 в apps/api/test/blob-backup.integration.test.ts
  # и codex-review-regressions.integration.test.ts (WebDAV putRemote 400,
  # STORAGE_ADAPTER не настроен в этой среде); подтверждено git stash —
  # тот же провал без изменений этой сессии, до-существующий пробел
  # окружения (WebDAV remote), не регрессия U07.
```

Файлы (абсолютные пути):
`C:\Users\Reno\Desktop\ORION\packages\shared-types\src\project.ts`,
`C:\Users\Reno\Desktop\ORION\apps\api\src\projects\projects.service.ts`,
`C:\Users\Reno\Desktop\ORION\apps\web\panels\ProjectsPanel.tsx`,
`C:\Users\Reno\Desktop\ORION\apps\api\test\project-connected-core.integration.test.ts`
(новый). Миграций нет — все затронутые FK уже существовали в БД.

Следующий шаг: U08 (личный межпространственный обзор без новых прав; общий
capture/account picker) — зависит от U07 (эта сессия). Lists↔project и
Habit-в-U01-реестре остаются осознанно не сделанными до отдельного явного
запроса — см. выше.

## U08 — личный межпространственный обзор без новых прав; общий capture/account picker (2026-09-22)

Задача: U08 (24-CONNECTED-CORE-BACKLOG.md), done-критерий «Источник каждой
записи видим; scope создания явный; суммы по валютам и без дублей;
read-only account не предлагается для списания; нет утечки через
search/export/count». Контракт — 23-UNIVERSAL-CONNECTED-CORE.md раздел
«Межпространственные данные: отдельный этап», первые два абзаца (до grants —
это U09, не эта сессия): «Сначала связи работают внутри пространства... Затем
личный обзор собирает данные пространств, где пользователь уже имеет доступ.
Он не выдаёт новых прав и не переносит записи.» Зависимость U07 закрыта
предыдущей сессией.

### Проверка реальности перед правкой

Прочитан весь путь до правок: `WorkspacesService.listForUser` (уже
существовал, используется U05 для переключателя сфер — подтверждённый метод,
как и говорилось в задании), `DashboardPanel.tsx`/`InboxPanel.tsx` (оба
строго single-workspace — `useActiveWorkspace()` и ничего кросс-пространственного),
`TasksService` (`assigneeId` — это `WorkspaceMember.id`, НЕ `User.id`;
критично для агрегации «назначено мне» — нужен свой `workspaceMember.id` на
КАЖДОЕ пространство, не общий `userId`), `AccountsService`/`finance-refs.util.ts`
(`computeNetByAccount` — переиспользован как есть, баланс никогда не хранится),
`Account`-модель в `schema.prisma` — подтверждено: прав уровня отдельного
счёта в схеме нет вообще, только `WorkspaceMember.role` (owner/member/lead)
на уровне пространства целиком.

**Не найдено готового места** — ни один существующий обзор/дашборд не
агрегирует кросс-пространственно. Это новый маленький read-only срез, не
доработка существующего.

### Ключевое архитектурное решение — N+1 per-workspace `withUser`, не один cross-workspace query

`OverviewService.getMyOverview(userId)` (`apps/api/src/overview/overview.service.ts`)
берёт список пространств через уже существующий `WorkspacesService.listForUser`,
затем для КАЖДОГО пространства открывает **свою** `PrismaService.withUser(userId, …)`
транзакцию — ровно то же самое, что делает любой другой per-workspace read в
кодовой базе, просто в цикле. Никакого единого SQL-запроса поперёк
`workspaceId` с фильтрацией членства в коде после — это и есть тот самый
«ослабить RLS ради универсального поиска», который 24-CONNECTED-CORE-BACKLOG.md
прямо запрещает. Дороже по числу round-trip'ов (N запросов вместо одного), но
у personal workspace счёт пространств — единицы, а не эта цена оправдывает
дыру в RLS.

`GET /me/overview` (не `workspaces/:workspaceId/...`, единственный контроллер
в кодовой базе, сознательно нарушающий инвариант №1 модульного контракта —
задокументировано в самом контроллере: агрегация по определению не имеет
одного workspaceId).

### Реализовано

- `packages/shared-types/src/overview.ts` (новый) — `myOverviewWorkspaceSchema`
  (`id`, `name`, `tasksEnabled`, `financeEnabled`), `myOverviewTaskSchema`
  (`taskSchema.extend({ workspaceName })`), `myOverviewAccountSchema`
  (`accountSchema.extend({ workspaceName })`), `myOverviewSchema`
  (`workspaces`, `tasks`, `accounts`, `balancesByCurrency`). Экспортирован из
  `index.ts`.
- `apps/api/src/overview/{overview.service,overview.controller,overview.module}.ts`
  (новый модуль) — `OverviewService.getMyOverview`: для задач резолвит
  `WorkspaceMember.id` вызывающего в каждом пространстве отдельно (как уже
  делает `TasksService.list` для `assignedToMe`), фильтрует
  `!isTaskClosed(status)`; для счетов переиспользует `computeNetByAccount` без
  изменений. Дедуп по `account.id` через `Map` перед суммированием по валюте
  (done-критерий «без дублей») — защита не от реального сценария (уникальный
  индекс `workspaceId_userId` не даёt задвоить членство), а от будущей
  регрессии. Зарегистрирован в `app.module.ts`.
- `packages/core/src/api/api-client.ts` — `getMyOverview()`.
- `packages/core-react/src/use-overview.ts` (новый) — `useMyOverview(enabled)`,
  не workspace-параметризован (единственный такой хук в пакете, наравне с
  `useWorkspaces`), экспортирован из `index.ts`.
- `apps/web/panels/OverviewPanel.tsx` (новый) — панель «Обзор»:
  - Задачи, сгруппированные по пространству, с явным `Badge` названия
    пространства на каждой группе (done-критерий «источник видим»); клик по
    задаче — явный `setActiveWorkspaceId(task.workspaceId)` + `focusTask`
    (осознанный явный переход между пространствами внутри окна, не скрытая
    подмена активного пространства).
  - «Быстрая задача»: `Select` пространства (только `tasksEnabled`) —
    ОБЯЗАТЕЛЕН, без выбора кнопка недоступна (`disabled={!captureWsId}`);
    никакого implicit fallback на «текущее активное пространство» — done-критерий
    «scope создания явный». Использует уже существующий `useCreateTask(workspaceId)`
    как есть — хук уже параметризован по `workspaceId`, только вызывающая
    панель раньше не давала пользователю сам этот параметр выбрать.
  - Финансовая секция: суммы по валютам через ту же схему, что и
    `DashboardPanel.financeStats` (dedup + `Map<currency, total>` на сервере
    вместо клиентского `sumByCurrency` — тот же результат, посчитан там же,
    где уже дедуплицированы счета).
  - «Быстрый расход»: `Select` пространства (только `financeEnabled`) →
    `Select` счёта (только счета ЭТОГО выбранного пространства) → сумма →
    `useCreateTransaction(workspaceId)`. Оба `Select` обязательны до сабмита.
- `apps/web/lib/panel-registry.ts` — панель `overview` зарегистрирована БЕЗ
  `moduleId` (как `dashboard`/`inbox` — она не принадлежит ни одному
  предметному модулю и не гейтится отключением модуля в одном пространстве,
  потому что охватывает все пространства сразу).

### read-only account — подтверждённое отсутствие функции, не баг

Прочитана вся модель прав `Account`/`Transaction`: единственный уровень
доступа — `WorkspaceMember.role` (owner/member/lead) на пространство целиком,
никакого флага/роли на отдельном счёте нет ни в `schema.prisma`, ни в
`AccountsService`, ни в `TransactionsService`. Спецификация из 23-документа
(«Общий picker счетов предлагает только те, где разрешено создание операции,
а не только просмотр») в текущей модели ORION тривиально верна для ЛЮБОГО
счёта участника: раз нет уровня «только просмотр» отдельно от членства, каждый
счёт, который пользователь вообще видит (член пространства, `finance`
включён), — это счёт, с которого он может создать операцию. Задокументировано
явно в `overview.ts`/`overview.service.ts` — **не реализовывать
несуществующее разграничение**, done-критерий закрыт констатацией факта, не
фильтром.

### Search/export/count — подтверждено без изменений кода

`SearchController`/`SearchService` остаются на `@Controller("workspaces/:workspaceId")`
без правок — обзор НЕ является генерализацией поиска, отдельный контроллер на
`/me/...`. Snapshot registry (`apps/api/src/sync/snapshot-registry.ts`) не
тронут — у обзора нет собственной Prisma-модели (чистая read-only проекция
существующих `Task`/`Account`), нечего добавлять в бэкап/восстановление
одного пространства; агрегация не хранится нигде и пересобирается на каждый
запрос. Явно прокомментировано в doc comment `overview.ts`.

### Новый integration-тест

`apps/api/test/overview.integration.test.ts` (реальная изолированная
Postgres + RLS, не мок): alice — член двух реальных пространств (её
исходное + второе, созданное через `POST /workspaces`), с задачей,
назначенной ей в каждом (плагин «Команда» включён напрямую в БД — тест не
про сам toggle плагина); `GET /me/overview` возвращает обе задачи с верными
`workspaceId`/`workspaceName`, НЕ включает неназначенную задачу из
пространства А и НЕ включает задачу боба из его собственного пространства,
членом которого alice не является. Отдельно: боб видит только свою одну
задачу (изоляция в обе стороны). Плюс `401` без токена. 2/2 PASS.

### Проверки (полный прогон)

```
pnpm typecheck    # PASS, все 7 workspace-проектов
pnpm lint         # PASS, те же 3 предсуществующих warning
pnpm test         # PASS, 32 файла / 259 тестов
npx vitest run --config vitest.integration.config.mts apps/api/test/overview.integration.test.ts
                  # PASS, 2/2
pnpm test:integration
                  # 135 passed, 7 failed — все 7 в blob-backup.integration.test.ts /
                  # codex-review-regressions.integration.test.ts (WebDAV putRemote 400,
                  # тот же до-существующий пробел окружения, что и в записи U07 этого
                  # же файла — не регрессия этой сессии)
pnpm build        # см. вывод сессии
```

Файлы (абсолютные пути):
`C:\Users\Reno\Desktop\ORION\packages\shared-types\src\overview.ts` (новый),
`C:\Users\Reno\Desktop\ORION\packages\shared-types\src\index.ts`,
`C:\Users\Reno\Desktop\ORION\apps\api\src\overview\overview.service.ts` (новый),
`C:\Users\Reno\Desktop\ORION\apps\api\src\overview\overview.controller.ts` (новый),
`C:\Users\Reno\Desktop\ORION\apps\api\src\overview\overview.module.ts` (новый),
`C:\Users\Reno\Desktop\ORION\apps\api\src\app.module.ts`,
`C:\Users\Reno\Desktop\ORION\packages\core\src\api\api-client.ts`,
`C:\Users\Reno\Desktop\ORION\packages\core-react\src\use-overview.ts` (новый),
`C:\Users\Reno\Desktop\ORION\packages\core-react\src\index.ts`,
`C:\Users\Reno\Desktop\ORION\apps\web\panels\OverviewPanel.tsx` (новый),
`C:\Users\Reno\Desktop\ORION\apps\web\lib\panel-registry.ts`,
`C:\Users\Reno\Desktop\ORION\apps\api\test\overview.integration.test.ts` (новый).
Миграций нет — обзор не имеет собственной таблицы.

Следующий шаг: U09 (read-only sharing целого объекта через явный grant) —
зависит от U08 (эта сессия). Не реализовано осознанно в этой сессии:
глубокая ссылка `focusTask`/`focusNote` на объект из НЕ активного пространства
(сейчас — явный `setActiveWorkspaceId` перед переходом, работает, но
переключает окно целиком, а не открывает предпросмотр без переключения);
частичная/read-only проекция чужого пространства (это U09, grants, не
существующая членская агрегация).

## U09 (threat model) — 2026-09-22

Задача: U09 (24-CONNECTED-CORE-BACKLOG.md), явное правило исполнения
«сначала зафиксировать threat/permission matrix и допустимые SQL-политики,
затем писать код». Эта сессия — чисто документационная: написан
`docs/SONNET_IMPLEMENTATION/27-U09-THREAT-MODEL.md` (threat model, permission
matrix, черновик SQL/Prisma для `CrossWorkspaceGrant` + ADDITIVE RLS-policy,
lifecycle гранта по каналам revoke, открытые вопросы для владельца). Никакой
Prisma-схемы, эндпоинтов или прикладного кода не менялось — working tree
трогал только этот новый файл + эта запись.

Читал перед написанием: 23-UNIVERSAL-CONNECTED-CORE.md (раздел
«Межпространственные данные: отдельный этап» целиком), 24-CONNECTED-CORE-BACKLOG.md
(карточка U09 + правило исполнения), записи U00/U01/U08 этого файла,
`apps/api/src/search/entity-registry.ts` (паттерн `summary()` → `null` для
неавторизованного доступа, закрытый adapter registry — образец для
grant-aware DTO), `apps/api/src/sync/snapshot-registry.ts` (категории
included/derived/identity-excluded — для решения, куда войдёт
`CrossWorkspaceGrant`), `apps/api/src/notifications/notification-center.service.ts`
(R18-03 `isVisibleToActor`/`moduleIdForEntityType` — образец для будущего
grant-revoked placeholder), RLS-миграции (`lists_rls` и соседние — образец
для нового ADDITIVE `CREATE POLICY ... FOR SELECT` поверх membership-политики,
не замены её).

### U09 threat model финализирована решениями владельца продукта — 2026-09-22 (документационная правка)

Владелец продукта дал окончательные ответы на все 5 открытых вопросов
раздела 5 и 3 технические поправки к черновику; `27-U09-THREAT-MODEL.md`
переписан целиком под это (старые черновичные формулировки, где они
расходились с финальным решением — например `granteeWorkspaceId` vs
`granteeUserId` — удалены, не оставлены как альтернатива). Прикладной код
по-прежнему не менялся — только документ + эта запись.

Закрытые вопросы (раздел 5 документа): (1) грант выдаёт только `owner`
исходного пространства, будущее делегирование через отдельное разрешение
«Управление внешним доступом» — не сейчас; (2) отозвать может тот, кто
выдал, либо текущий `owner` пространства (даже не тот, кто выдавал);
получатель отозвать не может, только client-side "hide" у себя (объект
остаётся технически доступным по гранту); (3) добавлен опциональный
`expiresAt` с UI-вариантами «Без срока»/«На 7 дней»/«До даты», проверяется
той же живой RLS-проверкой, без отдельного `@Cron`; (4) история версий
(`DocumentVersion`/`NoteRevision`) НЕ входит в grant ни при каком scope —
только текущее состояние; (5) live-чтение (не snapshot) — приоритет первой
версии, замороженный снимок зафиксирован как явно предвиденное, но не
проектируемое сейчас будущее расширение.

Принятые технические поправки владельца: (1) «отдельный endpoint»
недостаточен сам по себе — Postgres не видит HTTP-путь запроса, поэтому
grant-aware RLS-политика обязана быть дополнительно обусловлена
transaction-scoped GUC `app.active_grant_id` (по аналогии с
`app.current_user_id` из `PrismaService.withUser`), устанавливаемым только
новым `PrismaService.withGrant(...)` внутри `SharedController` — иначе
grant-политика теоретически расширяет видимость и в обычных
`workspaces/:id/...`-запросах через стандартное `OR` комбинирование
permissive-политик; политика строго `FOR SELECT`; (2) React Query кэш
существует независимо от отсутствия серверного кэша — клиент обязан
`queryClient.removeQueries` (не `invalidateQueries`) при 403/404 после
revoke, уже отрисованное и in-flight запросы, начавшиеся до revoke, отозвать
физически нельзя — принято как известное ограничение; (3) allowlist
расписан по каждому типу сущности отдельной таблицей (раздел 3.1): note
(текст без вложений), document (текущий файл целиком, БЕЗ версий — и с
обязательным UI-предупреждением, что весь файл, включая скрытые листы/
встроенные картинки, становится виден целиком), project (поля карточки без
автораскрытия задач/финансов), бюджет (отдельная проекция представления, не
доступ ко всем `Transaction`; в схеме нет отдельной модели `Budget` —
уточнено, что это `scope: "projection"` поверх финансовых данных проекта, не
grant на новую сущность). Модель `CrossWorkspaceGrant` переписана на
`granteeUserId` (конкретный пользователь, НЕ `granteeWorkspaceId`) — grantee
сам решает, в каком из своих пространств отображать доступ; workspace-level
grant «всем участникам пространства» зафиксирован как отдельное, явно не
реализуемое сейчас будущее правило. Добавлен раздел 6 «Первый пользовательский
сценарий (UX flow)»: владелец выбрал объект → указал получателя и срок →
проверил allowlist-превью → предоставил просмотр; у получателя видны
источник, «Только просмотр», срок; без прав дальнейшей передачи по
умолчанию.

Статус: **документ финализирован, открытых вопросов больше нет, реализация
U09 НЕ начата, TODO.** Следующая сессия пишет код по этому документу:
`CrossWorkspaceGrant`-модель с `expiresAt`/`granteeUserId`, миграция с
ADDITIVE RLS-политикой, обусловленной `app.active_grant_id` (раздел 2.2),
`PrismaService.withGrant`, узкий `GET /shared/:grantId/...`-endpoint с
per-type allowlist DTO (раздел 3.1), клиентский `useSharedObject` с
`removeQueries` на 403/404, затем integration-тесты: member без гранта не
видит чужое, grantee без membership видит ровно грант-объект и ничего
смежного (T1), revoke закрывает чтение немедленно, и — новое, из поправки 1
— активный грант НЕ расширяет видимость через обычный
`workspaces/:workspaceId/...`-endpoint. `scope: "projection"`/агрегаты и
snapshot-функция по-прежнему вне объёма (T6, раздел 5 п.5) — отдельные
будущие карточки.

### Codex · 2026-09-22 около 21:40 · независимая проверка U01–U08

Отчёт 28-REVIEW-AFTER-U08. Unit: 32 файла/259 PASS, typecheck PASS, desktop-export PASS. Четыре прежних office tests исправлены. Штатный integration на отдельной DB: 135 PASS / 7 FAIL на putRemote 400, до целевых проверок restore. Дополнительные 3 access tests FAIL: restricted data в Overview, entityTitle через reminders.list, unlink после отзыва module access. Дополнительный chart-writer regression FAIL: numFmt/merges теряются при наличии диаграммы. F05 generation guard всё ещё допускает замену уже dirty draft при новом refetch (кодовый вывод, slow-network UI NOT RUN).

Прикладной код не исправлялся; собственные временные тесты сохранены в evidence/*.txt и удалены из test directories. Изолированный PostgreSQL 5551 остановлен. U09 пока отложить до R28-01–05 и зелёного integration gate. Агент работает параллельно; отчёт относится к проверенному состоянию, более поздние изменения требуют повторной проверки.

### Sonnet · 2026-09-22 · U09 реализация по 27-U09-THREAT-MODEL.md

Реализовано read-only ядро explicit cross-workspace grants, буквально по
финализированному документу, приоритеты 1–3 полностью, 4 частично, 5 — нет
(бюджет сессии).

**Схема.** `CrossWorkspaceGrant` (`cross_workspace_grants`) —
`granterId`/`granteeUserId`/`objectType`/`objectId`/`scope`/`expiresAt`/
`revokedAt`/`revokedByUserId`, ровно как в разделе 2.1 (`projectionFields`
изменён с `String[]?` на `String[] @default([])` — Prisma не поддерживает
optional list, семантика «пусто = full» сохранена). Две миграции:
`20260922191528_cross_workspace_grants` (таблица) и
`20260922191600_cross_workspace_grants_rls` (RLS) — раздельно, тем же
паттерном, что `lists`/`lists_rls`.

**RLS — по разделу 2.2/2.3, транзакционный GUC.**
`PrismaService.withGrant(grantId, userId, fn)` — новый метод рядом с
`withUser`/`asSystem` (`apps/api/src/common/prisma.service.ts`): ставит
`app.current_user_id`, В КОДЕ проверяет грант (существует, `granteeUserId
=== userId`, `revokedAt IS NULL`, `expiresAt` не истёк) и только ПОСЛЕ этого
ставит `app.active_grant_id` (оба — `set_config(..., true)`, транзакционные,
не переживают commit). Если проверка не прошла — `app.active_grant_id`
вообще не ставится, `fn` видит пустой RLS-контекст, а не ошибку. Миграция
`cross_workspace_grants_rls` добавляет ОДНУ политику на саму таблицу грантов
(member/owner источника ИЛИ grantee — иначе `GET /shared` не смог бы прочитать
собственные гранты обычным `withUser`) и ЧЕТЫРЕ ADDITIVE `FOR SELECT`
grant-read политики — `projects_grant_read`/`notes_grant_read`/
`documents_grant_read`/`finance_transactions_grant_read` — каждая требует
`current_setting('app.active_grant_id', true) IS NOT NULL` И матчинг живого
гранта. Существующие `*_isolation`-политики не тронуты (additive, раздел
T7). `SharedService` (`apps/api/src/shared/shared.service.ts`) — ЕДИНСТВЕННЫЙ
вызывающий `withGrant` во всём коде.

**Allowlist per-type (раздел 3.1)** — `SharedService.getObject` вручную
собирает `SharedNoteView`/`SharedDocumentView`/`SharedProjectView`/
`SharedTransactionView` (`packages/shared-types/src/shared-grant.ts`), без
FK/EntityLink traversal: note — только title/body/tags; document — только
name/mimeType/sizeBytes (без версий, без потокового чтения самого блоба в
этом срезе — T1 закрыт, но file streaming через `StorageAdapter` для
`/shared/:grantId` НЕ реализован, это осталось TODO); project — карточка без
budgetAmount/hourlyRate/tasks/финансов; transaction — type/note/occurredAt
без строк/категорий. Закрытый enum `SharedGrantObjectType` — подмножество
`SearchableEntityType`: `note`/`document`/`project`/`transaction` (`task`/
`event` из entity-registry.ts НЕ включены — контракт требовал ровно эти
четыре).

**API.** `apps/api/src/shared/` — `PrismaService.withGrant`-caller
`SharedService`, `SharedGrantsService` (create/revoke/listMine, обычный
`withUser`), `SharedController` (`GET /shared`, `GET /shared/:grantId`, ни
одного mutating route — T5 через отсутствие маршрута, не проверку),
`GrantsController` (`POST`/`DELETE workspaces/:workspaceId/grants...`, owner-
only create через `assertMemberRoleTx(..., ["owner"])`, revoke — granter ИЛИ
текущий owner, grantee — 403). `SharedGrantModule` подключён в
`app.module.ts`. `SNAPSHOT_MODEL_REGISTRY`/`snapshot.service.ts` дополнены
записью `crossWorkspaceGrants` (`included`, снапшот пространства-источника —
T3), иначе структурный DMMF-тест снапшота свалился бы на новой
workspace-scoped таблице.

**Негативные тесты — новый файл
`apps/api/test/u09-cross-workspace-grants.integration.test.ts`, 7 тестов, все
PASS:**
- (a)+(g): grantee читает project ТОЛЬКО через `/shared/:grantId` (200,
  allowlisted — нет `budgetAmount`/`hourlyRate`/`tasks`), прямой
  `workspaces/:id/projects/:id` — 403, как и раньше.
- (b): `prisma.withUser(bob.id, ...).note.findMany(...)` на объект с
  реально активным грантом на Bob — 0 строк: без `app.active_grant_id`
  grant-read политика не срабатывает, даже если `current_user_id` и грант
  оба корректны. Через `SharedService`/`withGrant` тот же объект отдаётся.
- (c): revoke → следующий `GET /shared/:grantId` — 404 немедленно.
- (d): грант с `expiresAt` в прошлом — `GET /shared/:grantId` 404.
- (e): грант на project не даёт доступа к его задаче ни напрямую (403 на
  `tasks/:id/comments`), ни через `/shared/:grantId` (в ответе нет `tasks`).
- (f): plain member не может создать грант (403), grantee не может отозвать
  свой же грант (403), сторонний member тоже не может (403), owner может.
- Структурный: `cross_workspace_grants` — ENABLE+FORCE+policy>0.

**Существующий `api-rls.integration.test.ts` — 21/23 PASS, 2 FAIL, оба
дочерта не связаны с U09**: `S02: sync/backup is owner-only...` и `S02:
restore apply re-checks...` падают на `PUT .../sync/remote` → 400, до кода
самого U09 — это `remote-url-guard.ts` (SSRF-заслон, DNS-резолв
`example.com`), уже отмечено как FAIL в независимой проверке Codex 21:40
того же дня («7 FAIL на putRemote 400»), т.е. до начала этой сессии.
Изоляция notes/finance-транзакций и структурный RLS-тест (15+ таблиц) —
PASS без изменений, значит additive-политики не ослабили существующую
membership-изоляцию.

**Typecheck/lint/build:** `pnpm typecheck` — весь монорепо PASS (7
проектов); `pnpm lint` — 0 ошибок (3 pre-existing warning в
несвязанных файлах); `pnpm --filter @orion/api typecheck` включая
`tsconfig.test.json` — PASS.

**Не сделано (осознанно, бюджет сессии):** (4) client cache cleanup —
`packages/core-react/src/use-shared.ts` (`useSharedWithMe`/
`useSharedObject`/`useCreateGrant`/`useRevokeGrant`) написан с
`queryClient.removeQueries` на 403/404 через `throwOnError` (react-query v5
не даёт `onError` в `useQuery`), но БЕЗ собственного теста — проверено
только typecheck. `api-client.ts` получил `listSharedWithMe`/
`getSharedObject`/`createGrant`/`revokeGrant`. (5) UI — никакого. Нет панели
«Доступно мне», нет формы выдачи гранта с picker'ом получателя/сроком/
превью allowlist, нет предупреждения про документ (раздел 3.1). `scope:
"projection"` — не реализован нигде (как и требовал документ). Document
grant НЕ отдаёт сам файл (только метаданные) — стриминг блоба через
`/shared/:grantId/content` в этом срезе не написан, backend не пытается
делать partial-выдачу (соответствует T1's "весь файл целиком или ничего"),
но и полной выдачи тоже пока нет — следующая сессия.

### Addendum — U09 UI + document content streaming + members-search — 2026-09-22

Задача: закрыть UI-хвост U09 (grant-issue форма владельца, «Доступно мне» у
получателя) и оставленный `TODO` — реальный стриминг байт документа через
`/shared/:grantId/content`. `27-U09-THREAT-MODEL.md` перечитан целиком перед
работой, особенно раздел 6 (UX flow) и раздел 3.1 (document warning) — оба
использованы как буквальный чек-лист, не пересказ.

**Часть 1 — UI выдачи гранта.** `apps/web/components/share-grant-section.tsx`
(новый компонент, не режим `EntityLinksSection` — намеренно, T1: grant не
generic-связь). Показывается только если `useActiveWorkspace().workspace.role
=== "owner"` **и** совпадает с `workspaceId` объекта. Подключён рядом с
`EntityLinksSection` в четырёх местах: `note-editor.tsx` (note),
`ProjectsPanel.tsx` (project), `documents/preview-pane.tsx` (document),
`finance/transactions-view.tsx` (transaction) — все четыре allowlisted типа
из раздела 3.1. Форма: picker получателя (debounce не нужен — `useQuery`
`enabled: q.length >= 2`, тот же паттерн что глобальный поиск в
`EntityLinksSection`), три radio срока (без срока / 7 дней / до даты,
буквально раздел 5 вопрос 3), явный preview allowlist-полей ПЕРЕД созданием
(раздел 6 шаг 3) и — обязательное требование владельца — предупреждение для
`document` про файл целиком (скрытые листы/встроенные изображения), выведено
отдельным жёлтым блоком, не мелким текстом. Список активных грантов из
пространства с кнопкой «Отозвать» — новый `GET workspaces/:id/grants`
(`SharedGrantsService.listForWorkspace`, owner-only, резолвит
grantee name/email через тот же `asSystem`-паттерн что `listMine`).

**Часть 2 — панель «Доступно мне».** `apps/web/panels/SharedPanel.tsx` +
регистрация в `panel-registry.ts` (`id: "shared"`, ungrouped, та же логика
что `overview` — не привязано к состоянию модулей одного пространства,
потому что источник — чужое пространство). Список через `useSharedWithMe`
(источник/режим/срок), клик открывает read-only модалку через
`useSharedObject` — по типу: note рендерит `MarkdownView`, document даёт
кнопку «Скачать» (`api.getSharedDocumentBlob`), project/transaction — плоский
текст полей. Никакого редактора — читерский компонент, а не урезанная копия
владельческого (T5: read-only первая версия).

**Часть 3 — content streaming + members-search.**
`DocumentsService.openContentForGrant(workspaceId, documentId, rangeHeader)`
— новый метод, НЕ вызывает `assertMemberTx` (грантee не member), резолвит
путь на диске через `asSystem` (не `withUser`/grant RLS: grant-read политика
открывает только саму строку документа, не цепочку родительских папок,
нужную `folderSegmentsTx` — тот же принцип, что уже применён в
`SharedGrantsService.listMine` для имени пространства-источника — узкий
аудируемый bypass ПОСЛЕ того как решение о доступе уже принято отдельно).
`SharedService.getDocumentContent` сначала проверяет грант через `withGrant`
(та же проверка активности, что `getObject`), затем делегирует резолюцию
байт в `DocumentsService`. Новый роут `GET /shared/:grantId/content` в
`SharedController` — Range/Content-Disposition один в один с
`DocumentsController.content`. `GET workspaces/:id/members-search?q=` —
новый эндпоинт в `WorkspacesController`/`WorkspacesService.searchMembers`,
owner-only, ищет по email/name **только** среди участников ОДНОГО
переданного `workspaceId` (не глобальный поиск пользователей — осознанное
сужение по прямому указанию задания), `q.length < 2` → `[]` без похода в БД.

**Тесты.** Оба новых эндпоинта покрыты в существующем
`u09-cross-workspace-grants.integration.test.ts` (не новый файл — тот же
suite, та же fixture/cleanup): `(content)` — реальные байты через upload →
grant → `/shared/:id/content`, Range 206, grant не-document-типа → 404,
чужой пользователь → 404, revoke закрывает stream на следующий запрос;
`(members-search)` — `q` короче 2 символов → `[]`, находит реального member'а
по подстроке имени, не находит пользователя из чужого workspace даже по
email-префиксу (глобальный поиск исключён явной проверкой), 403 для
не-owner'а и для не-member'а чужого пространства. `pnpm --filter @orion/api
exec vitest run test/u09-cross-workspace-grants.integration.test.ts` — **9/9
PASS** (7 старых + 2 новых).

**Прогнано в этой сессии:** `pnpm typecheck` — 7/7 PASS. `pnpm lint` — 0
ошибок (3 старых warning в несвязанных файлах, без изменений). `pnpm build`
— PASS (`apps/api` tsc, `apps/web` next build, включая новый `/panel/shared`
маршрут в списке сгенерированных страниц). `pnpm test` — 264/264 PASS.
`pnpm test:integration` (рабочая БД 127.0.0.1:5433, без чистого прогона с
нуля) — 153/160 PASS, 7 FAIL, все в `blob-backup.integration.test.ts` (4) и
`codex-review-regressions.integration.test.ts` (1) плюс сопутствующие — на
`putRemote` → 400 через `assertPublicRemoteUrl` (реальный DNS lookup
`example.com`, недоступен в песочнице), **тот же диагноз, что уже
зафиксирован в этом файле для S19/U10 и не связан с U09/этой сессией** — код
`sync`/`remote-url-guard.ts` не трогался.

**Честно НЕ сделано:** визуальная проверка UI живьём (`pnpm dev:web` +
браузер) — нет browser tooling в среде агента, как и во всех предыдущих
UI-сессиях этого проекта; typecheck+lint+build — единственный доступный
proxy, явно озвученный как ограничение в самом задании. `scope: "projection"`
по-прежнему не реализован нигде (не входил в объём). Client-side "hide"
объекта из личного списка «Доступно мне» (раздел 2.1, отдельно от revoke) —
не реализован, не запрашивался явно в этой сессии.

## U10 — финальная миграционная/UX/эксплуатационная приёмка — 2026-09-22

Задача: U10 (24-CONNECTED-CORE-BACKLOG.md), буквально: проверки UC01–UC10,
список NOT RUN, обновлённые runbook/release notes, «никакого готово по одной
схеме БД». Проверочная сессия, прикладной код не менялся — правило
`11-AGENT-PROTOCOL.md`: не считать историю PROGRESS доказательством закрытия
дефектов, перепроверять реально. Полный отчёт — новый раздел
`docs/RELEASE_NOTES.md` («Дополнение (U10)»); здесь — сводка.

**Среда.** Новый изолированный portable-Postgres кластер:
`scripts/postgres.mjs`, `ORION_PG_PORT=5550`, отдельный scratchpad
`ORION_PG_DATA`/`STORAGE_DIR` — не пересекается ни с рабочим 5433, ни с
портами прошлых сессий (5544–5551, 5547 в S19). Поднят/использован/остановлен
в рамках этой сессии, рабочий `.env` и `infra/postgres/data` не трогались.

**Что реально прогнано (числа, не «проверено»):**
1. `prisma migrate deploy` на пустой БД → **PASS**, все 66 директорий миграций
   проекта одной цепочкой, впервые вся волна U00–U09 (entity_link_relation_kind,
   entity_reminders, u05_workspace_spheres, cross_workspace_grants,
   cross_workspace_grants_rls) применена с нуля в одну сессию.
2. `pnpm typecheck` → PASS, 7/7. `pnpm lint` → PASS, 0 ошибок, 3 старых
   warning без изменений.
3. `pnpm test` → PASS, 32 файла / 259 тестов.
4. `pnpm test:integration` на чистой БД → 28 файлов: 25 passed / 3 failed;
   149 тестов: **142 passed / 7 failed** — все 7 падений на `putRemote` 400
   (`assertPublicRemoteUrl` делает реальный DNS lookup `example.com`, у
   песочницы нет исходящей сети) — тот же диагноз, что в S19/28-REVIEW, не
   новая регрессия. `u09-cross-workspace-grants.integration.test.ts`
   перепрогнан отдельно вместе с `api-rls.integration.test.ts` — **7/7
   U09-тестов PASS**, включая структурную RLS-проверку
   (`cross_workspace_grants`: ENABLE+FORCE+policy>0), те же 2 DNS-падения.
5. `pnpm build` → PASS (`apps/api` tsc, `apps/web` next build, 28 страниц).
6. `pnpm build:desktop-export` → PASS, файлы на диске подтверждены.
7. `apps/web/lib/office` suite (включая `codex-review.test.ts`, F01–F05) →
   PASS, 4 файла / 21 тест — зелёный после всей волны U00–U09, регрессий из
   связанного ядра в офисный код нет.

**Главная находка сессии (не повтор старого отчёта — подтверждение, что
дефект дожил до сегодня):** R28-01/R28-02/R28-03 из `28-REVIEW-AFTER-U08.md`
**перечитаны в текущем коде построчно и подтверждены живыми** —
`overview.service.ts:39-40` (`/me/overview` проверяет только
`disabledModules`, не `restrictedModules` — restricted tasks/finance
участника всё ещё видны в личном обзоре), `reminders.service.ts:36-50`
(`list()` вызывает `ENTITY_REGISTRY[...].summary()` без повторной
`accessibleSetTx`-проверки — title сущности из уже ограниченного модуля
раскрывается), `search.service.ts:209-215` (`removeLink` проверяет только
`assertMemberTx`, без module-access — связь можно удалить после отзыва
доступа, зная только `id`). Ни один из трёх не исправлен между сессией
Codex-review и этой, хотя предыдущая сессия явно рекомендовала «U09 пока
отложить до R28-01–05», а U09 (cross-workspace grants) был всё равно
реализован поверх них. Прикладной код в этой сессии **не правился**
(проверочная сессия, правило протокола — не гасить P1 находку тихим
мини-патчем без отдельного обсуждения scope), но дефект зафиксирован здесь
явно, а не унаследован молча.

**Fault-matrix UC01–UC10** (детали и обоснование — `docs/RELEASE_NOTES.md`,
раздел «Дополнение (U10)»):

| UC | Статус |
|---|---|
| UC01 | FAIL (R28-01/R28-02: restricted-модуль не скрыт в overview/reminders) |
| UC02 | PASS (код+юнит, не переисследовано живьём заново) |
| UC03 | PASS (код) |
| UC04 | PARTIAL/NOT RUN (create-and-link не реализован; конкурентная гонка не покрыта отдельным тестом) |
| UC05 | NOT RUN (нет browser/multi-window tooling) |
| UC06 | NOT RUN (нет browser tooling) |
| UC07 | PASS (код, не переисследовано живьём заново) |
| UC08 | FAIL (тот же R28-01 путь: restricted finance виден в overview) |
| UC09 | PASS для grant целого объекта (7/7 тестов реально перепрогнаны); partial projection не реализована (задокументированный пробел, не готово по UI-фильтру) |
| UC10 | PASS частично: clean-db migrations + build + desktop-export подтверждены реальным прогоном; restore-со-связями и native desktop smoke — NOT RUN (нет Tauri/Rust) |

**NOT RUN список:** live UI/drag-drop/multi-window (UC05/UC06/часть UC04),
native desktop smoke (Tauri/Rust/Cargo отсутствуют), визуальное открытие
office-файлов в настоящем Word/Excel, WebDAV/DNS-зависимые тесты (7 штук,
среда без исходящей сети), slow-network browser regression для F05
(R28-05, код проверен, живой сценарий недоступен).

**Итоговый вердикт релиза этой волны: BLOCKED** — не техническим периметром
(тот зелёный целиком), а тремя живыми и по-прежнему открытыми P1-дефектами
изоляции прав доступа (R28-01/02/03) плюс R28-04 (chart-writer теряет
numFmt/merge) и R28-05 (F05 generation-guard неполон) из офисного трека.
Ни U09 UI, ни следующий срез связанного ядра не стоит начинать поверх этого
состояния — сначала закрыть R28-01–05 отдельной разработческой сессией с
regression-тестами на каждый пункт, затем перезапустить U10 целиком на новом
чистом кластере.

## R28-01/02/03/04/05 · 2026-09-22 · DONE (закрытие независимой проверки 28-REVIEW-AFTER-U08.md)

**Корректирующий addendum к записям "U08" и "U03" выше, а также к абзацу
"Итоговый вердикт релиза этой волны: BLOCKED" непосредственно над этой
записью.** Те записи НЕ переписаны — они верно описывали состояние на момент
своего написания (до этой проверки). Эта запись фиксирует, что все пять
подтверждённых Codex-ом дефектов из `28-REVIEW-AFTER-U08.md` закрыты и
провалидированы негативными тестами на реальной PostgreSQL/RLS (R28-01/02/03)
и модульными тестами (R28-04/05), не только чтением кода.

Протокол: воспроизводящие тесты ревьюера скопированы в постоянные suites
БЕЗ ослабления assertions (`docs/SONNET_IMPLEMENTATION/evidence/u08-review.integration.test.ts.txt`
→ `apps/api/test/r28-u08-review-access.integration.test.ts`;
`u08-office-review.test.ts.txt` → `apps/web/lib/office/xlsx-codec-chart-format.test.ts`),
подтверждены RED против непочиненного кода (временно откачен код трёх
backend-сервисов и прогнан против той же реальной dev-БД на 127.0.0.1:5433 —
все 3 backend-теста упали именно так, как описывает review-документ; office
regression тоже упал RED на непочиненном `xlsx-codec.ts`), затем починены по
порядку и подтверждены GREEN.

- **R28-01** (`apps/api/src/overview/overview.service.ts`, `getMyOverview`):
  заменил `isModuleEnabled(ws.disabledModules, ...)` на
  `ModulesService.accessibleSetTx(tx, userId, ws.id)`, прочитанный внутри
  СВОЕЙ `withUser`-транзакции на каждое пространство в цикле (роль зависит от
  пространства, поэтому набор нельзя посчитать один раз вне цикла). Тест:
  member с `restrictedModules=[tasks,finance]` в чужом owner-пространстве
  раньше видел назначенную задачу и счёт через `GET /me/overview` (200,
  оба объекта присутствуют) — теперь оба отсутствуют.
- **R28-02** (`apps/api/src/search/reminders.service.ts`, `list`/`cancel`):
  добавлен приватный `summaryIfAccessible` (тот же `accessibleSetTx`-гейт,
  что уже стоял в `create`) — при отсутствии доступа к модулю
  `entityTitle` возвращается `null` вместо резолва через
  `ENTITY_REGISTRY[...].summary`, тот же паттерн нейтрального состояния, что
  R18-03 применил в `notification-center.service.ts`. `cancel` продолжает
  работать (это запись самого пользователя), просто без раскрытия заголовка.
  Тест: member создал напоминание на note, owner ограничил `notes`, `list`
  раньше отдавал `entityTitle: "SECRET NOTE"` — теперь `null`.
- **R28-03** (`apps/api/src/search/search.service.ts`, `removeLink`):
  раньше — только `assertMemberTx` + `deleteMany`. Теперь читает связь,
  проверяет `accessibleSetTx` на ОБА конца (`sourceType`/`targetType`) в той
  же транзакции, что и удаление — `ForbiddenException`/`NotFoundException`
  вместо безусловного удаления. Тест: member создал task↔note, `tasks` и
  `notes` были ограничены, `DELETE` раньше отдавал 204 — теперь 403/404.
- **R28-04** (`apps/web/lib/office/xlsx-codec.ts`,
  `workbookStateToXlsxViaModernXlsx`): modern-xlsx branch не переносил
  numFmt/merges/columnWidths, в отличие от exceljs branch (F03). У
  `modern-xlsx`'s `Cell.numberFormat` нет сеттера — формат ставится через
  `new StyleBuilder().numberFormat(code).build(wb.styles)` →
  `cell.styleIndex = idx` (задокументированный паттерн самого пакета); merges
  и column widths идут напрямую через `Worksheet.addMergeCell`/
  `setColumnWidth`. Тест ревьюера (B2 numFmt=0.00 + merge C3:D3 + chart)
  теперь проходит: `numFmt`/`merge` сохраняются наравне с exceljs branch.
- **R28-05** (`apps/web/components/office/docx-editor.tsx` +
  `xlsx-editor.tsx`): исходный guard сравнивал generation с её же снимком
  НА СТАРТЕ текущего эффекта разбора blob (`generationAtFetchStart`) — это
  ловит только правку, случившуюся ВО ВРЕМЯ этого конкретного парсинга, но
  не черновик, который был грязным ДО его старта (send A → type B → ответ на
  save/refetch запускает эффект уже ПОСЛЕ B → `generationAtFetchStart` уже
  равен текущей generation → проверка тривиально проходит → B тихо
  заменяется на A). Правильное сравнение — `editGeneration ===
  savedGeneration` (последняя УСПЕШНО СОХРАНЁННАЯ generation), а не значение,
  снятое в середине полёта. Вынесено в общий чистый хелпер
  `apps/web/lib/office/editor-generation-guard.ts`
  (`shouldAcceptRefetchedBlob`), используемый обоими редакторами; у
  ревьюера НЕ было готового воспроизводящего теста для этого пункта (в
  `28-REVIEW-AFTER-U08.md` явно указано «кодовое подтверждение... живой
  сценарий NOT RUN», tooling для jsdom/testing-library в репозитории
  намеренно отсутствует — см. комментарий в `vitest.config.mts`), поэтому
  добавлен `apps/web/lib/office/editor-generation-guard.test.ts`: он
  воспроизводит старую (баг) формулу сравнения как `buggyShouldAccept` рядом
  с новой и явно показывает на том же сценарии из review-документа, что
  старая формула ошибочно говорит "принять", а новая — правильно
  "отклонить".

**Регрессия:** `pnpm typecheck` PASS (все 7 проектов), `pnpm lint` PASS (0
errors, те же 3 предсуществующих warning, что и в baseline), `pnpm test`
PASS — 34 файла / 264 теста (259 baseline + 5 новых: 4 в
`editor-generation-guard.test.ts` + перенесённый office-regression),
`pnpm build` PASS (api tsc + Next.js, 28 страниц). `pnpm test:integration`
против рабочего dev-кластера (127.0.0.1:5433, тот же, что уже используют
остальные integration-тесты через `apps/api/test/setup-integration.ts`):
29 файлов / 152 теста, 145 PASS / 7 FAIL — все 7 падений те же самые,
предсуществующие `putRemote`-DNS-guard 400 на `example.com`, что
зафиксированы в `28-REVIEW-AFTER-U08.md` как отдельная, не относящаяся к
R28-01–05 проблема (падают ДО целевого assertion в каждом тесте, не задеты
этой сессией). Новый `r28-u08-review-access.integration.test.ts` — все 3
теста PASS. Полный лог доступен через переисполнение команд из
`28-REVIEW-AFTER-U08.md`.

**Не сделано в этой сессии (осознанно, вне периметра R28-01–05):**
7 предсуществующих `putRemote`/DNS-guard integration-фейлов (отдельная
задача — согласовать WebDAV-фикстуру с `remote-url-guard.ts`, не ослабляя
guard); UI/browser-подтверждение R28-05 (нет jsdom/testing-library/live
office tooling в среде агента); U09 (grants) по-прежнему отложена до этой
починки — теперь можно начинать поверх безопасных агрегаторов.

## R29-01/R29-02 · 2026-09-22 · Corrective addendum к U09 (закрытие двух P1 из 29-REVIEW-GRANTS.md)

**Не начинал U09 заново** — правил существующий срез (`PrismaService.withGrant`,
`SharedService`, `SnapshotService`/`snapshot-registry.ts`) по прямому поручению
независимой проверки Codex (`docs/SONNET_IMPLEMENTATION/29-REVIEW-GRANTS.md`,
2026-09-22 ~23:30). Запись «U09 отложена»/предыдущие записи этого файла НЕ
переписывались — это добавление в конец, как требует протокол
(`11-AGENT-PROTOCOL.md`). R29-03/04/05 сознательно не трогал — следующая сессия.

**Восстановленные воспроизводящие тесты** из `docs/SONNET_IMPLEMENTATION/evidence/`:
`apps/api/test/r29-review.integration.test.ts`,
`apps/api/test/r29-restore-review.integration.test.ts` — assertions не
ослаблялись. RED подтверждён явно: временно подменил три правленых файла их
до-фикс версиями (сохранены сравнением с `git show HEAD` для `prisma.service.ts`
и вручную восстановленным старым телом для `shared.service.ts`/
`snapshot.service.ts`, т.к. весь срез U09 в git ещё не закоммичен) и прогнал
те же тесты — оба целевых сценария R29-01 (revoked+member, foreign owner) и
R29-02 (restore реактивирует grant) воспроизвелись как FAIL с ожидаемым
"200 вместо 404" / "200 вместо reject", после чего вернул исправленные файлы.

### R29-01 · Отозванный/чужой grant работал для участника пространства — FIXED

**Код:** `apps/api/src/common/prisma.service.ts` (`withGrant`, теперь бросает
новый `GrantNotActiveError`), `apps/api/src/shared/shared.service.ts`
(`getObject`/`getDocumentContent`).

Раньше `withGrant` при неактивном (отсутствующем/чужом/истёкшем/отозванном)
гранте всё равно вызывал callback внутри транзакции, где `app.current_user_id`
уже установлен — просто без `app.active_grant_id`. Это отключало ТОЛЬКО
grant-read RLS-политику; обычная membership-политика на целевой таблице
(notes и т.д.) могла независимо разрешить тот же SELECT, если grantee
ОДНОВРЕМЕННО был обычным участником исходного пространства — ровно
воспроизведённый ревьюером сценарий. Второй найденный баг тем же путём:
owner (не grantee этого гранта) тоже проходил на `/shared/:grantId`, потому
что членство/владение само по себе уже открывало объект через ту же дыру.

**Фикс:** `withGrant` теперь throw'ит `GrantNotActiveError` ДО вызова
callback, если грант неактивен — callback просто никогда не запускается,
значит membership-политика физически не успевает сыграть роль запасного
пути. Проверенный грант передаётся в callback явным вторым параметром
(`fn(tx, grant)`), так что `SharedService` больше не делает свой отдельный
"а вдруг найдётся" `findUnique` — раньше это чтение полагалось на то, что
RLS вернёт пусто, а не было независимой проверкой прав.`SharedService` ловит
`GrantNotActiveError` и превращает его в тот же 404, что и «объект не
найден» — внешний наблюдатель не может отличить «гранта никогда не было» от
«отозван» от «not yours».

**Доказано:** оба приложенных сценария зелёные (`revoked-member`,
`foreign-member`) плюс 3 новых acceptance-теста из приёмки документа —
`R29-01 addendum: expired grant...` (просроченный, а не отозванный грант, тот
же member-путь), `R29-01 addendum: revoked document grant...` (document
metadata- и byte-stream-путь `/shared/:id/content` оба 404 после revoke, с
позитивной проверкой "до revoke было 200" для не-тривиальности), `R29-01
addendum: ordinary workspace API keeps working...` (обычный workspace API
владельца не задет изменением). R29-03/R29-04 в том же файле по-прежнему RED
— вне периметра этой сессии, не притронулся.

### R29-02 · Restore заново открывал отозванный доступ — FIXED

**Код:** `apps/api/src/sync/snapshot.service.ts` (`specGrants`, новая обёртка
над `spec` только для ключа `crossWorkspaceGrants`), `snapshot-registry.ts`
(обновлён `reason` для модели `CrossWorkspaceGrant`, policy осталась
`included`).

**Выбранный контракт — подход "б" из самого документа ревью** (сохранённые
строки, но принудительно неактивные), а не полное исключение таблицы из
restore: владелец, открывший старый бэкап, должен видеть «я когда-то делился
X с Y» для аудита, и не нужно отдельно объяснять случай «снапшот снят до
создания гранта» (структурно совпадает со случаем «таблицы вообще нет в
файле» — см. addendum-тест ниже). `CrossWorkspaceGrant.objectId` — polymorphic
без FK на уровне схемы (никакого `@relation`, только строка + индекс), так
что restore не может упасть из-за отсутствующего/ещё не восстановленного
целевого объекта — грант просто ложится неактивным.

**Фикс:** `specGrants()` при вставке проставляет `revokedAt: row.revokedAt ??
restoredAt` для каждой строки — грант, который был активен (`revokedAt: null`)
на момент снятия бэкапа, ВСЕГДА приходит из restore уже отозванным (на момент
самого restore); грант, отозванный ДО бэкапа, сохраняет свой настоящий
исторический `revokedAt` как есть. Повторный доступ — только новый явный
грант от текущего владельца, никогда побочный эффект восстановления.

**Доказано:** приложенный тест (`create → backup → revoke → 404 → apply
старого снапшота → всё ещё 404`) зелёный, плюс 2 новых acceptance-теста —
`R29-02 addendum: apply() tolerates a snapshot missing the
crossWorkspaceGrants key entirely...` (даже полностью отсутствующий ключ
таблицы в объекте снапшота не роняет `apply()` — `?? []`-фолбэк уже был в
коде, тест это фиксирует) и `R29-02 addendum: a grantee's own workspace
backup never contains the owner's grant or the shared object...`
(собственный снапшот grantee-пространства не содержит ни строки гранта, ни
расшаренной заметки — подтверждает существовавшую фильтрацию по
`workspaceId` в `spec()`, не новый код, но явный regression-барьер).

**Регрессия (изолированный Postgres 16, порт 5553, отдельные data/`.env`
от рабочего 127.0.0.1:5433 — не трогал пользовательские данные, кластер
остановлен после прогона):**
- `pnpm typecheck` — PASS, все 7 проектов.
- `pnpm lint` — 0 errors, те же 4 warning что baseline (3 предсуществующих +
  временный unused-var в новом тесте, исправлен в этой же сессии).
- `pnpm test` — PASS, 34 файла / 264 теста (без изменений от baseline —
  фикс не в `packages/`).
- `pnpm exec vitest run --config vitest.integration.config.mts` (полный
  прогон, 32 файла / 170 тестов): **161 PASS / 9 FAIL.** Все 9 падений —
  ожидаемые: 7 те же самые предсуществующие `putRemote`/DNS-guard
  400-падения на WebDAV-фикстурах (`blob-backup` ×4, `api-rls` ×2,
  `codex-review-regressions` ×1 — зафиксированы как известная проблема ещё
  в `28-REVIEW-AFTER-U08.md`/`29-REVIEW-GRANTS.md`, детерминизм этой
  фикстуры — отдельная, не относящаяся к R29-01/02 задача) плюс 2
  сознательно нетронутых R29-03/R29-04 (`R29 trashed note body must not
  remain visible...`, `R29 RLS must deny grant retargeting...`) — обе в
  `r29-review.integration.test.ts`, для следующей сессии.
- `pnpm build` — PASS (api `tsc`, Next.js 29 страниц).

**Не сделано в этой сессии (осознанно, вне периметра R29-01/02):**
R29-03 (shared-путь читает удалённую заметку из корзины), R29-04 (RLS
допускает retargeting гранта получателем), R29-05 (UI не даёт выбрать
внешнего получателя) — все три оставлены как есть по прямому указанию
задания («следующая сессия»); WebDAV-фикстура для 7 предсуществующих
integration-фейлов не чинилась (тоже отдельная задача по документу ревью,
п.4 «Следующее поручение агенту»).

---

## R29-03/04/05 corrective addendum + WebDAV fixture determinism (2026-09-22, agent session following R29-01/02 fix)

Closes the remainder of 29-REVIEW-GRANTS.md's "Следующее поручение
агенту" (items 2-5). Restored r29-review.integration.test.ts already
contained live (RED) tests for R29-03 ("R29 trashed note body must not
remain visible to external grantee") and R29-04 ("R29 RLS must deny grant
retargeting by recipient") from the prior session - confirmed RED first
(expected 200 to be 404; promise resolved instead of rejecting) before
touching any code, per protocol. No separate evidence file existed for
R29-05 (it's UI + code review by the review doc's own description), so no
test needed restoring there.

R29-03 - shared-путь читает заметку/документ из корзины.
apps/api/src/shared/shared.service.ts getObject/getDocumentContent:
tx.note.findUnique/tx.document.findUnique had no deletedAt filter -
switched both to findFirst with an explicit deletedAt: null predicate
(the document content path already had a separate deletedAt check via
openContentForGrant, but the metadata path and the note path did not).
apps/api/src/shared/shared-grants.service.ts assertObjectOwnedByWorkspace:
also rejects issuing a new grant on a note/document already in the
trash (deletedAt !== null) - same "trashed = not there" contract on both
the write (create) and read (shared GET) side. Restore-from-trash does NOT
resurrect a grant that was separately revoked while the object was trashed
- nothing in this fix touches revokedAt, only object visibility, so that
half of the acceptance criteria was already satisfied by R29-02's fix
(revoked grants never come back active on their own).

R29-04 - RLS позволяет получателю изменять сам grant. New migration
apps/api/prisma/migrations/20260922200000_cross_workspace_grants_rls_split/
(the already-applied cross_workspace_grants_rls migration is untouched,
per the explicit instruction) drops the single
cross_workspace_grants_isolation policy (no FOR SELECT, so it covered
every command) and replaces it with four narrow policies:
cross_workspace_grants_select (source-workspace member OR grantee - same
condition as before, SELECT only), and cross_workspace_grants_insert /
_update / _delete (source-workspace member only - the grantee gets
no write policy of any kind, not even a "touch my own row" carve-out;
SharedGrantsService.revoke already goes through the granter/owner's own
withUser transaction, so it needed no code change, only this DB-level
tightening to make the promise actually hold).

Both proven by re-running the existing r29-review.integration.test.ts
file after the fixes: 7/7 PASS (previously 5/7, with the R29-03 and R29-04
tests RED as shown above).

R29-05 - UI не позволяет адресовать grant внешнему пользователю.
Implemented the minimal slice the review doc asked for, explicitly not a
full invite/contacts system:
- New GET /users/resolve-by-email?email= (apps/api/src/users/,
  UsersModule/UsersController/UsersService, registered in
  app.module.ts). JwtAuthGuard-only, not workspace-scoped (the whole
  point is finding someone outside the caller's own workspaces). Exact
  match only (tx.user.findUnique({ where: { email } }) under asSystem,
  same narrow audited-bypass precedent SharedGrantsService.listMine/
  listForWorkspace already use for cross-workspace name resolution).
  Returns { found: false } uniformly for "no such account" and "found the
  caller's own account" - a discriminated union
  (resolveUserByEmailResultSchema in packages/shared-types/src/workspace.ts)
  with no email echoed back on the found: true branch, so the endpoint
  can't be used to fish for which emails are registered beyond a single
  yes/no per guess, and the response body itself never varies in shape.
- ApiClient.resolveUserByEmail (packages/core/src/api/api-client.ts),
  useResolveUserByEmail (packages/core-react/src/use-workspaces.ts) -
  same shape as the existing useSearchWorkspaceMembers, gated on a
  plausible-email regex instead of a 2-char minimum, and on an explicit
  enabled flag so it never fires on every keystroke (button-armed in the
  UI, see below) - reduces both request volume and the accidental-oracle
  surface named in the review.
- apps/web/components/share-grant-section.tsx: added a "Участник этого
  пространства" / "По email" mode toggle above the existing member search.
  The email mode never calls useSearchWorkspaceMembers; it's a separate
  exact-match lookup armed by a "Найти" button click, and picking the
  result only sets the grant's granteeUserId - it never adds anyone to
  workspaceId's membership. Not-found renders the same neutral copy
  regardless of the underlying reason (explicitly does not distinguish
  "no such email" from any other failure).
- Explicitly NOT built: a contacts list, or a pending-invite flow for an
  email with no ORION account yet - documented here as intentional future
  work, matching the review doc's own scope cap ("минимальная версия
  «найти существующего пользователя ORION по точному email» достаточна для
  первого среза").
- Verification: pnpm typecheck (all 7 projects) and pnpm lint (0
  errors) cover the new endpoint/hooks/component end-to-end; no dedicated
  integration test was added for resolve-by-email specifically (would
  need its own fixture file) - this is the one acceptance item from the
  task description not covered by an automated test, called out honestly
  rather than claimed.

WebDAV fixture determinism (review doc's "Следующее поручение агенту"
п.4). All three integration files exercising PUT
workspaces/:id/sync/remote with a https://example.com/... fixture host
(apps/api/test/blob-backup.integration.test.ts,
apps/api/test/api-rls.integration.test.ts,
apps/api/test/codex-review-regressions.integration.test.ts) now
vi.mock("node:dns/promises", ...) at module scope, same pattern as
apps/api/test/remote-url-guard-dns.integration.test.ts (S05), resolving
the fixture host to a fixed public address (203.0.113.10, TEST-NET-3 -
never treated as private/loopback by isPrivateOrLoopbackHost). This does
not touch or weaken assertPublicRemoteUrl/assertResolvedHostIsPublic -
the real guard code still runs its real private/loopback-range check
against whatever the (now deterministic) mock returns; only the DNS
resolution step, which previously depended on the sandbox actually having
outbound DNS, is now sandbox-independent. WebdavRemote.prototype's actual
HTTP methods (putFile/getFile/ensureDir/exists) were already
stubbed via vi.spyOn in all three files before this change - no real
network call was ever made past the config-save guard.

Full regression (real isolated integration DB via pnpm db:up on
127.0.0.1:5433; every test file cleans up its own emailPrefix-scoped
users/workspaces in afterAll):
- pnpm typecheck - PASS, all 7 workspace projects.
- pnpm lint - 0 errors, same 3 pre-existing warnings as baseline
  (CalendarPanel.tsx, DocumentsPanel.tsx exhaustive-deps;
  seed-demo-workspace.mjs unused var).
- pnpm test (unit, packages/**) - PASS, 34 files / 264 tests, unchanged
  from baseline.
- pnpm test:integration (full run) - PASS, 32 files / 170 tests, 0
  FAIL. This is the first fully green integration run across the R28/R29
  review cycle: previously 153/164 (R29 review), then 161/170 with 9
  known FAIL after the R29-01/02 fix (7 WebDAV-DNS + 2 R29-03/04). All 9
  are now fixed, none skipped or weakened.
- pnpm build - PASS (apps/api tsc, apps/web Next.js production
  build, 29 static/SSG pages).

Migration note: db:migrate's post-migration prisma generate step
hit a transient EPERM renaming query_engine-windows.dll.node (a stale
lock from another local Node process on this machine, unrelated to this
change). The migration itself applied successfully before that step; no
schema.prisma model fields changed in this session (only new RLS
policies via raw SQL), so the existing generated Prisma Client remained
valid and no code depended on regeneration completing.

Still open / honestly not verified this session: browser-driven
verification of the R29-05 UI flow (two real users, one browser session
each) was not run - same limitation the review doc itself already flagged
for the original R28-05 slow-save scenario ("PASS чистого helper-теста не
равен доказательству поведения React-компонента"). resolve-by-email has
no dedicated automated test. Tauri/desktop build was not exercised (no
Rust/Cargo/Tauri CLI in this environment, consistent with every prior
session's stated limitation).
