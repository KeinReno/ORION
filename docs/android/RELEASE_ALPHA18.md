# Android alpha.18 — проверка изменений после alpha.15

23.10.2026; 0.1.17/code18. Baseline cbe43d3 (alpha.17).
Сверены изменения 86d6f64..cbe43d3: checklist, backup restore, gestures и sync parent support.
Чужие доработки сохранены; desktop checkout с незавершёнными правками не редактировался.

## Исправления с regression tests
- Restore терял черновик ещё не созданного списка/пункта. Теперь восстанавливает
  новый list draft; item draft требует существующий parent, но не уже созданный item.
  Merge не заменяет текущий phone draft; replace также сохраняет текущий ввод.
- Пересчёт балансов учитывал перевод только как расход источника. Теперь сумма
  зачисляется получателю; проверены merge и replace на двух счетах.
- Дубликаты ID заметок в файле отклоняются до записи вместо неоднозначных записей.
  После merge дополнительно проверяется целостность дерева задач.
- Извлечение чек-листа игнорирует fenced Markdown code (backticks/tilde), сохраняет
  код и окружающий текст. Сохраняет прежнее удаление пустых краёв описания.

## Проверка и ограничения
91 targeted tests: mobile-core, Android и core sync. Browser smoke охватывают
прежние сценарии и новые restore/task-creation. Реальные результаты сборки и
публикации дописаны в outputs/android-alpha18/REPORT.md.
Физический OPPO Reno8 5G/ColorOS, реальный Windows LAN, полный API integration и
аппаратная визуальная приёмка не выполнены; synthetic MemoryHost их не заменяет.
Наклоны не перерабатывались. Проверка не заявляет полный аудит всех desktop модулей.

Изменённые файлы: packages/mobile-core/src/backup.ts + backup.test.ts;
apps/android/src/features/tasks/text-to-checklist.ts + test; version fields,
settings/depth smoke fixtures; этот отчёт, README/STATUS.
