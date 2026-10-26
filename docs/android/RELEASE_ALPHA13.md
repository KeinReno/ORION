# Android alpha.13 — shell, настройки и списки

21.10.2026; 0.1.12 / code 13. Отдельная Android-ветка; desktop/API не менялись.
Устройство ручной приёмки: OPPO Reno8 5G.

## Что готово
Нижняя панель содержит иконки Tasks/Notes/Finance/Lists/More; на узких экранах
подписи скрываются, accessible names сохраняются. Header даёт связь и настройки.
Bundled registry знает canonical OrionModuleId, shell не импортирует конкретные
модули. Bootstrap соединяет адаптеры; outlet изолирует render error. Hash routes
содержат scope/entity; чужой scope не открывает редактор в другом пространстве.
Нативный/браузерный Back сохраняет работающий сценарий редактора. Неудачная или
незавершённая запись черновика блокирует уход до повтора/отмены.

Settings hub: поиск, stable field anchors, возврат с поисковым запросом; реальные
страницы Внешний вид, Движение, Голос, Данные, Обновления, Диагностика, О приложении.
Настройки относятся к телефону; patchSettings сливает поля в сериализованной durable
транзакции. Ошибка не публикует несохранённое значение; поле сохраняет попытку и retry.
Разные поля не перетирают друг друга. Placeholder admin/account controls отсутствуют.

Lists: создать/переименовать список и пункты, отметить пункт, архив/возврат,
поиск, scoped durable draft, подтверждённое удаление и JSON export. Удаление списка
каскадно удаляет только его пункты. Edit label сохраняет остальные public metadata.
Шаблоны read-only. Лимит 500 пунктов из общего контракта. Local projection и remote
queue используют существующие public list/listItem SyncOp; finance остаётся local-only.
Синхронизация ручная. Импорт «телефон → ПК» по-прежнему переносит только tasks/notes.
Старые snapshots/backup v1 читаются с additive defaults; identity/seq не пересоздаются.

## Проверки
- Workspace typecheck PASS; lint 0 errors, 29 прежних warnings.
- 44 focused tests: 41 mobile-core и 3 routes/registry/settings architecture.
  Включены parallel settings, disk failure, legacy snapshot defaults, lists metadata,
  cascade, backup, synthetic two-replica convergence и scope isolation.
- Architecture, module-docs и 11 plugin-contract tests PASS.
- 10 browser scripts PASS: прежние CRUD/offline, settings/update, theme, dictation,
  finance/date, gestures, visual motion, synthetic depth; новые foundation и lists.
  Foundation включает 320px/200% text, anchors/Back, settings retry, scope mismatch
  и отказ ухода при disk error черновика. Lists проверяет reload/export/delete.
- assembleDebug / assembleRelease / lintDebug / testDebugUnitTest PASS (9 JVM tests).
- Build сохраняет предупреждение Vite chunk >500 kB; native lint baseline warnings.
  Release variant unsigned; публикуется совместимый APK с прежним тестовым ключом.

## Границы и следующий шаг
Физический OPPO/ColorOS/TalkBack/sensors/FPS и настоящий Windows LAN NOT RUN.
Синтетические bridge/MemoryHost тесты не заменяют такую приёмку. Наклоны не менялись:
неполное покрытие элементов отложено владельцем. Task/Note сохраняют уже доступный
CRUD, но это не полный desktop field/attachment/trash parity.

A1 extraction начат, старые LAN/finance adapters продолжают работать; A2–A5 поставлены
ограниченным bundled срезом. Dynamic plugin SDK/policy lifecycle, все 17 модулей,
entity-table/media migration, background sync и backup restore UI остаются будущими.
JSON/SQLite лимиты 8 MiB snapshot / 16 MiB replica сохранены. Перед files/large data
нужна отдельная fault-tested миграция с recovery; не смешивать её с shell extraction.
Следующая приёмка: установить поверх alpha.12, проверить иконки/Back/поиск настроек,
список с черновиком после restart; затем физический LAN и следующий domain adapter.

## Изменённые файлы
- `apps/android/src/app/`: App/bootstrap, repository/navigation controllers,
  runtime registry, shell/outlet/More/header/navigation, settings catalog/pages/bindings.
- `apps/android/src/features/`: tasks/notes extraction, новый ListsScreen.
- `apps/android/src/{main,settings,connection,style,updates}`; package.json/build.gradle.
- `packages/mobile-core/src/{index,backup,mobile-lists,mobile-replica,remote-client}`
  и focused tests; публичные desktop DTO не изменены.
- `scripts/android-{foundation,lists}-smoke.mjs`, обновлённые прежние smoke;
  `vitest.config.mts`; актуальные Android architecture/settings/proposal/status docs.
