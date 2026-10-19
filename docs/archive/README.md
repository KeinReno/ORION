# Индекс исторических материалов ORION

**Срез индекса:** 19.10.2026. **Архив логический:** исходные пути не перемещаются, чтобы не сломать относительные ссылки на отчёты, скриншоты, ADR и evidence. **Это не список на удаление.**

| Архивный пакет | Исходное место | Что сохранено и почему | Что использовать сейчас |
|---|---|---|---|
| UI-аудит 11.10 | [UI_AUDIT_2026-10-11.md](../UI_AUDIT_2026-10-11.md) | Результаты браузерной проверки и исправления на старой сборке | [STATUS.md](../STATUS.md), [FRONTEND_WORKSPACE_SPEC.md](../FRONTEND_WORKSPACE_SPEC.md) |
| Первый редизайн 15–17.10 | [KAIDEN_ORION_REDESIGN_2026/](../KAIDEN_ORION_REDESIGN_2026/) | Документы 00, 06–29, HANDOFF и evidence — отчёты последовательных срезов; 01–05 остаются продуктовой базой требований, но оценки «не начато» исторические | [STATUS.md](../STATUS.md), утверждённые спецификации, актуальный UI |
| Волна 5 исполнителей 17–18.10 | [KAIDEN_REDESIGN_CURSOR_5_AGENTS_2026-10-17/](../KAIDEN_REDESIGN_CURSOR_5_AGENTS_2026-10-17/) | ТЗ 01–05 выполнены через PR #8–#12; инструкции `00`, `08` отражают **исходную** схему запуска Cursor, которая не была применена; отчёты `reports/AGENT_01..05.md` — доказательства | [STATUS.md](../STATUS.md), [07_NEXT_WAVES.md](../KAIDEN_REDESIGN_CURSOR_5_AGENTS_2026-10-17/07_NEXT_WAVES.md) после повторной сверки |
| Ревизионный архитектурный аудит 18.10 | [PLATFORM_AUDIT.md](../PLATFORM_AUDIT.md) | Исходная диагностика G1–G26 и поздние пометки, внутренние противоречия датированы; первоначальная очередь работ — история | [STATUS.md](../STATUS.md), [platform-api/](../platform-api/) |
| Срез Opportunity Hub 16.10 | [OPPORTUNITY_HUB_REVIEW_2026-10-16.md](../OPPORTUNITY_HUB_REVIEW_2026-10-16.md), [PROGRESS](../OPPORTUNITY_HUB_PROGRESS.md) | Проверки на конкретной ревизии, симуляция исполнителя — **не** реальная отправка HH | [STATUS.md](../STATUS.md), [OPPORTUNITY_HUB_SPEC.md](../OPPORTUNITY_HUB_SPEC.md) |
| Программа workspace и старый roadmap | [WORKSPACE_PROGRAM_2026-10.md](../WORKSPACE_PROGRAM_2026-10.md), [ROADMAP.md](../ROADMAP.md) | Постановки задач и срезы выполнения до основной Platform 1.0 | [PLATFORM.md](../PLATFORM.md), [STATUS.md](../STATUS.md) |
| Исследование донорских репозиториев | [PLATFORM_EXPANSION_2026-10-17/02_REPOSITORY_AUDIT.md](../PLATFORM_EXPANSION_2026-10-17/02_REPOSITORY_AUDIT.md) | Первичная инвентаризация, не security/code review | Проверить исходный репозиторий заново перед интеграцией |
| Прежние удалённые планы | [HISTORY.md](../HISTORY.md) | Git-история до 11 октября | Текущие документы |

**Не архивировать как неактуальные:** конституцию, [PLATFORM.md](../PLATFORM.md), модульные паспорта, действующие `ACCEPTED` ADR; [Agent Hub](../AGENT_HUB_ARCHITECTURE.md), [Android](../ANDROID_CLIENT_PLAN.md), [Orion Link](../ORION_LINK_ARCHITECTURE.md), [каталог идей](../PRODUCT_IDEAS_2026-10-18/ORION_MODULES_AND_PLUGINS_CATALOG.md), ещё не принятые ADR — это активные *предложения*, не завершённые задачи.

**Принцип:** перевод в HISTORICAL убирает документ из очереди исполнения, но не отменяет архитектурных контрактов, которые должны быть явно закреплены действующим документом.
