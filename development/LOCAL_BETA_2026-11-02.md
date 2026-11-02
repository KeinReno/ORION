# ORION DEV — локальный Windows-кандидат, 02.11.2026

Статус: локальный кандидат установлен в рабочий профиль владельца; native import/reopen/restart/reimport проверены 02.11.2026. Это не GitHub release и не независимая приёмка продукта.

## Источник и границы

- Ветка: `codex/orion-dev-stabilization-20261102`.
- Исходный commit сборки: `08c449179b1994d6aa3d2524d1e163d941a66d0d`.
- Метка: `v0.1.35-orion-dev-local-08c4491`; версия оболочки: `0.1.35`.
- Основа: PR #95; XLSX PR #94 не включён. Master и GitHub releases не изменялись.
- Это импорт каталога разработки в канонические сущности, а не завершённый
  диспетчер агентов, универсальная IDE-интеграция или система независимой приёмки.

## Что реализовано

Панель ORION DEV зарегистрирована через существующий manifest/Workbench registry.
Доступ: владелец/руководитель; ORION DEV, Проекты и Задачи должны быть включены.
Пользователь видит пространство с ID, создаваемые/связанные объекты, кандидатов
совпадений, критерии приёмки и зависимости. Совпадения можно открыть для проверки.
Без выбора всех совпадений и подтверждения пространства импорт недоступен.

Публичный маршрут `POST .../development-import/apply` блокирует пространство,
роль, проекты и граф задач, перечитывает snapshot, проверяет обе контрольные
суммы и одноразовое подтверждение, затем создаёт данные одной транзакцией RLS.
Изменения описания, графа, настроек модуля или прав после просмотра отклоняются.
Существующие описания не перезаписываются. Новые описания сохраняют фазу и
критерии приёмки. Задачи и зависимости изменяются через TaskOperations/events.

У токена есть область user/workspace/catalog/preview/selection, срок 5 минут,
хранится только SHA-256. Откат возвращает токен в непогашенное состояние вместе
с откатом объектов, сопоставлений и событий. Повторный импорт читает durable
mappings; потерянный ответ восстанавливается обновлением плана без повтора записи.
Сетевое ожидание ограничено 30 секундами; timeout не объявляется отменой сервера.

Каталог находится внутри API-пакета установщика и обновляемого application payload.
Сервер использует только встроенный каталог либо административный env override.

## Проверки

- Unit: 1692/1692 PASS, bounded forks, полный прогон.
- TypeScript: monorepo PASS; после UI recovery web и API final PASS.
- Lint: 0 errors, 39 существовавших предупреждений; изменённые UI/e2e/lifecycle
  файлы отдельно без ошибок.
- Architecture / module registry / docs / platform map: PASS.
- Plugin registry + contract snapshot: 13/13 PASS, включая 11 plugin contracts.
- Первый полный PostgreSQL regression: 680 PASS, 2 FAIL, 1 opt-in benchmark SKIP.
  Обе ошибки были в предположениях component-dependents теста: зависимыми считались
  только плагины, каталог для module probe не был настроен. Тест теперь проверяет
  и отказ зависимого модуля с `component_incompatible`, и работу независимых.
  Исправленный файл: 7/7 PASS. Повторный полный прогон на исходном commit
  финальной сборки: **682 PASS / 0 FAIL / 1 opt-in benchmark SKIP**, 118 файлов.
- Профильные PostgreSQL проверки: 52/52 PASS до добавления двух дополнительных
  stale-state сценариев (project description / development module); оба PASS
  в финальном полном прогоне.
- Chromium: 44/44 (42 panel parity + 2 ORION DEV); после UI recovery все 4 ORION DEV
  сценария PASS. Включены review/adoption, импорт, reload, повтор, stale snapshot,
  потерянный ответ после commit, keyboard и зависшее соединение с восстановлением.
- Визуально проверены desktop и 320 px; горизонтального overflow нет.
- Production API/Web и desktop export: PASS.
- Упакованный runtime финального кандидата `08c4491`: свежий автономный PostgreSQL,
  встроенный каталог без source env, 13 проектов / 16 задач, restart/reimport без
  дублей, исходный ORION/описание сохранены. Профиль `tmp/orion-dev-review/packaged-profile-08c4491`, встроенный Node/PostgreSQL/Prisma, без ORION_DEV_CATALOG_ROOT.
- Habitat Windows Job Object smoke: PASS (stdin/argv/descendant termination/abort).

Изолированные проверки используют кластер 5436 и named scratch databases.
Упакованный runtime проверяется на портах 4103/5437 с отдельным профилем в tmp.
Рабочая база и профиль установленного приложения не использовались как fixtures.

## Дефекты и исправления

1. Preview digest не замечал часть ручных изменений: добавлены project/task
   modification metadata, task revision, настройки модулей и полный граф edges.
2. Не было общей публичной транзакции consent/apply: добавлена с rollback/replay/
   parallel/stale/expiry/revocation HTTP регрессиями на реальной PostgreSQL.
3. Терялись фазы и критерии приёмки: сохранены в описаниях только новых объектов.
4. Не было зарегистрированного UI-входа: добавлен отдельный module contribution,
   без прямого встраивания в Tasks/Projects Base.
5. Отсутствовал безопасный recovery при потерянном ответе и зависшем fetch:
   обязательное обновление плана, сохранение выбора и 30-секундный deadline.
6. Тест матрицы выключения не покрывал зависимые модули: добавлены строгие
   проверки блокировки зависимого модуля и неизменной доступности остальных.

## Windows-артефакт

- Установщик: `dist/orion-dev/08c4491/ORION_DEV_0.1.35_08c4491_x64-setup.exe`.
- Размер: 96504068 байт.
- SHA-256 установщика: `e450bfc2b8f9c729285b2574478a617a7ace8082ae19bb6afb42efe2d5bd04ba`.
- SHA-256 каталога: `6e3f7abf24f9206206e6318d82bf9df4e2bdeae24c1bf60ff9ba32137631504a`.
- Рядом находятся `build-manifest.json` и `SHA256SUMS.txt`.
- Финальный NSIS / Tauri release build PASS. Предыдущий установщик сохранён
  в `tmp/orion-dev-review/prior-beta35/`, первый кандидат — в tmp.
- Исходная установка beta.28 / `2755201` обновлена до `08c4491`; installer exit code 0.
- По прямому указанию владельца резервная копия рабочего профиля не создавалась.

Повтор сборки из исходного commit на Windows x64:

```powershell
corepack pnpm install --frozen-lockfile
$env:ORION_BUILD_TAG='v0.1.35-orion-dev-local-08c4491'
corepack pnpm build:desktop-installer
```

Требуются Node/pnpm из packageManager, Windows Rust/Tauri toolchain, .NET 8 и
embedded PostgreSQL package из lockfile. Команда создаёт локальный установщик;
она не публикует релиз. Побайтовая идентичность не обещается: build.json содержит
время сборки; каждая сборка получает собственный SHA-256.

## Установка и рабочее пространство — 02.11.2026

Кандидат установлен поверх beta.28 штатным NSIS, exit code 0. Установленные
build.json, маркер активного web runtime и SHA-256 каталога соответствуют
`08c4491`. Миграции применены; при повторных стартах pending migrations нет.
Существующая сессия Reno сохранилась. В селекторе выбрано созданное владельцем
Orion Dev; canonical workspace ID проверен в UI и записан в локальный evidence JSON.

Через нативную панель просмотрены план и выбранное пространство, отмечено явное
подтверждение. Preview предлагал 13 проектов / 16 задач, 0 matches, 0 mappings.
Consent и apply завершились HTTP 201 в обычном пользовательском контексте.
Результат: **13 новых проектов, 16 задач, 5 зависимостей**. Старый ORION сохранён;
после импорта в пространстве **14 проектов**. Записей через system role не было.

В проекте ORION CORE открыта каноническая задача DEV-001: описание содержит фазу
foundation и оба критерия приёмки. После завершения приложения и повторного входа
preview показывал 29 уже связанных объектов, 0 новых проектов / задач. Повторный
импорт завершился HTTP 201 и создал **0 проектов / 0 задач / 0 зависимостей**.
После отдельного обычного закрытия кнопкой × процесс завершился; повторный запуск,
вход в то же пространство и чтение описания задачи снова PASS. Приложение оставлено
открытым в Orion Dev / ORION CORE с сохранёнными критериями приёмки.

Наблюдение автоматизации: первый `agent-desktop close-app` закрыл окно, но не
завершил процесс в свой timeout; после проверки отсутствия окон процесс был
завершён отдельно. Это не засчитано за обычное закрытие. Отдельная проверка
нативной кнопки × завершила процесс без принуждения. Причина первого расхождения
не локализована; утверждения о воспроизводимом пользовательском shutdown-дефекте нет.

Локальные evidence: `tmp/orion-dev-review/installed-acceptance.json` и screenshots
`installed-preview.png`, `installed-import-result.png`, `installed-task-criteria.png`,
`installed-after-restart.png`, `installed-repeat-result.png`,
`installed-task-after-normal-restart.png`. Они содержат пользовательский контекст,
игнорируются Git и не публиковались.

## Оставшиеся границы

- Это проверка установкой на существующем ПК владельца, не clean-PC acceptance.
- Задачи оставлены к выполнению; импорт и агентская проверка не присваивают им
  независимую приёмку и не запускают исполнителей.
- Агентский orchestrator/dispatcher и независимая приёмка остаются дальнейшими
  этапами. Импорт не запускает исполнителей и не выставляет результатам accepted.
- Нет свежего CI на GitHub, clean-PC/другого устройства и Android-приёмки.

См. [ADR-0045](../docs/adr/ADR-0045-development-review-apply.md) и
[первый этап стабилизации](LOCAL_STABILIZATION_2026-11-02.md).

## Использованные UI-навыки

Product-design: spec/shape; rules, surfaces, naming-and-copy, product-judgment.
UI-design: Build; aesthetic-direction, design-guidelines; colors, buttons,
form-controls, responsive-design, surfaces. Использованы существующие Orion
компоненты и токены. Agent-desktop / Windows использован для UIA-проверки
установленного приложения: выбор пространства, review/consent/import, открытие
канонической задачи, обычное закрытие и повторный запуск.

## Локальные evidence

`tmp/orion-dev-review/`: `unit-workbench.json`, `integration-acceptance.json`,
`browser-workbench-final.log` (42 parity + 2 import), `browser-recovery-final.log`
(4 итоговых ORION DEV), `typecheck-workbench.log`, `typecheck-api-final.log`,
`typecheck-recovery.log`, `lint-workbench-final.log`, `plugin-workbench-final.log`,
`windows-workbench-final-build.log`, `packaged-runtime-fresh-final-result.log`.
Скриншоты — `test-results/e2e/orion-dev-*`. Эти локальные артефакты игнорируются
Git и не заменяют CI. Повторный fetch подтвердил HEAD PR #95: `2710e64`
без новых remote-изменений.
