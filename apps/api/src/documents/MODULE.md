# Документы (`documents`)

Файлы и папки пространства: дерево по `parentId`, версии, превью, загрузка и потоковая отдача с `Range`.

Байты лежат за `StorageAdapter` (`apps/api/src/storage/`), база авторитетна по структуре. Корзина файлов чистится ночным кроном `document-trash-purge.service.ts`.

Работает без заметок и задач.

Привязка к проекту проверяется через публичный `ProjectReferences` (Projects SDK), в исходной транзакции/RLS; проверка прав и null остаются у Documents. Выключение Projects не меняет прежнюю допустимость ссылки.

Межмодульные операции выполняются через публичные SDK владельцев; полные доменные модули ради ссылки/команды не импортируются. [Контракты и правила](../../../../docs/platform-api/MODULE_BOUNDARY_SDKS.md).

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `documents` / 1.0.0 (платформа ^1.0.0) |
| Вид | базовый, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | `notes`, `projects` |
| Права (permissions) | `documents.document.read`, `documents.document.create`, `documents.document.update`, `documents.document.delete` |
| События | публикует: —; слушает: — |
| Панели веба | `documents` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/documents` |
| Плагины, расширяющие модуль | `documents-history`, `documents-resources`, `documents-office` |
| Миграции в манифесте | — |
| Код на сервере | `apps/api/src/documents/` |
| При выключении | Панель и загрузка файлов останавливаются. Файлы на диске и в базе сохраняются. |
<!-- generated:manifest:end -->
