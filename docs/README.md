# Документация ORION

> **Порядок чтения (актуальность):** [правила жизненного цикла](DOCUMENTATION_LIFECYCLE.md) → [состояние на текущем master](STATUS.md) → [утверждённое направление](PLATFORM.md) → применимые [контракты платформы](platform-api/README.md), [ADR](adr/) и паспорт компонента `MODULE.md` / `AI_CONTEXT.md`. [Архивный индекс](archive/README.md) описывает завершённые волны без перемещения файлов и поломки ссылок.
>
> **Важно:** ранние ТЗ в [пакете 5 агентов](KAIDEN_REDESIGN_CURSOR_5_AGENTS_2026-10-17/) и [отчёты редизайна 00–29](KAIDEN_ORION_REDESIGN_2026/) — снимки исполнения. Результаты первой волны интегрированы PR #8–#12. Продолжение выбирать из актуального [STATUS.md](STATUS.md), а не из их первоначальных «не реализовано».

**Главный документ направления — [PLATFORM.md](PLATFORM.md)** (KAIDEN Orion Platform 1.0, утверждён 17.10.2026): приоритеты и этапы всей дальнейшей работы берутся из него. Текущее состояние кода, что проверено и что не сделано — [STATUS.md](STATUS.md). Для продуктового обзора начать с [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md), затем читать [ROADMAP.md](ROADMAP.md). Агент перед изменением кода сначала выполняет обязательный порядок чтения из [AGENTS.md](../AGENTS.md). Слово «планируется» не означает, что функция уже есть в коде.

| Задача | Документ |
| --- | --- |
| Архитектурные инварианты и правила для агента | [../AGENTS.md](../AGENTS.md), [../ORION_CONSTITUTION.md](../ORION_CONSTITUTION.md) |
| Граница Core / Module / Plugin и текущая миграция | [MODULES_AND_PLUGINS.md](MODULES_AND_PLUGINS.md), [AI_FIRST_EXTENSION_ARCHITECTURE.md](AI_FIRST_EXTENSION_ARCHITECTURE.md), [AI_REFACTOR_MIGRATION_MAP.md](AI_REFACTOR_MIGRATION_MAP.md) |
| Оболочка и UX существующих модулей | [FRONTEND_WORKSPACE_SPEC.md](FRONTEND_WORKSPACE_SPEC.md), [UI_AUDIT_2026-10-11.md](UI_AUDIT_2026-10-11.md) |
| Контекстная панель ресурсов и межмодульные связи (MVP этапа A реализован; этапы B–C — нет) | [CONTEXTUAL_RESOURCES_PANEL.md](CONTEXTUAL_RESOURCES_PANEL.md), [ADR-0014](adr/ADR-0014-context-resources-panel.md) |
| ТЗ для исполнителей: панель ресурсов, Agent Gateway/Manager, LAN, общие пространства, Hybrid Sync | [tz/README.md](tz/README.md) |
| Гибридная синхронизация (локальные копии, очередь записи; списки → заметки и задачи) | [SYNC.md](SYNC.md), [ADR-0016](adr/ADR-0016-hybrid-sync-protocol.md), [tz/TZ-06-hybrid-sync.md](tz/TZ-06-hybrid-sync.md) |
| Orion Link: LAN, WebDAV/S3, будущий собственный сервер (**спецификация, не готовый транспорт**) | [ORION_LINK_ARCHITECTURE.md](ORION_LINK_ARCHITECTURE.md) |
| Orion Agent Hub: общие задачи и сообщения между подписочными агентами (**проект**) | [AGENT_HUB_ARCHITECTURE.md](AGENT_HUB_ARCHITECTURE.md) |
| Orion Android: OPPO Reno8 5G, офлайн alpha задач/заметок; LAN пока подготовлен | [android/README.md](android/README.md), [план полного MVP](ANDROID_CLIENT_PLAN.md) |
| Выход в закрытую бету | [DEPLOYMENT_READINESS.md](DEPLOYMENT_READINESS.md) |
| Автономный Windows-установщик | [WINDOWS_INSTALLER.md](WINDOWS_INSTALLER.md) |
| Многопользовательская модель и WebDAV | [SYNC.md](SYNC.md) |
| KAIDEN Opportunity Hub: Base R0.1–R0.3, серверная симуляция R1; реальный hh.ru-адаптер отсутствует | [OPPORTUNITY_HUB_SPEC.md](OPPORTUNITY_HUB_SPEC.md), [OPPORTUNITY_HUB_PROGRESS.md](OPPORTUNITY_HUB_PROGRESS.md), [ADR-0008](adr/ADR-0008-opportunity-hub.md) |
| Agent Gateway: capture, context, связи, поиск, MCP в установленной версии, мастер «Подключить агента» (реализовано, ТЗ-02) | [ADR-0018](adr/ADR-0018-agent-gateway.md), [AGENT_MANUAL.md](AGENT_MANUAL.md), [tz/TZ-02-agent-gateway.md](tz/TZ-02-agent-gateway.md) |
| Agent Manager: режимы автономности, матрица прав, превью изменений, журнал и откат (реализовано, ТЗ-03) | [ADR-0007](adr/ADR-0007-ai-bridge.md), [ADR-0017](adr/ADR-0017-agent-remote-access.md) (удалённый доступ, без кода), [tz/TZ-03-agent-manager.md](tz/TZ-03-agent-manager.md) |
| LAN Host/Client: режимы узла, mDNS, доверие устройств, TLS (реализовано, ТЗ-04) | [ADR-0015](adr/ADR-0015-lan-host-client.md), [tz/TZ-04-lan-host-client.md](tz/TZ-04-lan-host-client.md), [WINDOWS_INSTALLER.md](WINDOWS_INSTALLER.md) |
| Общие пространства и доступ: «Дом» + личные, приглашения с ролью, аудит изоляции, перенос базы `.orion` как нового пространства (реализовано, ТЗ-05; п. 5.6 — нет) | [TEAM_AND_ACCESS.md](TEAM_AND_ACCESS.md), [tz/TZ-05-shared-workspaces-identity.md](tz/TZ-05-shared-workspaces-identity.md) |
| Поздние направления | [KNOWLEDGE_HUB.md](KNOWLEDGE_HUB.md), [INTEGRATIONS_COMPASS_FINCONTROL.md](INTEGRATIONS_COMPASS_FINCONTROL.md), [adr/](adr/) |
| Журнал текущей экстракции плагинов | [PLUGIN_EXTRACTION_LOG.md](PLUGIN_EXTRACTION_LOG.md) |

Исторические планы `PLAN.md`, `RELEASE_NOTES.md`, `UI_UX_DESIGN.md` и пакет `SONNET_IMPLEMENTATION/` удалены как конкурирующие точки входа. Их содержание доступно через [HISTORY.md](HISTORY.md); ключевые решения и открытые критерии отражены в документах выше. Старые результаты тестов не следует выдавать за проверку текущей ревизии.
