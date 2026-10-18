# Рынки (`markets`)

Рынки: список наблюдения, журнал сделок (реальные, бумажные, исторические) и позиции по реальным сделкам; импорт журнала из Compass.

`compass-engine.service.ts` запускает и проксирует локальный движок Compass (только `ORION_MODE=local`). Модуль по умолчанию выключен.

Полностью независим: Compass может быть не установлен, а финансы работают сами по себе.

<!-- generated:manifest:start -->
## Манифест (генерируется)

Блок собирается `pnpm module-docs` из `packages/shared-types/src/{modules,component-manifest}.ts` и контроллеров; руками не править, проверка — `pnpm module-docs:check`.

| Поле | Значение |
|---|---|
| id / версия | `markets` / 1.0.0 (платформа ^1.0.0) |
| Вид | дополнительный, по умолчанию выключен |
| Жёсткие зависимости | — |
| Мягкие зависимости | `finance` |
| Права (permissions) | `markets.trade.read`, `markets.trade.create`, `markets.trade.update`, `markets.trade.delete` |
| События | публикует: —; слушает: — |
| Панели веба | `markets` |
| Слоты | — |
| Маршруты API | `workspaces/:workspaceId/markets` |
| Плагины, расширяющие модуль | — |
| Миграции в манифесте | — |
| Код на сервере | `apps/api/src/markets/` |
| При выключении | Панель и API скрываются. Список наблюдения и сделки сохраняются и вернутся при включении. |
<!-- generated:manifest:end -->
