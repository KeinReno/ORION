# Склад (`inventory`)

Склад: позиции и журнал движений (приход, расход, корректировка).

Уведомления о низком остатке формирует `inventory-alerts.service.ts`.

Работает без проектов — привязка к проекту необязательна.

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `inventory` / 1.0.0 (платформа ^1.0.0) |
| Вид | дополнительный, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | `projects` |
| Права (permissions) | `inventory.item.read`, `inventory.item.create`, `inventory.item.update`, `inventory.item.delete` |
| События | публикует: —; слушает: — |
| Панели веба | `inventory` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/inventory` |
| Плагины, расширяющие модуль | `inventory-alerts`, `inventory-costing` |
| Миграции в манифесте | — |
| Код на сервере | `apps/api/src/inventory/` |
| При выключении | Панель и API скрываются. Позиции и движения сохраняются. |
<!-- generated:manifest:end -->
