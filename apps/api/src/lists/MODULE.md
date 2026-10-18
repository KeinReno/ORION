# Списки (`lists`)

Лёгкие общие списки (покупки, дела, сборы): пункты с количеством, группой, ценой и отметкой «кто отметил», шаблоны, ручной порядок.

Связи со складом и финансами не входят в модуль: их ведут плагины `lists-inventory` и `lists-finance` (серверные каталоги рядом).

Полностью независим от остальных предметных модулей; связи с задачами, заметками и другими записями — общие связи пространства.

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `lists` / 1.0.0 (платформа ^1.0.0) |
| Вид | дополнительный, по умолчанию включён |
| Жёсткие зависимости | — |
| Мягкие зависимости | — |
| Права (permissions) | `lists.list.read`, `lists.list.create`, `lists.list.update`, `lists.list.delete` |
| События | публикует: —; слушает: — |
| Панели веба | `lists` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/lists`, `workspaces/:workspaceId/lists-finance`, `workspaces/:workspaceId/lists-inventory` |
| Плагины, расширяющие модуль | `lists-inventory`, `lists-finance` |
| Миграции в манифесте | — |
| Код на сервере | `apps/api/src/lists/` |
| При выключении | Панель и API скрываются. Списки и их пункты сохраняются. |
<!-- generated:manifest:end -->
