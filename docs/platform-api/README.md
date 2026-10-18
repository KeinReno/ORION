# Контракты платформы (Platform API) — индекс

Этап 2 `docs/PLATFORM.md` §8: формализация контрактов. Основание — аудит `docs/PLATFORM_AUDIT.md` (пробелы G1–G26).
Правило документов этой папки: раздел «Как сейчас (v1.0, зафиксировано)» описывает только то, что есть в коде,
с путём к файлу; «Целевое состояние» — предложение, кода нет; «Не сделано» — явный список. Статус «спецификация» значит:
документ написан, кода нет.

## Индекс контрактов

| Контракт | Статус v1.0 | Источник истины (код) | Документ |
|---|---|---|---|
| Module API | зафиксировано (как есть; манифест — производный) | `packages/shared-types/src/modules.ts` (`MODULE_CATALOG`, `ORION_MODULE_IDS`), `component-manifest.ts`, `apps/api/src/modules/` | [MANIFEST.md](MANIFEST.md) |
| Plugin API | зафиксировано (UI-слоты; сервер — частично) | `packages/shared-types/src/plugins.ts` (`PLUGIN_CATALOG`), `apps/web/lib/extensions/contracts.ts` (`SlotContracts`), `host-api.ts`, `apps/api/src/plugins/` | [MANIFEST.md](MANIFEST.md), `docs/MODULES_AND_PLUGINS.md` |
| Event API | спецификация (кода нет) | — (целевой `EventBus`; ADR-0019) | [EVENTS.md](EVENTS.md), [ADR-0019](../adr/ADR-0019-event-api-outbox.md) |
| Storage API | зафиксировано для файлов; для данных компонента — нет | `apps/api/src/storage/storage-adapter.ts`, `apps/api/prisma/schema.prisma`, `apps/api/src/sync/snapshot-registry.ts` | [STORAGE.md](STORAGE.md) |
| Workspace API | зафиксировано (как есть, без отдельного интерфейса для компонентов) | `apps/api/src/workspaces/`, `packages/shared-types/src/workspace.ts` | [WORKSPACE.md](WORKSPACE.md) |
| Theme API | зафиксировано (`ThemeDocument` v1) | `packages/shared-types/src/theme-document.ts`, `packages/ui/src/theme-engine.ts` | [THEMES.md](THEMES.md) |
| Surface API | зафиксировано как реестр панелей; единого контракта поверхностей нет | `apps/web/lib/panel-registry.ts` (`PanelDefinition`), `packages/ui/src/workbench.tsx` | [SURFACES.md](SURFACES.md) |
| Permission API | спецификация (кода нет; существуют пять разрозненных механизмов) | `workspace.ts`, `modules.service.ts`, `schema.prisma` (`HealthGrant`), `agent.ts` | [PERMISSIONS.md](PERMISSIONS.md) |
| Integration API | нет (каждая интеграция — отдельный сервис) | `apps/api/src/events/calendar-connections.service.ts`, `common/remote-url-guard.ts`, `storage/webdav.storage.ts` | [INTEGRATIONS.md](INTEGRATIONS.md) |
| Agent Gateway API | зафиксировано (`AGENT_API_VERSION = "1"`); регистрация инструментов модулями — нет | `apps/api/src/ai/`, `packages/shared-types/src/agent*.ts`, `apps/api/src/mcp/orion-mcp.ts` | [AGENT_GATEWAY.md](AGENT_GATEWAY.md), [ADR-0018](../adr/ADR-0018-agent-gateway.md) |

## Политика совместимости (G2)

### Как сейчас (v1.0, зафиксировано)

- Единая версия платформы: `PLATFORM_API_VERSION = "1.1.0"` в `packages/shared-types/src/component-manifest.ts`.
  Компонент указывает `requires.platform` (`^1.0.0`; поддержаны точная версия, `^`, `~`, `>=` — `satisfiesVersionRange`).
  Тест `component-manifest.test.ts` проверяет, что все манифесты каталогов удовлетворяют текущей версии.
- Версии отдельных контрактов уже существуют, но разрозненны и несвязаны с `PLATFORM_API_VERSION`:
  `AGENT_API_VERSION = "1"` (`packages/shared-types/src/agent-gateway.ts`), `themeDocumentSchema.schemaVersion = 1`
  (`theme-document.ts`), `SNAPSHOT_VERSION = 2` (`apps/api/src/sync/`, см. `CLAUDE.md`). У слотов расширения версии нет
  (`SlotContracts`, 38 слотов, `apps/web/lib/extensions/contracts.ts:393`; аудит насчитал 31 — расхождение не разбиралось).
- Версии компонентов статичны (`1.0.0`) и автоматически не сверяются с изменениями (см. [MANIFEST.md](MANIFEST.md)).

### Целевое состояние (предложение)

1. **Semver на каждый контракт.** У каждого из десяти контрактов своя версия `MAJOR.MINOR.PATCH`; `PLATFORM_API_VERSION` —
   версия набора: её MAJOR растёт при любом breaking-изменении любого контракта, MINOR — при совместимом добавлении.
   Манифест компонента может уточнять `requires.contracts` (например `event: "^1.0.0"`) — расширение схемы манифеста, не сделано.
2. **Breaking-изменение** (требует MAJOR, ADR и окна депрекации): удаление или переименование слота, поля props слота,
   экспорта `host-api.ts`; сужение props или смена их семантики; удаление/переименование токена `ThemeDocument.colors`
   или смена `schemaVersion`; удаление или смена типа поля в публичном DTO/маршруте; смена имени события, удаление или
   смена смысла поля `payload`, смена гарантий доставки; удаление или переименование разрешения/scope; ужесточение
   обязательного поля манифеста; смена формата снапшота без чтения старого.
3. **Не breaking** (MINOR): новый слот, необязательное поле props/payload/манифеста, новое событие, новое разрешение,
   новый токен темы с дефолтом, новый необязательный параметр маршрута.
4. **Окно депрекации.** Устаревшее помечается `deprecated` (комментарий `@deprecated` + запись в changelog контракта) и
   живёт не менее одного MINOR-релиза платформы и 90 дней; удаление — только в следующем MAJOR. Для данных (снапшот)
   читатель старой версии обязан остаться (прецедент: `SNAPSHOT_VERSION` 1 отвергается явным сообщением —
   это сегодняшний минимум, а не целевое поведение).
5. **Проверка в CI** (G2, критерий): снимок публичных типов слотов и `host-api.ts`, который падает при изменении без bump.

### Не сделано

- Per-contract версии, кроме перечисленных выше; `requires.contracts` в манифесте.
- CI-снимок публичных типов слотов/`host-api.ts` и требование bump (критерий G2).
- Журнал изменений контрактов (changelog) и пометки `deprecated`.
- Проверка `requires.platform` при старте API и в менеджере компонентов (рантайм манифесты не читает).
