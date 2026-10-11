# Документация ORION

Для продуктового обзора начать с [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md), затем читать [ROADMAP.md](ROADMAP.md). Агент перед изменением кода сначала выполняет обязательный порядок чтения из [AGENTS.md](../AGENTS.md). Слово «планируется» не означает, что функция уже есть в коде.

| Задача | Документ |
| --- | --- |
| Архитектурные инварианты и правила для агента | [../AGENTS.md](../AGENTS.md), [../ORION_CONSTITUTION.md](../ORION_CONSTITUTION.md) |
| Граница Core / Module / Plugin и текущая миграция | [MODULES_AND_PLUGINS.md](MODULES_AND_PLUGINS.md), [AI_FIRST_EXTENSION_ARCHITECTURE.md](AI_FIRST_EXTENSION_ARCHITECTURE.md), [AI_REFACTOR_MIGRATION_MAP.md](AI_REFACTOR_MIGRATION_MAP.md) |
| Оболочка и UX существующих модулей | [FRONTEND_WORKSPACE_SPEC.md](FRONTEND_WORKSPACE_SPEC.md), [UI_AUDIT_2026-10-11.md](UI_AUDIT_2026-10-11.md) |
| Выход в закрытую бету | [DEPLOYMENT_READINESS.md](DEPLOYMENT_READINESS.md) |
| Автономный Windows-установщик | [WINDOWS_INSTALLER.md](WINDOWS_INSTALLER.md) |
| Многопользовательская модель и WebDAV | [SYNC.md](SYNC.md) |
| Поздние направления | [KNOWLEDGE_HUB.md](KNOWLEDGE_HUB.md), [INTEGRATIONS_COMPASS_FINCONTROL.md](INTEGRATIONS_COMPASS_FINCONTROL.md), [adr/](adr/) |
| Журнал текущей экстракции плагинов | [PLUGIN_EXTRACTION_LOG.md](PLUGIN_EXTRACTION_LOG.md) |

Исторические планы `PLAN.md`, `RELEASE_NOTES.md`, `UI_UX_DESIGN.md` и пакет `SONNET_IMPLEMENTATION/` удалены как конкурирующие точки входа. Их содержание доступно через [HISTORY.md](HISTORY.md); ключевые решения и открытые критерии отражены в документах выше. Старые результаты тестов не следует выдавать за проверку текущей ревизии.
