# AI context — Opportunities R0.1

Перед изменениями читать AGENTS → constitution → module/plugin/AI/refactor docs → MODULE.md → public opportunity contract → Hub spec/progress.

Редактировать только этот модуль, его публичные контракты, клиент/hooks/UI и необходимые registrations/migration/snapshot tests. Не переносить HH-скрипты и персональные данные в Base. Не создавать внешнюю отправку по status change.

Инварианты: assertMemberTx + ModulesService.assertEnabledTx внутри withUser; не доверять только controller guard; CAS updateMany по id/workspaceId/revision; owned lookup с workspaceId; DTO явно собран; отсутствие суммы = null. Export owner-only. Схемы strict, неизвестные поля не принимаются.

Текущая пагинация R0.1 — стабильный UUID id asc (осознанное отличие от проектируемой сортировки updatedAt/id: обновление карточки не сдвигает cursor). Новые запросы/профили/клиент не используют внутренности соседних модулей. Schema defaults применяются на input, response schema не должна изменять отсутствующие поля молча.

Отключение не удаляет. Opportunity классифицирован included в snapshot registry и перечислен в snapshot models. Новый FK требует проверки порядка restore. UI интегрирован в unsaved-drafts guard и keyed по workspace.

Следующий срез: публичные contracts/slots для profiles/import из ADR-0008, затем R0.2. Не объявлять R1 готовым: никаких автономных отправок, grant/runner/LLM в текущем коде нет.
