# AI context — Opportunities R0.1

Перед изменениями читать AGENTS → constitution → module/plugin/AI/refactor docs → MODULE.md → public opportunity contract → Hub spec/progress.

Редактировать только этот модуль, его публичные контракты, клиент/hooks/UI и необходимые registrations/migration/snapshot tests. Не переносить HH-скрипты и персональные данные в Base. Не создавать внешнюю отправку по status change.

Инварианты: assertMemberTx + ModulesService.assertEnabledTx внутри withUser; не доверять только controller guard; CAS updateMany по id/workspaceId/revision; owned lookup с workspaceId; DTO явно собран; отсутствие суммы = null. Export owner-only. Схемы strict, неизвестные поля не принимаются.

Текущая пагинация R0.1 — стабильный UUID id asc (осознанное отличие от проектируемой сортировки updatedAt/id: обновление карточки не сдвигает cursor). Новые запросы/профили/клиент не используют внутренности соседних модулей. Schema defaults применяются на input, response schema не должна изменять отсутствующие поля молча.

Отключение не удаляет. Opportunity классифицирован included в snapshot registry и перечислен в snapshot models. Новый FK требует проверки порядка restore. UI интегрирован в unsaved-drafts guard и keyed по workspace.

Публичные contracts/slots R0.2: opportunities/public.ts и import-contract.ts, typed opportunities.views / opportunities.details.sections. Insert-only import не меняет существующую карточку. Profiles/HH принадлежит отдельным optional default-off plugins; их private tables/services запрещены для Base. Не объявлять R1 готовым: никаких автономных отправок, grant/runner/LLM в текущем коде нет.

<!-- generated:manifest:start -->
## Для агента (генерируется)

Блок собирается `pnpm module-docs`; руками не править.

- Точки входа: API `workspaces/:workspaceId/opportunities` (за `@RequireModule("opportunities")`); панель веба `opportunities`; код `apps/api/src/opportunities/`.
- Права: `opportunities.opportunity.read`, `opportunities.opportunity.create`, `opportunities.opportunity.update`, `opportunities.opportunity.delete`.
- Модуль владеет: Карточки возможностей, источник, условия и ручной жизненный цикл.
- Соседи: жёсткие: —; мягкие: —; чужие данные читать только через их публичный контракт, мягких соседей спрашивать через `isEnabled`.
- Расширения: плагины: `opportunities-profiles`, `opportunities-hh-import`, `opportunities-assistant`, `opportunities-execution`, `opportunities-manager`.
- Выключение модуля не удаляет данные; новые таблицы — только с ENABLE + FORCE RLS и записью в реестре снапшота.
<!-- generated:manifest:end -->
