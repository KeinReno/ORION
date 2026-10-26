# Android alpha.14 — поля задач и заметок

21.10.2026; 0.1.13 / code14. По выбору владельца продолжены Tasks/Notes;
нижняя навигация остаётся с иконками. Desktop/API/общие DTO не менялись.

## Доступные действия
Задача: пять статусов общего контракта (отложена, к выполнению, в работе,
завершена, отменена), прежний приоритет, срок с датой/временем и явное удаление
срока. Время показывается в часовом поясе телефона; фоновых напоминаний нет.
В списке видны статус/приоритет/срок и просрочка. Фильтры: статус (включая группы
незавершённые/закрытые), приоритет, сегодня/просроченные/ближайшие 7 дней/без срока.
Дата обновляется при focus/visibility и раз в минуту. Закрытые задачи не попадают
в actionable date filters. Границы дня локальные; неделя — сегодня и шесть следующих
дней. Reorder отключён при фильтре/поиске, чтобы не переписать порядок скрытых задач.

Заметка: краткое описание до300 символов, до20 тегов по40 символов через запятую,
закрепление. Теги нормализуются trim/deduplicate при явном Save; невалидный ввод
остаётся в durable draft для исправления. Закреплённые идут первыми, затем по
updatedAt; отдельные фильтры по тегу/закреплению, прежний архив сохранён. Поиск
учитывает title/summary/body/tags; карточка показывает summary или excerpt body.
Редактор показывает счётчик текста. Исходный Markdown не преобразуется при записи.
Search/filter state раздельны у Tasks/Notes и сохраняются при переключении разделов
в рамках текущего запуска; после полного restart фильтры/поиск сбрасываются.

## Контракты и сохранность
Mobile Draft расширен optional fields: status/dueAt/summary/tagsText/pinnedAt.
Без defaults: старый draft не стирает metadata существующей записи. Shared
entryFields для local/remote формирует только поддержанные поля и проверяет
validateOpFields. Чужие project/parent/assignee/recurrence/dependency поля не
перезаписываются; новые project/team controls не добавлялись. Remote сохраняет
expectedRevision/CAS и прежний durable queue/recovery; реальное подтверждение
сервера появляется после ручного sync. Legacy snapshots читаются без миграции,
identity/outbox не пересоздаются. Ошибка диска не публикует новое содержимое.

## Проверено
- 47 focused tests PASS: 43 mobile-core +4 Android architecture/filter.
  Новые сценарии: legacy drafts не очищают поля, нормализация/ошибка тегов,
  отказ диска, явная очистка, synthetic two-replica fields convergence,
  границы суток/закрытые overdue/комбинация фильтров.
- Workspace typecheck; lint 0 errors /29 прежних warnings; architecture,
  module-docs, 11 plugin-contract tests PASS.
- 11 browser scripts PASS: все10 прежних плюс entry-fields. Новый проверяет
  create/edit/clear/status/due/filter/reorder guard, независимость поиска,
  summary/tags/pin после reload, валидацию, disk retry и320px/200% text.
- assembleDebug/assembleRelease/lintDebug/testDebugUnitTest PASS (9 existing JVM).
  Vite chunk warning >500kB и native lint baseline остаются.
  Публикуется debug APK с прежним тестовым сертификатом, release variant unsigned.

## Файлы
apps/android/src/features/entry-fields.tsx; features/tasks/task-filters.ts и test;
features/tasks/tasks-screen.tsx; features/notes/notes-screen.tsx; app/App.tsx;
style.css; package.json; updates.ts; android/app/build.gradle.
packages/mobile-core/src/mobile-models.ts, index.ts, remote-client.ts и tests.
scripts/android-entry-fields-smoke.mjs, version fixtures в settings/depth smoke;
Android README/STATUS/этот отчёт.

## Ограничения и следующая приёмка
Физический OPPO Reno8 5G/ColorOS date picker, TalkBack, реальный LAN NOT RUN.
Синтетические browser/MemoryHost не доказывают работу телефона/Windows.
Наклоны по просьбе владельца не менялись. Нет полного desktop feature parity:
project/team/planning, reminders, history/templates/trash restore/attachments —
отдельные slices через существующие capabilities. Rich Markdown preview не добавлен.
После установки поверх alpha.13 проверить статус/срок, удаление срока, теги,
закрепление, Back с черновиком и перезапуск; затем реальный LAN/CAS.
