# ORION DEV — локальная стабилизация 02.11.2026

Статус: проверка и исправление foundation; не готовая Windows-бета.
Основа: PR #95, `2710e64b098843daba098703dfd774e01db5f872`.
Рабочая ветка: `codex/orion-dev-stabilization-20261102`.
Проверки ниже относятся к исходникам этой ветки, а не к установленному приложению.

## Контекст владельца

Владелец создал пространство **Orion Dev** и проект **ORION** внутри него.
Использовать существующие записи после авторизованного выбора их ID. Не создавать
ещё одно пространство, не переименовывать и не присваивать проект ORION каталогу
автоматически. Каталог содержит 13 проектов, 16 задач, 5 фаз; это стартовый перечень
работ, а не подтверждённый полный аудит всех модулей и не выполненные задачи.

Обсуждение: [общий чат](https://chatgpt.com/share/6ae83c9b-bf88-83eb-b043-f808f307dfe8),
письменная передача Рины от владельца. ORION DEV — обычное пространство; будущий
Development Orchestrator должен обслуживать разные проекты/репозитории и IDE.
Приоритет этой итерации — стабилизация, не автономный диспетчер и не новый дизайн.
RINA Lab и настройки автоматизаций не менялись.

## Сверка GitHub и локальной копии

GitHub проверен через connector, remote refs обновлены через git fetch origin.
На момент проверки открыты 13 PR:

| PR | Фактическая ситуация | Действие |
|---|---|---|
| [#95](https://github.com/KeinReno/ORION/pull/95) | Foundation продвинулся до 2710e64; локальная исходная ветка отставала на 111 коммитов этой линии | Взят отдельной базой стабилизации |
| [#94](https://github.com/KeinReno/ORION/pull/94) | XLSX/DOCX и preview/approved beta; уже был в исходной локальной ветке | Не включён в ветку стабилизации |
| [#85](https://github.com/KeinReno/ORION/pull/85)–[#90](https://github.com/KeinReno/ORION/pull/90) | Старые stacked PR Agent Hub/Habitat; ветки уже входят в master через интеграцию #92 | Не мержить повторно |
| [#91](https://github.com/KeinReno/ORION/pull/91) | Native host перенесён другими SHA: fab694c, 2ce9480, 8124d4d; master дополнительно содержит отмену #93 | Не накатывать старый snapshot поверх новых исправлений |
| [#62](https://github.com/KeinReno/ORION/pull/62) | Отдельная Android/LAN/Finance линия; GitHub сообщает конфликт с master | Отдельная интеграционная работа |
| [#81](https://github.com/KeinReno/ORION/pull/81), [#82](https://github.com/KeinReno/ORION/pull/82) | Android UI-ветки поверх #62 | Сначала сверить общие/альтернативные изменения и базу #62 |
| [#80](https://github.com/KeinReno/ORION/pull/80) | Продуктовое предложение Gen1 | Не считать принятым ТЗ или готовым кодом |

Дополнительные remote-ветки без новых открытых PR: старые fixes UI/security
`claude/modest-pasteur-tfpb9x`, документационная `docs/reconcile-and-organize-20261019`,
Orion Link/prototype, прежняя updater-ветка, Gen2 context. Их наличие вне ancestry
не означает отсутствие эквивалентного поведения в HEAD. Они инвентаризированы,
но построчная приёмка и интеграция этих направлений не выполнены.

Исходная локальная ветка `local/orion-dev-with-pr94` на `0b01db5` уже содержала
88 коммитов сверх origin/master. Она сохранена. Промежуточная
`codex/local-module-assembly-20261102` сохранила пробное локальное объединение #95.
Текущая ветка начата заново от #95, чтобы выполнить просьбу не смешивать #94.
Ни одна из этих операций не меняла master на GitHub.

## Исправленные дефекты

1. Ошибки TypeScript в проверках массивов, замыканиях consent и тестовых типах.
2. Две development-модели были вручную помещены в генерируемую область Agent Hub:
   обычная регенерация удаляла бы их. Модели вынесены из области, назначен владелец.
3. DevelopmentImportConsent отсутствовал в классификации backup/sync. Теперь он
   ephemeral-excluded/not-synced; восстановление не возвращает старые разрешения.
4. CLI и сервер расходились по phase validation, foreign snapshot/catalog rows,
   дубликатам зависимостей и идентичности переименованной mapped-задачи. Теперь
   используют общий чистый planner; differential tests проверяют оба entry point.
5. Серверный runtime теперь получает тот же CJS planner в production-сборке.
6. Прямые обращения development к чужим Project/Task/TaskDependency перенесены
   за фиксированные публичные проекции владельцев, без передачи Prisma delegates.
7. Создание задач и зависимостей обходило канонические события. Теперь используется
   TaskOperations.createTx/updateTx; без него запись отклоняется. Повторный импорт
   не публикует повторные события. События откатываются вместе с неудачным импортом.
8. До сверки mapping/graph добавлены workspace/role locks; граф задач блокируется
   до чтения и меняется с expectedRevision. Проверяются параллельный импорт и
   противоположные конкурентные рёбра.
9. Preview/consent учитывают выключенные Projects/Tasks через ModulesService.
10. Общий integration-прогон обнаружил нарушение принятого ADR-0007: live policy
    edit расширял выданные scopes агента. Восстановлен ceiling текущих scopes для
    матрицы/extra/module permissions; policy edits сериализованы row lock, чтобы
    параллельное сохранение не возвращало уже снятое право. Исходная проверка 403
    сохранена; добавлены unit и HTTP regression конкурентного сужения.
    Ранее расширенные реальные токены автоматически не отзывались и не менялись.
11. Architecture-check теперь проверяет development helpers без суффикса
    `.service.ts`, чтобы перенос запросов в helper не скрывал нарушение границ.
    Public SDK дополнен аддитивно: Integration 1.10.0 / Platform 1.11.0.
12. После просмотра исходников и скриншотов исправлены четыре устаревших action
    snapshots: существующие «Сводка» Projects и «Горячие клавиши» Settings.
    Пользовательский UI не переписывался.

## Проверки

Изолированный PostgreSQL 16: `127.0.0.1:5436`, данные в gitignored
`tmp/orion-dev-review/postgres`. Тестовые БД:
`orion_dev_acceptance_20261102`, `orion_dev_browser_20261102`.
Финальные адресные прогоны также используют `orion_dev_regression_20261102`.
Рабочие профили и пользовательское пространство не мигрировались и не наполнялись.

Все 153 миграции применены на пустой тестовой БД, включая
`20261101190000_development_import_consents`. Проверки выполняются под
non-superuser/non-BYPASSRLS ролью; у таблицы проверены ENABLE и FORCE RLS.
Consent покрывает owner/lead isolation, member/outsider/missing-session refusal,
hash-only storage, expiry/scope, concurrent consume/replay, rollback и HTTP
auth/stale-preview/role revocation. Mapping/import tests используют настоящий PG.

Проверенные исходники: `caa2db0a894c2a7e31947389e4d67f69ca29f5c0`, Windows x64,
Node 22.14.0. Следующий документационный commit добавляет результаты и пустую
workspace-запись Habitat в lockfile; версии зависимостей не изменяются.

| Проверка | Итог |
|---|---|
| `install --frozen-lockfile --offline` | PASS; добавлена недостающая пустая importer-запись `packages/habitat: {}`; повторный install больше не меняет lockfile |
| Prisma Client + 153 миграции | PASS на пустых изолированных БД |
| Populated consent DDL rehearsal | PASS, существующий Project неизменен; rehearsal полностью откатан |
| Typecheck всего текущего monorepo | PASS |
| Lint | PASS: 0 errors, 39 существующих warnings |
| Полный unit, forks / 1 worker | **1692 PASS**, 0 failed |
| Полный PostgreSQL integration, forks / 1 worker | **671 PASS**, 0 failed, 1 opt-in measured-Hub benchmark skipped |
| Адресные import/consent/snapshot integration | 51 PASS; входят в полный набор |
| Architecture / registry / module-docs / platform-map | PASS |
| Plugin contracts | 11 PASS |
| Production API + Web build | PASS; Web — 56 статических страниц |
| Chromium panel baseline | **42 PASS**, default-full и plugins-off |
| Compiled production API + restart | PASS: health, JWT preview 13 проектов/16 задач, consent, restart; синтетический существующий проект ORION остался единственным и неизменным |
| Установка native Windows / импорт через UI | NOT RUN: end-to-end import UI/apply ещё не реализованы |

Полный JSON-evidence локально: `tmp/orion-dev-review/unit-final.json`,
`integration-final.json`; browser/build/typecheck/lint и production smoke logs
лежат рядом. Это gitignored test evidence, не содержимое рабочего пространства.
Приложение production smoke запускалось отдельно на :4102 и было остановлено;
его синтетические пользователь и workspace удалены из тестовой БД.

Первые промежуточные прогоны не были зелёными: выявлены дефекты типов/ownership,
stale snapshots, нарушение scope ceiling и сбои от изменения source во время
прогона. Изменение TZ не проверяется корректно в threads pool на этой Windows;
thread runs не используются как полный acceptance. Финальные полные fork-прогоны
после исправлений завершились с exit code 0; проверки не выключались и не
ослаблялись ради результата.

Миграция consent дополнительно проиграна в транзакционном DDL-rehearsal на
тестовой БД с существующим Project: содержимое проекта осталось побайтно прежним,
ENABLE/FORCE RLS присутствовали; весь rehearsal откатился через ROLLBACK.

Команды проверки (DATABASE_URL и APP_DATABASE_URL должны указывать только на
названную изолированную БД; общий dev URL из setup-integration не использовать):

```text
corepack pnpm db:generate
corepack pnpm --filter @orion/api prisma:migrate:deploy
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm exec vitest run --maxWorkers=1 --pool=forks
corepack pnpm exec vitest run --config vitest.integration.config.mts --maxWorkers=1 --pool=forks
corepack pnpm architecture-check
corepack pnpm plugin-contract-check
corepack pnpm module-registry --check
corepack pnpm module-docs:check
corepack pnpm platform-map:check
corepack pnpm test:e2e:local e2e/panels.spec.ts
```

Для browser runner задаётся отдельная E2E_DATABASE и тот же тестовый кластер;
он пересоздаёт только эту БД. Встроенный default `orion_e2e` не использовался.

## Оставшиеся блокеры до пригодной Windows-беты

- Нет публичной команды apply: preview, consent и внутренние stages пока не
  соединены в одну авторизованную транзакцию Revalidation → Consume → Write → Result.
- Consent endpoint возвращает writePerformed:false в смысле отсутствия записей
  проектов/задач; сам hashed consent record записывается в БД.
- Для будущего apply нужно определить полноценный snapshot state: сейчас digest
  не включает revisions/updatedAt, состояние dependency graph и module settings.
  Это нужно закрыть до заявления «любое изменение после preview отклоняется».
- Каждый публичный writer должен повторять module/role gates под блокировками,
  не полагаться на выполненный ранее preview.
- Каталог принят как стартовый; acceptance/фазы ещё не представлены полностью в
  импортируемых описаниях/вехах. Нельзя потерять эти критерии при наполнении.
- Нет интерфейса выбора workspace, review/matches, итогов и повторного импорта;
  нет законченного Development module lifecycle/manager contribution.
- Каталог не включён как самодостаточный ресурс Windows runtime; сейчас источник
  конфигурируется администратором через ORION_DEV_CATALOG_ROOT.
- Не проведены native install/restart и реальный повторный импорт через UI.
  Готовый установщик ORION DEV в этой итерации не заявляется.

Следующий срез: сначала закрыть state fingerprint и транзакционный apply с
регрессиями stale state/rollback/replay/concurrency/module-off; затем UI через
зарегистрированный contribution, synthetic browser acceptance, Windows package,
native restart/reimport и только после этого наполнение существующего Orion Dev.
Отдельное разрешение требуется для merge master/публичного beta release.
