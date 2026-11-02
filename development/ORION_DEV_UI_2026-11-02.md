# ORION DEV: рабочий обзор

Задача владельца: увидеть направления разработки, понять текущие задачи и открыть их без чтения служебного плана импорта. На установленном 08c4491 весь экран занят плоским списком сопоставлений, UUID и исходными английскими названиями.

Решение: общий заголовок пространства, обзор по этапам, независимые списки направлений и задач, отдельный раздел импорта. Стартовый этап — надёжность платформы (Stage 0). Никаких новых сущностей, записей при открытии, автоматического выполнения или приёмки. Связи берутся только из already_mapped, статусы и зависимости — из канонических проектов и задач. Русские подписи каталога не переименовывают пользовательские данные; ручные переименования показываются как есть.

Состояния: загрузка, ошибка с повторной попыткой, пустое/частично заполненное пространство, недоступный связанный объект, фильтр без задач, архивный проект. Импорт сохраняет отдельное подтверждение совпадений и пространства, защиту от устаревшего плана и восстановление после неизвестного результата записи. Переключение раздела во время импорта запрещено.

Проверка: рабочие статусы/переименования, переходы в проекты и задачи, повторный импорт без дублей, конфликт и потеря ответа, клавиатура, ширина 320px, desktop и установленный Windows-кандидат. Оформление использует существующие семантические токены и публичные hooks/contracts.

Основания product-design: rule/smallest-intervention, rule/structure-before-containers, rule/one-primary-action, rule/cover-reachable-states, rule/name-object-scope-consequence, rule/preserve-user-input, rule/accessible-name-required, rule/keyboard-complete-flow, rule/preserve-mental-model, rule/inline-before-modal, rule/navigation-vs-action.

Применённые навыки: product-design (rules.md, product-judgment.md, surfaces.md, naming-and-copy.md) для структуры; ui-design Build для нового рабочего обзора (direction/product-ui.md, direction/aesthetic-direction.md, design-guidelines.md; guidelines/colors.md, buttons.md, responsive-design.md, surfaces.md, section-layout.md, form-controls.md). Существующая графитовая/янтарная тема и токены Orion имеют приоритет.

Первый браузерный прогон: 4 сценария импорта PASS; новый обзор корректно показывал данные, но переход к задаче в отдельном окне оказался пустым действием (нет dock bus). Исправлено в модуле через публичные useObjectOpeningAvailable/panelWindowUrl: обзор открывает каноническую отдельную панель; в основном окне использует штатный dock. При проверке импорта кнопки открытия объектов в отдельном окне отключены с объяснением, чтобы просмотр совпадения не сбрасывал введённые подтверждения.


## Проверки кандидата dd6307e

Windows, 02.11.2026. Source SHA: `dd6307e4d44dd195426807d06b107d913841a79f`; tag `v0.1.35-orion-dev-local-dd6307e`.

- 1695 unit / 218 files PASS, bounded forks; включает 3 проверки проекции/сопоставлений/ручных переименований.
- TypeScript workspace PASS; production API/Web PASS; lint 0 errors / 39 прежних warnings.
- architecture-check, 11 plugin contracts, module registry/docs/platform map checks PASS.
- 47 Chromium PASS: 42 panel parity (default-full/plugins-off) + 5 ORION DEV. Проверены preview/consent/apply, устаревший план, потеря ответа, 30s timeout, повтор без дублей; русские подписи и ручные названия, реальные статусы/зависимости, фильтры, отсутствие автоматических POST, network recovery, canonical task/project navigation в отдельной панели и основном dock. Клавиатура и 320px без горизонтального переполнения; первый/последний контент достижимы.
- PostgreSQL: 20 focused consent/apply integration PASS на отдельной базе кластера :5436. Первый параллельный прогон завершил все 20 assertions, но afterAll превысил 5s лимит транзакции очистки (5715ms). Повтор после завершения браузерной нагрузки PASS без изменений тестов или ослабления проверок. Миграции применены при создании отдельной E2E-базы; рабочий профиль не использовался для тестовых fixtures. Полный API regression 682/1 skip относится к предыдущему кандидату 08c4491 и в этом UI-срезе не повторялся.

Локальные evidence: `tmp/orion-dev-review/ui-{unit-all,typecheck,lint-final,architecture-final,contracts,integration-final,e2e-final,installer}.log`; изображения `test-results/e2e/orion-dev-overview-uses-ca-0c39e-es-with-no-automatic-writes-chromium/overview-{desktop,320,320-last-task}.png`. Это синтетические тестовые данные, не рабочие статусы владельца.

## Windows: сборка и установленный профиль

NSIS собран и установлен (`/S`, exit 0). Установленный `runtime/build.json` подтверждает tag и commit `dd6307e`. Перед установкой Orion штатно закрыт кнопкой ×; после установки запущен обычный установленный EXE. Резервные копии рабочего профиля по прежнему явному указанию владельца не создавались.

- Артефакт: `dist/orion-dev/dd6307e/ORION_DEV_0.1.35_dd6307e_x64-setup.exe` (96 512 369 bytes).
- SHA-256: `da750c8da83deebfe61346fe86a23e31f7bc443d94792b4be30650778fab739a`.
- Отдельный packaged-profile smoke PASS: встроенный каталог, запуск, 13 проектов / 16 задач, restart, повтор без дублей и сохранение исходного ORION. Evidence: `tmp/orion-dev-review/ui-packaged-runtime-result.log`. Нативный Windows host smoke также PASS.
- Рабочее пространство Orion Dev: обзор в янтарной теме показывает 13 направлений / 16 задач; всего в sidebar 14 проектов, включая исходный ORION. 0 в работе, 16 в планах, 5 ожидают зависимостей, 0 завершены. Это текущие записи, не заявление о приёмке разработки.
- Через нативный UI проверены переключение foundation → agents → foundation и статус зависимости DEV-008. DEV-001 открывается в каноническом ORION CORE с существующими статусом и критериями. После проверки приложение возвращено на обзор; рабочие записи не переименовывались и не завершались.
- Native evidence: `tmp/orion-dev-review/ui-installed-overview.png`, `ui-installed-agents.png`, `ui-installed-task.png`. Windows UIA для aria-pressed использует TogglePattern/check; Legacy click не менял выбранную фазу, поэтому результат всегда перечитывался. Это особенность инструмента автоматизации; браузерные pointer/keyboard сценарии проходят.

Границы: существующие английские названия/критерии в канонических карточках сохранены; русские подписи относятся к обзору. Права owner/lead не расширены. Диспетчер агентов и независимая приёмка не добавлялись. Функциональные/адаптивные проверки пройдены; субъективная оценка нового оформления остаётся владельцу. Master, GitHub releases и RINA Lab automation не изменялись.
