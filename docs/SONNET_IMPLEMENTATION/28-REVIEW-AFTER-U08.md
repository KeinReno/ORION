# Независимая проверка после U01–U08

2026-09-22, около 21:40 Europe/Moscow. Проверено текущее рабочее дерево; агент продолжает работу, поэтому более поздние изменения требуют повторной проверки. Прикладной код не исправлялся. Предыдущие документы 23–26 остаются спецификацией; этот отчёт уточняет реальное состояние и ближайший приоритет.

## Что подтверждено

- `pnpm test`: **32 файла, 259 тестов PASS**. Четыре исходных office-regression tests из 25 перенесены в постоянный suite с сохранёнными assertions и теперь проходят. Это существенный реальный прогресс.
- `pnpm typecheck`: **PASS**.
- `pnpm build:desktop-export`: **PASS**. Это не native smoke и не проверка Word/Excel.
- Миграции успешно применены на отдельном пустом PostgreSQL-кластере на порту 5551.
- В коде присутствуют typed relation kinds/registry, entity picker/связанные материалы, личные напоминания, sessionStorage context окна, личные spheres/pins, sidebar docking и межпространственный Overview. Наличие кода не заменяет все UC-проверки.
- U03 create-and-link остаётся PARTIAL по журналу. U09 на момент чтения — threat model, не реализованные grants. Не выдавать их за готовый доступ между пространствами.

Новые regression tests: три проверки доступа на настоящей PostgreSQL **FAIL 3/3**, дополнительная XLSX проверка **FAIL 1/1**. Старый зелёный suite эти комбинации не покрывал.

Полный штатный integration suite: **27 файлов: 24 PASS / 3 FAIL; 135 тестов PASS / 7 FAIL**. Все семь падений на `putRemote`, ожидается 200, фактически 400: 4 в blob-backup, 2 в api-rls, 1 в codex-review-regressions. Они происходят до целевого restore/assertion, поэтому не доказывают ни поломку, ни исправность восстановления. Тестовая конфигурация явно задавала корректный 32-byte SYNC_SECRET, отдельную DB/storage и ORION_MODE=local. В тестах WebDAV подменён, но URL guard делает реальный DNS lookup внешнего example-домена; согласовать фикстуру с новым guard, не отключая защиту production. К концу проверки в blob-backup fixture уже указан example.com; не привязывать диагноз к одному ранее использовавшемуся hostname. Отдельный response-body диагноз в этом прогоне не снимался, DNS — объяснение по коду, а не измеренный текст ошибки. Лог — evidence/u08-integration.log. Тестовый кластер 5551 остановлен после проверки; пользовательская БД не использовалась.

## R28-01 · P1 · Межпространственный обзор обходит restrictedModules

Место: `apps/api/src/overview/overview.service.ts`, `getMyOverview`, построение tasksEnabled/financeEnabled и дальнейшие запросы.

Сервис проверяет только disabledModules через isModuleEnabled. Роль и restrictedModules не учитываются. Membership RLS не защищает ограничения отдельных модулей. Обычный member получает свои назначенные задачи закрытого tasks и счета/балансы закрытого finance через `/me/overview`, хотя соответствующие модули ему недоступны.

Подтверждено HTTP regression: owner workspace, member с назначенной задачей и счётом, restrictedModules=[tasks,finance]. Ответ 200 содержит оба объекта; ожидается их отсутствие. Доказательство не зависит от UI или будущих grants.

Исправить через общий actor-aware accessibleSetTx в каждом workspace, формировать capability flags из той же актуальной проверки и фильтровать данные/итоги. Проверить owner/lead/member, disabled, изменение роли, удаление membership, кэш обзора после изменения доступа. Не предлагать в quick capture workspace, где запись запрещена.

## R28-02 · P1 · Список напоминаний раскрывает название закрытого объекта

Место: `apps/api/src/search/reminders.service.ts`, `list` и аналогичная выдача summary в `cancel`.

Create и cron проверяют доступ, list проверяет только членство/ownerId и затем вызывает registry.summary. После ограничения notes член пространства всё ещё получает entityTitle закрытой заметки. Отмена напоминания тоже возвращает summary без повторной module policy — этот путь выявлен по коду, отдельно не воспроизводился.

Подтверждено integration: member создаёт напоминание на разрешённую note; owner ограничивает notes; `list` возвращает SECRET NOTE. Исправить чтение и все DTO-resolve пути. Допустимо оставить приватный reminder с нейтральным состоянием недоступности, но запрещённые title/id/preview не должны раскрывать содержимое. Определить, какие идентификаторы допустимы для управления собственной ранее созданной записью.

## R28-03 · P1 · Запрет доступа не препятствует удалению связи

Место: `apps/api/src/search/search.service.ts`, `removeLink` (~209).

Create/list используют module policy, delete только assertMemberTx и deleteMany({id,workspaceId}). Пользователь, знавший id связи до отзыва доступа, может удалить связь закрытых модулей.

Подтверждено HTTP: member создал task↔note, затем tasks/notes ограничены; DELETE возвращает **204** вместо 403/404. Проверять разрешение управления связью и оба конца до удаления в той же транзакции. Невалидные/удалённые концы требуют отдельной политики очистки, а не безусловного bypass.

## R28-04 · P1 · Добавление диаграммы переключает XLSX на writer, теряющий формат/merge

Место: `apps/web/lib/office/xlsx-codec.ts`, `workbookStateToXlsxViaModernXlsx` (~549).

Исправление F03 сохраняет numFmt/merges/columnWidths в ExcelJS branch. Branch modern-xlsx (при наличии хотя бы одной диаграммы или pivot) переносит значения и формулы, но не переносит эти метаданные.

Подтверждено новым тестом: WorkbookState содержит B2=12.3 с numFmt=0.00, merge C3:D3 и chart. После сохранения format undefined, D3.isMerged=false. Старый F03 regression проходит, потому что не включает chart/pivot. Требуется равный контракт обоих writer branches и комбинированные fixtures: формат+формулы+chart+pivot+повторное открытие. После обновления значения ячейки также сохранять её формат, не заменять CellState целиком на {value}.

## R28-05 · P1 · F05 защищён только частично: уже грязный редактор принимает refetch

Места: `apps/web/components/office/docx-editor.tsx` и `xlsx-editor.tsx`, эффект по blob и generationAtFetchStart.

Добавлены edit/saved counters и beforeunload, но решение о принятии blob проверяет лишь изменение generation **после запуска эффекта разбора**. Уже существующий dirty draft, для которого generation не меняется во время парсинга, заменяется серверным blob и помечается saved. savedGenerationRef не участвует в этой проверке. Сценарий: отправить A → ввести B → получить save response/refetch A → эффект стартует уже после ввода B → generationAtFetchStart совпадает с текущей → B заменено A. Аналогичен refetch из-за возвращения фокуса при имеющемся черновике.

Это **кодовое подтверждение неполной защиты**, отдельный контролируемый slow-network browser regression в этом проходе NOT RUN. До закрытия нужны тесты очередности и принятия blob по server revision+saved generation; не считать beforeunload защитой переключения документа внутри приложения. Stale-save между двумя открытыми вкладками также требует серверного expectedRevision/CAS; ручная история версий не предотвращает перезапись.

## Оставшийся UI и полнота

- Charts/pivot renderer/edit/delete в текущем xlsx-editor не появились: формы добавления и grid остаются, полноценную визуальную работу не принимать. Это повтор F06, проверен код, свежий browser smoke после U08 не выполнялся.
- 200×40 display cap и базовые inputs — прежний F07; уточнять фактическую поддержку клавиатуры/форматирования отдельно.
- Registry summary у note/document не проверяет deletedAt. Это риск ссылок/напоминаний на корзину; добавить отрицательные tests прежде чем считать lifecycle завершённым.
- Сферы и sessionStorage — полезная основа, но проверка двух настоящих окон и native восстановления остаётся отдельной приёмкой. Скопированный opener sessionStorage не гарантирует уникальный windowId; не объявлять это доказанным unit-тестом resolveWindowId.

## Воспроизведение и порядок работы

`evidence/u08-review.integration.test.ts.txt` → временно скопировать в `apps/api/test/codex-u08-review.integration.test.ts`, запустить с отдельными DATABASE_URL/APP_DATABASE_URL/STORAGE_DIR и миграциями:

```text
corepack pnpm exec vitest run --config vitest.integration.config.mts apps/api/test/codex-u08-review.integration.test.ts
```

`evidence/u08-office-review.test.ts.txt` → `apps/web/lib/office/codex-followup-review.test.ts`:

```text
corepack pnpm exec vitest run apps/web/lib/office/codex-followup-review.test.ts
```

Оба временных теста удалены из исходников после проверки, сохранены текстовые копии и логи. После исправления перенести их в постоянные suites, не ослабляя проверки. Логи: u08-review-regressions.log, u08-office-regression.log, u08-unit.log, u08-typecheck.log, u08-desktop-export.log, u08-migrations.log.

**Следующий шаг:** R28-01/02/03 → R28-04/05 → восстановить зелёный integration gate → завершить прежние PARTIAL/F06/F07. Реализацию U09 отложить до закрытия текущих обходов module policy: новая модель grants не должна строиться поверх уже небезопасных агрегаторов. Не переписывать исторические записи DONE; добавить корректирующие статусы и доказательства.

