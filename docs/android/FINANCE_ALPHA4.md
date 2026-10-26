# Android alpha.4 — быстрые финансы

21.10.2026. Версия 0.1.3 / versionCode 4. OPPO Reno8 5G.
Основание: поручение владельца оформить финансы для быстрого ввода расходов/доходов.

## Поведение
«Финансы» — пятый раздел Android shell. По умолчанию расход, сегодня, RUB,
последний счёт. Сумма — decimal keyboard; категория выбирается кнопками;
дата и необязательный комментарий раскрываются отдельно. Счета «Карта» и
«Наличные» создаются один раз в независимом пространстве телефона.
После успешной записи форма очищается, счёт и тип сохраняются для следующей.
Журнал по месяцу и итоги расходов/доходов; редактирование через запись,
удаление после явного подтверждения. Итоги не утверждают реальный остаток денег.

Черновик сохраняется при вводе, включая редактируемую операцию. При ошибке
диска введённое остаётся в форме; ранее подтверждённый snapshot не меняется.
Повтор сохранения одного UUID обновляет операцию, не дублирует её.
При незавершённом вводе другая запись не перезаписывает черновик.

## Контракты и хранение
Public DTO Account / FinanceCategory / Transaction и createTransactionInputSchema
из shared-types; никакого импорта внутренних сервисов или desktop plugins.
Финансовая предметная логика мобильного клиента — mobile-core/mobile-finance.ts,
а не Core. Текущая alpha использует только expense/income, одну категорию/строку,
личные RUB-счета и целое число копеек. Строка суммы разбирается без float/округления;
запрещены ноль, отрицательные, экспонента и более двух десятичных знаков.
Предельная точная агрегированная сумма проверяется до записи.

Snapshot v1 получает additive finance field. Старый snapshot сохраняет задачи,
заметки, outbox, настройки и device identity; начальные счета записываются атомарно
через прежний storage bridge. Новых Android permissions и native bridges нет.
Финансы включены в portable backup вместе с черновиком; изменение финансов
сбрасывает признак актуальной резервной копии.

SYNC_ENTITY_TYPES существующего hybrid protocol = list/listItem/note/task.
Финансы не отправляются в sync ops, не привязаны к выбранному remote workspace
и всегда помечены «Только на телефоне». Сервер/API/desktop и их данные не менялись.
Новые финансовые sync-контракты требуют отдельного ADR/среза; не расширять
allowlist или выдавать повторы POST транзакций за идемпотентный offline sync.

## Решения интерфейса
Product-design rule/preserve-user-input: durable draft и запрет тихого замещения.
rule/name-object-scope-consequence: область телефона и отдельное подтверждение удаления.
rule/cover-reachable-states: пустой месяц, запись, ошибка суммы/даты/диска,
редактирование, восстановленный черновик и offline. Реализация — существующие
семантические токены и touch targets KAIDEN; новый стиль не вводился.

## Проверки
- Workspace typecheck PASS; ESLint 0 ошибок / 29 предупреждений; architecture,
  plugin-contract (11 tests), module-docs PASS.
- Общий unit run: 1468 passed / 2 timeout (PDF parser и module-docs при параллельной
  сборке). Оба файла повторно PASS с одним worker; тайм-ауты и тесты не ослаблялись.
- 6 новых unit finance: exact money, migration preservation, offline/draft/restart,
  stable IDs, rejected references/dates, disk rollback, export и backup gate.
- Все 3 browser smoke PASS: tasks/notes, settings/updater и finance. Finance проверяет
  офлайн расход/доход, restart, edit без дубля, durable draft, удаление/отмену,
  precision error, экспорт и 320px/font130. Скрипт: scripts/android-finance-smoke.mjs.
- Render inspection 412px dark и 320px/font130; нет горизонтального overflow.
  Mechanical design check: только существующий Roboto warning, сохранён Android font.
- Android assembleDebug/assembleRelease/lintDebug/testDebugUnitTest PASS (9 JVM tests).
  Финальный APK содержит последний собранный web bundle. Vite предупреждает о bundle
  510 KB minified (~138 KB gzip); splitting не включён в этот срез.
- Подпись APK проверена apksigner, совпадает с alpha.3; code 3→4.
  Public distribution: https://github.com/KeinReno/ORION-Android-Releases/releases/tag/v0.1.3-android-alpha.4
  APK 4 298 028 байт; SHA-256:
  `5537726f566d8706b1b931c73a8e4765083d3bf1cdcd9784efe4df22750a574c`.

## Ограничения и приёмка
Физического Android/emulator нет: keyboard/Back/TalkBack/SQLite/ColorOS и обновление
поверх alpha.3 — NOT RUN на устройстве. Browser evidence это не заменяет.
APK — тестовый signed debug с прежним ключом; release variant собран unsigned.
Нет finance sync, переводов, custom accounts/categories, начальных остатков,
бюджетов/FX и UI восстановления backup. Не запускались DB integration и desktop installer.
GitHub CI ранее не стартовал из-за billing policy; проверки выше локальные.

На OPPO: обновить без удаления → проверить прежние записи → Финансы → 250,50/Кафе →
сохранить → авиарежим/перезапуск → проверить запись → изменить → экспортировать JSON.
Следующий этап: обратная связь по скорости ввода, затем пользовательские счета/категории;
финансовая синхронизация отдельно после проектирования публичного идемпотентного контракта.
