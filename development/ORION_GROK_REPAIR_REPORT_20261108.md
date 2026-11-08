# Отчёт о правках цикла 8 ноября 2026

Ветка `grok/orion-platform-completion-20261108`. В `master` этот цикл не пушился. QA-v2 не переносился.

## Устранено

- Клавиатура `GlideSelect` и `Combobox` (`2fcb1ff7`, уже в истории master): открытие, стрелки, Enter, Escape, Tab, фокус на кнопке у GlideSelect. Правило вынесено в `packages/ui/src/visual/list-keyboard.ts`.
- Слежение только за выбранным агентом (`navigationTarget` требует `who`).
- В этом цикле: `decideAgentModuleOperation` отклоняет разрешение `documents.*`, если у токена запрет `documents`, в том числе у администратора. Чужой модуль этот запрет не закрывает.
- Сборщик установщика ждёт `phone.html` до 90 секунд. `next build` на этой машине завершался раньше, чем воркер дописывал статические страницы, и сборка обрывалась с «нет phone.html».

## Файлы этого цикла

- `scripts/build-desktop-installer.mjs`
- `packages/shared-types/src/agent-policy.ts`
- `packages/shared-types/src/agent-policy.test.ts`
- `development/ORION_PLATFORM_BASELINE_20261108.md`
- `development/ORION_PLATFORM_GAP_MATRIX_20261108.md`
- `development/ORION_PLATFORM_COMPLETION_PLAN_20261108.md`
- этот отчёт

Коммит `4c757faa` (меню на экранах ИИ, версия установщика `0.1.42`) сделан параллельно на локальном master и входит в ветку как предок. Его заново не переписывал.

## Тесты

Запущены и прошли, 33 теста в трёх файлах:

- `packages/shared-types/src/agent-policy.test.ts`
- `packages/ui/src/visual/list-keyboard.test.ts`
- `apps/web/lib/agent-presence.test.ts`

NOT_RUN в этом цикле: `pnpm lint`, полный `pnpm test`, `test:integration`, `architecture-check`, Playwright, создание дохода/расхода/перевода на тестовой базе, установка поверх профиля.

Ранее в тот же день, до этого цикла: `pnpm typecheck` PASS на коммите клавиатуры. Повторно после запрета документов полный typecheck NOT_RUN. Изменение — одна ветка в чистой функции, покрытая тестом.

## Осталось

Смотри матрицу. Критичное, что не сделано: приёмка финансовых форм мышью, cron примирения hub, поле в событии присутствия, Android, полный XLSX. Восстановление удалённой задачи не делалось намеренно.

## Нужно решение владельца

- Включать ли восстановление задач.
- Выставлять ли HTTP `verify` для hub.
- Сливать ли Android #81/#82 и XLSX #94.

## Следующему исполнителю

Не создавать второй каталог инструментов и второй загрузчик расширений. Не объявлять CI зелёным. Не ставить бета-установщик той же версии NSIS поверх уже выпущенной.
